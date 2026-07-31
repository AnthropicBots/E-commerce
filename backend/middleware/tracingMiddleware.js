// backend/middleware/tracingMiddleware.js
const { tracingService, SpanStatusCode } = require('../services/tracingService');

/**
 * Middleware to trace HTTP requests
 */
function traceRequest(req, res, next) {
    tracingService.startRequestTrace(req, res, () => {
        // Add trace headers to response
        const traceId = tracingService.getTraceId();
        const spanId = tracingService.getSpanId();

        if (traceId) {
            res.setHeader('X-Trace-Id', traceId);
        }
        if (spanId) {
            res.setHeader('X-Span-Id', spanId);
        }

        next();
    });
}

/**
 * Middleware to trace database queries
 */
function traceQuery(query, params = [], options = {}) {
    return tracingService.traceQuery(query, params, options);
}

/**
 * Middleware to trace a function
 */
function traceFunction(name, fn) {
    return async (...args) => {
        return tracingService.startSpan(name, async (span) => {
            try {
                return await fn(...args);
            } finally {
                span.end();
            }
        });
    };
}

/**
 * Get trace context for outgoing requests
 */
function getTraceHeaders() {
    const span = tracingService.getCurrentSpan();
    if (!span) return {};

    try {
        const spanContext = span.spanContext();
        return {
            'traceparent': `00-${spanContext.traceId}-${spanContext.spanId}-${spanContext.traceFlags.toString(16)}`,
        };
    } catch (error) {
        return {};
    }
}

module.exports = {
    traceRequest,
    traceQuery,
    traceFunction,
    getTraceHeaders,
    tracingService
};