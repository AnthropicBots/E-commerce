// backend/middleware/responseStandardizer.js
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ============================================
// RESPONSE FORMAT CONFIGURATION
// ============================================

const RESPONSE_CONFIG = {
    includeTimestamp: true,
    includeRequestId: true,
    includePath: true,
    includeDuration: true,
    includeEnvironment: true,
    includeVersion: true,
    environment: process.env.NODE_ENV || 'development',
    version: '1.0.0',
    logErrors: true,
    errorLogPath: path.join(__dirname, '../logs/api-errors.log')
};

// Create logs directory if it doesn't exist
const logDir = path.dirname(RESPONSE_CONFIG.errorLogPath);
if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
}

// ============================================
// STANDARD RESPONSE CLASS
// ============================================

class StandardResponse {
    constructor(options = {}) {
        this.success = options.success !== undefined ? options.success : true;
        this.message = options.message || '';
        this.data = options.data || null;
        this.errors = options.errors || null;
        this.timestamp = options.timestamp || new Date().toISOString();
        this.requestId = options.requestId || null;
        this.statusCode = options.statusCode || 200;
        this.path = options.path || null;
        this.duration = options.duration || null;
        this.pagination = options.pagination || null;
        this.meta = options.meta || null;
        this.environment = RESPONSE_CONFIG.environment;
        this.version = RESPONSE_CONFIG.version;
        this.correlationId = options.correlationId || null;
    }

    /**
     * Create a success response
     */
    static success(data, message = 'Success', options = {}) {
        return new StandardResponse({
            success: true,
            message,
            data,
            statusCode: 200,
            ...options
        });
    }

    /**
     * Create an error response
     */
    static error(message, statusCode = 400, errors = null, options = {}) {
        const errorResponse = new StandardResponse({
            success: false,
            message,
            errors,
            statusCode,
            ...options
        });

        // Log errors if enabled
        if (RESPONSE_CONFIG.logErrors && errors) {
            errorResponse.logError();
        }

        return errorResponse;
    }

    /**
     * Create a created response
     */
    static created(data, message = 'Resource created successfully', options = {}) {
        return new StandardResponse({
            success: true,
            message,
            data,
            statusCode: 201,
            ...options
        });
    }

    /**
     * Create a paginated response
     */
    static paginated(data, pagination, message = 'Success', options = {}) {
        return new StandardResponse({
            success: true,
            message,
            data,
            pagination,
            statusCode: 200,
            ...options
        });
    }

    /**
     * Create a no content response
     */
    static noContent(message = 'No content', options = {}) {
        return new StandardResponse({
            success: true,
            message,
            data: null,
            statusCode: 204,
            ...options
        });
    }

    /**
     * Create a validation error response
     */
    static validationError(errors, message = 'Validation failed', options = {}) {
        return new StandardResponse({
            success: false,
            message,
            errors,
            statusCode: 400,
            ...options
        });
    }

    /**
     * Create an unauthorized response
     */
    static unauthorized(message = 'Unauthorized', options = {}) {
        return new StandardResponse({
            success: false,
            message,
            errors: [{ code: 'UNAUTHORIZED', message }],
            statusCode: 401,
            ...options
        });
    }

    /**
     * Create a forbidden response
     */
    static forbidden(message = 'Forbidden', options = {}) {
        return new StandardResponse({
            success: false,
            message,
            errors: [{ code: 'FORBIDDEN', message }],
            statusCode: 403,
            ...options
        });
    }

    /**
     * Create a not found response
     */
    static notFound(message = 'Resource not found', options = {}) {
        return new StandardResponse({
            success: false,
            message,
            errors: [{ code: 'NOT_FOUND', message }],
            statusCode: 404,
            ...options
        });
    }

    /**
     * Create a conflict response
     */
    static conflict(message = 'Conflict', errors = null, options = {}) {
        return new StandardResponse({
            success: false,
            message,
            errors,
            statusCode: 409,
            ...options
        });
    }

    /**
     * Create a too many requests response
     */
    static tooManyRequests(message = 'Too many requests', options = {}) {
        return new StandardResponse({
            success: false,
            message,
            errors: [{ code: 'RATE_LIMIT_EXCEEDED', message }],
            statusCode: 429,
            ...options
        });
    }

    /**
     * Create a server error response
     */
    static serverError(message = 'Internal server error', errors = null, options = {}) {
        const errorResponse = new StandardResponse({
            success: false,
            message,
            errors: errors || [{ code: 'INTERNAL_SERVER_ERROR', message }],
            statusCode: 500,
            ...options
        });

        // Log server errors
        if (RESPONSE_CONFIG.logErrors) {
            errorResponse.logError();
        }

        return errorResponse;
    }

    /**
     * Log error to file
     */
    logError() {
        try {
            const logEntry = {
                timestamp: this.timestamp,
                requestId: this.requestId,
                statusCode: this.statusCode,
                message: this.message,
                errors: this.errors,
                path: this.path,
                environment: this.environment
            };

            const logLine = JSON.stringify(logEntry) + '\n';
            fs.appendFileSync(RESPONSE_CONFIG.errorLogPath, logLine);
        } catch (error) {
            console.error('Error logging response error:', error);
        }
    }

    /**
     * Convert to JSON
     */
    toJSON() {
        const response = {
            success: this.success,
            message: this.message,
            timestamp: this.timestamp,
            requestId: this.requestId
        };

        if (this.data !== null) {
            response.data = this.data;
        }

        if (this.errors !== null && this.errors.length > 0) {
            response.errors = this.errors;
        }

        if (this.pagination) {
            response.pagination = this.pagination;
        }

        if (this.meta) {
            response.meta = this.meta;
        }

        if (RESPONSE_CONFIG.includePath && this.path) {
            response.path = this.path;
        }

        if (RESPONSE_CONFIG.includeDuration && this.duration !== null) {
            response.duration = this.duration;
        }

        if (RESPONSE_CONFIG.includeEnvironment) {
            response.environment = this.environment;
        }

        if (RESPONSE_CONFIG.includeVersion) {
            response.version = this.version;
        }

        if (this.correlationId) {
            response.correlationId = this.correlationId;
        }

        return response;
    }

    /**
     * Send response
     */
    send(res) {
        return res.status(this.statusCode).json(this.toJSON());
    }
}

// ============================================
// RESPONSE STANDARDIZATION MIDDLEWARE
// ============================================

/**
 * Middleware to standardize all responses
 */
function standardizeResponse(req, res, next) {
    // Store request start time
    req._startTime = Date.now();

    // Generate request ID
    req.requestId = generateRequestId();

    // Get correlation ID from headers
    req.correlationId = req.headers['x-correlation-id'] || null;

    // Override res.json to standardize responses
    const originalJson = res.json;
    const originalSend = res.send;

    res.json = function(data) {
        // Calculate duration
        const duration = req._startTime ? Date.now() - req._startTime : null;

        // Check if response is already standardized
        if (data && typeof data === 'object' && 'success' in data && 'message' in data) {
            // Already standardized, add additional fields
            const standardized = {
                ...data,
                requestId: data.requestId || req.requestId,
                timestamp: data.timestamp || new Date().toISOString()
            };

            if (duration !== null && !data.duration) {
                standardized.duration = duration;
            }

            if (RESPONSE_CONFIG.includeEnvironment && !data.environment) {
                standardized.environment = RESPONSE_CONFIG.environment;
            }

            if (RESPONSE_CONFIG.includeVersion && !data.version) {
                standardized.version = RESPONSE_CONFIG.version;
            }

            if (req.correlationId && !data.correlationId) {
                standardized.correlationId = req.correlationId;
            }

            return originalJson.call(this, standardized);
        }

        // Not standardized - wrap it
        const statusCode = this.statusCode || 200;

        // Determine if success or error based on status code
        const isSuccess = statusCode >= 200 && statusCode < 300;
        const isError = statusCode >= 400;

        let response;

        if (isSuccess) {
            response = StandardResponse.success(data, data?.message || 'Success', {
                requestId: req.requestId,
                correlationId: req.correlationId,
                duration,
                path: req.path
            });
        } else if (isError) {
            const message = data?.message || data?.error || 'An error occurred';
            const errors = data?.errors || (data?.error ? [{ message: data.error }] : null);
            response = StandardResponse.error(message, statusCode, errors, {
                requestId: req.requestId,
                correlationId: req.correlationId,
                duration,
                path: req.path
            });
        } else {
            response = StandardResponse.success(data, data?.message || 'Success', {
                requestId: req.requestId,
                correlationId: req.correlationId,
                duration,
                path: req.path
            });
        }

        return originalJson.call(this, response.toJSON());
    };

    // Also handle res.send for non-JSON responses
    res.send = function(data) {
        // If data is a string and not JSON, send as is
        if (typeof data === 'string' && !data.startsWith('{') && !data.startsWith('[')) {
            return originalSend.call(this, data);
        }

        // If it's a buffer, send as is
        if (Buffer.isBuffer(data)) {
            return originalSend.call(this, data);
        }

        // Otherwise, try to parse as JSON
        try {
            const parsed = typeof data === 'string' ? JSON.parse(data) : data;
            return res.json(parsed);
        } catch (e) {
            return originalSend.call(this, data);
        }
    };

    next();
}

/**
 * Generate a unique request ID
 */
function generateRequestId() {
    const timestamp = Date.now().toString(36);
    const random = crypto.randomBytes(8).toString('hex');
    return `req_${timestamp}_${random}`;
}

// ============================================
// HELPER FUNCTIONS FOR CONTROLLERS
// ============================================

/**
 * Send a standardized success response
 */
function sendSuccess(res, data, message = 'Success', statusCode = 200) {
    const response = StandardResponse.success(data, message, {
        requestId: res.req?.requestId || generateRequestId(),
        correlationId: res.req?.correlationId || null,
        path: res.req?.path
    });
    response.statusCode = statusCode;
    return response.send(res);
}

/**
 * Send a standardized error response
 */
function sendError(res, message, statusCode = 400, errors = null) {
    const response = StandardResponse.error(message, statusCode, errors, {
        requestId: res.req?.requestId || generateRequestId(),
        correlationId: res.req?.correlationId || null,
        path: res.req?.path
    });
    return response.send(res);
}

/**
 * Send a standardized created response
 */
function sendCreated(res, data, message = 'Resource created successfully') {
    return StandardResponse.created(data, message, {
        requestId: res.req?.requestId || generateRequestId(),
        correlationId: res.req?.correlationId || null,
        path: res.req?.path
    }).send(res);
}

/**
 * Send a standardized paginated response
 */
function sendPaginated(res, data, pagination, message = 'Success') {
    return StandardResponse.paginated(data, pagination, message, {
        requestId: res.req?.requestId || generateRequestId(),
        correlationId: res.req?.correlationId || null,
        path: res.req?.path
    }).send(res);
}

/**
 * Send a standardized validation error
 */
function sendValidationError(res, errors, message = 'Validation failed') {
    return StandardResponse.validationError(errors, message, {
        requestId: res.req?.requestId || generateRequestId(),
        correlationId: res.req?.correlationId || null,
        path: res.req?.path
    }).send(res);
}

/**
 * Send a standardized not found response
 */
function sendNotFound(res, message = 'Resource not found') {
    return StandardResponse.notFound(message, {
        requestId: res.req?.requestId || generateRequestId(),
        correlationId: res.req?.correlationId || null,
        path: res.req?.path
    }).send(res);
}

/**
 * Send a standardized server error
 */
function sendServerError(res, message = 'Internal server error', errors = null) {
    return StandardResponse.serverError(message, errors, {
        requestId: res.req?.requestId || generateRequestId(),
        correlationId: res.req?.correlationId || null,
        path: res.req?.path
    }).send(res);
}

/**
 * Send a standardized unauthorized response
 */
function sendUnauthorized(res, message = 'Unauthorized') {
    return StandardResponse.unauthorized(message, {
        requestId: res.req?.requestId || generateRequestId(),
        correlationId: res.req?.correlationId || null,
        path: res.req?.path
    }).send(res);
}

/**
 * Send a standardized forbidden response
 */
function sendForbidden(res, message = 'Forbidden') {
    return StandardResponse.forbidden(message, {
        requestId: res.req?.requestId || generateRequestId(),
        correlationId: res.req?.correlationId || null,
        path: res.req?.path
    }).send(res);
}

/**
 * Send a standardized too many requests response
 */
function sendTooManyRequests(res, message = 'Too many requests') {
    return StandardResponse.tooManyRequests(message, {
        requestId: res.req?.requestId || generateRequestId(),
        correlationId: res.req?.correlationId || null,
        path: res.req?.path
    }).send(res);
}

// ============================================
// VALIDATION HELPERS
// ============================================

/**
 * Validate request body with standardized error response
 */
function validateBody(schema) {
    return (req, res, next) => {
        const errors = [];
        const body = req.body;

        for (const [field, rules] of Object.entries(schema)) {
            const value = body[field];

            if (rules.required && (value === undefined || value === null || value === '')) {
                errors.push({ field, message: `${field} is required` });
                continue;
            }

            if (value !== undefined && value !== null) {
                if (rules.type && typeof value !== rules.type) {
                    errors.push({ field, message: `${field} must be of type ${rules.type}` });
                }

                if (rules.min !== undefined && value < rules.min) {
                    errors.push({ field, message: `${field} must be at least ${rules.min}` });
                }

                if (rules.max !== undefined && value > rules.max) {
                    errors.push({ field, message: `${field} must be at most ${rules.max}` });
                }

                if (rules.pattern && !rules.pattern.test(value)) {
                    errors.push({ field, message: `${field} format is invalid` });
                }

                if (rules.enum && !rules.enum.includes(value)) {
                    errors.push({ field, message: `${field} must be one of: ${rules.enum.join(', ')}` });
                }
            }
        }

        if (errors.length > 0) {
            return sendValidationError(res, errors);
        }

        next();
    };
}

/**
 * Validate query parameters
 */
function validateQuery(schema) {
    return (req, res, next) => {
        const errors = [];
        const query = req.query;

        for (const [field, rules] of Object.entries(schema)) {
            const value = query[field];

            if (rules.required && (value === undefined || value === null || value === '')) {
                errors.push({ field, message: `${field} query parameter is required` });
                continue;
            }

            if (value !== undefined && value !== null) {
                if (rules.type) {
                    const parsed = value;
                    if (rules.type === 'number' && isNaN(Number(parsed))) {
                        errors.push({ field, message: `${field} must be a number` });
                    }
                    if (rules.type === 'boolean' && !['true', 'false'].includes(parsed)) {
                        errors.push({ field, message: `${field} must be true or false` });
                    }
                }

                if (rules.min !== undefined && Number(value) < rules.min) {
                    errors.push({ field, message: `${field} must be at least ${rules.min}` });
                }

                if (rules.max !== undefined && Number(value) > rules.max) {
                    errors.push({ field, message: `${field} must be at most ${rules.max}` });
                }

                if (rules.enum && !rules.enum.includes(value)) {
                    errors.push({ field, message: `${field} must be one of: ${rules.enum.join(', ')}` });
                }
            }
        }

        if (errors.length > 0) {
            return sendValidationError(res, errors);
        }

        next();
    };
}

// ============================================
// EXPORTS
// ============================================

module.exports = {
    StandardResponse,
    standardizeResponse,
    sendSuccess,
    sendError,
    sendCreated,
    sendPaginated,
    sendValidationError,
    sendNotFound,
    sendServerError,
    sendUnauthorized,
    sendForbidden,
    sendTooManyRequests,
    generateRequestId,
    validateBody,
    validateQuery,
    RESPONSE_CONFIG
};