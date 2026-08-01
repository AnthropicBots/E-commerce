// backend/services/loginLockoutService.js
//
// Failed-sign-in accounting and account lockout, held in Redis.
//
// This state used to be a `Map` in the auth controller's module scope, which
// meant a restart cleared every lockout and an attacker only had to be spread
// across instances to get MAX_LOGIN_ATTEMPTS tries per instance instead of
// MAX_LOGIN_ATTEMPTS in total. The policy below -- threshold, rolling window,
// lockout duration -- is unchanged; only where the counters live has moved.
//
// The Redis-outage behaviour matches config/redisRateLimitStore.js: fall back
// to per-process counting and log loudly. Rejecting every sign-in while Redis
// is down would lock every customer out of the site over a cache outage, and
// the per-process fallback is exactly what this code did before.

const crypto = require('crypto');
const redis = require('../config/redis');
const logger = require('../config/logger');

const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_LOCKOUT_DURATION = 15 * 60 * 1000; // 15 minutes
// Window in which the failed attempts must accumulate to trip the lockout.
// Failures older than this roll off so isolated mistakes never reach the threshold.
const LOGIN_ATTEMPT_WINDOW = 15 * 60 * 1000; // 15 minutes

const KEY_PREFIX = 'auth:lockout';
const OUTAGE_LOG_INTERVAL_MS = 60 * 1000;
const SCAN_BATCH = 100;

// Lua numbers are doubles, and `tostring` renders a millisecond timestamp as
// "1.7672256e+12", so writing one to Redis unformatted silently loses the low
// digits. Every numeric write below goes through %d for that reason.
const RECORD_FAILURE_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local maxAttempts = tonumber(ARGV[3])
local lockoutMs = tonumber(ARGV[4])

local attempts = tonumber(redis.call('HGET', key, 'attempts')) or 0
local windowExpires = tonumber(redis.call('HGET', key, 'windowExpires')) or 0
local lockoutUntil = tonumber(redis.call('HGET', key, 'lockoutUntil')) or 0

if attempts == 0 or now > windowExpires then
    attempts = 1
    windowExpires = now + window
    lockoutUntil = 0
else
    attempts = attempts + 1
    if attempts >= maxAttempts then
        lockoutUntil = now + lockoutMs
    end
end

redis.call('HSET', key,
    'attempts', string.format('%d', attempts),
    'windowExpires', string.format('%d', windowExpires),
    'lockoutUntil', string.format('%d', lockoutUntil))

local expiresAt = windowExpires
if lockoutUntil > expiresAt then
    expiresAt = lockoutUntil
end
redis.call('PEXPIRE', key, string.format('%d', expiresAt - now))

return { attempts, string.format('%d', lockoutUntil) }
`;

// Reading and expiring the record in one script keeps two instances from
// disagreeing about whether a lockout has elapsed.
const IS_LOCKED_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])

if redis.call('EXISTS', key) == 0 then
    return 0
end

local windowExpires = tonumber(redis.call('HGET', key, 'windowExpires')) or 0
local lockoutUntil = tonumber(redis.call('HGET', key, 'lockoutUntil')) or 0

-- Only an active lockout blocks login. Accumulating failures inside the window
-- is not itself a lock; that is what let a single mistyped password lock the
-- account before.
if lockoutUntil > 0 and now < lockoutUntil then
    return 1
end

-- No active lockout: drop the record once the lockout has expired or the
-- rolling attempt window has elapsed, so the counter restarts cleanly.
if (lockoutUntil > 0 and now >= lockoutUntil) or now > windowExpires then
    redis.call('DEL', key)
end

return 0
`;

/**
 * Normalise the account identifier before it becomes a key.
 *
 * Sign-in looks the account up by a lowercased email, so the counter has to be
 * keyed the same way -- otherwise "User@x.com" and "user@x.com" resolve to one
 * account but two independent budgets, and the threshold is trivially doubled.
 *
 * The value is hashed rather than embedded: the identifier is attacker-supplied
 * on a public endpoint, so hashing both keeps arbitrary input out of the
 * keyspace and avoids parking a list of user emails in Redis where a
 * `SCAN auth:lockout:*` would enumerate them.
 */
const lockoutKey = (email) => {
    const normalized = String(email || '').trim().toLowerCase();
    const digest = crypto.createHash('sha256').update(normalized).digest('hex');
    return `${KEY_PREFIX}:${digest}`;
};

// Per-process fallback, used only while Redis is unreachable.
const fallbackAttempts = new Map();
let lastOutageLogAt = 0;

const reportOutage = (operation, error) => {
    const now = Date.now();
    if (now - lastOutageLogAt < OUTAGE_LOG_INTERVAL_MS) {
        return;
    }

    lastOutageLogAt = now;
    logger.error(
        `Login lockout store unavailable (${operation}): ${error.message}. `
        + 'Falling back to per-process attempt counting; lockouts are not shared '
        + 'across instances and will not survive a restart.'
    );
};

const isLockedLocally = (key, now) => {
    const record = fallbackAttempts.get(key);
    if (!record) return false;

    if (record.lockoutUntil && now < record.lockoutUntil) {
        return true;
    }

    if ((record.lockoutUntil && now >= record.lockoutUntil) || now > record.windowExpires) {
        fallbackAttempts.delete(key);
    }
    return false;
};

const recordFailureLocally = (key, now) => {
    const record = fallbackAttempts.get(key);

    if (!record || now > record.windowExpires) {
        fallbackAttempts.set(key, {
            attempts: 1,
            windowExpires: now + LOGIN_ATTEMPT_WINDOW,
            lockoutUntil: null
        });
        return;
    }

    record.attempts++;
    if (record.attempts >= MAX_LOGIN_ATTEMPTS) {
        record.lockoutUntil = now + LOGIN_LOCKOUT_DURATION;
    }
};

/**
 * Is this account currently locked out?
 *
 * @param {string} email
 * @returns {Promise<boolean>}
 */
const isLoginLocked = async (email) => {
    const key = lockoutKey(email);
    const now = Date.now();

    try {
        const locked = await redis.eval(IS_LOCKED_SCRIPT, 1, key, now);
        return Number(locked) === 1;
    } catch (error) {
        reportOutage('isLoginLocked', error);
        return isLockedLocally(key, now);
    }
};

/**
 * Count one failed sign-in, starting the lockout if the threshold is reached
 * inside the rolling window.
 *
 * @param {string} email
 * @returns {Promise<void>}
 */
const recordLoginFailure = async (email) => {
    const key = lockoutKey(email);
    const now = Date.now();

    try {
        await redis.eval(
            RECORD_FAILURE_SCRIPT,
            1,
            key,
            now,
            LOGIN_ATTEMPT_WINDOW,
            MAX_LOGIN_ATTEMPTS,
            LOGIN_LOCKOUT_DURATION
        );
    } catch (error) {
        reportOutage('recordLoginFailure', error);
        recordFailureLocally(key, now);
    }
};

/**
 * Clear the counter after a successful sign-in.
 *
 * @param {string} email
 * @returns {Promise<void>}
 */
const resetLoginAttempts = async (email) => {
    const key = lockoutKey(email);
    fallbackAttempts.delete(key);

    try {
        await redis.del(key);
    } catch (error) {
        reportOutage('resetLoginAttempts', error);
    }
};

/**
 * Drop every tracked attempt. Test-only: production keys expire on their own.
 *
 * @returns {Promise<void>}
 */
const clearLoginAttempts = async () => {
    fallbackAttempts.clear();

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
        reportOutage('clearLoginAttempts', error);
    }
};

module.exports = {
    isLoginLocked,
    recordLoginFailure,
    resetLoginAttempts,
    clearLoginAttempts,
    lockoutKey,
    MAX_LOGIN_ATTEMPTS,
    LOGIN_LOCKOUT_DURATION,
    LOGIN_ATTEMPT_WINDOW
};
