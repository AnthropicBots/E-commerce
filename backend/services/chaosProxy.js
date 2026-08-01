/**
 * Chaos & Resilience Harness for checkout dependencies (#1398).
 *
 * Injects latency / errors into payment, Redis, and MySQL adapters so
 * timeouts, retries, and graceful degradation can be verified in
 * development / test only.
 *
 * Safety
 * ------
 * Chaos is a no-op unless ALL of the following hold:
 *   1. CHAOS_ENABLED=true
 *   2. NODE_ENV is not "production"
 *
 * Per-dependency flags (optional, default off when chaos is enabled):
 *   CHAOS_PAYMENT=true|false
 *   CHAOS_REDIS=true|false
 *   CHAOS_DB=true|false
 *
 * Injection knobs (optional):
 *   CHAOS_LATENCY_MS     — artificial delay before the real call (default 0)
 *   CHAOS_ERROR_RATE     — 0..1 probability of a forced failure (default 1
 *                          when the dependency flag is on and no rate set,
 *                          otherwise 0)
 *   CHAOS_FORCE_STATUS   — HTTP-ish status stamped on injected errors
 *                          (default 500 for payment, 503 for redis/db)
 *
 * Timeout / retry policy (documented + enforced by withChaos / withRetry)
 * ----------------------------------------------------------------------
 * Payment : 8s timeout, 2 retries, exponential backoff 200ms → 800ms
 * Redis   : 1.5s timeout, 1 retry,  100ms backoff
 * DB      : 5s timeout, 1 retry,  150ms backoff
 *
 * User-facing messages stay stable so the storefront can show a clear
 * toast instead of raw provider noise.
 */

"use strict";

const DEPENDENCIES = Object.freeze({
    PAYMENT: "payment",
    REDIS: "redis",
    DB: "db"
});

/**
 * Documented resilience policy for checkout dependencies.
 * Kept in one place so services and tests share the same numbers.
 */
const RESILIENCE_POLICY = Object.freeze({
    payment: Object.freeze({
        timeoutMs: 8000,
        retries: 2,
        backoffMs: 200,
        maxBackoffMs: 800,
        forceStatus: 500,
        userMessage: "Payment service temporarily unavailable. Please try again."
    }),
    redis: Object.freeze({
        timeoutMs: 1500,
        retries: 1,
        backoffMs: 100,
        maxBackoffMs: 400,
        forceStatus: 503,
        // Redis is a cache / pre-lock — degrade, don't hard-fail checkout.
        userMessage: "Checkout is running slower than usual. Please wait a moment.",
        degrade: true
    }),
    db: Object.freeze({
        timeoutMs: 5000,
        retries: 1,
        backoffMs: 150,
        maxBackoffMs: 600,
        forceStatus: 503,
        userMessage: "We could not complete checkout right now. Please try again."
    })
});

class ChaosError extends Error {
    constructor({ dependency, status, message, cause } = {}) {
        super(message || `Chaos injected failure for ${dependency}`);
        this.name = "ChaosError";
        this.code = "CHAOS_INJECTED";
        this.dependency = dependency;
        this.status = status || 500;
        this.cause = cause || null;
        this.userMessage =
            (RESILIENCE_POLICY[dependency] && RESILIENCE_POLICY[dependency].userMessage) ||
            message;
    }

    toJSON() {
        return {
            success: false,
            code: this.code,
            message: this.userMessage,
            dependency: this.dependency,
            status: this.status
        };
    }
}

function envFlag(name) {
    const raw = process.env[name];
    if (raw === undefined || raw === null || raw === "") return false;
    return String(raw).toLowerCase() === "true" || raw === "1";
}

function envNumber(name, fallback) {
    const raw = process.env[name];
    if (raw === undefined || raw === null || raw === "") return fallback;
    const n = Number(raw);
    return Number.isFinite(n) ? n : fallback;
}

/**
 * Master gate. Always false in production, even if CHAOS_ENABLED leaks in.
 */
function isChaosEnabled() {
    if (process.env.NODE_ENV === "production") return false;
    return envFlag("CHAOS_ENABLED");
}

function isDependencyChaosEnabled(dependency) {
    if (!isChaosEnabled()) return false;
    const key = {
        payment: "CHAOS_PAYMENT",
        redis: "CHAOS_REDIS",
        db: "CHAOS_DB"
    }[dependency];
    if (!key) return false;
    return envFlag(key);
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldInjectError(dependency) {
    if (!isDependencyChaosEnabled(dependency)) return false;
    const rate = envNumber("CHAOS_ERROR_RATE", 1);
    if (rate <= 0) return false;
    if (rate >= 1) return true;
    return Math.random() < rate;
}

function latencyMs() {
    if (!isChaosEnabled()) return 0;
    return Math.max(0, envNumber("CHAOS_LATENCY_MS", 0));
}

function forcedStatus(dependency) {
    const fromEnv = envNumber("CHAOS_FORCE_STATUS", NaN);
    if (Number.isFinite(fromEnv)) return fromEnv;
    return (RESILIENCE_POLICY[dependency] && RESILIENCE_POLICY[dependency].forceStatus) || 500;
}

/**
 * Race a promise against a timeout. Rejects with ChaosError-shaped timeout.
 */
function withTimeout(promise, timeoutMs, dependency) {
    if (!timeoutMs || timeoutMs <= 0) return promise;

    let timer;
    const timeoutPromise = new Promise((_, reject) => {
        timer = setTimeout(() => {
            reject(
                new ChaosError({
                    dependency,
                    status: 504,
                    message: `${dependency} timed out after ${timeoutMs}ms`
                })
            );
        }, timeoutMs);
    });

    return Promise.race([promise, timeoutPromise]).finally(() => {
        if (timer) clearTimeout(timer);
    });
}

/**
 * Retry with exponential backoff. Non-retryable ChaosError from injection
 * still goes through retries so tests can assert the policy; callers that
 * want fail-fast can pass retries: 0.
 */
async function withRetry(fn, { retries = 0, backoffMs = 100, maxBackoffMs = 800 } = {}) {
    let attempt = 0;
    let delay = backoffMs;
    // eslint-disable-next-line no-constant-condition
    while (true) {
        try {
            return await fn(attempt);
        } catch (err) {
            if (attempt >= retries) throw err;
            await sleep(delay);
            delay = Math.min(delay * 2, maxBackoffMs);
            attempt += 1;
        }
    }
}

/**
 * Wrap a dependency call with optional chaos injection + timeout + retry.
 *
 * @param {string} dependency  one of DEPENDENCIES values
 * @param {Function} fn        async () => result
 * @param {object} [overrides] policy overrides
 */
async function withChaos(dependency, fn, overrides = {}) {
    const policy = {
        ...(RESILIENCE_POLICY[dependency] || {}),
        ...overrides
    };

    const runOnce = async () => {
        const delay = latencyMs();
        if (delay > 0 && isDependencyChaosEnabled(dependency)) {
            await sleep(delay);
        }

        if (shouldInjectError(dependency)) {
            throw new ChaosError({
                dependency,
                status: forcedStatus(dependency),
                message: `Chaos: forced ${dependency} failure`
            });
        }

        return fn();
    };

    return withRetry(
        (attempt) => withTimeout(runOnce(), policy.timeoutMs, dependency),
        {
            retries: policy.retries || 0,
            backoffMs: policy.backoffMs || 100,
            maxBackoffMs: policy.maxBackoffMs || 800
        }
    );
}

/**
 * Redis helper: on chaos / outage, return a degraded result instead of
 * throwing when the policy says degrade:true. Checkout can continue without
 * the distributed pre-lock.
 */
async function withRedisChaos(fn, { fallback = null } = {}) {
    const policy = RESILIENCE_POLICY.redis;
    try {
        return await withChaos(DEPENDENCIES.REDIS, fn);
    } catch (err) {
        if (policy.degrade) {
            return typeof fallback === "function" ? fallback(err) : fallback;
        }
        throw err;
    }
}

/**
 * MySQL helper used by checkout paths that want a uniform error envelope.
 */
async function withDbChaos(fn) {
    return withChaos(DEPENDENCIES.DB, fn);
}

/**
 * Payment helper that always returns the payment service envelope
 * `{ success, ... }` so controllers don't have to special-case ChaosError.
 *
 * @param {Function} fn
 * @param {object} [overrides]  passed through to withChaos (e.g. { retries: 0 })
 */
async function withPaymentChaos(fn, overrides = {}) {
    try {
        return await withChaos(DEPENDENCIES.PAYMENT, fn, overrides);
    } catch (err) {
        const userMessage =
            err.userMessage ||
            RESILIENCE_POLICY.payment.userMessage;
        return {
            success: false,
            error: userMessage,
            code: err.code || "PAYMENT_UNAVAILABLE",
            status: err.status || 500,
            dependency: DEPENDENCIES.PAYMENT
        };
    }
}

/**
 * Checkout payment step with guaranteed inventory lock cleanup on failure.
 *
 * Controllers should prefer this over calling createPaymentIntent alone so a
 * chaos (or real) payment failure never leaves reserved stock stranded.
 *
 * @param {object} opts
 * @param {Function} opts.charge           async () => { success, ... }
 * @param {Function} opts.releaseLocks     async () => void  — release reservations
 * @param {Function} [opts.rollback]       async () => void  — txn rollback
 */
async function chargeWithLockRelease({ charge, releaseLocks, rollback } = {}) {
    if (typeof charge !== "function") {
        throw new TypeError("chargeWithLockRelease requires a charge function");
    }

    let result;
    try {
        result = await charge();
    } catch (err) {
        if (typeof rollback === "function") {
            try { await rollback(); } catch (_) { /* ignore */ }
        }
        if (typeof releaseLocks === "function") {
            try { await releaseLocks(); } catch (_) { /* ignore */ }
        }
        return {
            success: false,
            error:
                err.userMessage ||
                RESILIENCE_POLICY.payment.userMessage,
            code: err.code || "PAYMENT_UNAVAILABLE",
            status: err.status || 500,
            locksReleased: true
        };
    }

    if (!result || result.success !== true) {
        if (typeof rollback === "function") {
            try { await rollback(); } catch (_) { /* ignore */ }
        }
        if (typeof releaseLocks === "function") {
            try { await releaseLocks(); } catch (_) { /* ignore */ }
        }
        return {
            success: false,
            error:
                (result && (result.error || result.message)) ||
                RESILIENCE_POLICY.payment.userMessage,
            code: (result && result.code) || "PAYMENT_UNAVAILABLE",
            status: (result && result.status) || 500,
            locksReleased: true
        };
    }

    return { ...result, locksReleased: false };
}

/**
 * Snapshot of the active chaos configuration (for /health-style debug or tests).
 */
function getChaosStatus() {
    return {
        enabled: isChaosEnabled(),
        nodeEnv: process.env.NODE_ENV || null,
        dependencies: {
            payment: isDependencyChaosEnabled(DEPENDENCIES.PAYMENT),
            redis: isDependencyChaosEnabled(DEPENDENCIES.REDIS),
            db: isDependencyChaosEnabled(DEPENDENCIES.DB)
        },
        latencyMs: latencyMs(),
        errorRate: envNumber("CHAOS_ERROR_RATE", isChaosEnabled() ? 1 : 0),
        policy: RESILIENCE_POLICY
    };
}

module.exports = {
    DEPENDENCIES,
    RESILIENCE_POLICY,
    ChaosError,
    isChaosEnabled,
    isDependencyChaosEnabled,
    withChaos,
    withRetry,
    withTimeout,
    withRedisChaos,
    withDbChaos,
    withPaymentChaos,
    chargeWithLockRelease,
    getChaosStatus
};
