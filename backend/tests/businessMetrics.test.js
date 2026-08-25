// The business metrics, the columns they read, and who may read them (#1529).
//
// Every money figure this service produced was summed from `orders.total_amount`
// -- a column that does not exist -- and filtered on `status = 'completed'`,
// which is not a member of the `orders.status` ENUM. So average order value,
// customer lifetime value, revenue growth and coupon effectiveness all failed,
// and `/dashboard` awaits several of them at once, so it failed with them.
//
// Two of the defects are not about columns:
//
//   * `getCustomerLifetimeValue` built its threshold with
//     `query.replace('ORDER BY', 'HAVING order_count >= ${filters.minOrders} …')`
//     and `filters` is `req.query` spread from the URL.
//   * every route was `authMiddleware` and nothing more, and
//     /customer-lifetime-value returns the names and spend of the hundred
//     biggest customers.

jest.mock("../config/db", () => {
    const query = jest.fn();
    return { query, promise: { query }, getConnection: jest.fn() };
});

const fs = require("fs");
const path = require("path");

const db = require("../config/db");
const {
    MetricsAggregationService,
    MetricsError,
    TIME_PERIODS,
    assertSupportedFilters
} = require("../services/metricsAggregationService");

/** Every statement issued, whitespace collapsed. */
const statements = () =>
    db.query.mock.calls.map(([sql]) => String(sql).replace(/\s+/g, " ").trim());

const paramsOf = (index = 0) => db.query.mock.calls[index][1];

let metrics;

beforeEach(() => {
    db.query.mockReset();
    db.query.mockResolvedValue([[{}]]);
    // A fresh instance per test: the service caches by metric and period, and
    // a cached answer issues no statement to assert on.
    metrics = new MetricsAggregationService();
});

// ---------------------------------------------------------------------------
// The columns the money comes from
// ---------------------------------------------------------------------------

describe("what a metric sums", () => {
    const MONEY_METRICS = [
        ["average order value", (m) => m.getAverageOrderValue(TIME_PERIODS.WEEK)],
        ["customer lifetime value", (m) => m.getCustomerLifetimeValue(TIME_PERIODS.MONTH)],
        ["revenue growth", (m) => m.getRevenueGrowth(TIME_PERIODS.MONTH)],
        ["coupon effectiveness", (m) => m.getCouponEffectiveness(TIME_PERIODS.WEEK)]
    ];

    test.each(MONEY_METRICS)("%s reads orders.total", async (_label, run) => {
        await run(metrics);

        const money = statements().filter((sql) => /SUM\(|AVG\(/.test(sql));

        expect(money.length).toBeGreaterThan(0);

        for (const sql of money) {
            expect(sql).not.toMatch(/total_amount/);
            expect(sql).toMatch(/o\.total/);
        }
    });

    test.each(MONEY_METRICS)(
        "%s does not filter on a status the enum has no member for",
        async (_label, run) => {
            await run(metrics);

            for (const sql of statements()) {
                // 'completed' is not one of pending, processing, shipped,
                // delivered, cancelled, refunded, on_hold.
                expect(sql).not.toMatch(/status = 'completed'/);
            }
        }
    );

    test.each(MONEY_METRICS)("%s excludes cancelled and refunded orders", async (_label, run) => {
        await run(metrics);

        const money = statements().filter((sql) => /FROM orders|JOIN orders/.test(sql));

        expect(money.length).toBeGreaterThan(0);

        for (const sql of money) {
            expect(sql).toMatch(/NOT IN \('cancelled', 'refunded'\)/);
        }
    });
});

// ---------------------------------------------------------------------------
// The clause that was in the wrong place
// ---------------------------------------------------------------------------

describe("coupon effectiveness", () => {
    test("puts the type filter in the WHERE clause, not after ORDER BY", async () => {
        await metrics.getCouponEffectiveness(TIME_PERIODS.WEEK, {
            couponType: "percentage"
        });

        const sql = statements()[0];

        // It used to append ` AND c.discount_type = ?` after
        // `ORDER BY revenue_generated DESC`, which is a syntax error.
        expect(sql).toMatch(/WHERE[\s\S]*discount_type = \?[\s\S]*GROUP BY/);
        expect(sql).not.toMatch(/ORDER BY[\s\S]*AND c\.discount_type/);
        expect(paramsOf(0)).toContain("percentage");
    });

    test("joins orders on the column the order path writes", async () => {
        await metrics.getCouponEffectiveness(TIME_PERIODS.WEEK);

        // `orders.coupon_code` does not exist; the applied code is written to
        // promo_code and discount_code.
        expect(statements()[0]).not.toMatch(/coupon_code/);
        expect(statements()[0]).toMatch(/o\.promo_code = c\.code/);
    });
});

// ---------------------------------------------------------------------------
// The interpolated filter
// ---------------------------------------------------------------------------

describe("customer lifetime value", () => {
    test("passes the order threshold as a parameter", async () => {
        await metrics.getCustomerLifetimeValue(TIME_PERIODS.MONTH, { minOrders: 3 });

        const sql = statements()[0];

        expect(sql).toMatch(/HAVING order_count >= \?/);
        expect(paramsOf(0)).toContain(3);
    });

    test("does not concatenate a query parameter into the statement", async () => {
        const injection = "1 UNION SELECT id, email, password, 1, 1, 1, 1 FROM users -- ";

        await metrics.getCustomerLifetimeValue(TIME_PERIODS.MONTH, {
            minOrders: injection
        });

        const sql = statements()[0];

        expect(sql).not.toContain("UNION");
        expect(sql).not.toContain("password");
        // parseInt of that string is 1, and 1 is what the parameter becomes.
        expect(paramsOf(0)).toContain(1);
    });

    test("has exactly one HAVING clause", async () => {
        await metrics.getCustomerLifetimeValue(TIME_PERIODS.MONTH, { minOrders: 5 });

        const having = statements()[0].match(/HAVING/g) || [];

        // The replace-based version produced two, which MySQL rejects.
        expect(having).toHaveLength(1);
    });
});

// ---------------------------------------------------------------------------
// Filters that are not implemented
// ---------------------------------------------------------------------------

describe("an unsupported filter", () => {
    test("is refused rather than ignored", async () => {
        await expect(
            metrics.getAverageOrderValue(TIME_PERIODS.WEEK, { userSegment: "vip" })
        ).rejects.toThrow(MetricsError);
    });

    test("is refused with a 400, not a 500", async () => {
        expect.assertions(2);

        try {
            await metrics.getRevenueGrowth(TIME_PERIODS.MONTH, { region: "west" });
        } catch (error) {
            expect(error.status).toBe(400);
            expect(error.code).toBe("UNSUPPORTED_FILTER");
        }
    });

    test("names both what was asked for and what is available", () => {
        try {
            assertSupportedFilters({ userSegment: "vip" }, ["category"]);
        } catch (error) {
            expect(error.message).toContain("userSegment");
            expect(error.message).toContain("category");
        }
    });

    test("an empty or absent filter is not treated as one", () => {
        expect(() =>
            assertSupportedFilters({ category: undefined, userSegment: "" }, [])
        ).not.toThrow();
    });

    test("a supported filter still works", async () => {
        await metrics.getAverageOrderValue(TIME_PERIODS.WEEK, { category: 3 });

        // A category belongs to what was in the order, not to the order.
        expect(statements()[0]).toMatch(/EXISTS \( SELECT 1 FROM order_items oi/);
        expect(paramsOf(0)).toContain(3);
    });
});

// ---------------------------------------------------------------------------
// Metrics that cannot be computed
// ---------------------------------------------------------------------------

describe("recommendation CTR", () => {
    test("says it is unavailable instead of querying a table that does not exist", async () => {
        const result = await metrics.getRecommendationCTR(TIME_PERIODS.WEEK);

        expect(result.available).toBe(false);
        expect(result.reason).toMatch(/impressions are not recorded/i);
        expect(db.query).not.toHaveBeenCalled();
    });

    test("does not report a fabricated rate", async () => {
        const result = await metrics.getRecommendationCTR(TIME_PERIODS.WEEK);

        // null, not 0. "We do not measure this" and "nobody clicked" are
        // different statements and a dashboard should not confuse them.
        expect(result.value).toBeNull();
        expect(result.impressions).toBeNull();
    });

    test("no longer takes the dashboard down with it", async () => {
        const dashboard = await metrics.getDashboard(TIME_PERIODS.WEEK);

        expect(dashboard.metrics.recommendationCTR.available).toBe(false);
        expect(dashboard.summary).toBeDefined();
    });
});

// ---------------------------------------------------------------------------
// Churn
// ---------------------------------------------------------------------------

describe("churn rate", () => {
    test("counts only shoppers who were active before the window", async () => {
        await metrics.getChurnRate(TIME_PERIODS.MONTH);

        const [, churned] = statements();

        // The previous version counted every account older than the window
        // that had not ordered inside it -- almost the whole register, most of
        // whom were never active and so cannot have churned.
        expect(churned).toMatch(/FROM orders prior/);
        expect(churned).toMatch(/NOT EXISTS/);
        expect(churned).not.toMatch(/FROM users u/);
    });

    test("is not defeated by a guest order in the window", async () => {
        await metrics.getChurnRate(TIME_PERIODS.MONTH);

        const [, churned] = statements();

        // A guest order carries a null user_id, and `id NOT IN (… NULL …)` is
        // never true for any row -- so one guest order made churn zero.
        expect(churned).not.toMatch(/NOT IN \(\s*SELECT/);
        expect(churned).toMatch(/prior\.user_id IS NOT NULL/);
    });
});

// ---------------------------------------------------------------------------
// Who may read any of this
// ---------------------------------------------------------------------------

describe("the metrics routes", () => {
    const source = fs.readFileSync(
        path.join(__dirname, "..", "routes", "metricsRoutes.js"),
        "utf8"
    );

    test("require an admin, at the router", () => {
        expect(source).toMatch(/router\.use\(authMiddleware\)/);
        expect(source).toMatch(/router\.use\(authorizeRoles\(ROLES\.ADMIN\)\)/);
    });

    test("declare the guard before the first route", () => {
        // Applied at the router and before anything is mounted, so a route
        // added later cannot be missing it -- which is how nine of them came
        // to be readable by any signed-in shopper.
        const guard = source.indexOf("authorizeRoles(ROLES.ADMIN)");
        const firstRoute = source.search(/router\.(get|post)\(/);

        expect(guard).toBeGreaterThan(-1);
        expect(guard).toBeLessThan(firstRoute);
    });

    test("carry the status an error names", () => {
        // Without this an unsupported filter is reported as a server error,
        // which hides whose mistake it was.
        expect(source).toMatch(/const status = error\.status \|\| 500/);
    });
});

// ---------------------------------------------------------------------------
// The interval
// ---------------------------------------------------------------------------

describe("the hourly aggregation", () => {
    test("keeps a handle that shutdown can clear", async () => {
        db.query.mockResolvedValue([[]]);

        await metrics.initialize();

        expect(metrics.aggregationTimer).not.toBeNull();

        metrics.shutdown();

        expect(metrics.aggregationTimer).toBeNull();
    });
});
