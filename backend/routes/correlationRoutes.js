// backend/routes/correlationRoutes.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { getCorrelationId, createLogger } = require('../middleware/correlationIdMiddleware');

/**
 * GET /api/correlation/test
 * Test correlation ID logging
 */
router.get('/test', authMiddleware, (req, res) => {
    const correlationId = getCorrelationId(req);
    const logger = createLogger(correlationId, { 
        userId: req.user?.id,
        test: true 
    });

    logger.info('Test log entry with correlation ID');
    logger.debug('Debug log with correlation ID');

    res.json({
        success: true,
        message: 'Correlation ID test successful',
        correlationId,
        timestamp: new Date().toISOString()
    });
});

/**
 * GET /api/correlation/current
 * Get current correlation ID
 */
router.get('/current', (req, res) => {
    const correlationId = getCorrelationId(req);

    res.json({
        success: true,
        correlationId,
        generated: req.correlationIdGenerated || false,
        timestamp: new Date().toISOString()
    });
});

/**
 * GET /api/correlation/health
 * Health check with correlation
 */
router.get('/health', (req, res) => {
    const correlationId = getCorrelationId(req);
    const logger = createLogger(correlationId);

    logger.info('Health check called');

    res.json({
        success: true,
        status: 'healthy',
        correlationId,
        timestamp: new Date().toISOString()
    });
});

module.exports = router;