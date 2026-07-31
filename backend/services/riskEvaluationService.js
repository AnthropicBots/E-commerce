// backend/services/riskEvaluationService.js
const crypto = require('crypto');
const db = require('../config/db').promise;
const { getClientIp } = require('request-ip');
const UAParser = require('ua-parser-js');

// ============================================
// RISK CONFIGURATION
// ============================================

const RISK_CONFIG = {
    // Risk levels
    levels: {
        LOW: 'low',
        MEDIUM: 'medium',
        HIGH: 'high',
        CRITICAL: 'critical'
    },
    
    // Risk thresholds
    thresholds: {
        LOW: 20,
        MEDIUM: 50,
        HIGH: 75,
        CRITICAL: 90
    },
    
    // Signals weights
    weights: {
        device_fingerprint: 15,
        impossible_travel: 30,
        ip_change: 20,
        velocity: 20,
        browser_anomaly: 15,
        location_mismatch: 25,
        new_device: 20,
        suspicious_pattern: 30
    },
    
    // Velocity limits
    velocity: {
        login_attempts: 5, // per minute
        password_resets: 3, // per hour
        failed_attempts: 5 // per 15 minutes
    }
};

// ============================================
// RISK EVALUATION SERVICE
// ============================================

class RiskEvaluationService {
    constructor() {
        this.riskScores = new Map();
        this.deviceFingerprints = new Map();
        this.userSessions = new Map();
        this.anomalyLogs = [];
        this.ipHistory = new Map();
        this.velocityTracker = new Map();
        this.riskDecisions = new Map();
    }

    /**
     * Evaluate risk for a request
     */
    async evaluateRisk(req, user) {
        const risk = {
            score: 0,
            level: RISK_CONFIG.levels.LOW,
            signals: [],
            recommendations: [],
            requiresChallenge: false,
            timestamp: new Date().toISOString()
        };

        // 1. Device fingerprint analysis
        const deviceResult = await this.analyzeDeviceFingerprint(req, user);
        risk.signals.push(...deviceResult.signals);
        risk.score += deviceResult.score;

        // 2. Impossible travel detection
        const travelResult = await this.detectImpossibleTravel(req, user);
        risk.signals.push(...travelResult.signals);
        risk.score += travelResult.score;

        // 3. IP change detection
        const ipResult = await this.detectIPChange(req, user);
        risk.signals.push(...ipResult.signals);
        risk.score += ipResult.score;

        // 4. Request velocity analysis
        const velocityResult = await this.analyzeVelocity(req, user);
        risk.signals.push(...velocityResult.signals);
        risk.score += velocityResult.score;

        // 5. Browser anomaly detection
        const browserResult = await this.detectBrowserAnomalies(req);
        risk.signals.push(...browserResult.signals);
        risk.score += browserResult.score;

        // 6. Location mismatch detection
        const locationResult = await this.detectLocationMismatch(req, user);
        risk.signals.push(...locationResult.signals);
        risk.score += locationResult.score;

        // 7. New device detection
        const deviceNewResult = await this.detectNewDevice(req, user);
        risk.signals.push(...deviceNewResult.signals);
        risk.score += deviceNewResult.score;

        // 8. Suspicious pattern detection
        const patternResult = await this.detectSuspiciousPatterns(req, user);
        risk.signals.push(...patternResult.signals);
        risk.score += patternResult.score;

        // Calculate final risk level
        risk.score = Math.min(100, Math.max(0, risk.score));
        risk.level = this.calculateRiskLevel(risk.score);
        risk.requiresChallenge = risk.level === RISK_CONFIG.levels.HIGH || 
                                 risk.level === RISK_CONFIG.levels.CRITICAL;

        // Generate recommendations
        risk.recommendations = this.generateRecommendations(risk);

        // Log risk evaluation
        await this.logRiskEvaluation(user, req, risk);

        return risk;
    }

    /**
     * Analyze device fingerprint
     */
    async analyzeDeviceFingerprint(req, user) {
        const signals = [];
        let score = 0;
        const fingerprint = this.generateFingerprint(req);

        if (user) {
            const previousFingerprint = await this.getUserFingerprint(user.id);
            if (previousFingerprint && previousFingerprint !== fingerprint) {
                signals.push({
                    type: 'device_fingerprint_change',
                    severity: 'medium',
                    details: 'Device fingerprint changed'
                });
                score += RISK_CONFIG.weights.device_fingerprint;
            }
        }

        // Store fingerprint
        if (user) {
            await this.storeUserFingerprint(user.id, fingerprint);
        }

        return { signals, score };
    }

    /**
     * Detect impossible travel
     */
    async detectImpossibleTravel(req, user) {
        const signals = [];
        let score = 0;

        if (!user || !user.id) return { signals, score };

        const currentIP = getClientIp(req);
        const currentLocation = await this.getIPLocation(currentIP);

        // Get previous location from last login
        const lastLogin = await this.getLastLogin(user.id);
        if (lastLogin && lastLogin.ip) {
            const lastLocation = await this.getIPLocation(lastLogin.ip);
            
            if (lastLocation && currentLocation) {
                const distance = this.calculateDistance(
                    lastLocation.lat,
                    lastLocation.lng,
                    currentLocation.lat,
                    currentLocation.lng
                );

                const timeDiff = (Date.now() - new Date(lastLogin.timestamp).getTime()) / (1000 * 60 * 60);

                // Check if travel is impossible (more than 800 km per hour)
                if (distance > 800 * timeDiff && timeDiff > 0) {
                    signals.push({
                        type: 'impossible_travel',
                        severity: 'critical',
                        details: `Traveled ${distance.toFixed(0)}km in ${timeDiff.toFixed(1)} hours`
                    });
                    score += RISK_CONFIG.weights.impossible_travel;
                }
            }
        }

        return { signals, score };
    }

    /**
     * Detect IP change
     */
    async detectIPChange(req, user) {
        const signals = [];
        let score = 0;
        const currentIP = getClientIp(req);

        if (!user || !user.id) return { signals, score };

        const previousIP = await this.getUserIP(user.id);
        if (previousIP && previousIP !== currentIP) {
            signals.push({
                type: 'ip_change',
                severity: 'medium',
                details: `IP changed from ${previousIP} to ${currentIP}`
            });
            score += RISK_CONFIG.weights.ip_change;
        }

        // Track IP history
        await this.trackIP(user.id, currentIP);

        return { signals, score };
    }

    /**
     * Analyze request velocity
     */
    async analyzeVelocity(req, user) {
        const signals = [];
        let score = 0;
        const key = user ? `user_${user.id}` : `ip_${getClientIp(req)}`;
        const now = Date.now();

        if (!this.velocityTracker.has(key)) {
            this.velocityTracker.set(key, []);
        }

        const history = this.velocityTracker.get(key);
        history.push(now);

        // Keep only last minute
        const recent = history.filter(t => now - t < 60000);
        this.velocityTracker.set(key, recent);

        // Check login attempts
        if (req.path === '/api/auth/login') {
            const loginAttempts = recent.length;
            if (loginAttempts > RISK_CONFIG.velocity.login_attempts) {
                signals.push({
                    type: 'high_login_velocity',
                    severity: 'high',
                    details: `${loginAttempts} login attempts in 1 minute`
                });
                score += RISK_CONFIG.weights.velocity;
            }
        }

        return { signals, score };
    }

    /**
     * Detect browser anomalies
     */
    async detectBrowserAnomalies(req) {
        const signals = [];
        let score = 0;
        const ua = req.headers['user-agent'];
        const parser = new UAParser(ua);
        const result = parser.getResult();

        // Check for headless browser
        if (this.isHeadlessBrowser(ua)) {
            signals.push({
                type: 'headless_browser',
                severity: 'high',
                details: 'Headless browser detected'
            });
            score += RISK_CONFIG.weights.browser_anomaly;
        }

        // Check for missing common headers
        const requiredHeaders = ['accept-language', 'accept-encoding', 'sec-ch-ua'];
        const missingHeaders = requiredHeaders.filter(h => !req.headers[h]);

        if (missingHeaders.length > 1) {
            signals.push({
                type: 'missing_headers',
                severity: 'medium',
                details: `Missing headers: ${missingHeaders.join(', ')}`
            });
            score += RISK_CONFIG.weights.browser_anomaly / 2;
        }

        return { signals, score };
    }

    /**
     * Detect location mismatch
     */
    async detectLocationMismatch(req, user) {
        const signals = [];
        let score = 0;

        if (!user || !user.id) return { signals, score };

        const currentIP = getClientIp(req);
        const currentLocation = await this.getIPLocation(currentIP);

        // Check against stored location
        const storedLocation = await this.getUserLocation(user.id);
        if (storedLocation && currentLocation) {
            const distance = this.calculateDistance(
                storedLocation.lat,
                storedLocation.lng,
                currentLocation.lat,
                currentLocation.lng
            );

            if (distance > 100) {
                signals.push({
                    type: 'location_mismatch',
                    severity: 'high',
                    details: `User at ${distance.toFixed(0)}km from typical location`
                });
                score += RISK_CONFIG.weights.location_mismatch;
            }
        }

        return { signals, score };
    }

    /**
     * Detect new device
     */
    async detectNewDevice(req, user) {
        const signals = [];
        let score = 0;

        if (!user || !user.id) return { signals, score };

        const fingerprint = this.generateFingerprint(req);
        const knownDevices = await this.getUserDevices(user.id);

        if (!knownDevices.includes(fingerprint)) {
            signals.push({
                type: 'new_device',
                severity: 'medium',
                details: 'New device detected'
            });
            score += RISK_CONFIG.weights.new_device;
        }

        return { signals, score };
    }

    /**
     * Detect suspicious patterns
     */
    async detectSuspiciousPatterns(req, user) {
        const signals = [];
        let score = 0;

        // Check for rapid checkout
        if (req.path === '/api/checkout' && req.method === 'POST') {
            const sessionDuration = await this.getSessionDuration(user?.id);
            if (sessionDuration && sessionDuration < 30000) {
                signals.push({
                    type: 'rapid_checkout',
                    severity: 'high',
                    details: `Checkout after ${(sessionDuration / 1000).toFixed(0)}s session`
                });
                score += RISK_CONFIG.weights.suspicious_pattern;
            }
        }

        // Check for multiple payment methods
        if (req.path === '/api/payment' && req.method === 'POST') {
            const recentPayments = await this.getRecentPayments(user?.id);
            if (recentPayments > 3) {
                signals.push({
                    type: 'multiple_payment_attempts',
                    severity: 'high',
                    details: `${recentPayments} payment attempts in 1 hour`
                });
                score += RISK_CONFIG.weights.suspicious_pattern;
            }
        }

        return { signals, score };
    }

    // ============================================
    // HELPER FUNCTIONS
    // ============================================

    generateFingerprint(req) {
        const components = [
            req.headers['user-agent'] || 'unknown',
            req.headers['accept-language'] || 'unknown',
            req.headers['accept-encoding'] || 'unknown',
            req.headers['sec-ch-ua'] || 'unknown',
            req.headers['sec-ch-ua-platform'] || 'unknown'
        ];
        const string = components.join('|');
        return crypto.createHash('sha256').update(string).digest('hex');
    }

    isHeadlessBrowser(ua) {
        const patterns = [/Headless/i, /Puppeteer/i, /Playwright/i, /Selenium/i, /PhantomJS/i, /Cypress/i];
        return patterns.some(p => p.test(ua));
    }

    calculateDistance(lat1, lon1, lat2, lon2) {
        const R = 6371; // Earth's radius in km
        const dLat = this.toRad(lat2 - lat1);
        const dLon = this.toRad(lon2 - lon1);
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                  Math.cos(this.toRad(lat1)) * Math.cos(this.toRad(lat2)) *
                  Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }

    toRad(deg) {
        return deg * (Math.PI / 180);
    }

    calculateRiskLevel(score) {
        if (score >= RISK_CONFIG.thresholds.CRITICAL) return RISK_CONFIG.levels.CRITICAL;
        if (score >= RISK_CONFIG.thresholds.HIGH) return RISK_CONFIG.levels.HIGH;
        if (score >= RISK_CONFIG.thresholds.MEDIUM) return RISK_CONFIG.levels.MEDIUM;
        return RISK_CONFIG.levels.LOW;
    }

    generateRecommendations(risk) {
        const recommendations = [];

        if (risk.level === RISK_CONFIG.levels.CRITICAL) {
            recommendations.push('Block request immediately');
            recommendations.push('Alert security team');
            recommendations.push('Force re-authentication');
            recommendations.push('Require 2FA verification');
        }

        if (risk.level === RISK_CONFIG.levels.HIGH) {
            recommendations.push('Require additional verification');
            recommendations.push('Send security alert to user');
            recommendations.push('Rate limit further actions');
        }

        if (risk.level === RISK_CONFIG.levels.MEDIUM) {
            recommendations.push('Log for monitoring');
            recommendations.push('Challenge with CAPTCHA');
            recommendations.push('Require email confirmation');
        }

        // Signal-specific recommendations
        for (const signal of risk.signals) {
            if (signal.type === 'impossible_travel') {
                recommendations.push('Verify identity through 2FA');
            }
            if (signal.type === 'new_device') {
                recommendations.push('Send device verification email');
            }
            if (signal.type === 'high_login_velocity') {
                recommendations.push('Temporarily lock account');
            }
        }

        return recommendations;
    }

    // ============================================
    // DATABASE OPERATIONS
    // ============================================

    async getIPLocation(ip) {
        // In production, use IP geolocation service
        return { lat: 0, lng: 0 };
    }

    async getUserFingerprint(userId) {
        try {
            const [rows] = await db.query(
                'SELECT fingerprint FROM user_fingerprints WHERE user_id = ? ORDER BY created_at DESC LIMIT 1',
                [userId]
            );
            return rows[0]?.fingerprint || null;
        } catch (error) {
            return null;
        }
    }

    async storeUserFingerprint(userId, fingerprint) {
        try {
            await db.query(
                'INSERT INTO user_fingerprints (user_id, fingerprint, created_at) VALUES (?, ?, NOW())',
                [userId, fingerprint]
            );
        } catch (error) {
            console.error('Store fingerprint error:', error);
        }
    }

    async getLastLogin(userId) {
        try {
            const [rows] = await db.query(
                'SELECT ip, timestamp FROM login_history WHERE user_id = ? ORDER BY timestamp DESC LIMIT 1',
                [userId]
            );
            return rows[0] || null;
        } catch (error) {
            return null;
        }
    }

    async getUserIP(userId) {
        try {
            const [rows] = await db.query(
                'SELECT ip FROM login_history WHERE user_id = ? ORDER BY timestamp DESC LIMIT 1',
                [userId]
            );
            return rows[0]?.ip || null;
        } catch (error) {
            return null;
        }
    }

    async trackIP(userId, ip) {
        try {
            await db.query(
                'INSERT INTO login_history (user_id, ip, timestamp) VALUES (?, ?, NOW())',
                [userId, ip]
            );
        } catch (error) {
            console.error('Track IP error:', error);
        }
    }

    async getUserLocation(userId) {
        // In production, get from user profile or previous login
        return { lat: 0, lng: 0 };
    }

    async getUserDevices(userId) {
        try {
            const [rows] = await db.query(
                'SELECT fingerprint FROM user_fingerprints WHERE user_id = ?',
                [userId]
            );
            return rows.map(r => r.fingerprint);
        } catch (error) {
            return [];
        }
    }

    async getSessionDuration(userId) {
        // In production, get from session store
        return null;
    }

    async getRecentPayments(userId) {
        try {
            const [rows] = await db.query(
                'SELECT COUNT(*) as count FROM payments WHERE user_id = ? AND created_at > DATE_SUB(NOW(), INTERVAL 1 HOUR)',
                [userId]
            );
            return rows[0]?.count || 0;
        } catch (error) {
            return 0;
        }
    }

    async logRiskEvaluation(user, req, risk) {
        try {
            await db.query(
                `INSERT INTO risk_evaluations 
                 (user_id, ip, path, method, risk_score, risk_level, signals, recommendations, evaluated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
                [
                    user?.id || null,
                    getClientIp(req),
                    req.path,
                    req.method,
                    risk.score,
                    risk.level,
                    JSON.stringify(risk.signals),
                    JSON.stringify(risk.recommendations)
                ]
            );
        } catch (error) {
            console.error('Log risk evaluation error:', error);
        }
    }

    // ============================================
    // STATISTICS
    // ============================================

    async getStatistics() {
        try {
            const [stats] = await db.query(
                `SELECT 
                    COUNT(*) as total_evaluations,
                    AVG(risk_score) as avg_risk_score,
                    SUM(CASE WHEN risk_level = 'critical' THEN 1 ELSE 0 END) as critical_events,
                    SUM(CASE WHEN risk_level = 'high' THEN 1 ELSE 0 END) as high_events,
                    COUNT(DISTINCT user_id) as unique_users
                 FROM risk_evaluations
                 WHERE evaluated_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)`
            );

            return {
                ...stats[0],
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            console.error('Statistics error:', error);
            return null;
        }
    }

    getStatus() {
        return {
            riskScores: this.riskScores.size,
            deviceFingerprints: this.deviceFingerprints.size,
            userSessions: this.userSessions.size,
            ipHistory: this.ipHistory.size,
            velocityTracker: this.velocityTracker.size
        };
    }
}

// ============================================
// EXPORT
// ============================================

module.exports = {
    RiskEvaluationService,
    RISK_CONFIG,
    riskEvaluationService: new RiskEvaluationService()
};