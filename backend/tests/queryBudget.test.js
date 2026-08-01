/**
 * SQL query budget & slow-query circuit breaker tests (#1391).
 */

process.env.QUERY_BUDGET_ENABLED = "true";
process.env.QUERY_BUDGET_MAX = "5";
process.env.QUERY_SLOW_MS = "50";
process.env.QUERY_CIRCUIT_RETRY_AFTER_SEC = "15";
process.env.QUERY_CIRCUIT_TRIP_THRESHOLD = "3";
process.env.QUERY_CIRCUIT_WINDOW_MS = "60000";
process.env.QUERY_BUDGET_BYPASS = "false";

// Re-require after env so CONFIG picks up test values — module caches CONFIG at load.
jest.resetModules();

const { sanitizeSql, logSlowQuery } = require("../utils/slowQueryLogger");

describe("slowQueryLogger (#1391)", () => {
    test("sanitizeSql redacts string literals and long numbers", () => {
        const sql =
            "SELECT * FROM users WHERE email = 'alice@example.com' AND id = 1234567890";
        const cleaned = sanitizeSql(sql);
        expect(cleaned).not.toContain("alice@example.com");
        expect(cleaned).toContain("'?'");
        expect(cleaned).not.toContain("1234567890");
    });

    test("logSlowQuery returns sanitized payload with route attribution", () => {
        const payload = logSlowQuery({
            sql: "UPDATE products SET name = 'Secret' WHERE id = 1",
            durationMs: 1200,
            route: "/api/products",
            method: "GET",
            requestId: "corr_test"
        });
        expect(payload.type).toBe("slow_query");
        expect(payload.route).toBe("/api/products");
        expect(payload.method).toBe("GET");
        expect(payload.sql).not.toContain("Secret");
        expect(payload.durationMs).toBe(1200);
    });
});

describe("queryBudgetMiddleware (#1391)", () => {
    let qb;

    beforeEach(() => {
        jest.resetModules();
        process.env.QUERY_BUDGET_ENABLED = "true";
        process.env.QUERY_BUDGET_MAX = "5";
        process.env.QUERY_SLOW_MS = "50";
        process.env.QUERY_CIRCUIT_RETRY_AFTER_SEC = "15";
        process.env.QUERY_CIRCUIT_TRIP_THRESHOLD = "3";
        process.env.QUERY_BUDGET_BYPASS = "false";
        qb = require("../middleware/queryBudgetMiddleware");
        qb.resetQueryBudgetState();
        // Override CONFIG for deterministic tests (module already read env)
        qb.CONFIG.maxQueries = 5;
        qb.CONFIG.slowMs = 50;
        qb.CONFIG.enabled = true;
        qb.CONFIG.globalBypass = false;
        qb.CONFIG.tripThreshold = 3;
        qb.CONFIG.retryAfterSec = 15;
    });

    test("counts queries inside a request context and trips at budget", () => {
        qb.runWithQueryBudget({ route: "/api/loop", routeKey: "GET /api/loop" }, () => {
            for (let i = 0; i < 5; i++) {
                qb.recordQueryExecution({
                    phase: "begin",
                    sql: `SELECT ${i}`
                });
                qb.recordQueryExecution({
                    phase: "finish",
                    sql: `SELECT ${i}`,
                    durationMs: 1
                });
            }

            expect(() =>
                qb.recordQueryExecution({
                    phase: "begin",
                    sql: "SELECT too_many"
                })
            ).toThrow(qb.QueryBudgetError);

            try {
                qb.recordQueryExecution({
                    phase: "begin",
                    sql: "SELECT too_many"
                });
            } catch (err) {
                expect(err.code).toBe("QUERY_BUDGET_EXCEEDED");
                expect(err.status).toBe(503);
                expect(err.retryAfter).toBe(15);
            }
        });
    });

    test("bypass skips budget for migrations/jobs", () => {
        qb.runWithQueryBudgetBypass(() => {
            for (let i = 0; i < 20; i++) {
                const result = qb.recordQueryExecution({
                    phase: "begin",
                    sql: `SELECT bypass_${i}`
                });
                expect(result.counted).toBe(false);
            }
        });
    });

    test("no ALS context is treated as bypass (background work)", () => {
        const result = qb.recordQueryExecution({
            phase: "begin",
            sql: "SELECT 1"
        });
        expect(result.counted).toBe(false);
    });

    test("slow queries are attributed on finish", () => {
        qb.runWithQueryBudget({ route: "/api/slow", routeKey: "GET /api/slow" }, () => {
            qb.recordQueryExecution({ phase: "begin", sql: "SELECT sleep" });
            qb.recordQueryExecution({
                phase: "finish",
                sql: "SELECT sleep",
                durationMs: 200
            });
            const ctx = qb.getActiveBudgetContext();
            expect(ctx.slowCount).toBe(1);
        });
    });

    test("middleware returns 503 with Retry-After when route circuit is open", () => {
        const key = "GET /api/hot";
        // Force-open the circuit
        qb._routeCircuits.set(key, {
            openUntil: Date.now() + 15_000,
            trips: []
        });

        const req = {
            method: "GET",
            originalUrl: "/api/hot",
            path: "/api/hot"
        };
        const headers = {};
        const res = {
            setHeader: (k, v) => {
                headers[k] = v;
            },
            status: jest.fn(function (code) {
                this.statusCode = code;
                return this;
            }),
            json: jest.fn(function (body) {
                this.body = body;
                return this;
            })
        };
        const next = jest.fn();

        qb.queryBudgetMiddleware(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(503);
        expect(headers["Retry-After"]).toBeDefined();
        expect(res.body.code).toBe("QUERY_CIRCUIT_OPEN");
    });

    test("middleware opens ALS and calls next when circuit closed", () => {
        const req = {
            method: "GET",
            originalUrl: "/api/products",
            path: "/api/products",
            correlationId: "corr_1"
        };
        const res = {
            setHeader: jest.fn(),
            on: jest.fn()
        };
        const next = jest.fn();

        qb.queryBudgetMiddleware(req, res, next);
        expect(next).toHaveBeenCalled();
        expect(res.on).toHaveBeenCalledWith("finish", expect.any(Function));
    });

    test("getQueryBudgetMetrics returns config and offender lists", () => {
        qb.runWithQueryBudget({ route: "/api/a", routeKey: "GET /api/a" }, () => {
            for (let i = 0; i < 5; i++) {
                qb.recordQueryExecution({ phase: "begin", sql: "SELECT x" });
            }
            try {
                qb.recordQueryExecution({ phase: "begin", sql: "SELECT y" });
            } catch (_) {
                /* expected budget trip */
            }
        });

        const metrics = qb.getQueryBudgetMetrics(10);
        expect(metrics.config.maxQueries).toBe(5);
        expect(Array.isArray(metrics.topOffenders)).toBe(true);
        expect(Array.isArray(metrics.openCircuits)).toBe(true);
        expect(metrics.topOffenders.some((o) => o.budgetTrips >= 1)).toBe(true);
    });
});
