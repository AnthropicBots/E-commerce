// backend/utils/otpvalidators.js

const crypto = require('crypto');

// ============================================
// OTP CONFIGURATION
// ============================================

const OTP_CONFIG = {
    length: parseInt(process.env.OTP_LENGTH) || 6,
    expirySeconds: parseInt(process.env.OTP_EXPIRY_SECONDS) || 300,
    maxAttempts: parseInt(process.env.OTP_MAX_ATTEMPTS) || 5,
    cooldownSeconds: parseInt(process.env.OTP_COOLDOWN_SECONDS) || 60,
    type: process.env.OTP_TYPE || 'numeric',
    enableLogging: process.env.OTP_ENABLE_LOGGING !== 'false',
    enableRateLimiting: process.env.OTP_ENABLE_RATE_LIMITING !== 'false',
};

// ============================================
// IN-MEMORY STORE
// ============================================

const otpStore = new Map();
const attemptStore = new Map();

// ============================================
// OTP GENERATION
// ============================================

const generateOTP = (length = OTP_CONFIG.length, type = OTP_CONFIG.type) => {
    if (length < 4 || length > 10) {
        throw new Error('OTP length must be between 4 and 10');
    }

    let otp = '';

    if (type === 'numeric') {
        const digits = '0123456789';
        for (let i = 0; i < length; i++) {
            otp += digits[Math.floor(Math.random() * 10)];
        }
    } else if (type === 'alphanumeric') {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        for (let i = 0; i < length; i++) {
            otp += chars[Math.floor(Math.random() * chars.length)];
        }
    } else {
        throw new Error(`Invalid OTP type: ${type}. Supported: numeric, alphanumeric`);
    }

    return otp;
};

const generateOTPWithMetadata = (userId, options = {}) => {
    const otp = generateOTP(options.length, options.type);
    const createdAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + (OTP_CONFIG.expirySeconds * 1000)).toISOString();

    const data = {
        otp,
        userId,
        createdAt,
        expiresAt,
        attempts: 0,
        validated: false,
    };

    otpStore.set(userId, data);

    setTimeout(() => {
        otpStore.delete(userId);
    }, OTP_CONFIG.expirySeconds * 1000);

    logOTPEvent('generated', userId, otp);

    return data;
};

// ============================================
// OTP FORMAT VALIDATION
// ============================================

const validateOTPFormat = (otp) => {
    if (!otp || (typeof otp !== 'string' && typeof otp !== 'number')) {
        return { valid: false, error: 'OTP is required', code: 'OTP_REQUIRED' };
    }

    const otpString = String(otp).trim();

    if (otpString.length === 0) {
        return { valid: false, error: 'OTP cannot be empty', code: 'OTP_EMPTY' };
    }

    if (otpString.length !== OTP_CONFIG.length) {
        return {
            valid: false,
            error: `OTP must be ${OTP_CONFIG.length} digits`,
            code: 'OTP_INVALID_LENGTH'
        };
    }

    const otpRegex = OTP_CONFIG.type === 'numeric'
        ? new RegExp(`^\\d{${OTP_CONFIG.length}}$`)
        : new RegExp(`^[A-Z0-9]{${OTP_CONFIG.length}}$`);

    if (!otpRegex.test(otpString)) {
        return {
            valid: false,
            error: `OTP must be ${OTP_CONFIG.type === 'numeric' ? 'numeric' : 'alphanumeric'}`,
            code: 'OTP_INVALID_FORMAT'
        };
    }

    return { valid: true, value: otpString };
};

// ============================================
// OTP EXPIRY CHECK
// ============================================

const checkOTPExpiry = (otpData) => {
    if (!otpData) {
        return { valid: false, error: 'OTP not found or expired', code: 'OTP_NOT_FOUND' };
    }

    const now = new Date();
    const expiresAt = new Date(otpData.expiresAt);

    if (now > expiresAt) {
        otpStore.delete(otpData.userId);
        return { valid: false, error: 'OTP has expired', code: 'OTP_EXPIRED' };
    }

    if (otpData.validated) {
        return { valid: false, error: 'OTP already used', code: 'OTP_USED' };
    }

    return { valid: true };
};

// ============================================
// RATE LIMITING
// ============================================

const checkRateLimit = (userId) => {
    if (!OTP_CONFIG.enableRateLimiting) {
        return { allowed: true };
    }

    const key = `attempts:${userId}`;
    const attempts = attemptStore.get(key) || { count: 0, lastAttempt: Date.now() };

    if (Date.now() - attempts.lastAttempt > OTP_CONFIG.cooldownSeconds * 1000) {
        attemptStore.delete(key);
        return { allowed: true };
    }

    if (attempts.count >= OTP_CONFIG.maxAttempts) {
        const remaining = Math.ceil(
            (OTP_CONFIG.cooldownSeconds * 1000 - (Date.now() - attempts.lastAttempt)) / 1000
        );
        return {
            allowed: false,
            error: `Too many attempts. Please wait ${remaining} seconds`,
            code: 'RATE_LIMIT_EXCEEDED',
            remaining,
        };
    }

    return { allowed: true };
};

const incrementAttempts = (userId) => {
    if (!OTP_CONFIG.enableRateLimiting) return;

    const key = `attempts:${userId}`;
    const attempts = attemptStore.get(key) || { count: 0, lastAttempt: Date.now() };

    attempts.count += 1;
    attempts.lastAttempt = Date.now();
    attemptStore.set(key, attempts);

    setTimeout(() => {
        attemptStore.delete(key);
    }, OTP_CONFIG.cooldownSeconds * 1000);
};

// ============================================
// MAIN OTP VALIDATION
// ============================================

const isValidOTP = (userId, otp, options = {}) => {
    try {
        const formatResult = validateOTPFormat(otp);
        if (!formatResult.valid) {
            logOTPEvent('validation_failed', userId, otp, formatResult.error);
            return formatResult;
        }

        const otpValue = formatResult.value;

        const rateLimitResult = checkRateLimit(userId);
        if (!rateLimitResult.allowed) {
            logOTPEvent('rate_limited', userId, otp, rateLimitResult.error);
            return {
                valid: false,
                error: rateLimitResult.error,
                code: rateLimitResult.code,
                remaining: rateLimitResult.remaining,
            };
        }

        const otpData = otpStore.get(userId);

        const expiryResult = checkOTPExpiry(otpData);
        if (!expiryResult.valid) {
            logOTPEvent('validation_failed', userId, otp, expiryResult.error);
            return expiryResult;
        }

        if (otpData.otp !== otpValue) {
            incrementAttempts(userId);

            logOTPEvent('validation_failed', userId, otp, 'Invalid OTP');

            return {
                valid: false,
                error: 'Invalid OTP',
                code: 'OTP_INVALID',
                attempts: (attemptStore.get(`attempts:${userId}`)?.count || 0),
                maxAttempts: OTP_CONFIG.maxAttempts,
            };
        }

        otpData.validated = true;
        otpStore.set(userId, otpData);

        attemptStore.delete(`attempts:${userId}`);

        logOTPEvent('validation_success', userId, otp);

        return {
            valid: true,
            message: 'OTP validated successfully',
            code: 'OTP_VALID',
        };

    } catch (error) {
        console.error('OTP validation error:', error);
        return {
            valid: false,
            error: 'Internal server error',
            code: 'OTP_ERROR',
        };
    }
};

// ============================================
// LEGACY SUPPORT
// ============================================

const validateOTP = (otp) => {
    const result = validateOTPFormat(otp);
    return result.valid;
};

// ============================================
// LOGGING
// ============================================

const logOTPEvent = (event, userId, otp, message = null) => {
    if (!OTP_CONFIG.enableLogging) return;

    const log = {
        timestamp: new Date().toISOString(),
        event,
        userId,
        otp: otp ? String(otp).slice(0, 3) + '***' : 'N/A',
        message,
    };

    if (event === 'validation_success') {
        console.log('OTP Validation Success:', log);
    } else if (event === 'rate_limited') {
        console.warn('OTP Rate Limited:', log);
    } else if (event === 'validation_failed') {
        console.warn('OTP Validation Failed:', log);
    } else {
        console.log('OTP Event:', log);
    }
};

// ============================================
// UTILITY FUNCTIONS
// ============================================

const isOTPFormatValid = (otp) => {
    const result = validateOTPFormat(otp);
    return result.valid;
};

const getRemainingAttempts = (userId) => {
    if (!OTP_CONFIG.enableRateLimiting) {
        return { remaining: Infinity, maxAttempts: OTP_CONFIG.maxAttempts };
    }

    const key = `attempts:${userId}`;
    const attempts = attemptStore.get(key);

    if (!attempts) {
        return { remaining: OTP_CONFIG.maxAttempts, maxAttempts: OTP_CONFIG.maxAttempts };
    }

    const remaining = Math.max(0, OTP_CONFIG.maxAttempts - attempts.count);
    return { remaining, maxAttempts: OTP_CONFIG.maxAttempts };
};

const getOTPStatus = (userId) => {
    const otpData = otpStore.get(userId);

    if (!otpData) {
        return { exists: false };
    }

    return {
        exists: true,
        createdAt: otpData.createdAt,
        expiresAt: otpData.expiresAt,
        validated: otpData.validated,
        isExpired: new Date() > new Date(otpData.expiresAt),
    };
};

const clearOTP = (userId) => {
    otpStore.delete(userId);
    attemptStore.delete(`attempts:${userId}`);
};

const clearAllOTPs = () => {
    otpStore.clear();
    attemptStore.clear();
};

const getOTPConfig = () => {
    return { ...OTP_CONFIG };
};

const updateOTPConfig = (newConfig) => {
    Object.assign(OTP_CONFIG, newConfig);
};

// ============================================
// EXPORTS
// ============================================

module.exports = {
    isValidOTP,
    validateOTP,
    validateOTPFormat,
    isOTPFormatValid,
    generateOTP,
    generateOTPWithMetadata,
    getRemainingAttempts,
    checkRateLimit,
    getOTPStatus,
    clearOTP,
    clearAllOTPs,
    logOTPEvent,
    getOTPConfig,
    updateOTPConfig,
    OTP_CONFIG,
};