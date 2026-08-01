/**
 * Per-request SQL query budget & slow-query circuit breaker (#1391).
 *
 * Uses AsyncLocalStorage so the mysql2 pool wrapper can attribute queries to
 * the active HTTP request without monkey-patching Express handlers.
 * Migrations / jobs (no ALS store, or explicit bypass) are not budgeted.
 */

"use strict";

const { AsyncLocalStorage } = require("async_hooks");
const { sanitizeSql, logSlowQuery } = require("../utils/slowQueryLogger");

let metrics;
try {
    metrics = require("../config/metrics");
} catch (_) {
    metrics = null;
}

const queryBudgetAls = new AsyncLocalStorage();

function envInt(name, fallback) {
    const n = parseInt(process.env[name], 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
}

function envBool(name, fallback = false) {
    const v = process.env[name];
    if (v === undefined || v === "") return fallback;
    return ["1", "true", "yes", "on"].includes(String(v).toLowerCase());
}

const CONFIG = {
    enabled: envBool("QUERY_BUDGET_ENABLED", true),
    /** Max queries allowed per HTTP request before the circuit trips. */
    maxQueries: envInt("QUERY_BUDGET_MAX", 50),
    /** Duration (ms) above which a query is logged as slow. */
    slowMs: envInt("QUERY_SLOW_MS", 1000),
    /** Retry-After seconds when circuit is open. */
    retryAfterSec: envInt("QUERY_CIRCUIT_RETRY_AFTER_SEC", 30),
    /** Trips on a route within the window before route circuit opens. */
    tripThreshold: envInt("QUERY_CIRCUIT_TRIP_THRESHOLD", 5),
    tripWindowMs: envInt("QUERY_CIRCUIT_WINDOW_MS", 60_000),
    /** Global bypass (migrations, one-off jobs, emergency). */
    globalBypass: envBool("QUERY_BUDGET_BYPASS", false)
};

class QueryBudgetError extends Error {
    constructor(message, { code = "QUERY_BUDGET_EXCEEDED", status = 503, retryAfter = CONFIG.retryAfterSec } = {}) {
        super(message);
        this.name = "QueryBudgetError";
        this.code = code;
        this.errorCode = code;
        this.status = status;
        this.retryAfter = retryAfter;
    }
}

/** In-memory admin metrics — top offenders by route. */
const offenderStats = new Map();
/** routeKey -> { openUntil, trips: number[] } */
const routeCircuits = new Map();

function routeKey(method, path) {
    return `${method || "?"} ${(path || "/").split("?")[0]}`;
}

function touchOffender(key, patch) {
    const cur = offenderStats.get(key) || {
        route: key,
        requests: 0,
        queries: 0,
        budgetTrips: 0,
        slowQueries: 0,
        maxQueriesInRequest: 0,
        lastSeenAt: null
    };
    if (patch.requests) cur.requests += patch.requests;
    if (patch.queries) cur.queries += patch.queries;
    if (patch.budgetTrips) cur.budgetTrips += patch.budgetTrips;
    if (patch.slowQueries) cur.slowQueries += patch.slowQueries;
    if (patch.maxQueriesInRequest != null) {
        cur.maxQueriesInRequest = Math.max(
            cur.maxQueriesInRequest,
            patch.maxQueriesInRequest
        );
    }
    cur.lastSeenAt = new Date().toISOString();
    offenderStats.set(key, cur);
    return cur;
}

function promInc(name, value = 1) {
    if (metrics && typeof metrics.increment === "function") {
        try {
            metrics.increment(name, value);
        } catch (_) {
            /* never fail the request for metrics */
        }
    }
}

function isCircuitOpen(key) {
    const state = routeCircuits.get(key);
    if (!state || !state.openUntil) return false;
    if (Date.now() >= state.openUntil) {
        state.openUntil = 0;
        return false;
    }
    return true;
}

function recordRouteTrip(key) {
    const now = Date.now();
    const state = routeCircuits.get(key) || { openUntil: 0, trips: [] };
    state.trips = state.trips.filter((t) => now - t < CONFIG.tripWindowMs);
    state.trips.push(now);
    if (state.trips.length >= CONFIG.tripThreshold) {
        state.openUntil = now + CONFIG.retryAfterSec * 1000;
        state.trips = [];
        promInc("query_budget.circuit_open");
    }
    routeCircuits.set(key, state);
    return state;
}

function createRequestContext(req) {
    const method = req.method || "GET";
    const path = req.originalUrl || req.url || req.path || "/";
    return {
        bypass: false,
        queryCount: 0,
        slowCount: 0,
        budgetTripped: false,
        method,
        route: path.split("?")[0],
        routeKey: routeKey(method, path),
        requestId: req.correlationId || req.requestId || null,
        startedAt: Date.now()
    };
}

/**
 * Express middleware — opens ALS budget scope; short-circuits if route circuit is open.
 */
function queryBudgetMiddleware(req, res, next) {
    if (!CONFIG.enabled || CONFIG.globalBypass) {
        return next();
    }

    const key = routeKey(req.method, req.originalUrl || req.path);
    if (isCircuitOpen(key)) {
        const state = routeCircuits.get(key);
        const retryAfter = Math.max(
            1,
            Math.ceil((((state && state.openUntil) || Date.now()) - Date.now()) / 1000)
        );
        res.setHeader("Retry-After", String(retryAfter));
        res.setHeader("X-Query-Circuit", "open");
        return res.status(503).json({
            success: false,
            code: "QUERY_CIRCUIT_OPEN",
            errorCode: "QUERY_CIRCUIT_OPEN",
            message:
                "This route is temporarily protected after repeated query-budget trips. Retry shortly.",
            retryAfter
        });
    }

    const ctx = createRequestContext(req);

    return queryBudgetAls.run(ctx, () => {
        res.on("finish", () => {
            touchOffender(ctx.routeKey, {
                requests: 1,
                queries: ctx.queryCount,
                slowQueries: ctx.slowCount,
                maxQueriesInRequest: ctx.queryCount,
                budgetTrips: ctx.budgetTripped ? 1 : 0
            });
            if (ctx.queryCount > 0) {
                res.setHeader("X-Query-Count", String(ctx.queryCount));
            }
            if (ctx.budgetTripped) {
                res.setHeader("X-Query-Budget", "exceeded");
            }
        });
        next();
    });
}

/**
 * Called by the mysql2 pool wrapper for every query.
 * No ALS store / bypass → migrations & background jobs are unrestricted.
 *
 * @param {'begin'|'finish'} phase
 *   begin  — reserve a budget slot (throws before SQL if exhausted)
 *   finish — record duration / slow-query attribution after SQL returns
 */
function recordQueryExecution({
    phase = "finish",
    sql,
    durationMs = 0,
    params,
    error = null
} = {}) {
    const ctx = queryBudgetAls.getStore();

    if (!CONFIG.enabled || CONFIG.globalBypass) {
        if (phase === "finish" && durationMs >= CONFIG.slowMs) {
            logSlowQuery({
                sql,
                durationMs,
                route: "background",
                method: "-",
                params
            });
        }
        return { counted: false, queryCount: 0 };
    }

    if (!ctx || ctx.bypass) {
        if (phase === "finish" && durationMs >= CONFIG.slowMs) {
            logSlowQuery({
                sql,
                durationMs,
                route: "bypass",
                method: "-",
                params
            });
        }
        return { counted: false, queryCount: 0 };
    }

    if (phase === "begin") {
        if (ctx.budgetTripped || ctx.queryCount >= CONFIG.maxQueries) {
            ctx.budgetTripped = true;
            if (ctx.queryCount >= CONFIG.maxQueries && !ctx._tripRecorded) {
                ctx._tripRecorded = true;
                recordRouteTrip(ctx.routeKey);
                touchOffender(ctx.routeKey, { budgetTrips: 1 });
                promInc("query_budget.exceeded");
            }
            throw new QueryBudgetError(
                `SQL query budget exceeded (${ctx.queryCount}/${CONFIG.maxQueries}) on ${ctx.routeKey}. ` +
                    `Blocked SQL: ${sanitizeSql(sql)}`,
                { code: "QUERY_BUDGET_EXCEEDED", retryAfter: CONFIG.retryAfterSec }
            );
        }
        ctx.queryCount += 1;
        return { counted: true, queryCount: ctx.queryCount };
    }

    // finish
    if (durationMs >= CONFIG.slowMs) {
        ctx.slowCount += 1;
        promInc("query_budget.slow_query");
        logSlowQuery({
            sql,
            durationMs,
            route: ctx.route,
            method: ctx.method,
            requestId: ctx.requestId,
            params
        });
    }

    return { counted: true, queryCount: ctx.queryCount };
}

/** Run work outside the per-request budget (migrations, cron, seed scripts). */
function runWithQueryBudgetBypass(fn) {
    return queryBudgetAls.run({ bypass: true, queryCount: 0, slowCount: 0 }, fn);
}

function getQueryBudgetMetrics(limit = 20) {
    const offenders = [...offenderStats.values()]
        .sort(
            (a, b) =>
                b.budgetTrips - a.budgetTrips ||
                b.slowQueries - a.slowQueries ||
                b.maxQueriesInRequest - a.maxQueriesInRequest
        )
        .slice(0, Math.max(1, limit));

    const openCircuits = [];
    for (const [route, state] of routeCircuits.entries()) {
        if (state.openUntil && state.openUntil > Date.now()) {
            openCircuits.push({
                route,
                openUntil: new Date(state.openUntil).toISOString(),
                retryAfterSec: Math.ceil((state.openUntil - Date.now()) / 1000)
            });
        }
    }

    return {
        config: {
            enabled: CONFIG.enabled,
            maxQueries: CONFIG.maxQueries,
            slowMs: CONFIG.slowMs,
            retryAfterSec: CONFIG.retryAfterSec,
            tripThreshold: CONFIG.tripThreshold,
            tripWindowMs: CONFIG.tripWindowMs,
            globalBypass: CONFIG.globalBypass
        },
        topOffenders: offenders,
        openCircuits,
        generatedAt: new Date().toISOString()
    };
}

function resetQueryBudgetState() {
    offenderStats.clear();
    routeCircuits.clear();
}

function getActiveBudgetContext() {
    return queryBudgetAls.getStore() || null;
}

/** Test helper: run fn inside a synthetic request budget context. */
function runWithQueryBudget(ctx, fn) {
    return queryBudgetAls.run(
        {
            bypass: false,
            queryCount: 0,
            slowCount: 0,
            budgetTripped: false,
            method: "GET",
            route: "/test",
            routeKey: "GET /test",
            requestId: "test",
            startedAt: Date.now(),
            ...ctx
        },
        fn
    );
}

module.exports = {
    CONFIG,
    QueryBudgetError,
    queryBudgetMiddleware,
    recordQueryExecution,
    runWithQueryBudgetBypass,
    runWithQueryBudget,
    getQueryBudgetMetrics,
    resetQueryBudgetState,
    getActiveBudgetContext,
    queryBudgetAls,
    // test seams
    _offenderStats: offenderStats,
    _routeCircuits: routeCircuits
};
