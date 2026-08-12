// backend/middleware/fraudDetectionMiddleware.js
const detector = require('../services/syntheticIdentityDetector');
const db = require('../config/db').promise;
const redis = require('../config/redis');
const crypto = require('crypto');
/**
 * Middleware to detect synthetic identity fraud during signup
 */
async function detectSyntheticIdentity(req, res, next) {
    try {
        const { name, email, age } = req.body;
        
        // Skip detection for existing users (optional)
        if (req.user && req.user.id) {
            return next();
        }

        const userData = {
            name,
            email,
            age,
            // Add other identity data
        };

        const context = {
            ip: req.ip || req.connection.remoteAddress,
            userAgent: req.headers['user-agent'],
            acceptLanguage: req.headers['accept-language'],
            acceptEncoding: req.headers['accept-encoding'],
            signupTime: new Date().toISOString(),
            deviceId: req.headers['x-device-id'],
            isAutomated: req.headers['x-automated'] === 'true'
        };

        // Run detection
        const detection = await detector.detectSyntheticIdentity(userData, context);

        // Store detection result
        req.fraudDetection = detection;

        // Block critical risk
        if (detection.riskLevel === 'critical') {
            return res.status(403).json({
                success: false,
                error: 'Account creation blocked due to risk assessment',
                riskLevel: detection.riskLevel,
                message: 'Unable to create account at this time. Please contact support.'
            });
        }

        // Require additional verification for high risk
        if (detection.riskLevel === 'high') {
            return res.status(202).json({
                success: false,
                error: 'Additional verification required',
                riskLevel: detection.riskLevel,
                verificationRequired: true,
                recommendations: detection.recommendations
            });
        }

        // Flag for monitoring but allow signup
        if (detection.riskLevel === 'medium') {
            console.warn(`⚠️ Medium risk signup: ${email} (score: ${detection.riskScore})`);
            // Add to monitoring queue
            await flagForMonitoring(req, detection);
        }

        next();
    } catch (error) {
        console.error('Fraud detection error:', error);
        // Allow signup but log error
        next();
    }
}

/**
 * Middleware for checkout fraud detection
 */
async function detectCheckoutFraud(req, res, next) {
    try {
        const userId = req.user?.id;
        const { items, total } = req.body;

        if (!userId) {
            return next();
        }

        // Get user's fraud history
        const [history] = await db.query(
            `SELECT risk_level, risk_score FROM synthetic_identity_detections 
             WHERE user_id = ? 
             ORDER BY timestamp DESC LIMIT 1`,
            [userId]
        );

        if (history.length > 0 && history[0].risk_level === 'critical') {
            return res.status(403).json({
                success: false,
                error: 'Transaction blocked due to risk assessment',
                code: 'FRAUD_BLOCK'
            });
        }

        // Redis sliding window rate limiter
        const now = Date.now();
        const oneHourAgo = now - 3600000; // 1 hour in ms
        const windowKey = `fraud_velocity:${userId}`;
        const memberId = crypto.randomUUID();
        const orderTotal = Number(total) || 0;

        const luaScript = `
            local key = KEYS[1]
            local minTime = tonumber(ARGV[1])
            local currentTime = tonumber(ARGV[2])
            local amount = tonumber(ARGV[3])
            local mId = ARGV[4]

            -- Remove items older than 1 hour
            redis.call('ZREMRANGEBYSCORE', key, '-inf', minTime)

            -- Retrieve current window elements to calculate count and sum BEFORE adding current
            local elements = redis.call('ZRANGE', key, 0, -1)
            local count = 0
            local sum = 0

            for i, member in ipairs(elements) do
                -- member format: "timestamp:total:uuid"
                local totalStr = string.match(member, "^%d+:(%d+%.?%d*):")
                if totalStr then
                    sum = sum + tonumber(totalStr)
                end
                count = count + 1
            end

            -- Add the current attempt
            local newMember = currentTime .. ":" .. amount .. ":" .. mId
            redis.call('ZADD', key, currentTime, newMember)
            redis.call('EXPIRE', key, 3600)

            return { count, sum }
        `;

        const result = await redis.eval(
            luaScript, 
            1, 
            windowKey, 
            oneHourAgo, 
            now, 
            orderTotal, 
            memberId
        );

        const count = Number(result[0] || 0);
        const totalAmount = Number(result[1] || 0);

        if (count > 5) {
            return res.status(429).json({
                success: false,
                error: 'Too many orders in short time',
                code: 'RATE_LIMIT'
            });
        }

        if (orderTotal > 100000 && totalAmount > 200000) {
            return res.status(403).json({
                success: false,
                error: 'Large order flagged for review',
                code: 'LARGE_ORDER_FLAG'
            });
        }

        next();
    } catch (error) {
        console.error('Checkout fraud detection error:', error);
        next();
    }
}

/**
 * Flag account for monitoring
 */
async function flagForMonitoring(req, detection) {
    try {
        await db.query(
            `INSERT INTO fraud_monitoring_queue 
             (email, risk_score, risk_level, flags, ip_address, created_at)
             VALUES (?, ?, ?, ?, ?, NOW())`,
            [
                req.body.email,
                detection.riskScore,
                detection.riskLevel,
                JSON.stringify(detection.flags),
                req.ip || 'unknown'
            ]
        );
    } catch (error) {
        console.error('Error flagging for monitoring:', error);
    }
}

/**
 * Get fraud detection stats (admin only)
 */
async function getFraudStats(req, res) {
    try {
        if (req.user?.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const [stats] = await db.query(`
            SELECT 
                COUNT(*) as total_detections,
                SUM(CASE WHEN risk_level = 'critical' THEN 1 ELSE 0 END) as critical,
                SUM(CASE WHEN risk_level = 'high' THEN 1 ELSE 0 END) as high,
                SUM(CASE WHEN risk_level = 'medium' THEN 1 ELSE 0 END) as medium,
                SUM(CASE WHEN risk_level = 'low' THEN 1 ELSE 0 END) as low,
                AVG(risk_score) as avg_risk,
                AVG(confidence) as avg_confidence
            FROM synthetic_identity_detections
            WHERE timestamp > DATE_SUB(NOW(), INTERVAL 7 DAY)
        `);

        res.json({
            success: true,
            data: stats[0],
            detectorStats: detector.getStats()
        });
    } catch (error) {
        console.error('Error getting fraud stats:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get fraud stats'
        });
    }
}

module.exports = {
    detectSyntheticIdentity,
    detectCheckoutFraud,
    getFraudStats
};