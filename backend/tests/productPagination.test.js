// Tests for server-side pagination + sort in productController.getProducts (#1139).
// The DB module is mocked so the SQL and response envelope can be asserted
// without a live MySQL connection.

jest.mock("../config/db", () => ({ query: jest.fn() }));

const db = require("../config/db");
const { getProducts } = require("../controllers/productController");

function mockRes() {
    return {
        statusCode: null,
        body: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(payload) {
            this.body = payload;
            return this;
        }
    };
}

function stubDb(total, rows) {
    db.query.mockImplementation(async (sql) => {
        if (/SELECT COUNT/.test(sql)) {
            return [[{ total }]];
        }
        return [rows];
    });
}

function lastProductQuery() {
    const call = db.query.mock.calls.find(([sql]) =>
        /FROM products[\s\S]*LIMIT/.test(sql)
    );
    return call || [null, null];
}

describe("getProducts — server-side pagination", () => {
    beforeEach(() => {
        db.query.mockReset();
    });

    test("returns pagination metadata (page/limit/total/totalPages)", async () => {
        stubDb(42, [{ id: 2 }, { id: 1 }]);
        const res = mockRes();

        await getProducts({ query: { page: "2", limit: "12" } }, res);

        expect(res.statusCode).toBe(200);
        expect(res.body).toMatchObject({
            success: true,
            page: 2,
            limit: 12,
            total: 42,
            totalPages: 4,
            hasNextPage: true,
            hasPrevPage: true
        });
        expect(Array.isArray(res.body.products)).toBe(true);
    });

    test("uses LIMIT/OFFSET derived from page and limit", async () => {
        stubDb(42, [{ id: 1 }]);
        const res = mockRes();

        await getProducts({ query: { page: "3", limit: "10" } }, res);

        const [, params] = lastProductQuery();
        // page 3, limit 10 → LIMIT 10 OFFSET 20
        expect(params.slice(-2)).toEqual([10, 20]);
    });

    test("caps limit at the maximum page size", async () => {
        stubDb(500, [{ id: 1 }]);
        const res = mockRes();

        await getProducts({ query: { page: "1", limit: "999" } }, res);

        expect(res.body.limit).toBe(50);
    });

    test("rejects invalid page with 400", async () => {
        stubDb(0, []);
        const res = mockRes();

        await getProducts({ query: { page: "-1" } }, res);

        expect(res.statusCode).toBe(400);
        expect(res.body.success).toBe(false);
    });
});

describe("getProducts — sorting", () => {
    beforeEach(() => {
        db.query.mockReset();
        stubDb(10, [{ id: 1 }]);
    });

    // Columns are matched with an optional `p.` qualifier.
    //
    // The catalogue query grew a `LEFT JOIN categories c`, at which point every
    // products column had to be qualified (`p.price`, `p.id`) or MySQL would
    // reject the statement as ambiguous. The production change was correct;
    // these patterns were not updated with it and asserted on the unqualified
    // spelling, so all seven of these cases failed on `main` (#1341).
    //
    // Tolerating the qualifier keeps the assertion about *ordering semantics*,
    // which is what this suite is for, instead of about SQL formatting -- so
    // the next join does not break it again.
    const col = (name) => `(?:\\w+\\.)?${name}`;
    const orderBy = (...columns) =>
        new RegExp(`ORDER BY\\s+${columns.map(([c, dir]) => `${col(c)} ${dir}`).join(", ")}`);

    const cases = [
        ["price-low-high", orderBy(["price", "ASC"], ["id", "DESC"])],
        ["price-high-low", orderBy(["price", "DESC"], ["id", "DESC"])],
        ["popularity", orderBy(["num_reviews", "DESC"], ["id", "DESC"])],
        ["highest-rated", orderBy(["rating", "DESC"], ["id", "DESC"])],
        ["alphabetical-az", orderBy(["name", "ASC"], ["id", "DESC"])]
    ];

    test.each(cases)("maps sort=%s to the expected ORDER BY", async (sort, pattern) => {
        const res = mockRes();
        await getProducts({ query: { sort } }, res);
        const [sql] = lastProductQuery();
        expect(sql).toMatch(pattern);
    });

    test("falls back to newest (id DESC) for an unknown sort", async () => {
        const res = mockRes();
        await getProducts({ query: { sort: "not-a-real-sort" } }, res);
        const [sql] = lastProductQuery();
        expect(sql).toMatch(/ORDER BY\s+(?:\w+\.)?id DESC\s+LIMIT/);
    });

    test("defaults to newest (id DESC) when no sort is given", async () => {
        const res = mockRes();
        await getProducts({ query: {} }, res);
        const [sql] = lastProductQuery();
        expect(sql).toMatch(/ORDER BY\s+(?:\w+\.)?id DESC\s+LIMIT/);
    });
});
