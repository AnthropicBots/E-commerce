const db = require('../config/db').promise;
const crypto = require('crypto');
const NodeCache = require('node-cache');

const FRAUD_DETECTION_CONFIG = {
    maxAccountsPerIP: parseInt(process.env.MAX_ACCOUNTS_PER_IP) || 5,
    maxAccountsPerDevice: parseInt(process.env.MAX_ACCOUNTS_PER_DEVICE) || 3,
    maxAccountsPerHour: parseInt(process.env.MAX_ACCOUNTS_PER_HOUR) || 10,
    maxAccountsPerDay: parseInt(process.env.MAX_ACCOUNTS_PER_DAY) || 20,
    minAge: parseInt(process.env.MIN_AGE) || 18,
    maxAge: parseInt(process.env.MAX_AGE) || 100,
    trustScoreThreshold: parseInt(process.env.TRUST_SCORE_THRESHOLD) || 50,
    highRiskThreshold: parseInt(process.env.HIGH_RISK_THRESHOLD) || 30,
    criticalRiskThreshold: parseInt(process.env.CRITICAL_RISK_THRESHOLD) || 15,
    reputationCacheTTL: parseInt(process.env.REPUTATION_CACHE_TTL) || 3600,
    suspiciousNamePatterns: [
        /test/i,
        /user\d+/,
        /temp/i,
        /demo/i,
        /fake/i,
        /dummy/i,
        /bot/i,
        /spam/i
    ],
    suspiciousEmailDomains: [
        'tempmail.com',
        'guerrillamail.com',
        'mailinator.com',
        '10minutemail.com',
        'throwaway.com',
        'temp-mail.org',
        'yopmail.com',
        'guerrillamail.org'
    ],
    disposableEmailPatterns: [
        /\+.*@/,
        /\.{2,}/,
        /^[a-z0-9]{1,5}@/
    ],
    headlessPatterns: [
        /Headless/i,
        /Puppeteer/i,
        /Playwright/i,
        /Selenium/i,
        /PhantomJS/i,
        /Cypress/i
    ],
    proxyPatterns: [
        /^10\./,
        /^172\.16\./,
        /^192\.168\./,
        /^127\./
    ]
};

class SyntheticIdentityDetector {
    constructor() {
        this.fraudScores = new Map();
        this.deviceFingerprints = new Map();
        this.ipReputation = new NodeCache({
            stdTTL: FRAUD_DETECTION_CONFIG.reputationCacheTTL,
            checkperiod: 300
        });
        this.velocityTracker = new Map();
        this.initialized = false;
        this.detectionHistory = new Map();
    }

    async initialize() {
        try {
            await this.loadReputationData();
            this.initialized = true;
            console.log('Synthetic Identity Detector initialized');
        } catch (error) {
            console.error('Detector initialization error:', error);
            this.initialized = false;
        }
    }

    validateUserData(userData) {
        if (!userData || typeof userData !== 'object') {
            throw new Error('User data is required');
        }
        if (!userData.email && !userData.name) {
            throw new Error('At least email or name is required');
        }
        if (userData.email && typeof userData.email !== 'string') {
            throw new Error('Email must be a string');
        }
        if (userData.name && typeof userData.name !== 'string') {
            throw new Error('Name must be a string');
        }
        if (userData.age !== undefined && (typeof userData.age !== 'number' || userData.age < 0)) {
            throw new Error('Age must be a positive number');
        }
        return true;
    }

    validateContext(context) {
        if (!context || typeof context !== 'object') {
            return { ip: 'unknown', deviceId: 'unknown' };
        }
        return {
            ip: context.ip || 'unknown',
            deviceId: context.deviceId || 'unknown',
            userAgent: context.userAgent || 'unknown',
            acceptLanguage: context.acceptLanguage || 'unknown',
            screenResolution: context.screenResolution || 'unknown',
            timezone: context.timezone || 'unknown',
            signupTime: context.signupTime || new Date().toISOString(),
            formCompletionTime: context.formCompletionTime || 0,
            isAutomated: context.isAutomated || false
        };
    }

    async detectSyntheticIdentity(userData, context = {}) {
        const startTime = Date.now();
        const detectionId = crypto.randomUUID();

        try {
            this.validateUserData(userData);
            const validatedContext = this.validateContext(context);

            const detectionResult = {
                id: detectionId,
                isSynthetic: false,
                riskScore: 0,
                riskLevel: 'low',
                flags: [],
                recommendations: [],
                confidence: 0,
                timestamp: new Date().toISOString(),
                duration: 0
            };

            const checks = await Promise.all([
                this.checkVelocity(validatedContext),
                this.analyzeIdentityPatterns(userData),
                this.analyzeEmailPatterns(userData.email),
                this.analyzeDeviceFingerprint(validatedContext),
                this.checkIPReputation(validatedContext.ip),
                this.analyzeBehavioralPatterns(validatedContext),
                this.analyzeNamePatterns(userData.name)
            ]);

            let totalRiskScore = 0;
            checks.forEach((result, index) => {
                const checkTypes = [
                    'velocity', 'identity', 'email', 'device',
                    'ip', 'behavioral', 'name'
                ];
                detectionResult.flags.push(...result.flags);
                totalRiskScore += result.riskScore || 0;

                if (result.error) {
                    console.warn(`Check ${checkTypes[index]} failed:`, result.error);
                }
            });

            detectionResult.riskScore = Math.min(100, totalRiskScore);
            detectionResult.riskLevel = this.calculateRiskLevel(detectionResult.riskScore);
            detectionResult.isSynthetic = detectionResult.riskLevel === 'critical' ||
                                        detectionResult.riskLevel === 'high';
            detectionResult.confidence = this.calculateConfidence(detectionResult.flags);
            detectionResult.recommendations = this.generateRecommendations(detectionResult);
            detectionResult.duration = Date.now() - startTime;

            await this.logDetection(userData, detectionResult, validatedContext);
            await this.updateVelocity(validatedContext);

            this.detectionHistory.set(detectionId, detectionResult);
            if (this.detectionHistory.size > 1000) {
                const oldestKey = this.detectionHistory.keys().next().value;
                this.detectionHistory.delete(oldestKey);
            }

            return detectionResult;

        } catch (error) {
            console.error('Detection error:', error);
            return {
                id: detectionId,
                isSynthetic: false,
                riskScore: 0,
                riskLevel: 'unknown',
                flags: [{ type: 'error', severity: 'high', details: error.message }],
                recommendations: ['Manual review required'],
                confidence: 0,
                timestamp: new Date().toISOString(),
                duration: Date.now() - startTime,
                error: error.message
            };
        }
    }

    async checkVelocity(context) {
        const flags = [];
        let riskScore = 0;
        const ip = context.ip || 'unknown';
        const deviceId = context.deviceId || 'unknown';

        try {
            const [ipAccounts] = await db.query(
                `SELECT COUNT(*) as count FROM users 
                 WHERE registration_ip = ? 
                 AND created_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)`,
                [ip]
            );

            if (ipAccounts[0].count >= FRAUD_DETECTION_CONFIG.maxAccountsPerIP) {
                flags.push({
                    type: 'velocity_ip',
                    severity: 'high',
                    details: `Too many accounts from same IP (${ipAccounts[0].count})`
                });
                riskScore += 25;
            }

            if (deviceId !== 'unknown') {
                const [deviceAccounts] = await db.query(
                    `SELECT COUNT(*) as count FROM users 
                     WHERE device_fingerprint = ? 
                     AND created_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)`,
                    [deviceId]
                );

                if (deviceAccounts[0].count >= FRAUD_DETECTION_CONFIG.maxAccountsPerDevice) {
                    flags.push({
                        type: 'velocity_device',
                        severity: 'high',
                        details: `Too many accounts from same device (${deviceAccounts[0].count})`
                    });
                    riskScore += 30;
                }
            }

            const [hourlyAccounts] = await db.query(
                `SELECT COUNT(*) as count FROM users 
                 WHERE created_at > DATE_SUB(NOW(), INTERVAL 1 HOUR)`
            );

            if (hourlyAccounts[0].count >= FRAUD_DETECTION_CONFIG.maxAccountsPerHour) {
                flags.push({
                    type: 'velocity_hourly',
                    severity: 'medium',
                    details: `High account creation rate (${hourlyAccounts[0].count}/hour)`
                });
                riskScore += 15;
            }

        } catch (error) {
            console.error('Velocity check error:', error);
            return { flags, riskScore, error: error.message };
        }

        return { flags, riskScore };
    }

    analyzeIdentityPatterns(userData) {
        const flags = [];
        let riskScore = 0;

        if (userData.name) {
            for (const pattern of FRAUD_DETECTION_CONFIG.suspiciousNamePatterns) {
                if (pattern.test(userData.name)) {
                    flags.push({
                        type: 'suspicious_name',
                        severity: 'medium',
                        details: `Name matches suspicious pattern: ${pattern}`
                    });
                    riskScore += 15;
                    break;
                }
            }
        }

        if (userData.age !== undefined) {
            if (userData.age < FRAUD_DETECTION_CONFIG.minAge) {
                flags.push({
                    type: 'underage',
                    severity: 'high',
                    details: `Age (${userData.age}) below minimum (${FRAUD_DETECTION_CONFIG.minAge})`
                });
                riskScore += 20;
            }
            if (userData.age > FRAUD_DETECTION_CONFIG.maxAge) {
                flags.push({
                    type: 'unrealistic_age',
                    severity: 'medium',
                    details: `Age (${userData.age}) above maximum (${FRAUD_DETECTION_CONFIG.maxAge})`
                });
                riskScore += 10;
            }
        }

        const requiredFields = ['name', 'email'];
        const missingFields = requiredFields.filter(f => !userData[f]);
        if (missingFields.length > 0) {
            flags.push({
                type: 'missing_identity',
                severity: 'medium',
                details: `Missing identity fields: ${missingFields.join(', ')}`
            });
            riskScore += 10;
        }

        return { flags, riskScore };
    }

    analyzeEmailPatterns(email) {
        const flags = [];
        let riskScore = 0;

        if (!email) {
            flags.push({
                type: 'missing_email',
                severity: 'high',
                details: 'Email address is required'
            });
            riskScore += 20;
            return { flags, riskScore };
        }

        const domain = email.split('@')[1];
        if (domain && FRAUD_DETECTION_CONFIG.suspiciousEmailDomains.includes(domain)) {
            flags.push({
                type: 'disposable_email',
                severity: 'high',
                details: `Disposable email domain: ${domain}`
            });
            riskScore += 25;
        }

        for (const pattern of FRAUD_DETECTION_CONFIG.disposableEmailPatterns) {
            if (pattern.test(email)) {
                flags.push({
                    type: 'suspicious_email_pattern',
                    severity: 'medium',
                    details: `Email matches suspicious pattern: ${pattern}`
                });
                riskScore += 10;
                break;
            }
        }

        if (email.match(/\d{5,}@/)) {
            flags.push({
                type: 'temporary_email',
                severity: 'medium',
                details: 'Email contains numeric sequence suggesting temporary use'
            });
            riskScore += 15;
        }

        return { flags, riskScore };
    }

    async analyzeDeviceFingerprint(context) {
        const flags = [];
        let riskScore = 0;
        const fingerprint = this.generateDeviceFingerprint(context);

        try {
            const [existing] = await db.query(
                `SELECT COUNT(*) as count FROM users 
                 WHERE device_fingerprint = ?`,
                [fingerprint]
            );

            if (existing[0].count >= FRAUD_DETECTION_CONFIG.maxAccountsPerDevice) {
                flags.push({
                    type: 'device_fingerprint_abuse',
                    severity: 'high',
                    details: `Device fingerprint associated with ${existing[0].count} accounts`
                });
                riskScore += 30;
            }

            if (!context.userAgent || !context.acceptLanguage) {
                flags.push({
                    type: 'incomplete_device_data',
                    severity: 'low',
                    details: 'Device data is incomplete'
                });
                riskScore += 5;
            }

            if (context.userAgent && this.isHeadlessBrowser(context.userAgent)) {
                flags.push({
                    type: 'headless_browser',
                    severity: 'high',
                    details: 'Headless browser detected'
                });
                riskScore += 25;
            }

        } catch (error) {
            console.error('Device analysis error:', error);
            return { flags, riskScore, error: error.message };
        }

        this.deviceFingerprints.set(fingerprint, {
            firstSeen: new Date(),
            count: (this.deviceFingerprints.get(fingerprint)?.count || 0) + 1
        });

        return { flags, riskScore };
    }

    generateDeviceFingerprint(context) {
        const components = [
            context.userAgent || 'unknown',
            context.acceptLanguage || 'unknown',
            context.acceptEncoding || 'unknown',
            context.screenResolution || 'unknown',
            context.timezone || 'unknown'
        ];
        const string = components.join('|');
        return crypto.createHash('sha256').update(string).digest('hex');
    }

    isHeadlessBrowser(userAgent) {
        return FRAUD_DETECTION_CONFIG.headlessPatterns.some(pattern => pattern.test(userAgent));
    }

    async checkIPReputation(ip) {
        const flags = [];
        let riskScore = 0;

        if (!ip || ip === 'unknown') {
            flags.push({
                type: 'missing_ip',
                severity: 'medium',
                details: 'IP address not available'
            });
            riskScore += 10;
            return { flags, riskScore };
        }

        try {
            const cached = this.ipReputation.get(ip);
            if (cached) {
                if (cached.riskScore > 50) {
                    flags.push({
                        type: 'ip_reputation',
                        severity: 'high',
                        details: `IP has poor reputation (score: ${cached.riskScore})`
                    });
                    riskScore += cached.riskScore / 2;
                }
                return { flags, riskScore };
            }

            const [ipHistory] = await db.query(
                `SELECT COUNT(*) as account_count, 
                        SUM(CASE WHEN fraud_flag = true THEN 1 ELSE 0 END) as fraud_count
                 FROM users 
                 WHERE registration_ip = ?`,
                [ip]
            );

            if (ipHistory[0].account_count > 0) {
                const fraudRate = (ipHistory[0].fraud_count / ipHistory[0].account_count) * 100;
                if (fraudRate > 50) {
                    flags.push({
                        type: 'ip_fraud_history',
                        severity: 'high',
                        details: `IP associated with fraud (${fraudRate.toFixed(0)}% fraud rate)`
                    });
                    riskScore += Math.min(40, fraudRate / 2);
                }
            }

            if (this.isProxyIP(ip)) {
                flags.push({
                    type: 'proxy_ip',
                    severity: 'medium',
                    details: 'Proxy/VPN IP detected'
                });
                riskScore += 15;
            }

            this.ipReputation.set(ip, { riskScore });

        } catch (error) {
            console.error('IP reputation check error:', error);
            return { flags, riskScore, error: error.message };
        }

        return { flags, riskScore };
    }

    isProxyIP(ip) {
        return FRAUD_DETECTION_CONFIG.proxyPatterns.some(pattern => pattern.test(ip));
    }

    analyzeBehavioralPatterns(context) {
        const flags = [];
        let riskScore = 0;

        if (context.isAutomated) {
            flags.push({
                type: 'automated_behavior',
                severity: 'high',
                details: 'Automated behavior detected'
            });
            riskScore += 25;
        }

        if (context.signupTime) {
            const hour = new Date(context.signupTime).getHours();
            if (hour >= 0 && hour <= 5) {
                flags.push({
                    type: 'unusual_timing',
                    severity: 'low',
                    details: 'Signup during off-hours (12 AM - 5 AM)'
                });
                riskScore += 5;
            }
        }

        if (context.formCompletionTime && context.formCompletionTime < 2000) {
            flags.push({
                type: 'rapid_completion',
                severity: 'medium',
                details: 'Form completed too quickly (under 2 seconds)'
            });
            riskScore += 15;
        }

        return { flags, riskScore };
    }

    analyzeNamePatterns(name) {
        const flags = [];
        let riskScore = 0;

        if (!name) {
            flags.push({
                type: 'missing_name',
                severity: 'high',
                details: 'Name is required'
            });
            riskScore += 20;
            return { flags, riskScore };
        }

        if (name.length < 2) {
            flags.push({
                type: 'unrealistic_name_length',
                severity: 'medium',
                details: `Name too short (${name.length} characters)`
            });
            riskScore += 10;
        }

        const syntheticPatterns = [
            /^[A-Z][a-z]{1,2}$/,
            /[0-9]/,
            /[!@#$%^&*]/,
            /^[A-Z]$/
        ];

        for (const pattern of syntheticPatterns) {
            if (pattern.test(name)) {
                flags.push({
                    type: 'synthetic_name_pattern',
                    severity: 'medium',
                    details: `Name matches synthetic pattern: ${pattern}`
                });
                riskScore += 10;
                break;
            }
        }

        return { flags, riskScore };
    }

    calculateRiskLevel(score) {
        if (score >= FRAUD_DETECTION_CONFIG.trustScoreThreshold) return 'low';
        if (score >= FRAUD_DETECTION_CONFIG.highRiskThreshold) return 'medium';
        if (score >= FRAUD_DETECTION_CONFIG.criticalRiskThreshold) return 'high';
        return 'critical';
    }

    calculateConfidence(flags) {
        if (flags.length === 0) return 0;

        const severityWeights = { high: 3, medium: 2, low: 1 };
        const totalWeight = flags.reduce((sum, f) => sum + (severityWeights[f.severity] || 0), 0);
        const maxWeight = flags.length * 3;

        return Math.min(100, (totalWeight / maxWeight) * 100);
    }

    generateRecommendations(detection) {
        const recommendations = [];

        if (detection.riskLevel === 'critical') {
            recommendations.push('Block account creation immediately');
            recommendations.push('Flag IP address for monitoring');
            recommendations.push('Alert security team');
        }

        if (detection.riskLevel === 'high') {
            recommendations.push('Require additional verification');
            recommendations.push('Add CAPTCHA to checkout');
            recommendations.push('Monitor for fraudulent activity');
        }

        if (detection.riskLevel === 'medium') {
            recommendations.push('Send verification email');
            recommendations.push('Rate limit account actions');
            recommendations.push('Enable 2FA requirement');
        }

        detection.flags.forEach(flag => {
            if (flag.type === 'disposable_email') {
                recommendations.push('Require email verification before purchase');
            }
            if (flag.type === 'velocity_ip') {
                recommendations.push('Rate limit accounts from this IP');
            }
            if (flag.type === 'headless_browser') {
                recommendations.push('Add JavaScript challenge to verify browser');
            }
        });

        return recommendations;
    }

    async logDetection(userData, detection, context) {
        try {
            await db.query(
                `INSERT INTO synthetic_identity_detections 
                 (user_email, user_name, risk_score, risk_level, flags, 
                  confidence, recommendations, ip_address, device_fingerprint, 
                  detection_id, timestamp)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
                [
                    userData.email || 'unknown',
                    userData.name || 'unknown',
                    detection.riskScore,
                    detection.riskLevel,
                    JSON.stringify(detection.flags),
                    detection.confidence,
                    JSON.stringify(detection.recommendations),
                    context.ip || 'unknown',
                    this.generateDeviceFingerprint(context),
                    detection.id || crypto.randomUUID()
                ]
            );
        } catch (error) {
            console.error('Error logging detection:', error);
        }
    }

    async updateVelocity(context) {
        const key = `velocity_${context.ip || 'unknown'}`;
        const now = Date.now();

        if (!this.velocityTracker.has(key)) {
            this.velocityTracker.set(key, { count: 1, timestamp: now });
        } else {
            const data = this.velocityTracker.get(key);
            data.count++;
            data.timestamp = now;
        }
    }

    async loadReputationData() {
        try {
            const [reputations] = await db.query(
                `SELECT ip_address, risk_score FROM ip_reputation 
                 WHERE last_updated > DATE_SUB(NOW(), INTERVAL 7 DAY)`
            );

            for (const rep of reputations) {
                this.ipReputation.set(rep.ip_address, { riskScore: rep.risk_score });
            }

            console.log(`Loaded ${reputations.length} IP reputations`);
        } catch (error) {
            console.error('Error loading reputation data:', error);
        }
    }

    getStats() {
        return {
            fraudScores: this.fraudScores.size,
            deviceFingerprints: this.deviceFingerprints.size,
            ipReputations: this.ipReputation.keys().length,
            velocityTrackers: this.velocityTracker.size,
            detectionHistory: this.detectionHistory.size,
            initialized: this.initialized,
            cacheHits: this.ipReputation.getStats?.().hits || 0,
            cacheMisses: this.ipReputation.getStats?.().misses || 0
        };
    }

    clearCache() {
        this.ipReputation.flushAll();
        this.fraudScores.clear();
        this.deviceFingerprints.clear();
        this.velocityTracker.clear();
        console.log('Detector cache cleared');
        return { success: true, timestamp: new Date().toISOString() };
    }
}

const detector = new SyntheticIdentityDetector();
detector.initialize();

module.exports = detector;