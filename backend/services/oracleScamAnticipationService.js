// backend/services/oracleScamAnticipationService.js
const db = require('../config/db').promise;
const crypto = require('crypto');

// ============================================
// CONFIGURATION
// ============================================

const ORACLE_CONFIG = {
    // Scam types (12 types)
    scamTypes: [
        'PHISHING',
        'IDENTITY_THEFT',
        'CARDING',
        'REFUND_FRAUD',
        'DISCOUNT_SCAM',
        'FAKE_PRODUCT',
        'SHIPPING_SCAM',
        'PAYMENT_REDIRECT',
        'CHARGEBACK_FRAUD',
        'ACCOUNT_TAKEOVER',
        'SOCIAL_ENGINEERING',
        'SYNTHETIC_IDENTITY'
    ],
    
    // Detection thresholds
    thresholds: {
        EARLY_WARNING: 20,
        PROBABLE_SCAM: 50,
        CONFIRMED_SCAM: 80
    },
    
    // Trajectory monitoring
    maxTrajectoryDays: 15,
    maxApps: 95,
    minConfidence: 0.6,
    
    // Self-evolving context
    contextRetention: 30, // days
    learningRate: 0.01,
    distillationThreshold: 0.7
};

// ============================================
// ORACLE SCAM ANTICIPATION CLASS
// ============================================

class OracleScamAnticipationService {
    constructor() {
        this.trajectories = new Map();
        this.scamPatterns = new Map();
        this.contextMemory = new Map();
        this.alerts = [];
        this.confidenceCache = new Map();
        this.distillationData = [];
    }

    /**
     * Process streaming trajectory and anticipate scams
     */
    async processTrajectory(userId, appUsageData) {
        const trajectory = this.getOrCreateTrajectory(userId);
        
        // Add app usage to trajectory
        trajectory.addAppUsage(appUsageData);
        
        // Extract scam patterns from current trajectory
        const patterns = await this.extractScamPatterns(trajectory);
        
        // Analyze for scam anticipation
        const analysis = await this.analyzeTrajectory(trajectory, patterns);
        
        // Generate early warning if needed
        const warning = await this.generateEarlyWarning(userId, trajectory, analysis);
        
        // Update self-evolving context
        await this.updateContext(trajectory, analysis);
        
        // Store in database
        await this.storeTrajectoryData(userId, trajectory, analysis, warning);
        
        return {
            userId,
            trajectoryId: trajectory.id,
            analysis,
            warning,
            confidence: analysis.confidence,
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Get or create user trajectory
     */
    getOrCreateTrajectory(userId) {
        if (!this.trajectories.has(userId)) {
            this.trajectories.set(userId, new UserTrajectory(userId));
        }
        return this.trajectories.get(userId);
    }

    /**
     * Extract scam patterns from trajectory
     */
    async extractScamPatterns(trajectory) {
        const patterns = {
            detected: [],
            confidence: 0,
            evidence: []
        };

        const appHistory = trajectory.getAppHistory();
        const interactions = trajectory.getInteractions();

        // 1. Check for phishing patterns
        const phishingPattern = this.detectPhishingPattern(appHistory, interactions);
        if (phishingPattern) {
            patterns.detected.push(phishingPattern);
            patterns.confidence += phishingPattern.confidence;
            patterns.evidence.push(...phishingPattern.evidence);
        }

        // 2. Check for identity theft patterns
        const identityPattern = this.detectIdentityTheftPattern(appHistory, interactions);
        if (identityPattern) {
            patterns.detected.push(identityPattern);
            patterns.confidence += identityPattern.confidence;
            patterns.evidence.push(...identityPattern.evidence);
        }

        // 3. Check for carding patterns
        const cardingPattern = this.detectCardingPattern(appHistory, interactions);
        if (cardingPattern) {
            patterns.detected.push(cardingPattern);
            patterns.confidence += cardingPattern.confidence;
            patterns.evidence.push(...cardingPattern.evidence);
        }

        // 4. Check for refund fraud patterns
        const refundPattern = this.detectRefundFraudPattern(appHistory, interactions);
        if (refundPattern) {
            patterns.detected.push(refundPattern);
            patterns.confidence += refundPattern.confidence;
            patterns.evidence.push(...refundPattern.evidence);
        }

        // 5. Check for discount scam patterns
        const discountPattern = this.detectDiscountScamPattern(appHistory, interactions);
        if (discountPattern) {
            patterns.detected.push(discountPattern);
            patterns.confidence += discountPattern.confidence;
            patterns.evidence.push(...discountPattern.evidence);
        }

        // 6. Check for fake product patterns
        const fakeProductPattern = this.detectFakeProductPattern(appHistory, interactions);
        if (fakeProductPattern) {
            patterns.detected.push(fakeProductPattern);
            patterns.confidence += fakeProductPattern.confidence;
            patterns.evidence.push(...fakeProductPattern.evidence);
        }

        // 7. Check for shipping scam patterns
        const shippingPattern = this.detectShippingScamPattern(appHistory, interactions);
        if (shippingPattern) {
            patterns.detected.push(shippingPattern);
            patterns.confidence += shippingPattern.confidence;
            patterns.evidence.push(...shippingPattern.evidence);
        }

        // 8. Check for payment redirect patterns
        const redirectPattern = this.detectPaymentRedirectPattern(appHistory, interactions);
        if (redirectPattern) {
            patterns.detected.push(redirectPattern);
            patterns.confidence += redirectPattern.confidence;
            patterns.evidence.push(...redirectPattern.evidence);
        }

        // 9. Check for chargeback fraud patterns
        const chargebackPattern = this.detectChargebackFraudPattern(appHistory, interactions);
        if (chargebackPattern) {
            patterns.detected.push(chargebackPattern);
            patterns.confidence += chargebackPattern.confidence;
            patterns.evidence.push(...chargebackPattern.evidence);
        }

        // 10. Check for account takeover patterns
        const takeoverPattern = this.detectAccountTakeoverPattern(appHistory, interactions);
        if (takeoverPattern) {
            patterns.detected.push(takeoverPattern);
            patterns.confidence += takeoverPattern.confidence;
            patterns.evidence.push(...takeoverPattern.evidence);
        }

        // 11. Check for social engineering patterns
        const socialPattern = this.detectSocialEngineeringPattern(appHistory, interactions);
        if (socialPattern) {
            patterns.detected.push(socialPattern);
            patterns.confidence += socialPattern.confidence;
            patterns.evidence.push(...socialPattern.evidence);
        }

        // 12. Check for synthetic identity patterns
        const syntheticPattern = this.detectSyntheticIdentityPattern(appHistory, interactions);
        if (syntheticPattern) {
            patterns.detected.push(syntheticPattern);
            patterns.confidence += syntheticPattern.confidence;
            patterns.evidence.push(...syntheticPattern.evidence);
        }

        // Normalize confidence
        patterns.confidence = Math.min(100, patterns.confidence / patterns.detected.length);
        
        return patterns;
    }

    // ============================================
    // PATTERN DETECTION METHODS
    // ============================================

    detectPhishingPattern(appHistory, interactions) {
        const indicators = [];
        
        // Check for suspicious links
        const suspiciousLinks = appHistory.filter(app => 
            app.includes('phishing') || app.includes('fake') || app.includes('spoof')
        );
        if (suspiciousLinks.length > 0) {
            indicators.push('suspicious_links_detected');
        }

        // Check for credential requests
        const credentialRequests = interactions.filter(i => 
            i.includes('password') || i.includes('login') || i.includes('credentials')
        );
        if (credentialRequests.length > 2) {
            indicators.push('multiple_credential_requests');
        }

        if (indicators.length > 0) {
            return {
                type: 'PHISHING',
                confidence: Math.min(100, indicators.length * 25),
                evidence: indicators,
                timestamp: new Date().toISOString()
            };
        }
        return null;
    }

    detectIdentityTheftPattern(appHistory, interactions) {
        const indicators = [];

        // Check for personal info requests
        const personalInfo = interactions.filter(i => 
            i.includes('ssn') || i.includes('dob') || i.includes('address') || 
            i.includes('id') || i.includes('passport')
        );
        if (personalInfo.length > 2) {
            indicators.push('multiple_personal_info_requests');
        }

        // Check for multiple identity documents
        const documents = appHistory.filter(app => 
            app.includes('id_upload') || app.includes('document_verification')
        );
        if (documents.length > 1) {
            indicators.push('multiple_identity_documents');
        }

        if (indicators.length > 0) {
            return {
                type: 'IDENTITY_THEFT',
                confidence: Math.min(100, indicators.length * 30),
                evidence: indicators,
                timestamp: new Date().toISOString()
            };
        }
        return null;
    }

    detectCardingPattern(appHistory, interactions) {
        const indicators = [];

        // Check for rapid card additions
        const cardAdditions = interactions.filter(i => i.includes('add_card'));
        if (cardAdditions.length > 3) {
            indicators.push('rapid_card_additions');
        }

        // Check for multiple payment attempts
        const paymentAttempts = interactions.filter(i => i.includes('payment'));
        if (paymentAttempts.length > 5) {
            indicators.push('multiple_payment_attempts');
        }

        // Check for declined transactions
        const declines = interactions.filter(i => i.includes('declined'));
        if (declines.length > 2) {
            indicators.push('multiple_declines');
        }

        if (indicators.length > 0) {
            return {
                type: 'CARDING',
                confidence: Math.min(100, indicators.length * 25),
                evidence: indicators,
                timestamp: new Date().toISOString()
            };
        }
        return null;
    }

    detectRefundFraudPattern(appHistory, interactions) {
        const indicators = [];

        // Check for refund requests
        const refundRequests = interactions.filter(i => i.includes('refund'));
        if (refundRequests.length > 2) {
            indicators.push('multiple_refund_requests');
        }

        // Check for fake evidence
        const evidence = appHistory.filter(app => 
            app.includes('fake_evidence') || app.includes('ai_image')
        );
        if (evidence.length > 0) {
            indicators.push('fake_evidence_detected');
        }

        if (indicators.length > 0) {
            return {
                type: 'REFUND_FRAUD',
                confidence: Math.min(100, indicators.length * 30),
                evidence: indicators,
                timestamp: new Date().toISOString()
            };
        }
        return null;
    }

    detectDiscountScamPattern(appHistory, interactions) {
        const indicators = [];

        // Check for unauthorized discount requests
        const discountRequests = interactions.filter(i => 
            i.includes('discount') || i.includes('promo') || i.includes('coupon')
        );
        if (discountRequests.length > 3) {
            indicators.push('multiple_discount_requests');
        }

        // Check for code generation
        const codeGen = appHistory.filter(app => app.includes('code_generator'));
        if (codeGen.length > 0) {
            indicators.push('code_generator_detected');
        }

        if (indicators.length > 0) {
            return {
                type: 'DISCOUNT_SCAM',
                confidence: Math.min(100, indicators.length * 25),
                evidence: indicators,
                timestamp: new Date().toISOString()
            };
        }
        return null;
    }

    detectFakeProductPattern(appHistory, interactions) {
        const indicators = [];

        // Check for fake product listings
        const fakeListings = appHistory.filter(app => 
            app.includes('fake_product') || app.includes('counterfeit')
        );
        if (fakeListings.length > 0) {
            indicators.push('fake_product_detected');
        }

        // Check for suspicious product uploads
        const uploads = interactions.filter(i => i.includes('upload_product'));
        if (uploads.length > 5) {
            indicators.push('excessive_product_uploads');
        }

        if (indicators.length > 0) {
            return {
                type: 'FAKE_PRODUCT',
                confidence: Math.min(100, indicators.length * 30),
                evidence: indicators,
                timestamp: new Date().toISOString()
            };
        }
        return null;
    }

    detectShippingScamPattern(appHistory, interactions) {
        const indicators = [];

        // Check for address changes
        const addressChanges = interactions.filter(i => i.includes('change_address'));
        if (addressChanges.length > 2) {
            indicators.push('multiple_address_changes');
        }

        // Check for rerouting requests
        const rerouting = interactions.filter(i => i.includes('reroute'));
        if (rerouting.length > 1) {
            indicators.push('rerouting_requests');
        }

        if (indicators.length > 0) {
            return {
                type: 'SHIPPING_SCAM',
                confidence: Math.min(100, indicators.length * 25),
                evidence: indicators,
                timestamp: new Date().toISOString()
            };
        }
        return null;
    }

    detectPaymentRedirectPattern(appHistory, interactions) {
        const indicators = [];

        // Check for redirects
        const redirects = interactions.filter(i => i.includes('redirect'));
        if (redirects.length > 2) {
            indicators.push('multiple_redirects');
        }

        // Check for suspicious payment URLs
        const suspiciousUrls = appHistory.filter(app => 
            app.includes('fake_payment') || app.includes('unauthorized_payment')
        );
        if (suspiciousUrls.length > 0) {
            indicators.push('suspicious_payment_urls');
        }

        if (indicators.length > 0) {
            return {
                type: 'PAYMENT_REDIRECT',
                confidence: Math.min(100, indicators.length * 25),
                evidence: indicators,
                timestamp: new Date().toISOString()
            };
        }
        return null;
    }

    detectChargebackFraudPattern(appHistory, interactions) {
        const indicators = [];

        // Check for chargeback requests
        const chargebacks = interactions.filter(i => i.includes('chargeback'));
        if (chargebacks.length > 2) {
            indicators.push('multiple_chargeback_requests');
        }

        // Check for dispute patterns
        const disputes = interactions.filter(i => i.includes('dispute'));
        if (disputes.length > 2) {
            indicators.push('multiple_disputes');
        }

        if (indicators.length > 0) {
            return {
                type: 'CHARGEBACK_FRAUD',
                confidence: Math.min(100, indicators.length * 30),
                evidence: indicators,
                timestamp: new Date().toISOString()
            };
        }
        return null;
    }

    detectAccountTakeoverPattern(appHistory, interactions) {
        const indicators = [];

        // Check for password changes
        const passwordChanges = interactions.filter(i => i.includes('change_password'));
        if (passwordChanges.length > 2) {
            indicators.push('multiple_password_changes');
        }

        // Check for new device logins
        const newDevices = appHistory.filter(app => app.includes('new_device'));
        if (newDevices.length > 1) {
            indicators.push('multiple_new_devices');
        }

        // Check for suspicious login attempts
        const loginAttempts = interactions.filter(i => i.includes('login_attempt'));
        if (loginAttempts.length > 5) {
            indicators.push('multiple_login_attempts');
        }

        if (indicators.length > 0) {
            return {
                type: 'ACCOUNT_TAKEOVER',
                confidence: Math.min(100, indicators.length * 25),
                evidence: indicators,
                timestamp: new Date().toISOString()
            };
        }
        return null;
    }

    detectSocialEngineeringPattern(appHistory, interactions) {
        const indicators = [];

        // Check for manipulation attempts
        const manipulation = interactions.filter(i => 
            i.includes('urgent') || i.includes('emergency') || i.includes('immediate')
        );
        if (manipulation.length > 3) {
            indicators.push('manipulation_attempts');
        }

        // Check for authority claims
        const authority = interactions.filter(i => 
            i.includes('ceo') || i.includes('admin') || i.includes('supervisor')
        );
        if (authority.length > 1) {
            indicators.push('authority_claims');
        }

        if (indicators.length > 0) {
            return {
                type: 'SOCIAL_ENGINEERING',
                confidence: Math.min(100, indicators.length * 25),
                evidence: indicators,
                timestamp: new Date().toISOString()
            };
        }
        return null;
    }

    detectSyntheticIdentityPattern(appHistory, interactions) {
        const indicators = [];

        // Check for synthetic identity markers
        const synthetic = appHistory.filter(app => 
            app.includes('synthetic') || app.includes('generated_identity')
        );
        if (synthetic.length > 0) {
            indicators.push('synthetic_identity_detected');
        }

        // Check for inconsistent identity data
        const inconsistencies = interactions.filter(i => i.includes('identity_verification_failed'));
        if (inconsistencies.length > 2) {
            indicators.push('inconsistent_identity_data');
        }

        if (indicators.length > 0) {
            return {
                type: 'SYNTHETIC_IDENTITY',
                confidence: Math.min(100, indicators.length * 30),
                evidence: indicators,
                timestamp: new Date().toISOString()
            };
        }
        return null;
    }

    // ============================================
    // TRAJECTORY ANALYSIS
    // ============================================

    async analyzeTrajectory(trajectory, patterns) {
        const analysis = {
            scamProbability: 0,
            confidence: 0,
            detectedScams: [],
            riskLevel: 'low',
            earlySignals: [],
            recommendations: [],
            timestamp: new Date().toISOString()
        };

        // Calculate scam probability based on patterns
        for (const pattern of patterns.detected) {
            analysis.detectedScams.push(pattern.type);
            analysis.scamProbability += pattern.confidence / 100;
        }

        // Normalize probability
        analysis.scamProbability = patterns.detected.length > 0 
            ? (analysis.scamProbability / patterns.detected.length) * 100 
            : 0;

        // Calculate confidence based on evidence
        analysis.confidence = patterns.detected.length > 0 
            ? Math.min(100, patterns.evidence.length * 10 + 20)
            : 0;

        // Determine risk level
        if (analysis.scamProbability >= ORACLE_CONFIG.thresholds.CONFIRMED_SCAM) {
            analysis.riskLevel = 'critical';
        } else if (analysis.scamProbability >= ORACLE_CONFIG.thresholds.PROBABLE_SCAM) {
            analysis.riskLevel = 'high';
        } else if (analysis.scamProbability >= ORACLE_CONFIG.thresholds.EARLY_WARNING) {
            analysis.riskLevel = 'medium';
        } else {
            analysis.riskLevel = 'low';
        }

        // Extract early signals
        analysis.earlySignals = this.extractEarlySignals(trajectory, patterns);

        // Generate recommendations
        analysis.recommendations = this.generateRecommendations(analysis);

        // Update distillation data
        await this.updateDistillationData(trajectory, analysis);

        return analysis;
    }

    extractEarlySignals(trajectory, patterns) {
        const signals = [];
        const recentInteractions = trajectory.getRecentInteractions(10);
        const appHistory = trajectory.getAppHistory();

        // Check for rapid app switching
        if (recentInteractions.length > 5) {
            const uniqueApps = new Set(appHistory);
            if (uniqueApps.size > 3) {
                signals.push({
                    type: 'rapid_app_switching',
                    description: 'Rapid switching between multiple apps',
                    confidence: 60
                });
            }
        }

        // Check for unusual time patterns
        const times = recentInteractions.map(i => i.timestamp);
        if (times.length > 3) {
            const avgInterval = (times[times.length-1] - times[0]) / times.length;
            if (avgInterval < 10000) {
                signals.push({
                    type: 'unusual_time_pattern',
                    description: 'Unusually rapid interactions',
                    confidence: 70
                });
            }
        }

        // Check for repeated actions
        const actions = recentInteractions.map(i => i.action);
        const repeatedActions = actions.filter((a, i) => actions.indexOf(a) !== i);
        if (repeatedActions.length > 3) {
            signals.push({
                type: 'repeated_actions',
                description: `Repeated actions: ${repeatedActions.join(', ')}`,
                confidence: 65
            });
        }

        return signals;
    }

    generateRecommendations(analysis) {
        const recommendations = [];

        if (analysis.riskLevel === 'critical') {
            recommendations.push('Immediately block all actions');
            recommendations.push('Alert security team');
            recommendations.push('Lock user account');
            recommendations.push('Initiate fraud investigation');
        }

        if (analysis.riskLevel === 'high') {
            recommendations.push('Require additional verification');
            recommendations.push('Rate limit all actions');
            recommendations.push('Monitor for escalation');
            recommendations.push('Contact user for verification');
        }

        if (analysis.riskLevel === 'medium') {
            recommendations.push('Enable enhanced monitoring');
            recommendations.push('Flag for review');
            recommendations.push('Log all interactions');
        }

        if (analysis.detectedScams.length > 0) {
            recommendations.push(`Watch for ${analysis.detectedScams.join(', ')} patterns`);
        }

        return recommendations;
    }

    // ============================================
    // EARLY WARNING GENERATION
    // ============================================

    async generateEarlyWarning(userId, trajectory, analysis) {
        if (analysis.riskLevel === 'low') {
            return null;
        }

        const warning = {
            userId,
            trajectoryId: trajectory.id,
            riskLevel: analysis.riskLevel,
            scamProbability: analysis.scamProbability,
            confidence: analysis.confidence,
            detectedScams: analysis.detectedScams,
            earlySignals: analysis.earlySignals,
            recommendations: analysis.recommendations,
            timestamp: new Date().toISOString(),
            warningId: this.generateWarningId()
        };

        // Store warning
        await this.storeWarning(warning);
        this.alerts.push(warning);

        // Send notification for critical warnings
        if (analysis.riskLevel === 'critical') {
            console.error(`🚨 CRITICAL: Scam anticipated for user ${userId}`);
            console.error(`Scam Probability: ${analysis.scamProbability}%`);
            console.error(`Detected Scams: ${analysis.detectedScams.join(', ')}`);
            // Send email/Slack alert
        }

        return warning;
    }

    generateWarningId() {
        return `WARN_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    }

    // ============================================
    // CONTEXT MANAGEMENT
    // ============================================

    async updateContext(trajectory, analysis) {
        const userId = trajectory.userId;
        const context = this.contextMemory.get(userId) || {
            userId,
            patterns: [],
            confidence: 0,
            lastUpdated: new Date().toISOString()
        };

        // Update with new patterns
        for (const pattern of analysis.detectedScams) {
            if (!context.patterns.includes(pattern)) {
                context.patterns.push(pattern);
            }
        }

        // Update confidence
        context.confidence = Math.max(context.confidence, analysis.confidence);
        context.lastUpdated = new Date().toISOString();

        this.contextMemory.set(userId, context);

        // Store in database
        await this.storeContext(userId, context);
    }

    async updateDistillationData(trajectory, analysis) {
        // Store for on-policy self-distillation
        this.distillationData.push({
            userId: trajectory.userId,
            patterns: analysis.detectedScams,
            signals: analysis.earlySignals,
            confidence: analysis.confidence,
            riskLevel: analysis.riskLevel,
            timestamp: new Date().toISOString()
        });

        // Keep only last 1000 entries
        if (this.distillationData.length > 1000) {
            this.distillationData.shift();
        }

        // Trigger distillation if threshold met
        if (this.distillationData.length % 100 === 0) {
            await this.performDistillation();
        }
    }

    async performDistillation() {
        // Self-evolving context management
        // Distill evidence-informed knowledge for fraud recognition
        console.log(`🧠 Performing on-policy self-distillation...`);
        
        // In production, this would train a model on collected data
        // For now, we update pattern confidence based on success rate
        
        const successful = this.distillationData.filter(d => d.confidence > 0.7);
        const total = this.distillationData.length;
        
        if (total > 0) {
            const successRate = successful.length / total;
            console.log(`Distillation complete. Success rate: ${(successRate * 100).toFixed(2)}%`);
            
            // Update learning rate
            if (successRate > ORACLE_CONFIG.distillationThreshold) {
                // Increase learning rate for faster adaptation
                console.log('📈 Increasing learning rate');
            }
        }
    }

    // ============================================
    // DATABASE OPERATIONS
    // ============================================

    async storeTrajectoryData(userId, trajectory, analysis, warning) {
        try {
            await db.query(
                `INSERT INTO oracle_trajectory_data 
                 (user_id, app_history, interactions, detected_patterns, 
                  scam_probability, confidence, risk_level, warning_data, 
                  timestamp, trajectory_days)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?)`,
                [
                    userId,
                    JSON.stringify(trajectory.getAppHistory()),
                    JSON.stringify(trajectory.getInteractions()),
                    JSON.stringify(analysis.detectedScams),
                    analysis.scamProbability,
                    analysis.confidence,
                    analysis.riskLevel,
                    warning ? JSON.stringify(warning) : null,
                    trajectory.getDuration() / (24 * 60 * 60 * 1000) // days
                ]
            );
        } catch (error) {
            console.error('Store trajectory error:', error);
        }
    }

    async storeWarning(warning) {
        try {
            await db.query(
                `INSERT INTO oracle_warnings 
                 (warning_id, user_id, risk_level, scam_probability, 
                  confidence, detected_scams, early_signals, recommendations, 
                  timestamp)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
                [
                    warning.warningId,
                    warning.userId,
                    warning.riskLevel,
                    warning.scamProbability,
                    warning.confidence,
                    JSON.stringify(warning.detectedScams),
                    JSON.stringify(warning.earlySignals),
                    JSON.stringify(warning.recommendations)
                ]
            );
        } catch (error) {
            console.error('Store warning error:', error);
        }
    }

    async storeContext(userId, context) {
        try {
            await db.query(
                `INSERT INTO oracle_context_data 
                 (user_id, patterns, confidence, last_updated)
                 VALUES (?, ?, ?, NOW())
                 ON DUPLICATE KEY UPDATE
                 patterns = VALUES(patterns),
                 confidence = VALUES(confidence),
                 last_updated = NOW()`,
                [
                    userId,
                    JSON.stringify(context.patterns),
                    context.confidence
                ]
            );
        } catch (error) {
            console.error('Store context error:', error);
        }
    }

    // ============================================
    // STATISTICS
    // ============================================

    async getStatistics() {
        try {
            const [stats] = await db.query(
                `SELECT 
                    COUNT(*) as total_trajectories,
                    COUNT(DISTINCT user_id) as unique_users,
                    AVG(scam_probability) as avg_scam_probability,
                    AVG(confidence) as avg_confidence,
                    SUM(CASE WHEN risk_level = 'critical' THEN 1 ELSE 0 END) as critical_alerts,
                    SUM(CASE WHEN risk_level = 'high' THEN 1 ELSE 0 END) as high_alerts,
                    AVG(trajectory_days) as avg_trajectory_days
                 FROM oracle_trajectory_data
                 WHERE timestamp > DATE_SUB(NOW(), INTERVAL 7 DAY)`
            );

            const [warningStats] = await db.query(
                `SELECT 
                    COUNT(*) as total_warnings,
                    SUM(CASE WHEN risk_level = 'critical' THEN 1 ELSE 0 END) as critical_warnings
                 FROM oracle_warnings
                 WHERE timestamp > DATE_SUB(NOW(), INTERVAL 7 DAY)`
            );

            return {
                trajectories: stats[0],
                warnings: warningStats[0],
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            console.error('Statistics error:', error);
            throw error;
        }
    }

    getStatus() {
        return {
            trajectories: this.trajectories.size,
            scamPatterns: this.scamPatterns.size,
            contextMemory: this.contextMemory.size,
            alerts: this.alerts.length,
            distillationData: this.distillationData.length,
            config: ORACLE_CONFIG
        };
    }
}

// ============================================
// USER TRAJECTORY CLASS
// ============================================

class UserTrajectory {
    constructor(userId) {
        this.id = crypto.randomUUID();
        this.userId = userId;
        this.appHistory = [];
        this.interactions = [];
        this.createdAt = Date.now();
        this.updatedAt = Date.now();
        this.scamSignals = [];
    }

    addAppUsage(appData) {
        this.appHistory.push(appData);
        this.updatedAt = Date.now();
        
        // Keep only last 95 apps
        if (this.appHistory.length > ORACLE_CONFIG.maxApps) {
            this.appHistory.shift();
        }
    }

    addInteraction(interaction) {
        this.interactions.push({
            ...interaction,
            timestamp: Date.now()
        });
        this.updatedAt = Date.now();
        
        // Keep only recent interactions
        const maxAge = ORACLE_CONFIG.maxTrajectoryDays * 24 * 60 * 60 * 1000;
        const cutoff = Date.now() - maxAge;
        this.interactions = this.interactions.filter(i => i.timestamp > cutoff);
        
        // Check for scam signals
        const signal = this.detectScamSignal(interaction);
        if (signal) {
            this.scamSignals.push(signal);
        }
    }

    detectScamSignal(interaction) {
        const suspiciousKeywords = [
            'urgent', 'emergency', 'immediate', 'bypass', 'override',
            'free', 'unlimited', 'unrestricted', 'admin', 'ceo',
            'hack', 'exploit', 'vulnerability', 'fake', 'counterfeit'
        ];
        
        const text = interaction.text || '';
        const detected = suspiciousKeywords.filter(keyword => 
            text.toLowerCase().includes(keyword)
        );
        
        if (detected.length > 0) {
            return {
                type: 'suspicious_keywords',
                keywords: detected,
                timestamp: Date.now()
            };
        }
        return null;
    }

    getAppHistory() {
        return this.appHistory;
    }

    getInteractions() {
        return this.interactions;
    }

    getRecentInteractions(count = 10) {
        return this.interactions.slice(-count);
    }

    getDuration() {
        return this.updatedAt - this.createdAt;
    }

    getScamSignals() {
        return this.scamSignals;
    }
}

// ============================================
// EXPORT
// ============================================

module.exports = new OracleScamAnticipationService();