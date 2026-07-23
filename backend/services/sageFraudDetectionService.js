// backend/services/sageFraudDetectionService.js
const db = require('../config/db').promise;
const crypto = require('crypto');

// ============================================
// CONFIGURATION
// ============================================

const SAGE_CONFIG = {
    // Three dedicated agents
    agents: {
        DATA_ANALYSIS: 'data_analysis',
        DECISION_MAKING: 'decision_making',
        VERIFICATION: 'verification'
    },
    
    // Six-layer Data Diagnostic Tree
    ddtLayers: {
        L1_DATA_QUALITY: 'data_quality',
        L2_FEATURE_ENGINEERING: 'feature_engineering',
        L3_PATTERN_DETECTION: 'pattern_detection',
        L4_ANOMALY_DETECTION: 'anomaly_detection',
        L5_RISK_ASSESSMENT: 'risk_assessment',
        L6_DECISION_MAKING: 'decision_making'
    },
    
    // Markov decision process
    mdp: {
        maxIterations: 10,
        learningRate: 0.01,
        discountFactor: 0.95,
        explorationRate: 0.1
    },
    
    // Performance metrics
    metrics: {
        recallWeight: 0.5,
        precisionWeight: 0.3,
        f1Weight: 0.2
    }
};

// ============================================
// SAGE FRAUD DETECTION CLASS
// ============================================

class SAGEFraudDetectionService {
    constructor() {
        this.agentStates = new Map();
        this.ddtTree = new DataDiagnosticTree();
        this.mdp = new MarkovDecisionProcess();
        this.detectionResults = [];
        this.agentCollaboration = new Map();
        this.selfReflectionLogs = [];
    }

    /**
     * Detect fraud using multi-agent SAGE framework
     */
    async detectFraud(transactionData, context = {}) {
        // 1. Data Analysis Agent
        const dataAnalysisResult = await this.dataAnalysisAgent(transactionData, context);
        
        // 2. Decision Making Agent
        const decisionResult = await this.decisionMakingAgent(dataAnalysisResult, context);
        
        // 3. Verification Agent
        const verificationResult = await this.verificationAgent(decisionResult, context);
        
        // 4. Agent collaboration
        const collaborativeResult = await this.agentCollaboration(
            dataAnalysisResult,
            decisionResult,
            verificationResult
        );
        
        // 5. Self-reflection
        const finalResult = await this.selfReflection(collaborativeResult);
        
        // 6. Store results
        await this.storeDetectionResult(transactionData, finalResult, context);
        
        return finalResult;
    }

    /**
     * Data Analysis Agent (Agent 1)
     * Analyzes transaction data using six-layer DDT
     */
    async dataAnalysisAgent(transactionData, context) {
        const analysis = {
            agent: SAGE_CONFIG.agents.DATA_ANALYSIS,
            layers: {},
            features: {},
            anomalies: [],
            confidence: 0,
            timestamp: new Date().toISOString()
        };

        // L1: Data Quality Check
        analysis.layers.data_quality = await this.checkDataQuality(transactionData);
        
        // L2: Feature Engineering
        analysis.layers.feature_engineering = await this.engineerFeatures(transactionData);
        
        // L3: Pattern Detection
        analysis.layers.pattern_detection = await this.detectPatterns(transactionData);
        
        // L4: Anomaly Detection
        analysis.layers.anomaly_detection = await this.detectAnomalies(transactionData);
        
        // L5: Risk Assessment
        analysis.layers.risk_assessment = await this.assessRisk(transactionData);
        
        // L6: Initial Decision
        analysis.layers.decision_making = await this.initialDecision(analysis.layers);
        
        // Calculate agent confidence
        analysis.confidence = this.calculateAgentConfidence(analysis.layers);
        
        // Store agent state
        this.agentStates.set('data_analysis', analysis);
        
        return analysis;
    }

    /**
     * L1: Data Quality Check
     */
    async checkDataQuality(transactionData) {
        const quality = {
            completeness: 0,
            accuracy: 0,
            consistency: 0,
            timeliness: 0,
            issues: []
        };

        // Check required fields
        const requiredFields = ['amount', 'userId', 'productId', 'timestamp'];
        const missingFields = requiredFields.filter(f => !transactionData[f]);
        
        if (missingFields.length > 0) {
            quality.issues.push({
                type: 'missing_fields',
                fields: missingFields
            });
            quality.completeness = 1 - (missingFields.length / requiredFields.length);
        } else {
            quality.completeness = 1;
        }

        // Check data accuracy
        if (transactionData.amount && transactionData.amount <= 0) {
            quality.issues.push({
                type: 'invalid_amount',
                details: 'Amount must be positive'
            });
            quality.accuracy = 0.5;
        } else {
            quality.accuracy = 1;
        }

        // Check consistency
        if (transactionData.amount && transactionData.amount > 1000000) {
            quality.issues.push({
                type: 'suspicious_amount',
                details: 'Amount exceeds threshold'
            });
            quality.consistency = 0.6;
        } else {
            quality.consistency = 1;
        }

        // Check timeliness
        const age = Date.now() - new Date(transactionData.timestamp).getTime();
        if (age > 24 * 60 * 60 * 1000) {
            quality.issues.push({
                type: 'stale_data',
                details: 'Data is more than 24 hours old'
            });
            quality.timeliness = 0.7;
        } else {
            quality.timeliness = 1;
        }

        return quality;
    }

    /**
     * L2: Feature Engineering
     */
    async engineerFeatures(transactionData) {
        const features = {
            transaction: {},
            user: {},
            product: {},
            temporal: {}
        };

        // Transaction features
        features.transaction.amount = transactionData.amount || 0;
        features.transaction.currency = transactionData.currency || 'INR';
        features.transaction.type = transactionData.type || 'purchase';
        features.transaction.status = transactionData.status || 'pending';

        // User features
        features.user.id = transactionData.userId;
        features.user.tier = transactionData.userTier || 'standard';
        features.user.totalOrders = transactionData.totalOrders || 0;
        features.user.averageOrderValue = transactionData.averageOrderValue || 0;

        // Product features
        features.product.id = transactionData.productId;
        features.product.category = transactionData.category || 'general';
        features.product.price = transactionData.price || 0;
        features.product.quantity = transactionData.quantity || 1;

        // Temporal features
        const now = Date.now();
        const txTime = new Date(transactionData.timestamp || now).getTime();
        features.temporal.hour = new Date(txTime).getHours();
        features.temporal.dayOfWeek = new Date(txTime).getDay();
        features.temporal.isWeekend = [0, 6].includes(features.temporal.dayOfWeek);
        features.temporal.timeSinceLastOrder = transactionData.timeSinceLastOrder || 0;

        // Derived features
        features.transaction.amountPerUser = features.transaction.amount / (features.user.totalOrders + 1);
        features.transaction.velocity = features.user.totalOrders / (features.temporal.timeSinceLastOrder + 1);

        return features;
    }

    /**
     * L3: Pattern Detection
     */
    async detectPatterns(transactionData) {
        const patterns = {
            suspicious: [],
            normal: [],
            known: [],
            confidence: 0
        };

        // Check for carding pattern
        if (transactionData.cardAdditions && transactionData.cardAdditions > 2) {
            patterns.suspicious.push({
                type: 'carding_pattern',
                confidence: 0.8,
                details: 'Multiple card additions detected'
            });
        }

        // Check for rapid checkout pattern
        if (transactionData.checkoutTime && transactionData.checkoutTime < 1000) {
            patterns.suspicious.push({
                type: 'rapid_checkout',
                confidence: 0.7,
                details: 'Checkout completed too quickly'
            });
        }

        // Check for unusual time pattern
        if (transactionData.hour && (transactionData.hour < 3 || transactionData.hour > 22)) {
            patterns.suspicious.push({
                type: 'unusual_hour',
                confidence: 0.6,
                details: `Transaction at unusual hour: ${transactionData.hour}:00`
            });
        }

        // Check for amount pattern
        if (transactionData.amount && transactionData.amount === 0.01) {
            patterns.suspicious.push({
                type: 'test_transaction',
                confidence: 0.9,
                details: 'Micro-transaction (testing)'
            });
        }

        // Normal patterns
        if (patterns.suspicious.length === 0) {
            patterns.normal.push({
                type: 'typical_transaction',
                confidence: 0.9
            });
        }

        patterns.confidence = patterns.suspicious.length > 0 
            ? patterns.suspicious.reduce((sum, p) => sum + p.confidence, 0) / patterns.suspicious.length
            : 0.9;

        return patterns;
    }

    /**
     * L4: Anomaly Detection
     */
    async detectAnomalies(transactionData) {
        const anomalies = {
            detected: [],
            scores: {},
            confidence: 0,
            summary: ''
        };

        // Check amount anomaly
        if (transactionData.amount && transactionData.amount > transactionData.avgAmount * 3) {
            anomalies.detected.push({
                type: 'amount_anomaly',
                score: 0.85,
                details: 'Amount significantly above average'
            });
        }

        // Check frequency anomaly
        if (transactionData.frequency && transactionData.frequency > transactionData.avgFrequency * 2) {
            anomalies.detected.push({
                type: 'frequency_anomaly',
                score: 0.75,
                details: 'Transaction frequency above normal'
            });
        }

        // Check location anomaly
        if (transactionData.location && transactionData.location !== transactionData.typicalLocation) {
            anomalies.detected.push({
                type: 'location_anomaly',
                score: 0.7,
                details: 'Transaction from unusual location'
            });
        }

        // Check device anomaly
        if (transactionData.deviceId && transactionData.deviceId !== transactionData.typicalDevice) {
            anomalies.detected.push({
                type: 'device_anomaly',
                score: 0.65,
                details: 'Transaction from new device'
            });
        }

        // Calculate scores
        anomalies.scores = anomalies.detected.reduce((acc, a) => {
            acc[a.type] = a.score;
            return acc;
        }, {});

        anomalies.confidence = anomalies.detected.length > 0
            ? anomalies.detected.reduce((sum, a) => sum + a.score, 0) / anomalies.detected.length
            : 0;

        anomalies.summary = anomalies.detected.length > 0
            ? `Detected ${anomalies.detected.length} anomalies`
            : 'No anomalies detected';

        return anomalies;
    }

    /**
     * L5: Risk Assessment
     */
    async assessRisk(transactionData) {
        const risk = {
            level: 'low',
            score: 0,
            factors: [],
            confidence: 0
        };

        const riskFactors = [];

        // Amount risk
        if (transactionData.amount > 100000) {
            riskFactors.push({ factor: 'high_amount', weight: 0.3 });
        }

        // Velocity risk
        if (transactionData.velocity && transactionData.velocity > 10) {
            riskFactors.push({ factor: 'high_velocity', weight: 0.25 });
        }

        // New user risk
        if (transactionData.userAge && transactionData.userAge < 7) {
            riskFactors.push({ factor: 'new_user', weight: 0.2 });
        }

        // Unusual location risk
        if (transactionData.location && transactionData.location !== transactionData.typicalLocation) {
            riskFactors.push({ factor: 'unusual_location', weight: 0.15 });
        }

        // Calculate risk score
        risk.score = riskFactors.reduce((sum, rf) => sum + rf.weight, 0);
        risk.score = Math.min(1, risk.score);

        // Determine risk level
        if (risk.score >= 0.7) risk.level = 'critical';
        else if (risk.score >= 0.5) risk.level = 'high';
        else if (risk.score >= 0.3) risk.level = 'medium';
        else risk.level = 'low';

        risk.factors = riskFactors;
        risk.confidence = 0.9;

        return risk;
    }

    /**
     * L6: Initial Decision
     */
    async initialDecision(layers) {
        const decision = {
            action: 'pending',
            confidence: 0,
            reasoning: [],
            score: 0
        };

        // Combine layer results
        const qualityScore = layers.data_quality.completeness * 
                             layers.data_quality.accuracy * 
                             layers.data_quality.consistency;

        const patternScore = layers.pattern_detection.confidence;
        const anomalyScore = layers.anomaly_detection.confidence;
        const riskScore = layers.risk_assessment.score;

        // Calculate final score
        decision.score = (qualityScore * 0.2 + patternScore * 0.25 + 
                          anomalyScore * 0.25 + riskScore * 0.3);

        // Determine action
        if (decision.score >= 0.7) {
            decision.action = 'block';
            decision.reasoning.push('High risk score detected');
        } else if (decision.score >= 0.4) {
            decision.action = 'review';
            decision.reasoning.push('Moderate risk requires review');
        } else {
            decision.action = 'approve';
            decision.reasoning.push('Low risk transaction');
        }

        decision.confidence = 0.85;

        return decision;
    }

    /**
     * Decision Making Agent (Agent 2)
     */
    async decisionMakingAgent(dataAnalysisResult, context) {
        const decision = {
            agent: SAGE_CONFIG.agents.DECISION_MAKING,
            action: 'pending',
            confidence: 0,
            reasoning: [],
            alternatives: [],
            selectedAlternative: null,
            timestamp: new Date().toISOString()
        };

        // Extract relevant data
        const { layers, anomalies, confidence } = dataAnalysisResult;
        
        // Generate alternatives using MDP
        const alternatives = await this.mdp.generateAlternatives(
            layers,
            anomalies,
            context
        );

        decision.alternatives = alternatives;

        // Score each alternative
        const scoredAlternatives = await this.scoreAlternatives(alternatives, context);
        
        // Select best alternative
        decision.selectedAlternative = scoredAlternatives.reduce((best, current) => 
            current.score > best.score ? current : best
        );

        decision.action = decision.selectedAlternative.action;
        decision.confidence = decision.selectedAlternative.confidence;
        decision.reasoning = decision.selectedAlternative.reasoning;

        // Store agent state
        this.agentStates.set('decision_making', decision);

        return decision;
    }

    /**
     * Score alternatives using MDP
     */
    async scoreAlternatives(alternatives, context) {
        const scored = [];

        for (const alt of alternatives) {
            let score = 0;
            const reasoning = [];

            // Check recall impact
            const recallScore = await this.calculateRecallImpact(alt, context);
            score += recallScore * SAGE_CONFIG.metrics.recallWeight;
            reasoning.push(`Recall impact: ${recallScore.toFixed(2)}`);

            // Check precision impact
            const precisionScore = await this.calculatePrecisionImpact(alt, context);
            score += precisionScore * SAGE_CONFIG.metrics.precisionWeight;
            reasoning.push(`Precision impact: ${precisionScore.toFixed(2)}`);

            // Check F1 impact
            const f1Score = (2 * recallScore * precisionScore) / (recallScore + precisionScore + 0.0001);
            score += f1Score * SAGE_CONFIG.metrics.f1Weight;
            reasoning.push(`F1 impact: ${f1Score.toFixed(2)}`);

            // Natural language gradient optimization
            const gradient = await this.naturalLanguageGradient(alt, context);
            score += gradient;

            scored.push({
                ...alt,
                score: Math.min(1, score),
                confidence: score,
                reasoning
            });
        }

        return scored;
    }

    /**
     * Natural language gradient optimization
     */
    async naturalLanguageGradient(alternative, context) {
        // Simulate gradient-based optimization
        let gradient = 0;

        if (alternative.action === 'block' && context.riskLevel === 'high') {
            gradient += 0.2;
        }

        if (alternative.action === 'review' && context.uncertainty > 0.5) {
            gradient += 0.15;
        }

        if (alternative.action === 'approve' && context.riskLevel === 'low') {
            gradient += 0.25;
        }

        // Adjust based on historical performance
        const historical = await this.getHistoricalPerformance(alternative.action);
        gradient += historical * 0.3;

        return Math.min(0.5, gradient);
    }

    /**
     * Verification Agent (Agent 3)
     */
    async verificationAgent(decisionResult, context) {
        const verification = {
            agent: SAGE_CONFIG.agents.VERIFICATION,
            verified: false,
            confidence: 0,
            discrepancies: [],
            recommendations: [],
            timestamp: new Date().toISOString()
        };

        const { action, reasoning, confidence } = decisionResult;

        // Verify against known fraud patterns
        const patternVerification = await this.verifyAgainstPatterns(action, context);
        verification.discrepancies.push(...patternVerification.discrepancies);

        // Verify against historical data
        const historicalVerification = await this.verifyHistoricalData(action, context);
        verification.discrepancies.push(...historicalVerification.discrepancies);

        // Verify against business rules
        const ruleVerification = await this.verifyBusinessRules(action, context);
        verification.discrepancies.push(...ruleVerification.discrepancies);

        // Determine if verified
        verification.verified = verification.discrepancies.length === 0;
        verification.confidence = verification.verified ? confidence : confidence * 0.7;

        // Generate recommendations
        if (!verification.verified) {
            verification.recommendations = this.generateVerificationRecommendations(
                verification.discrepancies
            );
        }

        // Store agent state
        this.agentStates.set('verification', verification);

        return verification;
    }

    /**
     * Verify against patterns
     */
    async verifyAgainstPatterns(action, context) {
        const discrepancies = [];

        // Check if action matches known fraud patterns
        const fraudPatterns = await this.getFraudPatterns(context);
        
        for (const pattern of fraudPatterns) {
            if (action === pattern.recommendedAction && pattern.active) {
                discrepancies.push({
                    type: 'pattern_mismatch',
                    pattern: pattern.type,
                    details: `Action conflicts with known fraud pattern: ${pattern.type}`
                });
            }
        }

        return { discrepancies };
    }

    /**
     * Verify historical data
     */
    async verifyHistoricalData(action, context) {
        const discrepancies = [];

        const historicalSuccess = await this.getHistoricalSuccess(action, context);
        
        if (historicalSuccess < 0.5) {
            discrepancies.push({
                type: 'historical_concern',
                details: `Action has low historical success rate: ${(historicalSuccess * 100).toFixed(0)}%`
            });
        }

        return { discrepancies };
    }

    /**
     * Verify business rules
     */
    async verifyBusinessRules(action, context) {
        const discrepancies = [];

        const rules = await this.getBusinessRules(context);
        
        for (const rule of rules) {
            if (action === rule.action && !rule.valid) {
                discrepancies.push({
                    type: 'rule_violation',
                    rule: rule.name,
                    details: `Action violates business rule: ${rule.name}`
                });
            }
        }

        return { discrepancies };
    }

    /**
     * Agent Collaboration
     */
    async agentCollaboration(dataAnalysis, decision, verification) {
        const collaboration = {
            consensus: false,
            confidence: 0,
            finalAction: 'pending',
            agentContributions: {},
            timestamp: new Date().toISOString()
        };

        // Gather all agent outputs
        const agents = {
            dataAnalysis,
            decision,
            verification
        };

        collaboration.agentContributions = agents;

        // Check if all agents agree
        const actions = [
            dataAnalysis.layers.decision_making.action,
            decision.action,
            verification.verified ? decision.action : 'block'
        ];

        const uniqueActions = new Set(actions);
        collaboration.consensus = uniqueActions.size === 1;

        // Calculate collective confidence
        const confidences = [
            dataAnalysis.confidence,
            decision.confidence,
            verification.confidence
        ];

        collaboration.confidence = confidences.reduce((sum, c) => sum + c, 0) / confidences.length;

        // Determine final action
        if (collaboration.consensus) {
            collaboration.finalAction = actions[0];
        } else if (verification.verified) {
            collaboration.finalAction = decision.action;
        } else {
            collaboration.finalAction = 'block';
        }

        // Store collaboration
        this.agentCollaboration.set('current', collaboration);

        return collaboration;
    }

    /**
     * Self-Reflection
     */
    async selfReflection(collaborativeResult) {
        const reflection = {
            action: collaborativeResult.finalAction,
            confidence: collaborativeResult.confidence,
            improvements: [],
            lessons: [],
            timestamp: new Date().toISOString()
        };

        // Analyze false positives/negatives
        if (collaborativeResult.finalAction === 'block' && collaborativeResult.confidence < 0.6) {
            reflection.improvements.push('Increase verification for blocking decisions');
            reflection.lessons.push('Blocking with low confidence requires additional verification');
        }

        if (collaborativeResult.finalAction === 'approve' && collaborativeResult.confidence < 0.5) {
            reflection.improvements.push('Add more data sources for approval decisions');
            reflection.lessons.push('Approval with low confidence needs more validation');
        }

        // Check agent balance
        const contributions = collaborativeResult.agentContributions;
        const weights = {
            dataAnalysis: 0.3,
            decision: 0.4,
            verification: 0.3
        };

        // Analyze if agents are balanced
        const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0);
        if (totalWeight !== 1) {
            reflection.improvements.push('Re-balance agent weights for better collaboration');
        }

        // Store reflection
        this.selfReflectionLogs.push(reflection);

        return {
            ...collaborativeResult,
            reflection,
            agentStates: Array.from(this.agentStates.entries())
        };
    }

    // ============================================
    // HELPER METHODS
    // ============================================

    calculateAgentConfidence(layers) {
        const scores = [
            layers.data_quality.completeness,
            layers.feature_engineering ? 0.9 : 0.7,
            layers.pattern_detection.confidence,
            layers.anomaly_detection.confidence,
            layers.risk_assessment.confidence,
            layers.decision_making.confidence
        ];

        return scores.reduce((sum, s) => sum + s, 0) / scores.length;
    }

    async calculateRecallImpact(alternative, context) {
        // Simulate recall calculation
        const base = 0.7;
        const impact = alternative.action === 'block' ? 0.1 : -0.1;
        return Math.min(1, Math.max(0, base + impact));
    }

    async calculatePrecisionImpact(alternative, context) {
        // Simulate precision calculation
        const base = 0.8;
        const impact = alternative.action === 'review' ? 0.05 : 0;
        return Math.min(1, Math.max(0, base + impact));
    }

    async getHistoricalPerformance(action) {
        try {
            const [result] = await db.query(
                `SELECT AVG(confidence) as avg_confidence 
                 FROM sage_detection_results 
                 WHERE final_action = ? 
                 AND timestamp > DATE_SUB(NOW(), INTERVAL 30 DAY)`,
                [action]
            );
            return result[0]?.avg_confidence || 0.5;
        } catch (error) {
            console.error('Historical performance error:', error);
            return 0.5;
        }
    }

    async getFraudPatterns(context) {
        try {
            const [patterns] = await db.query(
                `SELECT * FROM sage_fraud_patterns 
                 WHERE active = 1 
                 AND category = ?`,
                [context.category || 'all']
            );
            return patterns;
        } catch (error) {
            console.error('Fraud patterns error:', error);
            return [];
        }
    }

    async getHistoricalSuccess(action, context) {
        try {
            const [result] = await db.query(
                `SELECT AVG(success) as success_rate 
                 FROM sage_detection_results 
                 WHERE final_action = ? 
                 AND verified = 1 
                 AND timestamp > DATE_SUB(NOW(), INTERVAL 30 DAY)`,
                [action]
            );
            return result[0]?.success_rate || 0.5;
        } catch (error) {
            console.error('Historical success error:', error);
            return 0.5;
        }
    }

    async getBusinessRules(context) {
        try {
            const [rules] = await db.query(
                `SELECT * FROM sage_business_rules 
                 WHERE active = 1 
                 AND (category = ? OR category = 'all')`,
                [context.category || 'all']
            );
            return rules;
        } catch (error) {
            console.error('Business rules error:', error);
            return [];
        }
    }

    generateVerificationRecommendations(discrepancies) {
        const recommendations = [];

        for (const disc of discrepancies) {
            if (disc.type === 'pattern_mismatch') {
                recommendations.push('Review transaction for known fraud patterns');
            }
            if (disc.type === 'historical_concern') {
                recommendations.push('Check historical transaction history');
            }
            if (disc.type === 'rule_violation') {
                recommendations.push('Verify compliance with business rules');
            }
        }

        return recommendations;
    }

    /**
     * Store detection result
     */
    async storeDetectionResult(transactionData, result, context) {
        try {
            await db.query(
                `INSERT INTO sage_detection_results 
                 (transaction_id, data_analysis, decision_making, verification,
                  final_action, confidence, verified, reflection, context, timestamp)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
                [
                    transactionData.id || crypto.randomUUID(),
                    JSON.stringify(result.agentStates.find(a => a[0] === 'data_analysis')[1]),
                    JSON.stringify(result.agentStates.find(a => a[0] === 'decision_making')[1]),
                    JSON.stringify(result.agentStates.find(a => a[0] === 'verification')[1]),
                    result.finalAction,
                    result.confidence,
                    result.verified ? 1 : 0,
                    JSON.stringify(result.reflection),
                    JSON.stringify(context)
                ]
            );
        } catch (error) {
            console.error('Store result error:', error);
        }
    }

    /**
     * Get statistics
     */
    async getStatistics() {
        try {
            const [stats] = await db.query(
                `SELECT 
                    COUNT(*) as total_detections,
                    AVG(confidence) as avg_confidence,
                    SUM(CASE WHEN verified = 1 THEN 1 ELSE 0 END) as verified_count,
                    SUM(CASE WHEN final_action = 'block' THEN 1 ELSE 0 END) as blocked_count,
                    SUM(CASE WHEN final_action = 'approve' THEN 1 ELSE 0 END) as approved_count,
                    AVG(CASE WHEN verified = 1 THEN confidence ELSE 0 END) as verified_confidence
                 FROM sage_detection_results
                 WHERE timestamp > DATE_SUB(NOW(), INTERVAL 24 HOUR)`
            );

            return {
                ...stats[0],
                verification_rate: stats[0].total_detections > 0 
                    ? ((stats[0].verified_count / stats[0].total_detections) * 100).toFixed(2) + '%'
                    : '0%',
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            console.error('Statistics error:', error);
            throw error;
        }
    }

    getStatus() {
        return {
            agentStates: this.agentStates.size,
            detectionResults: this.detectionResults.length,
            agentCollaboration: this.agentCollaboration.size,
            selfReflectionLogs: this.selfReflectionLogs.length,
            config: SAGE_CONFIG
        };
    }
}

// ============================================
// DATA DIAGNOSTIC TREE CLASS
// ============================================

class DataDiagnosticTree {
    constructor() {
        this.tree = {};
    }

    process(data) {
        // Six-layer processing
        const layers = {};
        
        // L1: Data Quality
        layers.l1_data_quality = this.checkDataQuality(data);
        // L2: Feature Engineering
        layers.l2_feature_engineering = this.engineerFeatures(data);
        // L3: Pattern Detection
        layers.l3_pattern_detection = this.detectPatterns(data);
        // L4: Anomaly Detection
        layers.l4_anomaly_detection = this.detectAnomalies(data);
        // L5: Risk Assessment
        layers.l5_risk_assessment = this.assessRisk(data);
        // L6: Decision Making
        layers.l6_decision_making = this.makeDecision(layers);

        return layers;
    }

    checkDataQuality(data) { return {}; }
    engineerFeatures(data) { return {}; }
    detectPatterns(data) { return {}; }
    detectAnomalies(data) { return {}; }
    assessRisk(data) { return {}; }
    makeDecision(layers) { return {}; }
}

// ============================================
// MARKOV DECISION PROCESS CLASS
// ============================================

class MarkovDecisionProcess {
    constructor() {
        this.states = [];
        this.actions = ['block', 'review', 'approve'];
        this.transitions = {};
        this.rewards = {};
        this.policy = {};
        this.iteration = 0;
    }

    async generateAlternatives(layers, anomalies, context) {
        const alternatives = [];
        
        // Generate alternatives based on current state
        const state = this.getCurrentState(layers, anomalies, context);
        
        for (const action of this.actions) {
            const reward = this.calculateReward(state, action);
            const transition = this.getTransition(state, action);
            
            alternatives.push({
                action,
                reward,
                transition,
                confidence: this.calculateConfidence(state, action, reward)
            });
        }

        return alternatives;
    }

    getCurrentState(layers, anomalies, context) {
        return {
            riskScore: layers.l5_risk_assessment?.score || 0,
            anomalyCount: anomalies.detected?.length || 0,
            patternConfidence: layers.l3_pattern_detection?.confidence || 0
        };
    }

    calculateReward(state, action) {
        // Reward based on action appropriateness
        let reward = 0;

        if (action === 'block' && state.riskScore > 0.7) reward += 1;
        if (action === 'review' && state.riskScore > 0.4 && state.riskScore <= 0.7) reward += 1;
        if (action === 'approve' && state.riskScore <= 0.4) reward += 1;

        return reward;
    }

    getTransition(state, action) {
        // Simulate transition probabilities
        return {
            nextState: { ...state },
            probability: 0.8 + Math.random() * 0.2
        };
    }

    calculateConfidence(state, action, reward) {
        // Confidence based on state and reward
        let confidence = 0.5;

        if (reward > 0.7) confidence += 0.3;
        if (state.riskScore > 0.3 && state.riskScore < 0.8) confidence += 0.2;

        return Math.min(1, confidence);
    }
}

// ============================================
// EXPORT
// ============================================

module.exports = new SAGEFraudDetectionService();