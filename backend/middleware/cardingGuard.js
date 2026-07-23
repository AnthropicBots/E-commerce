const CardingDetectionService = require('../services/cardingDetectionService');
const VelocityMonitoringService = require('../services/velocityMonitoringService');

/**
 * Middleware to detect and block carding attempts
 */
const detectCarding = async (req, res, next) => {
    try {
        const { userId, cardData, paymentAmount } = req.body;

        if (!userId) {
            return next();
        }

        // Run carding detection
        const detection = await CardingDetectionService.detectCarding(
            userId,
            cardData || {},
            paymentAmount || 0
        );

        // Log activity
        await CardingDetectionService.logCardActivity({
            userId,
            cardId: cardData?.cardId || req.body.cardId,
            action: req.body.action || 'card_added',
            lastFour: cardData?.lastFour,
            issuer: cardData?.issuer,
            country: cardData?.country,
            bin: cardData?.bin,
            paymentAmount: paymentAmount || 0,
            paymentStatus: req.body.paymentStatus,
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'],
            sessionId: req.sessionID,
            riskScore: detection.riskScore,
            isSuspicious: detection.isSuspicious,
            detectionFlags: detection.flags,
            metadata: req.body.metadata
        });

        // Check if should block
        if (detection.shouldBlock) {
            return res.status(403).json({
                error: 'Transaction blocked due to suspicious activity',
                detections: detection.detections,
                riskScore: detection.riskScore,
                reference: 'CARDING_DETECTION'
            });
        }

        // Store detection in request for later use
        req.cardingDetection = detection;

        next();
    } catch (error) {
        console.error('Carding detection error:', error);
        next(); // Don't block on errors
    }
};

/**
 * Middleware to monitor velocity
 */
const monitorVelocity = async (req, res, next) => {
    try {
        const { userId, action } = req.body;

        if (!userId || !action) {
            return next();
        }

        const velocityResult = await VelocityMonitoringService.monitorVelocity(
            userId,
            action,
            {
                ipAddress: req.ip,
                userAgent: req.headers['user-agent']
            }
        );

        // Check if velocity is exceeded in any window
        const isExceeded = Object.values(velocityResult).some(
            data => data.isExceeded
        );

        if (isExceeded) {
            return res.status(429).json({
                error: 'Rate limit exceeded',
                velocity: velocityResult,
                message: 'Too many attempts. Please try again later.'
            });
        }

        req.velocityResult = velocityResult;

        next();
    } catch (error) {
        console.error('Velocity monitoring error:', error);
        next();
    }
};

/**
 * Middleware to validate card input
 */
const validateCardInput = (req, res, next) => {
    const { cardData } = req.body;

    if (!cardData) {
        return next();
    }

    const errors = [];

    // Validate card number format
    if (cardData.number) {
        const cleanNumber = cardData.number.replace(/\s/g, '');
        if (!/^\d{15,16}$/.test(cleanNumber)) {
            errors.push('Invalid card number format');
        }
    }

    // Validate expiry
    if (cardData.expiry) {
        const [month, year] = cardData.expiry.split('/');
        const currentYear = new Date().getFullYear() % 100;
        const currentMonth = new Date().getMonth() + 1;

        if (parseInt(month) < 1 || parseInt(month) > 12) {
            errors.push('Invalid expiry month');
        }

        if (parseInt(year) < currentYear || 
            (parseInt(year) === currentYear && parseInt(month) < currentMonth)) {
            errors.push('Card expired');
        }
    }

    // Validate CVV
    if (cardData.cvv) {
        if (!/^\d{3,4}$/.test(cardData.cvv)) {
            errors.push('Invalid CVV format');
        }
    }

    if (errors.length > 0) {
        return res.status(400).json({
            error: 'Invalid card data',
            details: errors
        });
    }

    next();
};

module.exports = {
    detectCarding,
    monitorVelocity,
    validateCardInput
};