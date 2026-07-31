// backend/services/lowLatencyFraudDetectionService.js
const db = require('../config/db').promise;
const crypto = require('crypto');

// ============================================
// CONFIGURATION
// ============================================

const FRAUD_CONFIG = {
    // 42 structured features
    features: {
        PROMPT_CHARACTERISTICS: 'prompt_characteristics',      // 10 features
        SESSION_DYNAMICS: 'session_dynamics',                  // 8 features
        TOOL_USAGE: 'tool_usage',                              // 6 features
        EXECUTION_CONTEXT: 'execution_context',                // 8 features
        FRAUD_SIGNALS: 'fraud_signals'                         // 10 features
    },
    
    // Feature weights
    weights: {
        prompt_characteristics: 0.25,
        session_dynamics: 0.25,
        tool_usage: 0.20,
        execution_context: 0.15,
        fraud_signals: 0.15
    },
    
    // Detection thresholds
    thresholds: {
        LOW: 0,
        MEDIUM: 35,
        HIGH: 65,
        CRITICAL: 80
    },
    
    // Performance
    targetLatency: 50, // milliseconds
    maxTrajectoryLength: 50,
    batchSize: 10
};

// ============================================
// LOW LATENCY FRAUD DETECTION CLASS
// ============================================

class LowLatencyFraudDetectionService {
    constructor() {
        this.trajectories = new Map();
        this.riskScores = new Map();
        this.detectionResults = [];
        this.featureCache = new Map();
        this.batchBuffer = [];
        this.processingTime = 0;
        this.totalDetections = 0;
    }

    /**
     * Process interaction with low-latency detection
     */
    async processInteraction(sessionId, interactionData) {
        const startTime = Date.now();
        
        const trajectory = this.getOrCreateTrajectory(sessionId);
        
        // Extract 42 features
        const features = await this.extractAllFeatures(interactionData);
        
        // Add to trajectory
        trajectory.addInteraction({
            ...interactionData,
            features,
            timestamp: Date.now()
        });

        // Calculate risk score
        const riskScore = this.calculateRiskScore(features);
        
        // Update trajectory risk
        const trajectoryRisk = this.updateTrajectoryRisk(trajectory, riskScore);
        
        // Detect escalation patterns
        const escalation = this.detectEscalation(trajectory);
        
        // Generate alert if needed
        const alert = await this.generateAlert(sessionId, trajectory, trajectoryRisk, escalation);
        
        // Store detection
        await this.storeDetection(sessionId, trajectory, trajectoryRisk, alert);
        
        // Track performance
        const processingTime = Date.now() - startTime;
        this.processingTime = (this.processingTime + processingTime) / 2;
        this.totalDetections++;

        return {
            sessionId,
            riskScore,
            trajectoryRisk,
            escalation,
            alert,
            features,
            processingTime,
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Extract all 42 features
     */
    async extractAllFeatures(interactionData) {
        const features = {
            // 1. Prompt Characteristics (10 features)
            prompt: this.extractPromptFeatures(interactionData.prompt),
            
            // 2. Session Dynamics (8 features)
            session: this.extractSessionFeatures(interactionData),
            
            // 3. Tool Usage (6 features)
            tools: this.extractToolFeatures(interactionData),
            
            // 4. Execution Context (8 features)
            context: this.extractContextFeatures(interactionData),
            
            // 5. Fraud Signals (10 features)
            fraud: this.extractFraudSignals(interactionData),
            
            timestamp: Date.now()
        };

        return features;
    }

    // ============================================
    // 1. PROMPT CHARACTERISTICS (10 features)
    // ============================================

    extractPromptFeatures(prompt) {
        if (!prompt) {
            return this.getDefaultPromptFeatures();
        }

        return {
            length: prompt.length,
            wordCount: prompt.split(' ').length,
            specialChars: (prompt.match(/[^a-zA-Z0-9\s]/g) || []).length,
            uppercaseRatio: (prompt.match(/[A-Z]/g) || []).length / (prompt.length || 1),
            digitRatio: (prompt.match(/[0-9]/g) || []).length / (prompt.length || 1),
            sentimentScore: this.calculateSentiment(prompt),
            urgencyScore: this.detectUrgency(prompt),
            instructionCount: (prompt.match(/ignore|override|bypass|system|admin|forget/i) || []).length,
            repetitionScore: this.detectRepetition(prompt),
            lengthDeviation: this.calculateLengthDeviation(prompt)
        };
    }

    getDefaultPromptFeatures() {
        return {
            length: 0,
            wordCount: 0,
            specialChars: 0,
            uppercaseRatio: 0,
            digitRatio: 0,
            sentimentScore: 0,
            urgencyScore: 0,
            instructionCount: 0,
            repetitionScore: 0,
            lengthDeviation: 0
        };
    }

    // ============================================
    // 2. SESSION DYNAMICS (8 features)
    // ============================================

    extractSessionFeatures(interactionData) {
        const now = Date.now();
        const sessionStart = interactionData.sessionStart || now;
        const sessionDuration = (now - sessionStart) / 1000;

        return {
            sessionDuration,
            interactionsInSession: interactionData.interactionCount || 0,
            averageTimeBetweenInteractions: this.calculateAverageTime(interactionData),
            timeSinceLastInteraction: interactionData.lastInteractionTime 
                ? (now - interactionData.lastInteractionTime) / 1000 
                : 0,
            actionCount: interactionData.actions?.length || 0,
            uniqueActions: new Set(interactionData.actions || []).size,
            navigationDepth: interactionData.navigationDepth || 0,
            sessionStability: this.calculateSessionStability(interactionData)
        };
    }

    // ============================================
    // 3. TOOL USAGE (6 features)
    // ============================================

    extractToolFeatures(interactionData) {
        const tools = interactionData.tools || [];
        const toolCalls = interactionData.toolCalls || [];

        return {
            toolCount: tools.length,
            uniqueTools: new Set(tools).size,
            toolCallFrequency: toolCalls.length / (interactionData.interactionCount || 1),
            averageToolArguments: this.calculateAverageToolArguments(toolCalls),
            suspiciousToolPatterns: this.detectSuspiciousTools(tools),
            automatedToolUsage: this.detectAutomatedTools(tools)
        };
    }

    // ============================================
    // 4. EXECUTION CONTEXT (8 features)
    // ============================================

    extractContextFeatures(interactionData) {
        return {
            timeOfDay: new Date().getHours(),
            dayOfWeek: new Date().getDay(),
            deviceType: this.detectDeviceType(interactionData.userAgent),
            browserFingerprint: interactionData.fingerprint || 'unknown',
            ipReputation: interactionData.ipReputation || 0,
            locationConsistency: this.calculateLocationConsistency(interactionData),
            networkType: interactionData.networkType || 'unknown',
            contextSwitchCount: interactionData.contextSwitchCount || 0
        };
    }

    // ============================================
    // 5. FRAUD SIGNALS (10 features)
    // ============================================

    extractFraudSignals(interactionData) {
        return {
            velocityScore: this.calculateVelocity(interactionData),
            burstScore: this.calculateBurstiness(interactionData),
            anomalyScore: this.calculateAnomaly(interactionData),
            patternDeviation: this.calculatePatternDeviation(interactionData),
            mandateViolations: interactionData.mandateViolations || 0,
            unusualNavigation: this.detectUnusualNavigation(interactionData),
            rapidCheckout: this.detectRapidCheckout(interactionData),
            formCompletionTime: interactionData.formCompletionTime || 0,
            mouseMovementScore: interactionData.mouseMovementScore || 0,
            humanLikelihood: this.calculateHumanLikelihood(interactionData)
        };
    }

    // ============================================
    // FEATURE CALCULATION HELPERS
    // ============================================

    calculateSentiment(text) {
        const positive = ['great', 'good', 'excellent', 'love', 'best', 'amazing'];
        const negative = ['bad', 'poor', 'terrible', 'worst', 'hate', 'awful'];
        
        let score = 0;
        const words = text.toLowerCase().split(' ');
        
        for (const word of words) {
            if (positive.includes(word)) score += 1;
            if (negative.includes(word)) score -= 1;
        }
        
        return score;
    }

    detectUrgency(text) {
        const urgentWords = ['urgent', 'immediate', 'asap', 'quick', 'fast', 'now', 'emergency'];
        return urgentWords.filter(word => text.toLowerCase().includes(word)).length;
    }

    detectRepetition(text) {
        const words = text.toLowerCase().split(' ');
        const wordCount = {};
        let maxRepetition = 0;
        
        for (const word of words) {
            wordCount[word] = (wordCount[word] || 0) + 1;
            maxRepetition = Math.max(maxRepetition, wordCount[word]);
        }
        
        return words.length > 0 ? maxRepetition / words.length : 0;
    }

    calculateLengthDeviation(prompt) {
        // Compare to average prompt length
        const avgLength = 100; // Placeholder
        return prompt.length - avgLength;
    }

    calculateAverageTime(interactionData) {
        const times = interactionData.interactionTimes || [];
        if (times.length < 2) return 0;
        
        let total = 0;
        for (let i = 1; i < times.length; i++) {
            total += (times[i] - times[i-1]);
        }
        return total / (times.length - 1);
    }

    calculateSessionStability(interactionData) {
        const actions = interactionData.actions || [];
        if (actions.length < 2) return 1;
        
        let changes = 0;
        for (let i = 1; i < actions.length; i++) {
            if (actions[i] !== actions[i-1]) changes++;
        }
        return 1 - (changes / actions.length);
    }

    calculateAverageToolArguments(toolCalls) {
        if (toolCalls.length === 0) return 0;
        let totalArgs = 0;
        for (const call of toolCalls) {
            totalArgs += (call.arguments || []).length;
        }
        return totalArgs / toolCalls.length;
    }

    detectSuspiciousTools(tools) {
        const suspicious = ['eval', 'exec', 'system', 'shell', 'child_process'];
        return tools.filter(t => suspicious.some(s => t.includes(s))).length;
    }

    detectAutomatedTools(tools) {
        const automated = ['puppeteer', 'selenium', 'playwright', 'headless'];
        return tools.filter(t => automated.some(s => t.includes(s))).length;
    }

    detectDeviceType(userAgent) {
        if (!userAgent) return 'unknown';
        if (userAgent.includes('Mobile')) return 'mobile';
        if (userAgent.includes('Tablet')) return 'tablet';
        if (userAgent.includes('Headless')) return 'headless';
        return 'desktop';
    }

    calculateLocationConsistency(interactionData) {
        const locations = interactionData.locations || [];
        if (locations.length < 2) return 1;
        
        const first = locations[0];
        let consistent = true;
        for (const loc of locations) {
            if (Math.abs(loc.lat - first.lat) > 100 || Math.abs(loc.lng - first.lng) > 100) {
                consistent = false;
                break;
            }
        }
        return consistent ? 1 : 0;
    }

    calculateVelocity(interactionData) {
        const interactions = interactionData.interactionCount || 0;
        const duration = (Date.now() - (interactionData.sessionStart || Date.now())) / 1000;
        return duration > 0 ? interactions / duration : 0;
    }

    calculateBurstiness(interactionData) {
        const times = interactionData.interactionTimes || [];
        if (times.length < 3) return 0;
        
        let bursts = 0;
        for (let i = 2; i < times.length; i++) {
            const interval1 = times[i-1] - times[i-2];
            const interval2 = times[i] - times[i-1];
            if (interval1 < 1000 && interval2 < 1000) bursts++;
        }
        return times.length > 0 ? bursts / times.length : 0;
    }

    calculateAnomaly(interactionData) {
        let anomalyScore = 0;
        
        const times = interactionData.interactionTimes || [];
        if (times.length > 2) {
            const intervals = [];
            for (let i = 1; i < times.length; i++) {
                intervals.push(times[i] - times[i-1]);
            }
            const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
            const variance = intervals.reduce((a, b) => a + Math.pow(b - avg, 2), 0) / intervals.length;
            if (variance / (avg || 1) > 2) anomalyScore += 1;
        }
        
        const actions = interactionData.actions || [];
        if (actions.length > 5) {
            const uniqueActions = new Set(actions);
            if (uniqueActions.size < actions.length * 0.5) anomalyScore += 1;
        }
        
        return anomalyScore;
    }

    calculatePatternDeviation(interactionData) {
        const baseline = interactionData.baseline || {};
        const current = interactionData;
        
        let deviation = 0;
        
        if (baseline.avgDuration) {
            deviation += Math.abs((current.duration || 0) - baseline.avgDuration) / (baseline.avgDuration || 1);
        }
        if (baseline.avgInteractions) {
            deviation += Math.abs((current.interactionCount || 0) - baseline.avgInteractions) / (baseline.avgInteractions || 1);
        }
        
        return deviation;
    }

    detectUnusualNavigation(interactionData) {
        const path = interactionData.path || [];
        if (path.includes('checkout') && !path.includes('product')) {
            return 1;
        }
        return 0;
    }

    detectRapidCheckout(interactionData) {
        const path = interactionData.path || [];
        const checkoutIndex = path.indexOf('checkout');
        if (checkoutIndex === -1) return 0;
        
        const timeToCheckout = (interactionData.timestamps?.[checkoutIndex] || 0) - 
                              (interactionData.sessionStart || 0);
        return timeToCheckout < 10000 ? 1 : 0;
    }

    calculateHumanLikelihood(interactionData) {
        let score = 0;
        
        if (interactionData.mouseMovements) score += 20;
        if (interactionData.typingPatterns) score += 20;
        if (interactionData.navigationPatterns) score += 20;
        if (interactionData.sessionDuration > 60000) score += 20;
        if (interactionData.actionVariety > 3) score += 20;
        
        return score;
    }

    // ============================================
    // RISK CALCULATION
    // ============================================

    calculateRiskScore(features) {
        let riskScore = 0;
        const weights = FRAUD_CONFIG.weights;

        // Prompt risk (25%)
        const promptRisk = this.calculatePromptRisk(features.prompt);
        riskScore += promptRisk * weights.prompt_characteristics;

        // Session risk (25%)
        const sessionRisk = this.calculateSessionRisk(features.session);
        riskScore += sessionRisk * weights.session_dynamics;

        // Tool risk (20%)
        const toolRisk = this.calculateToolRisk(features.tools);
        riskScore += toolRisk * weights.tool_usage;

        // Context risk (15%)
        const contextRisk = this.calculateContextRisk(features.context);
        riskScore += contextRisk * weights.execution_context;

        // Fraud risk (15%)
        const fraudRisk = this.calculateFraudRisk(features.fraud);
        riskScore += fraudRisk * weights.fraud_signals;

        return Math.round(riskScore);
    }

    calculatePromptRisk(promptFeatures) {
        let risk = 0;
        if (promptFeatures.instructionCount > 3) risk += 30;
        if (promptFeatures.instructionCount > 5) risk += 20;
        if (promptFeatures.urgencyScore > 3) risk += 20;
        if (promptFeatures.repetitionScore > 0.5) risk += 15;
        if (promptFeatures.uppercaseRatio > 0.5) risk += 15;
        return Math.min(100, risk);
    }

    calculateSessionRisk(sessionFeatures) {
        let risk = 0;
        if (sessionFeatures.sessionDuration < 10) risk += 20;
        if (sessionFeatures.interactionsInSession > 20) risk += 20;
        if (sessionFeatures.sessionStability < 0.3) risk += 20;
        if (sessionFeatures.averageTimeBetweenInteractions < 1000) risk += 20;
        return Math.min(100, risk);
    }

    calculateToolRisk(toolFeatures) {
        let risk = 0;
        if (toolFeatures.suspiciousToolPatterns > 0) risk += 30;
        if (toolFeatures.automatedToolUsage > 0) risk += 25;
        if (toolFeatures.toolCallFrequency > 5) risk += 25;
        return Math.min(100, risk);
    }

    calculateContextRisk(contextFeatures) {
        let risk = 0;
        if (contextFeatures.deviceType === 'headless') risk += 30;
        if (contextFeatures.ipReputation < 30) risk += 25;
        if (contextFeatures.locationConsistency < 0.5) risk += 20;
        if (contextFeatures.timeOfDay < 3 || contextFeatures.timeOfDay > 22) risk += 15;
        return Math.min(100, risk);
    }

    calculateFraudRisk(fraudSignals) {
        let risk = 0;
        if (fraudSignals.velocityScore > 10) risk += 25;
        if (fraudSignals.velocityScore > 20) risk += 20;
        if (fraudSignals.burstScore > 0.5) risk += 20;
        if (fraudSignals.anomalyScore > 3) risk += 20;
        if (fraudSignals.patternDeviation > 1) risk += 15;
        return Math.min(100, risk);
    }

    // ============================================
    // TRAJECTORY MANAGEMENT
    // ============================================

    getOrCreateTrajectory(sessionId) {
        if (!this.trajectories.has(sessionId)) {
            this.trajectories.set(sessionId, new Trajectory(sessionId));
        }
        return this.trajectories.get(sessionId);
    }

    updateTrajectoryRisk(trajectory, interactionRisk) {
        const history = trajectory.getRiskHistory();
        history.push(interactionRisk);
        
        if (history.length > FRAUD_CONFIG.maxTrajectoryLength) {
            history.shift();
        }
        
        const trend = this.calculateTrend(history);
        const average = history.reduce((a, b) => a + b, 0) / history.length;
        const maxRisk = Math.max(...history);
        
        return {
            currentRisk: interactionRisk,
            averageRisk: Math.round(average),
            maxRisk: Math.round(maxRisk),
            trend: Math.round(trend),
            historyLength: history.length,
            riskLevel: this.getRiskLevel(interactionRisk)
        };
    }

    calculateTrend(history) {
        if (history.length < 3) return 0;
        
        const recent = history.slice(-3);
        const older = history.slice(0, -3);
        
        const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
        const olderAvg = older.length > 0 ? older.reduce((a, b) => a + b, 0) / older.length : 0;
        
        return recentAvg - olderAvg;
    }

    getRiskLevel(riskScore) {
        if (riskScore >= FRAUD_CONFIG.thresholds.CRITICAL) return 'critical';
        if (riskScore >= FRAUD_CONFIG.thresholds.HIGH) return 'high';
        if (riskScore >= FRAUD_CONFIG.thresholds.MEDIUM) return 'medium';
        return 'low';
    }

    detectEscalation(trajectory) {
        const history = trajectory.getRiskHistory();
        if (history.length < 5) return null;
        
        const escalation = {
            detected: false,
            severity: 'low',
            pattern: [],
            details: {}
        };
        
        let increasingCount = 0;
        let totalIncrease = 0;
        
        for (let i = 1; i < history.length; i++) {
            if (history[i] > history[i-1]) {
                increasingCount++;
                totalIncrease += history[i] - history[i-1];
            }
        }
        
        if (increasingCount > history.length * 0.6 && totalIncrease > 20) {
            escalation.detected = true;
            escalation.severity = totalIncrease > 40 ? 'high' : 'medium';
            escalation.pattern.push('gradual_increase');
            escalation.details.increaseRate = (totalIncrease / history.length).toFixed(2);
        }
        
        const maxRisk = Math.max(...history);
        const avgRisk = history.reduce((a, b) => a + b, 0) / history.length;
        if (maxRisk - avgRisk > 30) {
            escalation.detected = true;
            escalation.severity = maxRisk - avgRisk > 50 ? 'critical' : 'high';
            escalation.pattern.push('sudden_spike');
            escalation.details.spikeMagnitude = (maxRisk - avgRisk).toFixed(2);
        }
        
        return escalation;
    }

    async generateAlert(sessionId, trajectory, trajectoryRisk, escalation) {
        if (!escalation || !escalation.detected) {
            return null;
        }
        
        const alert = {
            sessionId,
            riskLevel: trajectoryRisk.riskLevel,
            escalationLevel: escalation.severity,
            pattern: escalation.pattern,
            details: escalation.details,
            timestamp: new Date().toISOString()
        };
        
        await this.storeAlert(alert);
        
        if (escalation.severity === 'critical') {
            console.error(`🚨 CRITICAL: Escalation detected in session ${sessionId}`);
            console.error(`Risk Level: ${trajectoryRisk.riskLevel}`);
            console.error(`Pattern: ${escalation.pattern.join(', ')}`);
        }
        
        return alert;
    }

    async storeDetection(sessionId, trajectory, trajectoryRisk, alert) {
        try {
            await db.query(
                `INSERT INTO low_latency_detections 
                 (session_id, risk_history, current_risk, average_risk, 
                  max_risk, trend, risk_level, alert_data, timestamp)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
                [
                    sessionId,
                    JSON.stringify(trajectory.getRiskHistory()),
                    trajectoryRisk.currentRisk,
                    trajectoryRisk.averageRisk,
                    trajectoryRisk.maxRisk,
                    trajectoryRisk.trend,
                    trajectoryRisk.riskLevel,
                    alert ? JSON.stringify(alert) : null
                ]
            );
        } catch (error) {
            console.error('Store detection error:', error);
        }
    }

    async storeAlert(alert) {
        try {
            await db.query(
                `INSERT INTO low_latency_alerts 
                 (session_id, risk_level, escalation_level, pattern, details, timestamp)
                 VALUES (?, ?, ?, ?, ?, NOW())`,
                [
                    alert.sessionId,
                    alert.riskLevel,
                    alert.escalationLevel,
                    JSON.stringify(alert.pattern),
                    JSON.stringify(alert.details)
                ]
            );
        } catch (error) {
            console.error('Store alert error:', error);
        }
    }

    // ============================================
    // STATISTICS
    // ============================================

    async getStatistics() {
        try {
            const [stats] = await db.query(
                `SELECT 
                    COUNT(*) as total_detections,
                    AVG(current_risk) as avg_risk,
                    SUM(CASE WHEN risk_level = 'critical' THEN 1 ELSE 0 END) as critical_sessions,
                    SUM(CASE WHEN risk_level = 'high' THEN 1 ELSE 0 END) as high_sessions,
                    AVG(trend) as avg_trend
                 FROM low_latency_detections
                 WHERE timestamp > DATE_SUB(NOW(), INTERVAL 24 HOUR)`
            );

            const [alertStats] = await db.query(
                `SELECT 
                    COUNT(*) as total_alerts,
                    SUM(CASE WHEN escalation_level = 'critical' THEN 1 ELSE 0 END) as critical_alerts
                 FROM low_latency_alerts
                 WHERE timestamp > DATE_SUB(NOW(), INTERVAL 24 HOUR)`
            );

            return {
                detections: stats[0],
                alerts: alertStats[0],
                performance: {
                    avgProcessingTime: Math.round(this.processingTime),
                    totalDetections: this.totalDetections,
                    targetLatency: FRAUD_CONFIG.targetLatency
                },
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
            riskScores: this.riskScores.size,
            detectionResults: this.detectionResults.length,
            featureCache: this.featureCache.size,
            batchBuffer: this.batchBuffer.length,
            config: FRAUD_CONFIG
        };
    }
}

// ============================================
// TRAJECTORY CLASS
// ============================================

class Trajectory {
    constructor(sessionId) {
        this.sessionId = sessionId;
        this.interactions = [];
        this.riskHistory = [];
        this.createdAt = Date.now();
        this.updatedAt = Date.now();
    }

    addInteraction(interaction) {
        this.interactions.push(interaction);
        this.updatedAt = Date.now();
        
        if (this.interactions.length > FRAUD_CONFIG.maxTrajectoryLength) {
            this.interactions.shift();
        }
    }

    getRiskHistory() {
        return this.riskHistory;
    }

    addRiskScore(score) {
        this.riskHistory.push(score);
        if (this.riskHistory.length > FRAUD_CONFIG.maxTrajectoryLength) {
            this.riskHistory.shift();
        }
    }

    getInteractionCount() {
        return this.interactions.length;
    }

    getDuration() {
        return this.updatedAt - this.createdAt;
    }
}

// ============================================
// EXPORT
// ============================================

module.exports = new LowLatencyFraudDetectionService();