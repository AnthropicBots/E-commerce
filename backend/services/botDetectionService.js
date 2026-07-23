// backend/services/botDetectionService.js
const crypto = require('crypto');
const db = require('../config/db').promise;

// ============================================
// CONFIGURATION
// ============================================

const BOT_CONFIG = {
    // Behavioral thresholds
    mouseMovementThreshold: 50, // minimum pixels for human movement
    typingSpeedThreshold: 200, // characters per minute (human range)
    sessionDurationMin: 30000, // 30 seconds minimum for human sessions
    actionIntervalMin: 1000, // 1 second minimum between actions
    
    // Rate limiting
    defaultRateLimit: 60, // requests per minute
    adaptiveMultiplier: 1.5, // increase for trusted IPs
    
    // Device fingerprinting
    fingerprintHeaders: [
        'user-agent',
        'accept-language',
        'accept-encoding',
        'sec-ch-ua',
        'sec-ch-ua-platform'
    ],
    
    // ML model (simplified)
    modelVersion: '1.0.0',
    confidenceThreshold: 0.6
};

// ============================================
// BOT DETECTION CLASS
// ============================================

class BotDetectionService {
    constructor() {
        this.sessions = new Map();
        this.fingerprints = new Map();
        this.ipScores = new Map();
        this.mlModel = null;
    }

    /**
     * Detect if request is from a bot
     */
    async detectBot(req) {
        const detection = {
            isBot: false,
            confidence: 0,
            factors: [],
            details: {},
            score: 0
        };

        // 1. Behavioral Analysis
        const behaviorResult = this.analyzeBehavior(req);
        detection.factors.push(...behaviorResult.factors);
        detection.score += behaviorResult.score;

        // 2. Device Fingerprinting
        const fingerprintResult = await this.analyzeFingerprint(req);
        detection.factors.push(...fingerprintResult.factors);
        detection.score += fingerprintResult.score;

        // 3. Session Analysis
        const sessionResult = await this.analyzeSession(req);
        detection.factors.push(...sessionResult.factors);
        detection.score += sessionResult.score;

        // 4. IP Reputation
        const ipResult = await this.checkIPReputation(req);
        detection.factors.push(...ipResult.factors);
        detection.score += ipResult.score;

        // 5. Rate Limiting
        const rateResult = await this.checkRateLimit(req);
        detection.factors.push(...rateResult.factors);
        detection.score += rateResult.score;

        // 6. ML Model (if available)
        const mlResult = await this.mlPredict(req);
        if (mlResult) {
            detection.factors.push(mlResult.factor);
            detection.score += mlResult.score;
        }

        // Calculate final confidence
        detection.confidence = Math.min(100, Math.max(0, detection.score));
        detection.isBot = detection.confidence > 60;

        // Log detection
        await this.logDetection(req, detection);

        return detection;
    }

    /**
     * Analyze behavioral patterns
     */
    analyzeBehavior(req) {
        const factors = [];
        let score = 0;

        // Mouse movement analysis (via client-side data)
        const mouseData = req.body._mouseData || req.query._mouseData;
        if (mouseData) {
            const parsed = typeof mouseData === 'string' ? JSON.parse(mouseData) : mouseData;
            
            // Check mouse movement naturalness
            if (parsed.movements && parsed.movements.length > 0) {
                const avgSpeed = parsed.movements.reduce((sum, m) => sum + m.speed, 0) / parsed.movements.length;
                if (avgSpeed > 1000) {
                    factors.push({
                        type: 'unnatural_mouse_speed',
                        severity: 'medium',
                        details: `Mouse speed too high: ${avgSpeed}px/s`
                    });
                    score += 10;
                }
            }

            // Check for human-like mouse patterns
            if (!parsed.movements || parsed.movements.length < 3) {
                factors.push({
                    type: 'insufficient_mouse_data',
                    severity: 'low',
                    details: 'No mouse movement detected'
                });
                score += 5;
            }
        }

        // Typing pattern analysis
        const typingData = req.body._typingData || req.query._typingData;
        if (typingData) {
            const parsed = typeof typingData === 'string' ? JSON.parse(typingData) : typingData;
            
            // Check typing speed
            if (parsed.speed && parsed.speed > BOT_CONFIG.typingSpeedThreshold * 2) {
                factors.push({
                    type: 'unnatural_typing_speed',
                    severity: 'medium',
                    details: `Typing speed too high: ${parsed.speed} chars/min`
                });
                score += 10;
            }

            // Check for human typing patterns (bursts and pauses)
            if (parsed.pauses && parsed.pauses.length === 0) {
                factors.push({
                    type: 'no_typing_pauses',
                    severity: 'medium',
                    details: 'No typing pauses detected - likely bot'
                });
                score += 15;
            }
        }

        // Session duration analysis
        const sessionStart = req.session?.startTime || req.headers['x-session-start'];
        if (sessionStart) {
            const duration = Date.now() - new Date(sessionStart).getTime();
            if (duration < BOT_CONFIG.sessionDurationMin && req.path.includes('/checkout')) {
                factors.push({
                    type: 'short_session',
                    severity: 'medium',
                    details: `Session too short for checkout: ${duration}ms`
                });
                score += 15;
            }
        }

        // Check for automated behavior (rapid sequential requests)
        const requestTimes = this.getRequestTimes(req.ip);
        if (requestTimes.length > 5) {
            const avgInterval = requestTimes.reduce((sum, t, i, arr) => {
                if (i === 0) return 0;
                return sum + (t - arr[i-1]);
            }, 0) / (requestTimes.length - 1);

            if (avgInterval < BOT_CONFIG.actionIntervalMin) {
                factors.push({
                    type: 'rapid_requests',
                    severity: 'high',
                    details: `Average request interval: ${avgInterval}ms (bot-like)`
                });
                score += 20;
            }
        }

        return { factors, score: Math.min(50, score) };
    }

    /**
     * Analyze device fingerprint
     */
    async analyzeFingerprint(req) {
        const factors = [];
        let score = 0;

        // Generate fingerprint
        const fingerprint = this.generateFingerprint(req);
        
        // Check if fingerprint exists in database
        const [existing] = await db.query(
            'SELECT * FROM device_fingerprints WHERE fingerprint = ?',
            [fingerprint]
        );

        if (existing.length > 0) {
            // Check if fingerprint has been used with multiple accounts
            if (existing[0].account_count > 3) {
                factors.push({
                    type: 'fingerprint_abuse',
                    severity: 'high',
                    details: `Fingerprint used with ${existing[0].account_count} accounts`
                });
                score += 25;
            }
        }

        // Check for headless browser
        const userAgent = req.headers['user-agent'] || '';
        const headlessPatterns = [
            /Headless/i,
            /Puppeteer/i,
            /Playwright/i,
            /Selenium/i,
            /PhantomJS/i,
            /Cypress/i
        ];

        for (const pattern of headlessPatterns) {
            if (pattern.test(userAgent)) {
                factors.push({
                    type: 'headless_browser',
                    severity: 'high',
                    details: `Headless browser detected: ${pattern}`
                });
                score += 30;
                break;
            }
        }

        // Check for missing browser features
        const missingHeaders = [];
        const requiredHeaders = [
            'accept-language',
            'accept-encoding',
            'sec-ch-ua',
            'sec-ch-ua-platform'
        ];

        for (const header of requiredHeaders) {
            if (!req.headers[header]) {
                missingHeaders.push(header);
            }
        }

        if (missingHeaders.length > 2) {
            factors.push({
                type: 'missing_browser_headers',
                severity: 'medium',
                details: `Missing headers: ${missingHeaders.join(', ')}`
            });
            score += 15;
        }

        // Store fingerprint
        if (!existing.length) {
            await db.query(
                `INSERT INTO device_fingerprints 
                 (fingerprint, user_agent, first_seen, last_seen, account_count)
                 VALUES (?, ?, NOW(), NOW(), 1)`,
                [fingerprint, userAgent]
            );
        } else {
            await db.query(
                `UPDATE device_fingerprints 
                 SET last_seen = NOW(), 
                     account_count = account_count + 1 
                 WHERE fingerprint = ?`,
                [fingerprint]
            );
        }

        return { factors, score: Math.min(40, score) };
    }

    /**
     * Generate device fingerprint
     */
    generateFingerprint(req) {
        const components = BOT_CONFIG.fingerprintHeaders.map(header => 
            req.headers[header] || 'unknown'
        );
        // Add IP (optional, for better fingerprinting)
        components.push(req.ip || 'unknown');
        
        const string = components.join('|');
        return crypto.createHash('sha256').update(string).digest('hex');
    }

    /**
     * Analyze session behavior
     */
    async analyzeSession(req) {
        const factors = [];
        let score = 0;

        const sessionId = req.session?.id || req.cookies?.sessionId;
        if (!sessionId) {
            factors.push({
                type: 'no_session',
                severity: 'low',
                details: 'No session detected'
            });
            score += 5;
            return { factors, score };
        }

        const session = this.sessions.get(sessionId);
        if (session) {
            // Check for unusual navigation patterns
            if (session.paths && session.paths.length > 10) {
                // Check if navigating too quickly
                const avgTime = session.paths.reduce((sum, p, i, arr) => {
                    if (i === 0) return 0;
                    return sum + (p.time - arr[i-1].time);
                }, 0) / (session.paths.length - 1);

                if (avgTime < 2000) {
                    factors.push({
                        type: 'rapid_navigation',
                        severity: 'medium',
                        details: `Navigation too quick: ${avgTime}ms between pages`
                    });
                    score += 15;
                }
            }

            // Check for direct checkout without browsing
            if (req.path.includes('/checkout') && (!session.paths || session.paths.length < 2)) {
                factors.push({
                    type: 'direct_checkout',
                    severity: 'high',
                    details: 'Direct checkout without browsing'
                });
                score += 20;
            }

            // Update session
            session.paths.push({
                path: req.path,
                time: Date.now()
            });
        } else {
            // Create new session
            this.sessions.set(sessionId, {
                id: sessionId,
                startTime: Date.now(),
                paths: [{
                    path: req.path,
                    time: Date.now()
                }]
            });
        }

        return { factors, score: Math.min(30, score) };
    }

    /**
     * Check IP reputation
     */
    async checkIPReputation(req) {
        const factors = [];
        let score = 0;
        const ip = req.ip || req.connection.remoteAddress || 'unknown';

        // Check cache
        if (this.ipScores.has(ip)) {
            const cached = this.ipScores.get(ip);
            if (cached.score > 50) {
                factors.push({
                    type: 'ip_reputation',
                    severity: 'high',
                    details: `IP reputation score: ${cached.score}`
                });
                score += 20;
            }
            return { factors, score };
        }

        // Query database
        try {
            const [history] = await db.query(
                `SELECT 
                    COUNT(*) as total_requests,
                    SUM(CASE WHEN is_bot = 1 THEN 1 ELSE 0 END) as bot_requests,
                    AVG(confidence) as avg_confidence
                 FROM bot_detection_logs 
                 WHERE ip_address = ? 
                 AND timestamp > DATE_SUB(NOW(), INTERVAL 7 DAY)`,
                [ip]
            );

            if (history[0]?.total_requests > 10) {
                const botRate = (history[0].bot_requests / history[0].total_requests) * 100;
                if (botRate > 50) {
                    factors.push({
                        type: 'high_bot_rate',
                        severity: 'high',
                        details: `${botRate.toFixed(0)}% requests from this IP are bots`
                    });
                    score += 30;
                }

                // Cache the result
                this.ipScores.set(ip, {
                    score: Math.min(100, score),
                    lastChecked: Date.now()
                });
            }
        } catch (error) {
            console.error('IP reputation check error:', error);
        }

        return { factors, score: Math.min(30, score) };
    }

    /**
     * Check rate limiting
     */
    async checkRateLimit(req) {
        const factors = [];
        let score = 0;
        const ip = req.ip || req.connection.remoteAddress || 'unknown';

        const rateLimit = this.getRateLimit(ip);
        const current = await this.getCurrentRequests(ip);

        if (current > rateLimit) {
            factors.push({
                type: 'rate_limit_exceeded',
                severity: 'high',
                details: `Rate limit exceeded: ${current}/${rateLimit} req/min`
            });
            score += 30;
        }

        if (current > rateLimit * 2) {
            factors.push({
                type: 'severe_rate_limit',
                severity: 'critical',
                details: `Severe rate limit exceeded: ${current}/${rateLimit} req/min`
            });
            score += 40;
        }

        return { factors, score: Math.min(40, score) };
    }

    /**
     * Get rate limit for IP
     */
    getRateLimit(ip) {
        const reputation = this.ipScores.get(ip);
        if (reputation && reputation.score < 30) {
            return BOT_CONFIG.defaultRateLimit * 2; // Trusted IP
        }
        return BOT_CONFIG.defaultRateLimit;
    }

    /**
     * Get current requests in minute
     */
    async getCurrentRequests(ip) {
        try {
            const [result] = await db.query(
                'SELECT COUNT(*) as count FROM bot_detection_logs WHERE ip_address = ? AND timestamp > DATE_SUB(NOW(), INTERVAL 1 MINUTE)',
                [ip]
            );
            return result[0]?.count || 0;
        } catch (error) {
            console.error('Rate check error:', error);
            return 0;
        }
    }

    /**
     * Get request times for IP
     */
    getRequestTimes(ip) {
        // In production, use Redis or memory cache
        if (!this._requestTimes) {
            this._requestTimes = new Map();
        }
        
        if (!this._requestTimes.has(ip)) {
            this._requestTimes.set(ip, []);
        }
        
        const times = this._requestTimes.get(ip);
        const now = Date.now();
        
        // Keep only last 10 seconds
        const recent = times.filter(t => now - t < 10000);
        recent.push(now);
        this._requestTimes.set(ip, recent);
        
        return recent;
    }

    /**
     * ML prediction (simplified)
     */
    async mlPredict(req) {
        // Placeholder for actual ML model
        // In production, use TensorFlow.js or external ML service
        
        const features = {
            userAgent: req.headers['user-agent'] || '',
            acceptLanguage: req.headers['accept-language'] || '',
            acceptEncoding: req.headers['accept-encoding'] || '',
            path: req.path,
            method: req.method,
            ip: req.ip || 'unknown'
        };

        // Simple rule-based prediction
        let score = 0;
        let factor = null;

        // Suspicious User-Agent patterns
        const suspiciousUAs = [
            /bot/i,
            /crawler/i,
            /spider/i,
            /scraper/i,
            /headless/i,
            /puppeteer/i,
            /selenium/i,
            /playwright/i
        ];

        for (const pattern of suspiciousUAs) {
            if (pattern.test(features.userAgent)) {
                score += 20;
                factor = {
                    type: 'ml_suspicious_ua',
                    severity: 'high',
                    details: `ML: Suspicious User-Agent pattern: ${pattern}`
                };
                break;
            }
        }

        // Missing headers
        if (!features.acceptLanguage || !features.acceptEncoding) {
            score += 10;
            factor = {
                type: 'ml_missing_headers',
                severity: 'medium',
                details: 'ML: Missing common browser headers'
            };
        }

        return score > 0 ? { score, factor } : null;
    }

    /**
     * Log detection
     */
    async logDetection(req, detection) {
        try {
            await db.query(
                `INSERT INTO bot_detection_logs 
                 (ip_address, user_agent, path, method, is_bot, 
                  confidence, factors, timestamp)
                 VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
                [
                    req.ip || req.connection.remoteAddress || 'unknown',
                    req.headers['user-agent'] || 'unknown',
                    req.path,
                    req.method,
                    detection.isBot ? 1 : 0,
                    detection.confidence,
                    JSON.stringify(detection.factors)
                ]
            );
        } catch (error) {
            console.error('Log detection error:', error);
        }
    }

    /**
     * Get statistics
     */
    async getStatistics() {
        try {
            const [stats] = await db.query(
                `SELECT 
                    COUNT(*) as total_requests,
                    SUM(CASE WHEN is_bot = 1 THEN 1 ELSE 0 END) as bot_requests,
                    AVG(confidence) as avg_confidence,
                    COUNT(DISTINCT ip_address) as unique_ips
                 FROM bot_detection_logs
                 WHERE timestamp > DATE_SUB(NOW(), INTERVAL 24 HOUR)`
            );

            return {
                ...stats[0],
                bot_rate: stats[0].total_requests > 0 
                    ? ((stats[0].bot_requests / stats[0].total_requests) * 100).toFixed(2) + '%'
                    : '0%',
                timestamp: new Date().toISOString(),
                modelVersion: BOT_CONFIG.modelVersion
            };
        } catch (error) {
            console.error('Statistics error:', error);
            throw error;
        }
    }

    /**
     * Get status
     */
    getStatus() {
        return {
            sessions: this.sessions.size,
            fingerprints: this.fingerprints.size,
            ipScores: this.ipScores.size,
            config: {
                defaultRateLimit: BOT_CONFIG.defaultRateLimit,
                confidenceThreshold: BOT_CONFIG.confidenceThreshold
            }
        };
    }
}

// ============================================
// EXPORT
// ============================================

module.exports = new BotDetectionService();