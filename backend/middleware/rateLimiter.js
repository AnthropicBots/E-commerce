const rateLimit = require("express-rate-limit");
// `ipKeyGenerator` normalises an address before it is used as a bucket key.
// For IPv6 it collapses the address to its /56 subnet, so a client cannot walk
// through the enormous address space it is typically allocated and get a fresh
// quota on every request. Raw `req.ip` gives every IPv6 address its own bucket,
// which is an effective bypass of any IP-based limit.
const { ipKeyGenerator } = require("express-rate-limit");
// Counters live in Redis rather than the library's default in-process store, so
// a restart no longer hands every caller a fresh quota and every instance sees
// the same totals. See config/redisRateLimitStore.js for the Redis-outage
// behaviour.
const { createRateLimitStore } = require("../config/redisRateLimitStore");

// ==================== CONSTANTS FROM ENV ====================
// Shared Redis keyspace for the auth limiters, kept distinct from the rest of
// the backend's keys.
const KEY_NAMESPACE = "rl:auth";

const DEFAULT_WINDOW_MS =
    parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10)
    || 15 * 60 * 1000; // 15 minutes

const LOGIN_MAX =
    parseInt(process.env.RATE_LIMIT_LOGIN_MAX, 10)
    || 5;

const SIGNUP_MAX =
    parseInt(process.env.RATE_LIMIT_SIGNUP_MAX, 10)
    || 5;

const REFRESH_TOKEN_MAX =
    parseInt(process.env.RATE_LIMIT_REFRESH_MAX, 10)
    || 10;

const FORGOT_PASSWORD_MAX =
    parseInt(process.env.RATE_LIMIT_FORGOT_PASSWORD_MAX, 10)
    || 3;

const OTP_VERIFY_MAX =
    parseInt(process.env.RATE_LIMIT_OTP_VERIFY_MAX, 10)
    || 3;

const RESET_PASSWORD_MAX =
    parseInt(process.env.RATE_LIMIT_RESET_PASSWORD_MAX, 10)
    || 3;

const OTP_REQUEST_MAX =
    parseInt(process.env.RATE_LIMIT_OTP_REQUEST_MAX, 10)
    || 3;

const OTP_WINDOW_MS =
    parseInt(process.env.RATE_LIMIT_OTP_WINDOW_MS, 10)
    || 5 * 60 * 1000; // 5 minutes

const GUEST_ORDER_LOOKUP_MAX =
    parseInt(process.env.RATE_LIMIT_GUEST_ORDER_LOOKUP_MAX, 10)
    || 10;

// ==================== CUSTOM KEY GENERATOR ====================
// A limit is only as good as the identity it counts against, so the identity is
// picked deliberately here.
//
// An authenticated request is bucketed on the account. Bucketing it on the
// address instead means one abusive account can exhaust the budget of every
// other user behind the same corporate NAT or mobile carrier gateway.
//
// Everything else falls back to the client address. `req.ip` is only
// trustworthy because `trust proxy` is configured explicitly at startup (see
// config/trustProxy.js); without that it is either the load balancer's address
// for everyone or a value the caller supplied in X-Forwarded-For.
//
// `req.body.userId` used to take part in this key. It is caller-supplied, so
// anyone could mint a fresh bucket on every request just by varying it -- a
// complete bypass of the unauthenticated limits, which are the ones that
// matter. Only an identity the server established itself is used now.
const customKeyGenerator = (req) => {
    if (req.user?.id) {
        return `user:${req.user.id}`;
    }

    const address = req.ip || req.socket?.remoteAddress;

    // Normalise before bucketing. An IPv6 client is typically handed a whole
    // subnet, so keying on the raw address hands out a fresh quota per request.
    return address ? `ip:${ipKeyGenerator(address)}` : "ip:unknown";
};

// ==================== ON LIMIT REACHED CALLBACK ====================
const onLimitReached = (req) => {
    const key = customKeyGenerator(req);
    console.warn(
        `Rate limit exceeded for: ${key} on endpoint: ${req.path}`
    );
};

// ==================== SHARED HELPERS ====================

// shared JSON body for all limiter responses
const buildRateLimitResponse = (message) => ({
    success: false,
    message
});

// shared handler factory
const createRateLimitHandler = (
    message,
    logPrefix = "Rate limit exceeded",
    keyGenerator = customKeyGenerator
) => {
    return (req, res) => {
        const key = keyGenerator(req);

        console.warn(`${logPrefix}: ${key}`);

        return res.status(429).json(
            buildRateLimitResponse(message)
        );
    };
};

// shared limiter factory
//
// `name` namespaces the limiter's counters in Redis. Without it the login and
// signup limiters would share a bucket for the same client, so five failed
// logins would also consume the signup budget.
const createLimiter = ({
    name,
    windowMs,
    max,
    message,
    logPrefix,
    keyGenerator = customKeyGenerator,
    onLimitReachedCallback = onLimitReached,
    skip
}) => {
    return rateLimit({
        windowMs,
        max,
        standardHeaders: true,
        legacyHeaders: false,
        store: createRateLimitStore(`${KEY_NAMESPACE}:${name}`),
        keyGenerator,
        ...(skip ? { skip } : {}),
        handler: createRateLimitHandler(
            message,
            logPrefix,
            keyGenerator
        ),
        message: buildRateLimitResponse(message)
    });
};

// ==================== SKIP SUCCESSFUL ATTEMPTS ====================
const skipSuccessfulAttempts = () => {
    return false;
};

// ==================== LOGIN LIMITER ====================
const loginLimiter = createLimiter({
    name: "login",
    windowMs: DEFAULT_WINDOW_MS,
    max: LOGIN_MAX,
    message: `Too many login attempts. Please try again after ${DEFAULT_WINDOW_MS / 60000} minutes.`,
    logPrefix: "Login rate limit exceeded",
    skip: skipSuccessfulAttempts
});

// ==================== SIGNUP LIMITER ====================
const signupLimiter = createLimiter({
    name: "signup",
    windowMs: DEFAULT_WINDOW_MS,
    max: SIGNUP_MAX,
    message: `Too many signup attempts. Please try again after ${DEFAULT_WINDOW_MS / 60000} minutes.`,
    logPrefix: "Signup rate limit exceeded"
});

// ==================== REFRESH TOKEN LIMITER ====================
const refreshTokenLimiter = createLimiter({
    name: "refresh-token",
    windowMs: DEFAULT_WINDOW_MS,
    max: REFRESH_TOKEN_MAX,
    message: `Too many refresh requests. Please try again after ${DEFAULT_WINDOW_MS / 60000} minutes.`,
    logPrefix: "Refresh token rate limit exceeded"
});

// ==================== FORGOT PASSWORD LIMITER ====================
const forgotPasswordLimiter = createLimiter({
    name: "forgot-password",
    windowMs: DEFAULT_WINDOW_MS,
    max: FORGOT_PASSWORD_MAX,
    message: `Too many password reset requests. Please try again after ${DEFAULT_WINDOW_MS / 60000} minutes.`,
    logPrefix: "Forgot password rate limit exceeded"
});

// ==================== OTP VERIFICATION LIMITER ====================
const otpVerifyLimiter = createLimiter({
    name: "otp-verify",
    windowMs: OTP_WINDOW_MS,
    max: OTP_VERIFY_MAX,
    message: `Too many OTP verification attempts. Please try again after ${OTP_WINDOW_MS / 60000} minutes.`,
    logPrefix: "OTP verification rate limit exceeded"
});

// ==================== RESET PASSWORD LIMITER ====================
const resetPasswordLimiter = createLimiter({
    name: "reset-password",
    windowMs: DEFAULT_WINDOW_MS,
    max: RESET_PASSWORD_MAX,
    message: `Too many reset password attempts. Please try again after ${DEFAULT_WINDOW_MS / 60000} minutes.`,
    logPrefix: "Reset password rate limit exceeded"
});

// ==================== OTP REQUEST LIMITER ====================
const otpRequestLimiter = createLimiter({
    name: "otp-request",
    windowMs: OTP_WINDOW_MS,
    max: OTP_REQUEST_MAX,
    message: `Too many OTP requests. Please try again after ${OTP_WINDOW_MS / 60000} minutes.`,
    logPrefix: "OTP request rate limit exceeded"
});

// ==================== GUEST ORDER LOOKUP LIMITER ====================
// Not an auth endpoint, but the same abuse: an unauthenticated caller
// submitting a credential pair and being told whether it was right. Left with
// the other credential limiters so the defence is maintained alongside them
// rather than drifting off on its own.
//
// The order number carries sixty-four bits, so this is not really about making
// guessing infeasible -- it already is. It bounds a bulk probe against a list
// of numbers obtained some other way, and it caps what the endpoint costs.
const guestOrderLookupLimiter = createLimiter({
    name: "guest-order-lookup",
    windowMs: DEFAULT_WINDOW_MS,
    max: GUEST_ORDER_LOOKUP_MAX,
    message: `Too many order lookups. Please try again after ${DEFAULT_WINDOW_MS / 60000} minutes.`,
    logPrefix: "Guest order lookup rate limit exceeded"
});

// ==================== SUSPICIOUS IP RATE LIMITER ====================
const suspiciousIpKeyGenerator = (req) => {
    const address = req.ip || req.socket?.remoteAddress;
    // express-rate-limit v8 raises ERR_ERL_KEY_GEN_IPV6 for a custom
    // keyGenerator that reads req.ip without this helper.
    return address ? ipKeyGenerator(address) : "unknown";
};

const suspiciousIpLimiter = createLimiter({
    name: "suspicious-ip",
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 50,
    message: "Too many requests from this IP. Please try again later.",
    logPrefix: "Suspicious IP rate limit exceeded",
    keyGenerator: suspiciousIpKeyGenerator,
    onLimitReachedCallback: (req) => {
        console.error(
            `IP blocked: ${req.ip} for suspicious activity`
        );
    }
});

// ==================== EXPORTS ====================
module.exports = {
    loginLimiter,
    signupLimiter,
    refreshTokenLimiter,
    forgotPasswordLimiter,
    otpVerifyLimiter,
    resetPasswordLimiter,
    otpRequestLimiter,
    guestOrderLookupLimiter,
    suspiciousIpLimiter,
    customKeyGenerator,
    onLimitReached
};