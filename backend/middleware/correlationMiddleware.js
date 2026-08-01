// backend/middleware/correlationIdMiddleware.js
const crypto = require('crypto');

// ============================================
// CONFIGURATION
// ============================================

const CORRELATION_CONFIG = {
    headerName: 'X-Correlation-Id',
    responseHeader: 'X-Correlation-Id',
    logFormat: 'json',
    includeInResponse: true,
    generateOnMissing: true,
    maxLength: 64
};

// ============================================
// CORRELATION ID MIDDLEWARE
// ============================================

/**
 * Generate a correlation ID
 */
function generateCorrelationId() {
    const timestamp = Date.now().toString(36);
    const random = crypto.randomBytes(8).toString('hex');
    const uuid = crypto.randomUUID().split('-')[0];
    return `corr_${timestamp}_${random}_${uuid}`;
}

/**
 * Validate correlation ID format
 */
function isValidCorrelationId(id) {
    if (!id || typeof id !== 'string') return false;
    if (id.length > CORRELATION_CONFIG.maxLength) return false;
    // Allow alphanumeric, underscores, hyphens
    return /^[a-zA-Z0-9_-]+$/.test(id);
}

/**
 * Main middleware to handle correlation IDs
 */
function correlationIdMiddleware(req, res, next) {
    // Get correlation ID from header or generate new one
    let correlationId = req.headers[CORRELATION_CONFIG.headerName.toLowerCase()];

    if (!correlationId && CORRELATION_CONFIG.generateOnMissing) {
        correlationId = generateCorrelationId();
    }

    // Validate correlation ID
    if (correlationId && !isValidCorrelationId(correlationId)) {
        correlationId = generateCorrelationId();
    }

    // Attach to request
    req.correlationId = correlationId;
    req.correlationIdGenerated = !req.headers[CORRELATION_CONFIG.headerName.toLowerCase()];

    // Add to response headers
    if (CORRELATION_CONFIG.includeInResponse) {
        res.setHeader(CORRELATION_CONFIG.responseHeader, correlationId);
    }

    // Create child logger with correlation ID
    req.log = createChildLogger(req, correlationId);

    // Log request start
    req._startTime = Date.now();

    // Override console methods to include correlation ID
    patchConsoleMethods(correlationId);

    next();
}

/**
 * Create child logger with correlation ID
 */
function createChildLogger(req, correlationId) {
    const baseInfo = {
        correlationId,
        requestId: req.requestId || correlationId,
        method: req.method,
        path: req.path,
        ip: req.ip || req.connection?.remoteAddress || 'unknown'
    };

    return {
        info: (message, data = {}) => {
            console.log(JSON.stringify({
                level: 'info',
                ...baseInfo,
                ...data,
                message,
                timestamp: new Date().toISOString()
            }));
        },
        error: (message, data = {}) => {
            console.error(JSON.stringify({
                level: 'error',
                ...baseInfo,
                ...data,
                message,
                timestamp: new Date().toISOString()
            }));
        },
        warn: (message, data = {}) => {
            console.warn(JSON.stringify({
                level: 'warn',
                ...baseInfo,
                ...data,
                message,
                timestamp: new Date().toISOString()
            }));
        },
        debug: (message, data = {}) => {
            if (process.env.NODE_ENV !== 'production') {
                console.debug(JSON.stringify({
                    level: 'debug',
                    ...baseInfo,
                    ...data,
                    message,
                    timestamp: new Date().toISOString()
                }));
            }
        },
        child: (additionalData) => {
            return createChildLogger(req, correlationId);
        }
    };
}

/**
 * Patch console methods to include correlation ID
 */
function patchConsoleMethods(correlationId) {
    // Disabled console override to prevent recursive stack accumulation and request cross-contamination.
}

function logCompletionMiddleware(req, res, next) {
    res.on('finish', () => {
        const duration = Date.now() - (req._startTime || Date.now());
        const statusCode = res.statusCode;

        const logData = {
            correlationId: req.correlationId,
            method: req.method,
            path: req.path,
            statusCode,
            duration: `${duration}ms`,
            userAgent: req.headers['user-agent'],
            ip: req.ip || req.connection?.remoteAddress
        };

        if (statusCode >= 400) {
            console.error(JSON.stringify({
                level: 'error',
                ...logData,
                message: 'Request completed with error',
                timestamp: new Date().toISOString()
            }));
        } else {
            console.log(JSON.stringify({
                level: 'info',
                ...logData,
                message: 'Request completed successfully',
                timestamp: new Date().toISOString()
            }));
        }
    });

    next();
}

/**
 * Get correlation ID helper
 */
function getCorrelationId(req) {
    return req.correlationId || null;
}

/**
 * Create a logger with correlation ID
 */
function createLogger(correlationId, context = {}) {
    return {
        info: (message, data = {}) => {
            console.log(JSON.stringify({
                level: 'info',
                correlationId,
                ...context,
                ...data,
                message,
                timestamp: new Date().toISOString()
            }));
        },
        error: (message, data = {}) => {
            console.error(JSON.stringify({
                level: 'error',
                correlationId,
                ...context,
                ...data,
                message,
                timestamp: new Date().toISOString()
            }));
        },
        warn: (message, data = {}) => {
            console.warn(JSON.stringify({
                level: 'warn',
                correlationId,
                ...context,
                ...data,
                message,
                timestamp: new Date().toISOString()
            }));
        },
        debug: (message, data = {}) => {
            if (process.env.NODE_ENV !== 'production') {
                console.debug(JSON.stringify({
                    level: 'debug',
                    correlationId,
                    ...context,
                    ...data,
                    message,
                    timestamp: new Date().toISOString()
                }));
            }
        }
    };
}

// ============================================
// EXPORTS
// ============================================

module.exports = {
    correlationIdMiddleware,
    logCompletionMiddleware,
    getCorrelationId,
    createLogger,
    generateCorrelationId,
    CORRELATION_CONFIG
};