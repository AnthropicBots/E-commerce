// backend/config/cookieConfig.js

/**
 * ============================================
 * COOKIE CONFIGURATION
 * ============================================
 * Shared cookie configuration to ensure consistent
 * creation, security, and environment-specific settings.
 */

// ============================================
// CONSTANTS
// ============================================

const TIME = {
    ONE_MINUTE: 60 * 1000,
    ONE_HOUR: 60 * 60 * 1000,
    ONE_DAY: 24 * 60 * 60 * 1000,
    ONE_WEEK: 7 * 24 * 60 * 60 * 1000,
    ONE_MONTH: 30 * 24 * 60 * 60 * 1000,
    ONE_YEAR: 365 * 24 * 60 * 60 * 1000,
};

const ALLOWED_ENVS = ['development', 'staging', 'production', 'test'];
const ALLOWED_SAME_SITE = ['strict', 'lax', 'none'];
const ALLOWED_PRIORITY = ['low', 'medium', 'high'];
const ALLOWED_COOKIE_PREFIXES = ['__Host-', '__Secure-', ''];

// ============================================
// ENVIRONMENT VALIDATION
// ============================================

/**
 * Validate environment value
 */
function validateEnvironment(env) {
    if (!ALLOWED_ENVS.includes(env)) {
        throw new Error(
            `Invalid NODE_ENV: ${env}. Allowed: ${ALLOWED_ENVS.join(', ')}`
        );
    }
    return env;
}

/**
 * Validate SameSite value
 */
function validateSameSite(value) {
    if (value && !ALLOWED_SAME_SITE.includes(value)) {
        throw new Error(
            `Invalid SameSite: ${value}. Allowed: ${ALLOWED_SAME_SITE.join(', ')}`
        );
    }
    return value;
}

/**
 * Validate priority value
 */
function validatePriority(value) {
    if (value && !ALLOWED_PRIORITY.includes(value)) {
        throw new Error(
            `Invalid priority: ${value}. Allowed: ${ALLOWED_PRIORITY.join(', ')}`
        );
    }
    return value;
}

/**
 * Validate domain format
 */
function validateDomain(domain) {
    if (domain && !/^(\.[a-zA-Z0-9-]+)+$/.test(domain)) {
        throw new Error(`Invalid domain format: ${domain}`);
    }
    return domain;
}

/**
 * Validate maxAge
 */
function validateMaxAge(maxAge) {
    if (maxAge !== undefined && (typeof maxAge !== 'number' || maxAge < 0)) {
        throw new Error('maxAge must be a positive number');
    }
    return maxAge;
}

/**
 * Validate secure configuration
 */
function validateSecureConfig(secure, sameSite) {
    if (sameSite === 'none' && !secure) {
        throw new Error('SameSite=none requires secure=true');
    }
    return true;
}

// ============================================
// ENVIRONMENT DETECTION
// ============================================

const NODE_ENV = process.env.NODE_ENV || 'development';
const validatedEnv = validateEnvironment(NODE_ENV);

const isProduction = validatedEnv === 'production';
const isStaging = validatedEnv === 'staging';
const isDevelopment = validatedEnv === 'development';

// ============================================
// COOKIE PREFIX SUPPORT
// ============================================

/**
 * Get cookie prefix based on security settings
 */
function getCookiePrefix(secure, httpOnly, path) {
    if (secure && httpOnly && path === '/') {
        return '__Host-';
    }
    if (secure) {
        return '__Secure-';
    }
    return '';
}

// ============================================
// ENVIRONMENT-SPECIFIC CONFIGURATIONS
// ============================================

const ENV_CONFIGS = {
    development: {
        secure: false,
        sameSite: 'lax',
        domain: undefined,
        maxAge: TIME.ONE_WEEK,
        httpOnly: true,
        path: '/',
        partitioned: false,
    },
    staging: {
        secure: true,
        sameSite: 'lax',
        domain: process.env.COOKIE_DOMAIN || '.staging.example.com',
        maxAge: TIME.ONE_WEEK,
        httpOnly: true,
        path: '/',
        partitioned: false,
    },
    production: {
        secure: true,
        sameSite: 'strict',
        domain: process.env.COOKIE_DOMAIN || '.example.com',
        maxAge: TIME.ONE_MONTH,
        httpOnly: true,
        path: '/',
        partitioned: false,
    }
};

// ============================================
// MAIN CONFIGURATION
// ============================================

const cookieConfig = {
    // HTTP-Only flag (prevents XSS attacks)
    httpOnly: process.env.COOKIE_HTTP_ONLY !== 'false',
    
    // Secure flag (only send over HTTPS)
    secure: process.env.COOKIE_SECURE !== undefined 
        ? process.env.COOKIE_SECURE === 'true' 
        : (isProduction || isStaging),
    
    // SameSite policy (CSRF protection)
    sameSite: validateSameSite(
        process.env.COOKIE_SAME_SITE || 
        (isProduction ? 'strict' : 'lax')
    ),
    
    // Domain configuration
    domain: validateDomain(
        process.env.COOKIE_DOMAIN || 
        (isProduction ? '.example.com' : 
         isStaging ? '.staging.example.com' : 
         undefined)
    ),
    
    // Cookie path
    path: process.env.COOKIE_PATH || '/',
    
    // Max age in milliseconds
    maxAge: validateMaxAge(
        parseInt(process.env.COOKIE_MAX_AGE) || 
        (isProduction ? TIME.ONE_MONTH : TIME.ONE_WEEK)
    ),
    
    // Expires (alternative to maxAge)
    expires: process.env.COOKIE_EXPIRES ? new Date(process.env.COOKIE_EXPIRES) : undefined,
    
    // Partitioned (for CHIPS - Chrome's partitioned cookies)
    partitioned: process.env.COOKIE_PARTITIONED === 'true',
    
    // Priority (low, medium, high)
    priority: validatePriority(
        process.env.COOKIE_PRIORITY || 'medium'
    ),
};

// Validate secure configuration
validateSecureConfig(cookieConfig.secure, cookieConfig.sameSite);

// ============================================
// COOKIE NAMES
// ============================================

const cookieNames = {
    // Session cookies
    session: process.env.COOKIE_SESSION_NAME || 'session',
    refreshToken: process.env.COOKIE_REFRESH_NAME || 'refresh_token',
    
    // Auth cookies
    accessToken: process.env.COOKIE_ACCESS_NAME || 'access_token',
    auth: process.env.COOKIE_AUTH_NAME || 'auth_token',
    
    // User preferences
    preferences: process.env.COOKIE_PREFERENCES_NAME || 'preferences',
    theme: process.env.COOKIE_THEME_NAME || 'theme',
    language: process.env.COOKIE_LANGUAGE_NAME || 'language',
    
    // Security cookies
    csrf: process.env.COOKIE_CSRF_NAME || 'csrf_token',
    xsrftoken: process.env.COOKIE_XSRF_NAME || 'XSRF-TOKEN',
    
    // Analytics
    analytics: process.env.COOKIE_ANALYTICS_NAME || 'analytics',
    tracking: process.env.COOKIE_TRACKING_NAME || 'tracking_id',
};

// ============================================
// COOKIE OPTIONS FUNCTIONS
// ============================================

/**
 * Get environment-specific cookie options
 */
function getEnvCookieOptions() {
    const env = process.env.COOKIE_ENV || NODE_ENV;
    return ENV_CONFIGS[env] || ENV_CONFIGS.development;
}

/**
 * Merge custom options with environment defaults
 */
function getCookieOptions(customOptions = {}) {
    const envOptions = getEnvCookieOptions();
    let options = { ...envOptions, ...customOptions };
    
    // Remove undefined values
    Object.keys(options).forEach(key => {
        if (options[key] === undefined) {
            delete options[key];
        }
    });
    
    return options;
}

/**
 * Get cookie options for session
 */
function getSessionCookieOptions(customOptions = {}) {
    const envOptions = getEnvCookieOptions();
    return {
        ...envOptions,
        httpOnly: true,
        secure: isProduction,
        sameSite: 'lax',
        maxAge: TIME.ONE_WEEK,
        ...customOptions,
    };
}

/**
 * Get cookie options for refresh token
 */
function getRefreshTokenOptions(customOptions = {}) {
    const envOptions = getEnvCookieOptions();
    return {
        ...envOptions,
        httpOnly: true,
        secure: isProduction,
        sameSite: 'strict',
        maxAge: TIME.ONE_MONTH,
        path: '/api/auth/refresh',
        ...customOptions,
    };
}

/**
 * Get cookie options for access token
 */
function getAccessTokenOptions(customOptions = {}) {
    const envOptions = getEnvCookieOptions();
    return {
        ...envOptions,
        httpOnly: true,
        secure: isProduction,
        sameSite: 'lax',
        maxAge: 15 * TIME.ONE_MINUTE,
        ...customOptions,
    };
}

/**
 * Get cookie options for preferences (non-sensitive)
 */
function getPreferencesOptions(customOptions = {}) {
    const envOptions = getEnvCookieOptions();
    return {
        ...envOptions,
        httpOnly: false,
        secure: isProduction,
        sameSite: 'lax',
        maxAge: TIME.ONE_YEAR,
        ...customOptions,
    };
}

/**
 * Get cookie options for CSRF token
 */
function getCsrfTokenOptions(customOptions = {}) {
    const envOptions = getEnvCookieOptions();
    return {
        ...envOptions,
        httpOnly: false,
        secure: isProduction,
        sameSite: 'strict',
        maxAge: TIME.ONE_DAY,
        ...customOptions,
    };
}

/**
 * Clear cookie options (for logout)
 */
function getClearCookieOptions(path = '/') {
    return {
        httpOnly: true,
        secure: isProduction,
        sameSite: 'strict',
        path: path,
        maxAge: 0,
    };
}

// ============================================
// VALIDATION FUNCTION
// ============================================

/**
 * Validate cookie configuration
 */
function validateCookieConfig() {
    const errors = [];
    const warnings = [];
    
    // Check secure flag in production
    if (isProduction && !cookieConfig.secure) {
        errors.push('Secure flag must be true in production');
    }
    
    // Check domain configuration
    if (isProduction && !cookieConfig.domain) {
        warnings.push('Domain should be set in production');
    }
    
    // Check SameSite policy
    if (!ALLOWED_SAME_SITE.includes(cookieConfig.sameSite)) {
        errors.push(`Invalid SameSite value: ${cookieConfig.sameSite}`);
    }
    
    // Check maxAge
    if (cookieConfig.maxAge && cookieConfig.maxAge < 0) {
        errors.push('maxAge must be positive');
    }
    
    // Check priority
    if (cookieConfig.priority && !ALLOWED_PRIORITY.includes(cookieConfig.priority)) {
        warnings.push(`Invalid priority value: ${cookieConfig.priority}`);
    }
    
    return {
        isValid: errors.length === 0,
        errors,
        warnings,
        environment: NODE_ENV,
        isProduction,
    };
}

// ============================================
// LOGGING
// ============================================

/**
 * Log cookie configuration (for debugging)
 */
function logCookieConfig() {
    const validation = validateCookieConfig();
    
    console.log('========== COOKIE CONFIGURATION ==========');
    console.log(`Environment: ${NODE_ENV}`);
    console.log(`Production: ${isProduction}`);
    console.log(`Secure: ${cookieConfig.secure}`);
    console.log(`SameSite: ${cookieConfig.sameSite}`);
    console.log(`Domain: ${cookieConfig.domain || 'Not set'}`);
    console.log(`MaxAge: ${cookieConfig.maxAge}ms`);
    console.log(`Validation: ${validation.isValid ? '✅ Valid' : '❌ Invalid'}`);
    
    if (validation.warnings.length > 0) {
        console.log('⚠️ Warnings:');
        validation.warnings.forEach(w => console.log(`  - ${w}`));
    }
    
    if (validation.errors.length > 0) {
        console.log('❌ Errors:');
        validation.errors.forEach(e => console.log(`  - ${e}`));
    }
    console.log('==========================================');
}

// Run validation in development
if (isDevelopment) {
    logCookieConfig();
}

// ============================================
// EXPORTS
// ============================================

module.exports = {
    // Main configuration
    cookieConfig,
    
    // Cookie names
    cookieNames,
    
    // Environment options
    getEnvCookieOptions,
    getCookieOptions,
    
    // Specific options by cookie type
    getSessionCookieOptions,
    getRefreshTokenOptions,
    getAccessTokenOptions,
    getPreferencesOptions,
    getCsrfTokenOptions,
    
    // Utility functions
    getClearCookieOptions,
    validateCookieConfig,
    logCookieConfig,
    
    // Environment helpers
    isProduction,
    isStaging,
    isDevelopment,
    NODE_ENV,
    
    // Constants
    TIME,
    getCookiePrefix,
    ALLOWED_ENVS,
    ALLOWED_SAME_SITE,
    ALLOWED_PRIORITY,
};