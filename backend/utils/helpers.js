// backend/utils/helpers.js

const validator = require('validator');
const crypto = require('crypto');

/**
 * ============================================
 * NUMBER SAFETY HELPERS
 * ============================================
 */

/**
 * Safely parse a number with fallback
 * @param {any} value - Value to parse
 * @param {number} fallback - Default value if parsing fails
 * @returns {number} - Safe number
 */
function safeNumber(value, fallback = 0) {
    if (value === null || value === undefined) return fallback;
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Safely parse an integer with fallback
 * @param {any} value - Value to parse
 * @param {number} fallback - Default value if parsing fails
 * @returns {number} - Safe integer
 */
function safeInteger(value, fallback = 0) {
    if (value === null || value === undefined) return fallback;
    const parsed = parseInt(value, 10);
    return Number.isInteger(parsed) ? parsed : fallback;
}

/**
 * ============================================
 * STRING SANITIZATION
 * ============================================
 */

/**
 * Sanitize string by trimming
 * @param {any} value - Value to sanitize
 * @returns {string} - Sanitized string
 */
function sanitizeString(value) {
    if (value === null || value === undefined) return '';
    return String(value).trim();
}

/**
 * Escape HTML characters to prevent XSS
 * @param {any} value - Value to escape
 * @returns {string} - Escaped string
 */
function escapeHTML(value) {
    if (value === null || value === undefined) return '';
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

/**
 * Deep sanitize an object/array recursively
 * @param {any} obj - Object to sanitize
 * @returns {any} - Sanitized object
 */
function deepSanitize(obj) {
    if (obj === null || obj === undefined) return obj;
    if (typeof obj === 'string') return sanitizeString(obj);
    if (Array.isArray(obj)) return obj.map(item => deepSanitize(item));
    if (typeof obj === 'object') {
        const sanitized = {};
        for (const [key, value] of Object.entries(obj)) {
            sanitized[key] = deepSanitize(value);
        }
        return sanitized;
    }
    return obj;
}

/**
 * ============================================
 * PAGINATION HELPERS
 * ============================================
 */

/**
 * Get pagination parameters
 * @param {number} page - Page number
 * @param {number} limit - Items per page
 * @param {number} maxLimit - Maximum limit allowed
 * @returns {Object} - Pagination object
 */
function getPagination(page, limit, maxLimit = 50) {
    const safePage = Math.max(1, safeInteger(page, 1));
    const safeLimit = Math.min(maxLimit, Math.max(1, safeInteger(limit, 10)));
    return {
        page: safePage,
        limit: safeLimit,
        offset: (safePage - 1) * safeLimit
    };
}

/**
 * Build pagination metadata
 * @param {number} total - Total items
 * @param {number} page - Current page
 * @param {number} limit - Items per page
 * @returns {Object} - Pagination metadata
 */
function buildPaginationMeta(total, page, limit) {
    const totalPages = Math.max(1, Math.ceil(total / limit));
    return {
        total,
        page,
        limit,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1
    };
}

/**
 * ============================================
 * TYPE SAFETY HELPERS
 * ============================================
 */

/**
 * Safely get array
 * @param {any} value - Value to check
 * @returns {Array} - Safe array
 */
function safeArray(value) {
    return Array.isArray(value) ? value : [];
}

/**
 * Safely get object
 * @param {any} value - Value to check
 * @param {Object} fallback - Default object
 * @returns {Object} - Safe object
 */
function safeObject(value, fallback = {}) {
    return (value && typeof value === 'object' && !Array.isArray(value)) ? value : fallback;
}

/**
 * Check if value is nil (null or undefined)
 * @param {any} value - Value to check
 * @returns {boolean} - True if nil
 */
function isNil(value) {
    return value === null || value === undefined;
}

/**
 * Check if value is a string
 * @param {any} value - Value to check
 * @returns {boolean} - True if string
 */
function isString(value) {
    return typeof value === 'string' || value instanceof String;
}

/**
 * Check if value is a number
 * @param {any} value - Value to check
 * @returns {boolean} - True if number
 */
function isNumber(value) {
    return typeof value === 'number' && !isNaN(value);
}

/**
 * Check if value is a boolean
 * @param {any} value - Value to check
 * @returns {boolean} - True if boolean
 */
function isBoolean(value) {
    return typeof value === 'boolean' || value instanceof Boolean;
}

/**
 * Check if value is an array
 * @param {any} value - Value to check
 * @returns {boolean} - True if array
 */
function isArray(value) {
    return Array.isArray(value);
}

/**
 * Check if value is an object (not null, not array)
 * @param {any} value - Value to check
 * @returns {boolean} - True if object
 */
function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * ============================================
 * ASYNC HANDLER
 * ============================================
 */

/**
 * Wrapper for async route handlers
 * @param {Function} fn - Async function
 * @returns {Function} - Express middleware
 */
function asyncHandler(fn) {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
}

/**
 * ============================================
 * VALIDATION HELPERS
 * ============================================
 */

/**
 * Validate email address
 * @param {string} email - Email to validate
 * @returns {boolean} - True if valid
 */
function validateEmail(email) {
    if (!email || typeof email !== 'string') return false;
    return validator.isEmail(email.trim());
}

/**
 * Validate phone number
 * @param {string} phone - Phone to validate
 * @returns {boolean} - True if valid
 */
function validatePhone(phone) {
    if (!phone || typeof phone !== 'string') return false;
    const cleaned = phone.replace(/[\s\-\(\)\+]/g, '');
    return validator.isMobilePhone(cleaned, 'any');
}

/**
 * Validate URL
 * @param {string} url - URL to validate
 * @returns {boolean} - True if valid
 */
function validateUrl(url) {
    if (!url || typeof url !== 'string') return false;
    return validator.isURL(url.trim(), {
        protocols: ['http', 'https'],
        require_protocol: true
    });
}

/**
 * Validate Indian pincode
 * @param {string} pincode - Pincode to validate
 * @returns {boolean} - True if valid
 */
function validatePincode(pincode) {
    if (!pincode || typeof pincode !== 'string') return false;
    return /^\d{6}$/.test(pincode.trim());
}

/**
 * Validate UUID
 * @param {string} uuid - UUID to validate
 * @returns {boolean} - True if valid
 */
function validateUUID(uuid) {
    if (!uuid || typeof uuid !== 'string') return false;
    return validator.isUUID(uuid);
}

/**
 * Safely parse a UUID with fallback
 * @param {any} value - Value to parse
 * @param {string} fallback - Default value if parsing fails
 * @returns {string} - Safe UUID string
 */
function safeUUID(value, fallback = null) {
    if (value === null || value === undefined) return fallback;
    const strValue = String(value).trim();
    return validateUUID(strValue) ? strValue : fallback;
}

/**
 * Validate MongoDB ObjectId
 * @param {string} id - ID to validate
 * @returns {boolean} - True if valid
 */
function isObjectId(id) {
    if (!id || typeof id !== 'string') return false;
    return /^[0-9a-fA-F]{24}$/.test(id);
}

/**
 * Alias for isObjectId
 * @param {string} id - ID to validate
 * @returns {boolean} - True if valid
 */
function isMongoId(id) {
    return isObjectId(id);
}

/**
 * Validate PostgreSQL UUID
 * @param {string} uuid - UUID to validate
 * @returns {boolean} - True if valid
 */
function isPostgresUUID(uuid) {
    return validateUUID(uuid);
}

/**
 * ============================================
 * STRING HELPERS
 * ============================================
 */

/**
 * Generate URL-friendly slug
 * @param {string} text - Text to convert
 * @returns {string} - Generated slug
 */
function generateSlug(text) {
    if (!text || typeof text !== 'string') return '';
    return text
        .toLowerCase()
        .trim()
        .replace(/[^\w\s-]/g, '')
        .replace(/[\s_-]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

/**
 * Truncate text to specified length
 * @param {string} text - Text to truncate
 * @param {number} length - Maximum length
 * @param {string} suffix - Suffix to add
 * @returns {string} - Truncated text
 */
function truncate(text, length = 100, suffix = '...') {
    if (!text || typeof text !== 'string') return '';
    if (text.length <= length) return text;
    return text.substring(0, length).trim() + suffix;
}

/**
 * Capitalize first letter
 * @param {string} str - String to capitalize
 * @returns {string} - Capitalized string
 */
function capitalize(str) {
    if (!isString(str)) return '';
    if (str.length === 0) return str;
    return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Convert to camelCase
 * @param {string} str - String to convert
 * @returns {string} - CamelCase string
 */
function toCamelCase(str) {
    if (!isString(str)) return '';
    return str
        .toLowerCase()
        .replace(/[^a-zA-Z0-9]+(.)/g, (match, chr) => chr.toUpperCase());
}

/**
 * ============================================
 * GENERATION HELPERS
 * ============================================
 */

/**
 * Generate UUID
 * @returns {string} - Generated UUID
 */
function generateUUID() {
    return crypto.randomUUID();
}

/**
 * Generate OTP
 * @param {number} length - OTP length
 * @returns {string} - Generated OTP
 */
function generateOTP(length = 6) {
    const digits = '0123456789';
    let otp = '';
    for (let i = 0; i < length; i++) {
        otp += digits[Math.floor(Math.random() * 10)];
    }
    return otp;
}

/**
 * Generate random string
 * @param {number} length - String length
 * @returns {string} - Random string
 */
function generateRandomString(length = 16) {
    return crypto.randomBytes(Math.ceil(length / 2))
        .toString('hex')
        .slice(0, length);
}

/**
 * Generate random number between min and max
 * @param {number} min - Minimum value
 * @param {number} max - Maximum value
 * @returns {number} - Random number
 */
function randomNumber(min = 0, max = 100) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * ============================================
 * RESPONSE FORMATTERS
 * ============================================
 */

/**
 * Format success response
 * @param {boolean} success - Success status
 * @param {any} data - Response data
 * @param {string} message - Response message
 * @param {any} errors - Error details
 * @returns {Object} - Formatted response
 */
function formatResponse(success, data, message = null, errors = null) {
    const response = { success };
    if (data !== null && data !== undefined) response.data = data;
    if (message) response.message = message;
    if (errors) response.errors = errors;
    return response;
}

/**
 * Format error response
 * @param {string} message - Error message
 * @param {string} code - Error code
 * @param {any} details - Error details
 * @returns {Object} - Formatted error
 */
function formatError(message, code = null, details = null) {
    const error = { success: false, message };
    if (code) error.code = code;
    if (details) error.details = details;
    return error;
}

/**
 * ============================================
 * DATA MASKING HELPERS
 * ============================================
 */

/**
 * Mask email address
 * @param {string} email - Email to mask
 * @returns {string} - Masked email
 */
function maskEmail(email) {
    if (!email || typeof email !== 'string') return '';
    const [local, domain] = email.split('@');
    if (!domain) return email;
    const masked = local.length > 2 
        ? local[0] + '*'.repeat(Math.min(local.length - 2, 4)) + local[local.length - 1]
        : local;
    return `${masked}@${domain}`;
}

/**
 * Mask phone number
 * @param {string} phone - Phone to mask
 * @returns {string} - Masked phone
 */
function maskPhone(phone) {
    if (!phone || typeof phone !== 'string') return '';
    const cleaned = phone.replace(/[\s\-\(\)\+]/g, '');
    if (cleaned.length <= 4) return '****';
    return '*'.repeat(cleaned.length - 4) + cleaned.slice(-4);
}

/**
 * ============================================
 * JSON HELPERS
 * ============================================
 */

/**
 * Check if string is valid JSON
 * @param {string} str - String to check
 * @returns {boolean} - True if valid JSON
 */
function isValidJSON(str) {
    if (!str || typeof str !== 'string') return false;
    try {
        JSON.parse(str);
        return true;
    } catch {
        return false;
    }
}

/**
 * Parse JSON safely
 * @param {string} str - String to parse
 * @param {any} fallback - Fallback value
 * @returns {any} - Parsed JSON or fallback
 */
function parseJSON(str, fallback = null) {
    if (!str || typeof str !== 'string') return fallback;
    try {
        return JSON.parse(str);
    } catch {
        return fallback;
    }
}

/**
 * ============================================
 * ASYNC HELPERS
 * ============================================
 */

/**
 * Sleep for specified milliseconds
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise} - Promise that resolves after sleep
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry async function with exponential backoff
 * @param {Function} fn - Async function
 * @param {number} retries - Number of retries
 * @param {number} delay - Initial delay in ms
 * @returns {Function} - Retry wrapper
 */
function retry(fn, retries = 3, delay = 1000) {
    return async function(...args) {
        let lastError;
        for (let i = 0; i < retries; i++) {
            try {
                return await fn(...args);
            } catch (error) {
                lastError = error;
                if (i < retries - 1) {
                    await sleep(delay * Math.pow(2, i));
                }
            }
        }
        throw lastError;
    };
}

/**
 * ============================================
 * ENVIRONMENT HELPERS
 * ============================================
 */

/**
 * Get environment variable with fallback
 * @param {string} key - Environment variable key
 * @param {string} defaultValue - Default value
 * @returns {string} - Environment variable value
 */
function getEnv(key, defaultValue = '') {
    const value = process.env[key];
    return value !== undefined ? value : defaultValue;
}

/**
 * Get environment variable as number
 * @param {string} key - Environment variable key
 * @param {number} defaultValue - Default value
 * @returns {number} - Environment variable as number
 */
function getEnvNumber(key, defaultValue = 0) {
    const value = process.env[key];
    if (value === undefined) return defaultValue;
    const parsed = parseFloat(value);
    return !isNaN(parsed) ? parsed : defaultValue;
}

/**
 * Get environment variable as boolean
 * @param {string} key - Environment variable key
 * @param {boolean} defaultValue - Default value
 * @returns {boolean} - Environment variable as boolean
 */
function getEnvBoolean(key, defaultValue = false) {
    const value = process.env[key];
    if (value === undefined) return defaultValue;
    return value.toLowerCase() === 'true' || value === '1';
}

/**
 * Get environment variable as array
 * @param {string} key - Environment variable key
 * @param {string} delimiter - Delimiter
 * @param {Array} defaultValue - Default value
 * @returns {Array} - Environment variable as array
 */
function getEnvArray(key, delimiter = ',', defaultValue = []) {
    const value = process.env[key];
    if (value === undefined || value === '') return defaultValue;
    return value.split(delimiter).map(item => item.trim()).filter(item => item !== '');
}

/**
 * ============================================
 * DATE HELPERS
 * ============================================
 */

/**
 * Check if value is a valid date
 * @param {any} value - Value to check
 * @returns {boolean} - True if valid date
 */
function isDate(value) {
    if (value instanceof Date && !isNaN(value)) return true;
    if (typeof value === 'string' || typeof value === 'number') {
        const date = new Date(value);
        return date instanceof Date && !isNaN(date);
    }
    return false;
}

/**
 * Format date
 * @param {Date|string|number} date - Date to format
 * @param {string} format - Format string
 * @returns {string} - Formatted date
 */
function formatDate(date, format = 'YYYY-MM-DD HH:mm:ss') {
    if (!isDate(date)) {
        throw new Error('Invalid date provided');
    }
    
    const d = new Date(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    const seconds = String(d.getSeconds()).padStart(2, '0');
    
    return format
        .replace('YYYY', year)
        .replace('MM', month)
        .replace('DD', day)
        .replace('HH', hours)
        .replace('mm', minutes)
        .replace('ss', seconds);
}

/**
 * Get current timestamp
 * @param {string} format - Timestamp format
 * @returns {string|number} - Timestamp
 */
function getTimestamp(format = 'ISO') {
    const now = new Date();
    switch (format.toUpperCase()) {
        case 'ISO':
            return now.toISOString();
        case 'UNIX':
            return Math.floor(now.getTime() / 1000);
        case 'MILLISECONDS':
            return now.getTime();
        case 'DATE':
            return formatDate(now, 'YYYY-MM-DD');
        case 'DATETIME':
            return formatDate(now, 'YYYY-MM-DD HH:mm:ss');
        default:
            return now.toISOString();
    }
}

/**
 * ============================================
 * OBJECT HELPERS
 * ============================================
 */

/**
 * Check if object is empty
 * @param {Object} obj - Object to check
 * @returns {boolean} - True if empty
 */
function isEmptyObject(obj) {
    if (obj === null || obj === undefined) return true;
    if (typeof obj !== 'object') return true;
    return Object.keys(obj).length === 0;
}

/**
 * Deep clone an object
 * @param {Object} obj - Object to clone
 * @returns {Object} - Cloned object
 */
function deepClone(obj) {
    if (obj === null || typeof obj !== 'object') return obj;
    return JSON.parse(JSON.stringify(obj));
}

/**
 * Pick specific keys from object
 * @param {Object} obj - Source object
 * @param {string[]} keys - Keys to pick
 * @returns {Object} - Object with picked keys
 */
function pickObject(obj, keys) {
    if (typeof obj !== 'object' || obj === null) return {};
    const keysToPick = Array.isArray(keys) ? keys : [keys];
    return Object.fromEntries(
        Object.entries(obj).filter(([key]) => keysToPick.includes(key))
    );
}

/**
 * Omit specific keys from object
 * @param {Object} obj - Source object
 * @param {string[]} keys - Keys to omit
 * @returns {Object} - Object without omitted keys
 */
function omitObject(obj, keys) {
    if (typeof obj !== 'object' || obj === null) return {};
    const keysToOmit = Array.isArray(keys) ? keys : [keys];
    return Object.fromEntries(
        Object.entries(obj).filter(([key]) => !keysToOmit.includes(key))
    );
}

// ============================================
// EXPORTS
// ============================================

module.exports = {
    // Number Safety
    safeNumber,
    safeInteger,
    safeUUID,
    
    // String Sanitization
    sanitizeString,
    escapeHTML,
    deepSanitize,
    
    // Pagination
    getPagination,
    buildPaginationMeta,
    
    // Type Safety
    safeArray,
    safeObject,
    isNil,
    isString,
    isNumber,
    isBoolean,
    isArray,
    isObject,
    
    // Async Handler
    asyncHandler,
    
    // Validation
    validateEmail,
    validatePhone,
    validateUrl,
    validatePincode,
    validateUUID,
    isObjectId,
    isMongoId,
    isPostgresUUID,
    
    // String Helpers
    generateSlug,
    truncate,
    capitalize,
    toCamelCase,
    
    // Generation
    generateUUID,
    generateOTP,
    generateRandomString,
    randomNumber,
    
    // Response Formatters
    formatResponse,
    formatError,
    
    // Data Masking
    maskEmail,
    maskPhone,
    
    // JSON Helpers
    isValidJSON,
    parseJSON,
    
    // Async Helpers
    sleep,
    retry,
    
    // Environment Helpers
    getEnv,
    getEnvNumber,
    getEnvBoolean,
    getEnvArray,
    
    // Date Helpers
    isDate,
    formatDate,
    getTimestamp,
    
    // Object Helpers
    isEmptyObject,
    deepClone,
    pickObject,
    omitObject,
};