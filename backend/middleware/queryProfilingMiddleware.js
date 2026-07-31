// backend/middleware/queryProfilingMiddleware.js
const { queryProfilingService } = require('../services/queryProfilingService');

/**
 * Middleware to profile database queries
 */
function queryProfilingMiddleware(req, res, next) {
    const originalQuery = require('../config/db').promise.query;

    // Override query method
    const db = require('../config/db').promise;
    
    const profiledQuery = async (query, params) => {
        return queryProfilingService.profileQuery(query, params, {
            requestId: req.requestId,
            path: req.path,
            method: req.method,
            userId: req.user?.id,
            ip: req.ip
        });
    };

    // Attach profiled query to request
    req.profiledQuery = profiledQuery;

    next();
}

/**
 * Middleware to add query profiling to response
 */
function addProfilingHeaders(req, res, next) {
    const originalJson = res.json;

    res.json = function(data) {
        // Add profiling headers if there were slow queries
        if (req.profile && req.profile.slowQueries.length > 0) {
            res.setHeader('X-Slow-Queries', req.profile.slowQueries.length);
            res.setHeader('X-Query-Count', req.profile.queries.length);
        }
        return originalJson.call(this, data);
    };

    next();
}

module.exports = {
    queryProfilingMiddleware,
    addProfilingHeaders
};