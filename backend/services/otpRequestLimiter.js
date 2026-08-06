// backend/services/otpRequestLimiter.js
//
// The per-address budget for "send me a code" endpoints, held in Redis (#1455).
//
// There are two limits on these endpoints and they do different jobs, which is
// why both exist:
//
//   middleware/rateLimiter.js  -- per *caller*. Stops one client hammering the
//                                 endpoint. Answers with 429, which is honest:
//                                 it describes the caller's own behaviour and
//                                 says nothing about any account.
//
//   this module                -- per *subject*, i.e. per address being asked
//                                 about. Stops a hundred callers between them
//                                 mail-bombing one victim, which the per-caller
//                                 limit cannot see.
//
// The per-subject budget deliberately does **not** surface as a 429. Whether a
// given address has been asked about recently is information about that address,
// and this whole area exists because that kind of information was leaking. The
// caller is told the same thing either way and the send is simply skipped --
// see `forgotPassword` in controllers/authController.js.
//
// This state used to be a `Map` in the auth controller's module scope, which
// meant a restart cleared every budget, two instances each kept their own, and
// the map grew one entry per distinct address until a five-minute sweep ran.
// The policy -- 3 requests per 5 minutes per address -- is unchanged; only where
// the counters live has moved. The Redis-outage behaviour matches
// services/loginLockoutService.js and config/redisRateLimitStore.js: fall back
// to per-process counting and log loudly, because refusing every password reset
// while Redis is down would be a worse failure than counting imprecisely.

'use strict';

const crypto = require('crypto');
const redis = require('../config/redis');
const logger = require('../config/logger');

// Same defaults the controller's Map used, still overridable by env so the
// value is not baked into two places.
const OTP_REQUEST_MAX =
    parseInt(process.env.OTP_REQUEST_MAX, 10) || 3;

const OTP_REQUEST_WINDOW_MS =
    parseInt(process.env.OTP_REQUEST_WINDOW_MS, 10) || 5 * 60 * 1000;

const KEY_PREFIX = 'auth:otp-budget';
const OUTAGE_LOG_INTERVAL_MS = 60 * 1000;
const SCAN_BATCH = 100;

/**
 * Increment a counter and set its expiry on first use, in one round trip.
 *
 * INCR-then-EXPIRE from the client side has a window where the process dies
 * between the two calls and leaves a counter with no TTL -- which would lock
 * that address out permanently. Doing both inside the script removes it.
 *
 * `string.format('%d', ...)` rather than `tostring`: Lua numbers are doubles and
 * `tostring` renders large millisecond values in exponential notation, silently
 * losing the low digits. Same reason as the scripts in loginLockoutService.
 */
const CONSUME_SCRIPT = `
local key = KEYS[1]
local windowMs = tonumber(ARGV[1])

local count = redis.call('INCR', key)
if count == 1 then
    redis.call('PEXPIRE', key, string.format('%d', windowMs))
end

local ttl = redis.call('PTTL', key)

-- A key with no TTL should not exist, but if one somehow does it would never
-- expire and would bar the address for good. Repair it rather than trust it.
if ttl < 0 then
    redis.call('PEXPIRE', key, string.format('%d', windowMs))
    ttl = windowMs
end

return { count, ttl }
`;

/**
 * Normalise an address and hash it into a key.
 *
 * Lowercased and trimmed first, because sign-in resolves the account that way:
 * without it "User@x.com" and "user@x.com" are one account but two budgets, and
 * the limit is bypassed by holding down shift.
 *
 * Hashed rather than interpolated because the value arrives on a public
 * endpoint. That keeps arbitrary caller input out of the keyspace, and stops a
 * `SCAN auth:otp-budget:*` from returning a list of customer addresses.
 *
 * @param {string} subject
 * @returns {string}
 */
const budgetKey = (subject) => {
    const normalized = String(subject || '').trim().toLowerCase();
    const digest = crypto.createHash('sha256').update(normalized).digest('hex');
    return `${KEY_PREFIX}:${digest}`;
};

// Per-process fallback, used only while Redis is unreachable.
const fallbackCounters = new Map();
let lastOutageLogAt = 0;

const reportOutage = (operation, error) => {
    const now = Date.now();
    if (now - lastOutageLogAt < OUTAGE_LOG_INTERVAL_MS) {
        return;
    }

    lastOutageLogAt = now;
    logger.error(
        `OTP request budget store unavailable (${operation}): ${error.message}. `
        + 'Falling back to per-process counting; budgets are not shared across '
        + 'instances and will not survive a restart.'
    );
};

/**
 * The fallback path. Same arithmetic, in memory.
 *
 * Unlike the `Map` this replaced, expired records are dropped on read rather
 * than waiting for a sweep, so the map only holds addresses seen inside the
 * current window.
 *
 * @param {string} key
 * @param {number} now
 * @returns {{ count: number, resetInMs: number }}
 */
const consumeLocally = (key, now) => {
    const record = fallbackCounters.get(key);

    if (!record || now >= record.expiresAt) {
        const expiresAt = now + OTP_REQUEST_WINDOW_MS;
        fallbackCounters.set(key, { count: 1, expiresAt });
        return { count: 1, resetInMs: OTP_REQUEST_WINDOW_MS };
    }

    record.count += 1;
    return { count: record.count, resetInMs: record.expiresAt - now };
};

/**
 * Take one request from the budget for `subject`.
 *
 * Always consumes, including on the request that trips the limit, so a caller
 * sitting on a refused address does not get a free retry every window boundary.
 *
 * @param {string} subject Address the code would be sent to.
 * @returns {Promise<{allowed: boolean, count: number, limit: number, resetInMs: number}>}
 */
const consume = async (subject) => {
    const key = budgetKey(subject);
    const now = Date.now();

    let count;
    let resetInMs;

    try {
        const result = await redis.eval(
            CONSUME_SCRIPT,
            1,
            key,
            OTP_REQUEST_WINDOW_MS
        );

        // ioredis hands back an array of strings for a Lua table of numbers.
        count = Number(Array.isArray(result) ? result[0] : result);
        resetInMs = Number(Array.isArray(result) ? result[1] : OTP_REQUEST_WINDOW_MS);

        // A double that cannot be read is not a reason to refuse a password
        // reset; treat it the same way as an outage.
        if (!Number.isFinite(count)) {
            throw new Error('OTP budget script returned a non-numeric count');
        }
    } catch (error) {
        reportOutage('consume', error);
        ({ count, resetInMs } = consumeLocally(key, now));
    }

    return {
        allowed: count <= OTP_REQUEST_MAX,
        count,
        limit: OTP_REQUEST_MAX,
        resetInMs: Number.isFinite(resetInMs) && resetInMs > 0
            ? resetInMs
            : OTP_REQUEST_WINDOW_MS
    };
};

/**
 * Give an address its budget back.
 *
 * Called once a code has actually been redeemed: the address has demonstrably
 * reached its owner, so the anti-mail-bomb counter has done its job and should
 * not hold a legitimate retry against them.
 *
 * @param {string} subject
 * @returns {Promise<void>}
 */
const release = async (subject) => {
    const key = budgetKey(subject);
    fallbackCounters.delete(key);

    try {
        await redis.del(key);
    } catch (error) {
        reportOutage('release', error);
    }
};

/**
 * Drop every tracked budget. Test-only; production keys expire on their own.
 *
 * @returns {Promise<void>}
 */
const clear = async () => {
    fallbackCounters.clear();
    // Reset the once-a-minute outage log throttle too. Without this the first
    // test to simulate an outage swallows the log line every later test in the
    // same file would assert on, because the throttle is module state and Jest
    // does not reset it between tests.
    lastOutageLogAt = 0;

    try {
        // SCAN rather than KEYS so this cannot block a shared Redis.
        let cursor = '0';
        do {
            const [nextCursor, keys] = await redis.scan(
                cursor,
                'MATCH',
                `${KEY_PREFIX}:*`,
                'COUNT',
                SCAN_BATCH
            );
            cursor = nextCursor;

            if (keys.length > 0) {
                await redis.del(...keys);
            }
        } while (cursor !== '0');
    } catch (error) {
        reportOutage('clear', error);
    }
};

module.exports = {
    consume,
    release,
    clear,
    budgetKey,
    OTP_REQUEST_MAX,
    OTP_REQUEST_WINDOW_MS
};
