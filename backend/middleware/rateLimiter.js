const rateLimit = require("express-rate-limit");

// ==================== CONSTANTS FROM ENV ====================
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

// ==================== CUSTOM KEY GENERATOR ====================
const customKeyGenerator = (req) => {
    const userId =
        req.user?.id
        || req.body?.userId
        || "anonymous";

    const ip =
        req.ip
        || req.connection.remoteAddress
        || "unknown";

    return `${ip}_${userId}`;
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
const createLimiter = ({
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
    windowMs: DEFAULT_WINDOW_MS,
    max: LOGIN_MAX,
    message: `Too many login attempts. Please try again after ${DEFAULT_WINDOW_MS / 60000} minutes.`,
    logPrefix: "Login rate limit exceeded",
    skip: skipSuccessfulAttempts
});

// ==================== SIGNUP LIMITER ====================
const signupLimiter = createLimiter({
    windowMs: DEFAULT_WINDOW_MS,
    max: SIGNUP_MAX,
    message: `Too many signup attempts. Please try again after ${DEFAULT_WINDOW_MS / 60000} minutes.`,
    logPrefix: "Signup rate limit exceeded"
});

// ==================== REFRESH TOKEN LIMITER ====================
const refreshTokenLimiter = createLimiter({
    windowMs: DEFAULT_WINDOW_MS,
    max: REFRESH_TOKEN_MAX,
    message: `Too many refresh requests. Please try again after ${DEFAULT_WINDOW_MS / 60000} minutes.`,
    logPrefix: "Refresh token rate limit exceeded"
});

// ==================== FORGOT PASSWORD LIMITER ====================
const forgotPasswordLimiter = createLimiter({
    windowMs: DEFAULT_WINDOW_MS,
    max: FORGOT_PASSWORD_MAX,
    message: `Too many password reset requests. Please try again after ${DEFAULT_WINDOW_MS / 60000} minutes.`,
    logPrefix: "Forgot password rate limit exceeded"
});

// ==================== OTP VERIFICATION LIMITER ====================
const otpVerifyLimiter = createLimiter({
    windowMs: OTP_WINDOW_MS,
    max: OTP_VERIFY_MAX,
    message: `Too many OTP verification attempts. Please try again after ${OTP_WINDOW_MS / 60000} minutes.`,
    logPrefix: "OTP verification rate limit exceeded"
});

// ==================== RESET PASSWORD LIMITER ====================
const resetPasswordLimiter = createLimiter({
    windowMs: DEFAULT_WINDOW_MS,
    max: RESET_PASSWORD_MAX,
    message: `Too many reset password attempts. Please try again after ${DEFAULT_WINDOW_MS / 60000} minutes.`,
    logPrefix: "Reset password rate limit exceeded"
});

// ==================== OTP REQUEST LIMITER ====================
const otpRequestLimiter = createLimiter({
    windowMs: OTP_WINDOW_MS,
    max: OTP_REQUEST_MAX,
    message: `Too many OTP requests. Please try again after ${OTP_WINDOW_MS / 60000} minutes.`,
    logPrefix: "OTP request rate limit exceeded"
});

// ==================== SUSPICIOUS IP RATE LIMITER ====================
const suspiciousIpKeyGenerator = (req) =>
    req.ip
    || req.connection.remoteAddress
    || "unknown";

const suspiciousIpLimiter = createLimiter({
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
    suspiciousIpLimiter,
    customKeyGenerator,
    onLimitReached
};