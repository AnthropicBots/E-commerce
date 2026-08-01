// backend/services/chaosProxy.js
/**
 * Chaos & Resilience Harness for Checkout Dependencies (#1398)
 *
 * SAFETY
 * ------
 * Injection is OFF unless ALL of the following hold:
 *   1. CHAOS_ENABLED=true
 *   2. NODE_ENV is NOT "production"
 *
 * Per-dependency flags (examples):
 *   CHAOS_PAYMENT=error
 *   CHAOS_PAYMENT=latency:500
 *   CHAOS_PAYMENT=timeout
 *   CHAOS_REDIS=error
 *   CHAOS_MYSQL=latency:1000
 *
 * Timeout / retry policy (documented + enforced by withChaos):
 *   payment → timeout 10s, maxRetries 2, backoff 200ms
 *   redis   → timeout  2s, maxRetries 1, backoff  50ms
 *   mysql   → timeout 30s, maxRetries 0 (fail fast to caller txn)
 */

const DEPENDENCIES = Object.freeze(['payment', 'redis', 'mysql']);

/**
 * Canonical resilience policy for checkout dependencies.
 * Controllers/services should treat these as the source of truth.
 */
const CHAOS_POLICY = Object.freeze({
    payment: {
        timeoutMs: 10_000,
        maxRetries: 2,
        retryBackoffMs: 200,
        userMessage: 'Payment service temporarily unavailable. Please try again.'
    },
    redis: {
        timeoutMs: 2_000,
        maxRetries: 1,
        retryBackoffMs: 50,
        userMessage: 'Cache unavailable; continuing with degraded mode where possible.'
    },
    mysql: {
        timeoutMs: 30_000,
        maxRetries: 0,
        retryBackoffMs: 0,
        userMessage: 'Database temporarily unavailable. Please try again.'
    }
});

class ChaosInjectedError extends Error {
    constructor(dependency, mode, detail = {}) {
        super(`Chaos injected on ${dependency}: ${mode}`);
        this.name = 'ChaosInjectedError';
        this.code = 'CHAOS_INJECTED';
        this.dependency = dependency;
        this.mode = mode;
        this.statusCode = detail.statusCode || 503;
        this.userMessage = detail.userMessage || CHAOS_POLICY[dependency]?.userMessage;
        this.retryable = detail.retryable !== false;
    }
}

function envFlag(name) {
    return String(process.env[name] || '').trim();
}

/**
 * Master kill-switch. Hard-disabled in production regardless of CHAOS_ENABLED.
 */
function isChaosEnabled() {
    if (process.env.NODE_ENV === 'production') {
        return false;
    }
    return envFlag('CHAOS_ENABLED').toLowerCase() === 'true';
}

/**
 * Parse CHAOS_<DEP> into { mode, latencyMs }.
 * Modes: off | error | latency | timeout
 */
function parseChaosSpec(dependency) {
    const key = `CHAOS_${String(dependency).toUpperCase()}`;
    const raw = envFlag(key).toLowerCase();
    if (!raw || raw === 'off' || raw === 'false' || raw === '0') {
        return { mode: 'off', latencyMs: 0 };
    }
    if (raw === 'error' || raw === 'fail' || raw === '500') {
        return { mode: 'error', latencyMs: 0, statusCode: 500 };
    }
    if (raw === 'timeout') {
        const policyTimeout = CHAOS_POLICY[dependency]?.timeoutMs || 1000;
        return { mode: 'timeout', latencyMs: policyTimeout + 250 };
    }
    if (raw.startsWith('latency:')) {
        const ms = Math.max(0, parseInt(raw.slice('latency:'.length), 10) || 0);
        return { mode: 'latency', latencyMs: ms };
    }
    if (raw === 'latency') {
        return { mode: 'latency', latencyMs: 500 };
    }
    return { mode: 'off', latencyMs: 0 };
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout(promise, timeoutMs, dependency) {
    if (!timeoutMs || timeoutMs <= 0) {
        return promise;
    }
    let timer;
    const timeoutPromise = new Promise((_, reject) => {
        timer = setTimeout(() => {
            reject(new ChaosInjectedError(dependency, 'timeout', {
                statusCode: 504,
                userMessage: CHAOS_POLICY[dependency]?.userMessage,
                retryable: true
            }));
        }, timeoutMs);
    });
    return Promise.race([
        Promise.resolve(promise).finally(() => clearTimeout(timer)),
        timeoutPromise
    ]);
}

/**
 * Apply configured chaos for a dependency BEFORE invoking the real call.
 */
async function applyChaos(dependency) {
    if (!isChaosEnabled()) {
        return { applied: false };
    }
    if (!DEPENDENCIES.includes(dependency)) {
        return { applied: false };
    }

    const spec = parseChaosSpec(dependency);
    if (spec.mode === 'off') {
        return { applied: false };
    }

    if (spec.mode === 'latency' || spec.mode === 'timeout') {
        await sleep(spec.latencyMs);
    }

    if (spec.mode === 'error' || spec.mode === 'timeout') {
        throw new ChaosInjectedError(dependency, spec.mode, {
            statusCode: spec.statusCode || (spec.mode === 'timeout' ? 504 : 500),
            userMessage: CHAOS_POLICY[dependency]?.userMessage
        });
    }

    return { applied: true, mode: spec.mode, latencyMs: spec.latencyMs };
}

/**
 * Run `fn` behind chaos injection + timeout + optional retries.
 *
 * @param {'payment'|'redis'|'mysql'} dependency
 * @param {() => Promise<any>} fn
 * @param {object} [overrides] partial CHAOS_POLICY override
 */
async function withChaos(dependency, fn, overrides = {}) {
    const policy = { ...(CHAOS_POLICY[dependency] || {}), ...overrides };
    const maxRetries = Math.max(0, policy.maxRetries || 0);
    let lastError;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            await applyChaos(dependency);
            return await withTimeout(Promise.resolve().then(fn), policy.timeoutMs, dependency);
        } catch (err) {
            lastError = err;
            // Only retry explicit chaos / retryable failures — not config errors
            const retryable = err.code === 'CHAOS_INJECTED' || err.retryable === true;
            if (!retryable || attempt >= maxRetries) {
                throw err;
            }
            const backoff = (policy.retryBackoffMs || 0) * (attempt + 1);
            if (backoff > 0) {
                await sleep(backoff);
            }
        }
    }

    throw lastError;
}

/**
 * Snapshot of active chaos config (safe for /health or admin debug).
 */
function getChaosStatus() {
    const enabled = isChaosEnabled();
    const deps = {};
    for (const dep of DEPENDENCIES) {
        deps[dep] = enabled ? parseChaosSpec(dep) : { mode: 'off', latencyMs: 0 };
    }
    return {
        enabled,
        nodeEnv: process.env.NODE_ENV || 'undefined',
        masterFlag: envFlag('CHAOS_ENABLED') || 'false',
        dependencies: deps,
        policy: CHAOS_POLICY
    };
}

/**
 * Helper used by checkout failure paths: release inventory locks so a chaotic
 * payment/redis failure cannot leave stock reserved forever.
 */
async function releaseInventoryLocksOnChaosFail(userId, releaseFn) {
    if (!userId || typeof releaseFn !== 'function') {
        return { released: false };
    }
    try {
        await releaseFn(userId);
        return { released: true };
    } catch (err) {
        console.error('Failed to release inventory locks after chaos/resilience failure:', err.message);
        return { released: false, error: err.message };
    }
}

module.exports = {
    DEPENDENCIES,
    CHAOS_POLICY,
    ChaosInjectedError,
    isChaosEnabled,
    parseChaosSpec,
    applyChaos,
    withChaos,
    withTimeout,
    getChaosStatus,
    releaseInventoryLocksOnChaosFail
};
