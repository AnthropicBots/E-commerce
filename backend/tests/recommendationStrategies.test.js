// The recommendation strategies, and the schema they query (#1525).
//
// Every strategy selected `p.image_url` and `p.category`, and four of them
// joined `orders o ON o.product_id = p.id`. None of those exist: the columns
// are `image` and `category_id`, and a product id on a purchase lives in
// `order_items`. Each strategy caught the resulting ER_BAD_FIELD_ERROR and
// returned `[]`, so `GET /api/recommendations` answered 200 with an empty list
// and the homepage showed "Explore more products to get personalized
// recommendations!" to everybody.
//
// Two kinds of test here:
//
//   * the SQL each strategy issues, checked against the column and table names
//     the migrations define. `db.query` is mocked, so a mock would accept
//     `p.image_url` happily -- only reading the statement can catch it.
//   * what a failure does. The old code turned "this query does not compile"
//     into "we have nothing to suggest", which is why it survived.

jest.mock("../config/db", () => ({
    query: jest.fn(),
    getConnection: jest.fn()
}));

jest.mock("../utils/logger", () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
}));

const fs = require("fs");
const path = require("path");

const db = require("../config/db");
const logger = require("../utils/logger");
const {
    RecommendationStrategyFactory,
    STRATEGY_TYPES,
    MAX_LIMIT,
    clampLimit,
    toRecommendation,
    TrendingStrategy,
    RecentlyViewedStrategy,
    CollaborativeStrategy,
    ContentBasedStrategy,
    HybridStrategy,
    PromotionalStrategy,
    PersonalizedStrategy
} = require("../services/recommendationStrategyService");

const USER_ID = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";

/** A product row shaped like the columns the strategies select. */
const productRow = (overrides = {}) => ({
    id: "3f2504e0-4f89-11d3-9a0c-0305e82c3302",
    name: "Cotton shirt",
    price: 800,
    compare_price: 1000,
    image: "shirt.jpg",
    stock: 5,
    rating: 4.5,
    num_reviews: 12,
    category_id: 3,
    category: "Shirts",
    ...overrides
});

/** Everything the strategy asked the database, whitespace collapsed. */
const statements = () =>
    db.query.mock.calls.map(([sql]) => String(sql).replace(/\s+/g, " ").trim());

beforeEach(() => {
    db.query.mockReset();
    logger.error.mockClear();
});

// ---------------------------------------------------------------------------
// Columns and tables that do not exist
// ---------------------------------------------------------------------------

describe("the schema the strategies query", () => {
    /** Names that appear nowhere in the migrations. */
    const IMAGINARY = [
        /\bp\.image_url\b/,
        /\bp\.category\b(?!_id)/,
        /\bp\.discount_price\b/,
        /\bp\.discount_percentage\b/,
        /\bo\.product_id\b/,
        /\bu\.preferences\b/,
        /\bo\.total_amount\b/
    ];

    const EVERY_STRATEGY = [
        ["trending", () => new TrendingStrategy()],
        ["recently viewed", () => new RecentlyViewedStrategy()],
        ["collaborative", () => new CollaborativeStrategy()],
        ["content-based", () => new ContentBasedStrategy()],
        ["promotional", () => new PromotionalStrategy()],
        ["personalized", () => new PersonalizedStrategy()]
    ];

    test.each(EVERY_STRATEGY)(
        "%s asks only for columns that exist",
        async (_label, build) => {
            db.query.mockResolvedValue([[productRow()]]);

            await build().getRecommendations(USER_ID, 5);

            expect(statements().length).toBeGreaterThan(0);

            for (const sql of statements()) {
                for (const pattern of IMAGINARY) {
                    expect(sql).not.toMatch(pattern);
                }
            }
        }
    );

    test("the source file names no column the migrations do not define", () => {
        // A static sweep as well as the per-strategy checks, so a query added
        // to a branch nobody exercises is covered too.
        const source = fs.readFileSync(
            path.join(__dirname, "..", "services", "recommendationStrategyService.js"),
            "utf8"
        );

        // Read out of the schema rather than listed here, so a column added
        // by a migration tomorrow counts without editing this test.
        const schema = fs.readFileSync(
            path.join(__dirname, "..", "..", "migrations", "0001_baseline_schema.sql"),
            "utf8"
        );

        const productColumns = new Set();
        const table = schema.slice(
            schema.indexOf("CREATE TABLE IF NOT EXISTS products")
        );

        for (const match of table.slice(0, table.indexOf("ENGINE=")).matchAll(
            /^\s{4}(\w+)\s+[A-Z]/gm
        )) {
            productColumns.add(match[1]);
        }

        // Sanity: the parse found the table, not an empty set.
        expect(productColumns.has("image")).toBe(true);
        expect(productColumns.has("compare_price")).toBe(true);
        expect(productColumns.has("image_url")).toBe(false);

        // Comments are stripped first: the header of that file names the
        // columns it used to read wrongly, and those are the point of it.
        const code = source
            .replace(/\/\*[\s\S]*?\*\//g, "")
            .replace(/^\s*\/\/.*$/gm, "");

        for (const match of code.matchAll(/\bp\.(\w+)\b/g)) {
            expect(productColumns).toContain(match[1]);
        }
    });
});

// ---------------------------------------------------------------------------
// Purchases come from order_items
// ---------------------------------------------------------------------------

describe("where a purchase is read from", () => {
    test("collaborative filtering joins order_items, not orders.product_id", async () => {
        db.query
            .mockResolvedValueOnce([[{ user_id: "other-user", shared: 2 }]])
            .mockResolvedValueOnce([[productRow()]]);

        await new CollaborativeStrategy().getRecommendations(USER_ID, 5);

        const [similar, products] = statements();

        expect(similar).toMatch(/FROM order_items oi1/);
        expect(similar).toMatch(/JOIN orders o1 ON o1\.id = oi1\.order_id/);
        expect(products).toMatch(/JOIN order_items oi ON oi\.product_id = p\.id/);
    });

    test("content-based reads categories through order_items", async () => {
        db.query
            .mockResolvedValueOnce([[{ category_id: 3, purchases: 4 }]])
            .mockResolvedValueOnce([[productRow()]]);

        await new ContentBasedStrategy().getRecommendations(USER_ID, 5);

        expect(statements()[0]).toMatch(/FROM order_items oi/);
        expect(statements()[0]).toMatch(/p\.category_id/);
    });

    test("cancelled and refunded orders are not treated as purchases", async () => {
        db.query
            .mockResolvedValueOnce([[{ category_id: 3, purchases: 4 }]])
            .mockResolvedValueOnce([[productRow()]]);

        await new ContentBasedStrategy().getRecommendations(USER_ID, 5);

        expect(statements()[0]).toMatch(/NOT IN \('cancelled', 'refunded'\)/);
    });

    test("trending counts sales, views and saves without multiplying them", async () => {
        db.query.mockResolvedValue([[productRow({ sales_count: 3, view_count: 9, wishlist_count: 2, days_old: 10 })]]);

        await new TrendingStrategy().getRecommendations(USER_ID, 5);

        const sql = statements()[0];

        // Three LEFT JOINs onto one product row multiply each other -- 3 sales
        // and 9 views count as 27 of each -- so each total is its own
        // aggregate subquery.
        expect(sql).toMatch(/LEFT JOIN \( SELECT oi\.product_id, SUM\(oi\.qty\)/);
        expect(sql).toMatch(/LEFT JOIN \( SELECT product_id, COUNT\(\*\) AS total FROM product_views/);
    });

    test("trending does not divide by the age of a product added today", async () => {
        db.query.mockResolvedValue([[productRow()]]);

        await new TrendingStrategy().getRecommendations(USER_ID, 5);

        // `1/DATEDIFF(NOW(), created_at)` is a division by zero for anything
        // added today, which MySQL answers as NULL and which then poisons the
        // whole ORDER BY expression.
        expect(statements()[0]).toMatch(/DATEDIFF\(NOW\(\), p\.created_at\) \+ 1/);
        expect(statements()[0]).not.toMatch(/1 \/ DATEDIFF\(NOW\(\), p\.created_at\)\s*\)/);
    });
});

// ---------------------------------------------------------------------------
// Failure is reported, not swallowed
// ---------------------------------------------------------------------------

describe("when a query fails", () => {
    test("the strategy raises instead of answering with an empty list", async () => {
        db.query.mockRejectedValue(new Error("ER_BAD_FIELD_ERROR"));

        await expect(
            new TrendingStrategy().getRecommendations(USER_ID, 5)
        ).rejects.toThrow("ER_BAD_FIELD_ERROR");

        expect(logger.error).toHaveBeenCalledWith(
            expect.stringContaining("Trending Products strategy failed")
        );
    });

    test("the hybrid mix survives one strategy failing", async () => {
        const hybrid = new HybridStrategy();

        jest.spyOn(hybrid.strategies[0], "getRecommendations")
            .mockRejectedValue(new Error("trending is down"));
        jest.spyOn(hybrid.strategies[1], "getRecommendations")
            .mockResolvedValue([toRecommendation(productRow(), { score: 1 })]);
        jest.spyOn(hybrid.strategies[2], "getRecommendations").mockResolvedValue([]);
        jest.spyOn(hybrid.strategies[3], "getRecommendations").mockResolvedValue([]);

        const results = await hybrid.getRecommendations(USER_ID, 8);

        expect(results).toHaveLength(1);
    });

    test("the hybrid mix raises when every strategy fails", async () => {
        const hybrid = new HybridStrategy();

        for (const strategy of hybrid.strategies) {
            jest.spyOn(strategy, "getRecommendations")
                .mockRejectedValue(new Error("database is down"));
        }

        // Four failed lookups is not "we have no suggestions for you".
        await expect(hybrid.getRecommendations(USER_ID, 8)).rejects.toThrow(
            "database is down"
        );
    });
});

// ---------------------------------------------------------------------------
// The shape handed back
// ---------------------------------------------------------------------------

describe("the recommendation each strategy returns", () => {
    test("carries the image column the catalogue has", async () => {
        db.query.mockResolvedValue([[productRow()]]);

        const [item] = await new PromotionalStrategy().getRecommendations(USER_ID, 5);

        expect(item.image).toBe("shirt.jpg");
        expect(item.imageUrl).toBe("shirt.jpg");
    });

    test("derives the discount from compare_price", async () => {
        db.query.mockResolvedValue([
            [productRow({ price: 800, compare_price: 1000, discount_percentage: 20 })]
        ]);

        const [item] = await new PromotionalStrategy().getRecommendations(USER_ID, 5);

        expect(item.original_price).toBe(1000);
        expect(item.discount).toBe(20);
    });

    test("reports no discount for a product at its normal price", async () => {
        db.query.mockResolvedValue([[productRow({ price: 800, compare_price: null })]]);

        const [item] = await new TrendingStrategy().getRecommendations(USER_ID, 5);

        // null rather than 0, so the card renders no badge at all.
        expect(item.discount).toBeNull();
        expect(item.original_price).toBeNull();
    });

    test("names the category rather than its id alone", async () => {
        db.query.mockResolvedValue([[productRow()]]);

        const [item] = await new TrendingStrategy().getRecommendations(USER_ID, 5);

        expect(item.category).toBe("Shirts");
        expect(item.categoryId).toBe(3);
    });
});

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

describe("the limit", () => {
    test.each([
        ["a sane number", 12, 12],
        ["absent", undefined, 10],
        ["zero", 0, 10],
        ["negative", -5, 10],
        ["not a number", "many", 10],
        ["absurd", 100000, MAX_LIMIT]
    ])("a limit that is %s", (_label, given, expected) => {
        expect(clampLimit(given)).toBe(expected);
    });

    test("reaches the SQL clamped", async () => {
        db.query.mockResolvedValue([[]]);

        await new PromotionalStrategy().getRecommendations(USER_ID, 100000);

        const [, params] = db.query.mock.calls[0];

        expect(params[params.length - 1]).toBe(MAX_LIMIT);
    });
});

// ---------------------------------------------------------------------------
// Fallbacks
// ---------------------------------------------------------------------------

describe("shoppers with no history", () => {
    test("personalized falls back to hybrid for someone who has never ordered", async () => {
        db.query.mockResolvedValueOnce([[{ total_orders: 0 }]]);
        db.query.mockResolvedValue([[productRow()]]);

        const results = await new PersonalizedStrategy().getRecommendations(USER_ID, 4);

        // The previous version read total_orders off the rows array rather
        // than a row, so this branch was `undefined === 0` and never taken.
        expect(Array.isArray(results)).toBe(true);
        expect(statements()[0]).toMatch(/COUNT\(\*\) AS total_orders/);
    });

    test("collaborative returns nothing when no similar shopper exists", async () => {
        db.query.mockResolvedValueOnce([[]]);

        const results = await new CollaborativeStrategy().getRecommendations(USER_ID, 5);

        expect(results).toEqual([]);
        // No second query — there is nobody to look up products for.
        expect(db.query).toHaveBeenCalledTimes(1);
    });
});

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

describe("the factory", () => {
    test.each(Object.values(STRATEGY_TYPES))("builds %s", (type) => {
        const strategy = RecommendationStrategyFactory.createStrategy(type);

        expect(strategy.type).toBe(type);
        expect(typeof strategy.getRecommendations).toBe("function");
    });

    test("falls back to hybrid for a strategy nobody has written", () => {
        expect(RecommendationStrategyFactory.createStrategy("astrology").type).toBe(
            STRATEGY_TYPES.HYBRID
        );
    });

    test("lists every strategy the factory can build", () => {
        const listed = RecommendationStrategyFactory.getAllStrategies().map((s) => s.type);

        expect(new Set(listed)).toEqual(new Set(Object.values(STRATEGY_TYPES)));
    });
});
