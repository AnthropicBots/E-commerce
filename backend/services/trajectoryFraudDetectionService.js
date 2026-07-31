// backend/services/trajectoryFraudDetectionService.js
const db = require('../config/db').promise;
const crypto = require('crypto');

// ============================================
// CONFIGURATION
// ============================================

const TRAJECTORY_CONFIG = {
    // Feature categories (42 structured features)
    features: {
        PROMPT_CHARACTERISTICS: 'prompt_characteristics',
        SESSION_DYNAMICS: 'session_dynamics',
        TOOL_USAGE: 'tool_usage',
        EXECUTION_CONTEXT: 'execution_context',
        FRAUD_SIGNALS: 'fraud_signals'
    },
    
    // Risk thresholds
    riskThresholds: {
        LOW: 0,
        MEDIUM: 30,
        HIGH: 60,
        CRITICAL: 80
    },
    
    // Trajectory monitoring
    maxTrajectoryLength: 50,
    trajectoryWindow: 3600, // 1 hour in seconds
    escalationThreshold: 3, // number of risk increases before alert
    
    // Feature weights
    featureWeights: {
        prompt_characteristics: 0.25,
        session_dynamics: 0.25,
        tool_usage: 0.20,
        execution_context: 0.15,
        fraud_signals: 0.15
    }
};

// ============================================
// TRAJECTORY FRAUD DETECTION CLASS
// ============================================

class TrajectoryFraudDetectionService {
    constructor() {
        this.trajectories = new Map();
        this.riskScores = new Map();
        this.escalationAlerts = [];
        this.featureCache = new Map();
    }

    /**
     * Process interaction and detect trajectory-based fraud
     */
    async processInteraction(sessionId, interactionData) {
        const trajectory = this.getOrCreateTrajectory(sessionId);
        
        // Extract features from interaction
        const features = await this.extractFeatures(interactionData);
        
        // Add to trajectory
        trajectory.addInteraction({
            ...interactionData,
            features,
            timestamp: Date.now()
        });

        // Calculate risk score for this interaction
        const riskScore = this.calculateInteractionRisk(features);
        
        // Update trajectory risk
        const trajectoryRisk = this.updateTrajectoryRisk(trajectory, riskScore);
        
        // Check for escalation patterns
        const escalation = this.detectEscalation(trajectory);
        
        // Generate alert if needed
        const alert = await this.generateAlert(sessionId, trajectory, trajectoryRisk, escalation);
        
        // Store in database
        await this.storeTrajectoryData(sessionId, trajectory, trajectoryRisk, alert);

        return {
            sessionId,
            trajectoryRisk,
            escalation,
            alert,
            features,
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Extract 42 structured features from interaction
     */
    async extractFeatures(interactionData) {
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

    /**
     * Extract prompt characteristics
     */
    extractPromptFeatures(prompt) {
        if (!prompt) {
            return this.getDefaultPromptFeatures();
        }

        return {
            length: prompt.length,
            wordCount: prompt.split(' ').length,
            specialChars: (prompt.match(/[^a-zA-Z0-9\s]/g) || []).length,
            uppercaseRatio: (prompt.match(/[A-Z]/g) || []).length / prompt.length,
            digitRatio: (prompt.match(/[0-9]/g) || []).length / prompt.length,
            sentimentScore: this.calculateSentiment(prompt),
            urgencyScore: this.detectUrgency(prompt),
            instructionCount: (prompt.match(/ignore|override|bypass|system|admin/gi) || []).length,
            repetitionScore: this.detectRepetition(prompt),
            lengthDeviation: 0 // Will be calculated relative to baseline
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

    /**
     * Extract session dynamics
     */
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

    /**
     * Extract tool usage patterns
     */
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

    /**
     * Extract execution context
     */
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

    /**
     * Extract fraud signals
     */
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
        // Simple sentiment analysis
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
        
        return maxRepetition / words.length;
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
        
        // Simple consistency check - all locations should be close
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
        return bursts / times.length;
    }

    calculateAnomaly(interactionData) {
        // Simple anomaly detection - check for unusual patterns
        let anomalyScore = 0;
        
        // Check for unusual timing
        const times = interactionData.interactionTimes || [];
        if (times.length > 2) {
            const intervals = [];
            for (let i = 1; i < times.length; i++) {
                intervals.push(times[i] - times[i-1]);
            }
            const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
            const variance = intervals.reduce((a, b) => a + Math.pow(b - avg, 2), 0) / intervals.length;
            if (variance / avg > 2) anomalyScore += 1;
        }
        
        // Check for rapid navigation
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
        
        // Compare key metrics with baseline
        if (baseline.avgDuration) {
            deviation += Math.abs((current.duration || 0) - baseline.avgDuration) / baseline.avgDuration;
        }
        if (baseline.avgInteractions) {
            deviation += Math.abs((current.interactionCount || 0) - baseline.avgInteractions) / baseline.avgInteractions;
        }
        
        return deviation;
    }

    detectUnusualNavigation(interactionData) {
        const path = interactionData.path || [];
        // Check for direct checkout without product views
        if (path.includes('checkout') && !path.includes('product')) {
            return 1;
        }
        return 0;
    }

    detectRapidCheckout(interactionData) {
        const path = interactionData.path || [];
        const checkoutIndex = path.indexOf('checkout');
        if (checkoutIndex === -1) return 0;
        
        // Check if checkout happened too quickly
        const timeToCheckout = (interactionData.timestamps?.[checkoutIndex] || 0) - 
                              (interactionData.sessionStart || 0);
        return timeToCheckout < 10000 ? 1 : 0;
    }

    calculateHumanLikelihood(interactionData) {
        let score = 0;
        
        // Mouse movements
        if (interactionData.mouseMovements) {
            score += 20;
        }
        
        // Typing patterns
        if (interactionData.typingPatterns) {
            score += 20;
        }
        
        // Navigation patterns
        if (interactionData.navigationPatterns) {
            score += 20;
        }
        
        // Session duration
        if (interactionData.sessionDuration > 60000) {
            score += 20;
        }
        
        // Interaction variety
        if (interactionData.actionVariety > 3) {
            score += 20;
        }
        
        return score;
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

    calculateInteractionRisk(features) {
        let riskScore = 0;
        
        // Apply weights to different feature categories
        const weights = TRAJECTORY_CONFIG.featureWeights;
        
        // Prompt characteristics (25%)
        if (features.prompt) {
            const promptRisk = this.calculatePromptRisk(features.prompt);
            riskScore += promptRisk * weights.prompt_characteristics;
        }
        
        // Session dynamics (25%)
        if (features.session) {
            const sessionRisk = this.calculateSessionRisk(features.session);
            riskScore += sessionRisk * weights.session_dynamics;
        }
        
        // Tool usage (20%)
        if (features.tools) {
            const toolRisk = this.calculateToolRisk(features.tools);
            riskScore += toolRisk * weights.tool_usage;
        }
        
        // Execution context (15%)
        if (features.context) {
            const contextRisk = this.calculateContextRisk(features.context);
            riskScore += contextRisk * weights.execution_context;
        }
        
        // Fraud signals (15%)
        if (features.fraud) {
            const fraudRisk = this.calculateFraudRisk(features.fraud);
            riskScore += fraudRisk * weights.fraud_signals;
        }
        
        return Math.round(riskScore);
    }

    calculatePromptRisk(promptFeatures) {
        let risk = 0;
        
        // High instruction count
        if (promptFeatures.instructionCount > 3) risk += 30;
        if (promptFeatures.instructionCount > 5) risk += 20;
        
        // High urgency
        if (promptFeatures.urgencyScore > 3) risk += 20;
        
        // High repetition
        if (promptFeatures.repetitionScore > 0.5) risk += 15;
        
        // High uppercase ratio
        if (promptFeatures.uppercaseRatio > 0.5) risk += 15;
        
        return Math.min(100, risk);
    }

    calculateSessionRisk(sessionFeatures) {
        let risk = 0;
        
        // Short session
        if (sessionFeatures.sessionDuration < 10) risk += 20;
        
        // Too many interactions
        if (sessionFeatures.interactionsInSession > 20) risk += 20;
        
        // Low session stability
        if (sessionFeatures.sessionStability < 0.3) risk += 20;
        
        // Too fast interactions
        if (sessionFeatures.averageTimeBetweenInteractions < 1000) risk += 20;
        
        return Math.min(100, risk);
    }

    calculateToolRisk(toolFeatures) {
        let risk = 0;
        
        // Suspicious tools
        if (toolFeatures.suspiciousToolPatterns > 0) risk += 30;
        
        // Automated tools
        if (toolFeatures.automatedToolUsage > 0) risk += 25;
        
        // High tool usage frequency
        if (toolFeatures.toolCallFrequency > 5) risk += 25;
        
        return Math.min(100, risk);
    }

    calculateContextRisk(contextFeatures) {
        let risk = 0;
        
        // Headless browser
        if (contextFeatures.deviceType === 'headless') risk += 30;
        
        // Poor IP reputation
        if (contextFeatures.ipReputation < 30) risk += 25;
        
        // Location inconsistency
        if (contextFeatures.locationConsistency < 0.5) risk += 20;
        
        // Unusual time
        if (contextFeatures.timeOfDay < 3 || contextFeatures.timeOfDay > 22) risk += 15;
        
        return Math.min(100, risk);
    }

    calculateFraudRisk(fraudSignals) {
        let risk = 0;
        
        // High velocity
        if (fraudSignals.velocityScore > 10) risk += 25;
        if (fraudSignals.velocityScore > 20) risk += 20;
        
        // High burstiness
        if (fraudSignals.burstScore > 0.5) risk += 20;
        
        // Anomalies
        if (fraudSignals.anomalyScore > 3) risk += 20;
        
        // Pattern deviation
        if (fraudSignals.patternDeviation > 1) risk += 15;
        
        return Math.min(100, risk);
    }

    updateTrajectoryRisk(trajectory, interactionRisk) {
        // Update running average
        const history = trajectory.getRiskHistory();
        history.push(interactionRisk);
        
        // Keep only last 50 interactions
        if (history.length > TRAJECTORY_CONFIG.maxTrajectoryLength) {
            history.shift();
        }
        
        // Calculate trend
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
        if (riskScore >= TRAJECTORY_CONFIG.riskThresholds.CRITICAL) return 'critical';
        if (riskScore >= TRAJECTORY_CONFIG.riskThresholds.HIGH) return 'high';
        if (riskScore >= TRAJECTORY_CONFIG.riskThresholds.MEDIUM) return 'medium';
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
        
        // Check for gradual increase
        let increasingCount = 0;
        let totalIncrease = 0;
        
        for (let i = 1; i < history.length; i++) {
            if (history[i] > history[i-1]) {
                increasingCount++;
                totalIncrease += history[i] - history[i-1];
            }
        }
        
        // Check if risk has been increasing
        if (increasingCount > history.length * 0.6 && totalIncrease > 20) {
            escalation.detected = true;
            escalation.severity = totalIncrease > 40 ? 'high' : 'medium';
            escalation.pattern.push('gradual_increase');
            escalation.details.increaseRate = (totalIncrease / history.length).toFixed(2);
        }
        
        // Check for sudden spikes
        const maxRisk = Math.max(...history);
        const avgRisk = history.reduce((a, b) => a + b, 0) / history.length;
        if (maxRisk - avgRisk > 30) {
            escalation.detected = true;
            escalation.severity = maxRisk - avgRisk > 50 ? 'critical' : 'high';
            escalation.pattern.push('sudden_spike');
            escalation.details.spikeMagnitude = (maxRisk - avgRisk).toFixed(2);
        }
        
        // Check for multiple escalations
        if (escalation.detected && escalation.pattern.length > 1) {
            escalation.severity = 'critical';
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
        
        // Store alert
        await this.storeAlert(alert);
        this.escalationAlerts.push(alert);
        
        // Log critical alerts
        if (escalation.severity === 'critical') {
            console.error(`🚨 CRITICAL: Escalation detected in session ${sessionId}`);
            console.error(`Risk Level: ${trajectoryRisk.riskLevel}`);
            console.error(`Pattern: ${escalation.pattern.join(', ')}`);
        }
        
        return alert;
    }

    async storeTrajectoryData(sessionId, trajectory, trajectoryRisk, alert) {
        try {
            await db.query(
                `INSERT INTO trajectory_fraud_data 
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
            console.error('Store trajectory error:', error);
        }
    }

    async storeAlert(alert) {
        try {
            await db.query(
                `INSERT INTO trajectory_fraud_alerts 
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

    async getStatistics() {
        try {
            const [stats] = await db.query(
                `SELECT 
                    COUNT(*) as total_sessions,
                    COUNT(DISTINCT session_id) as unique_sessions,
                    AVG(current_risk) as avg_risk,
                    SUM(CASE WHEN risk_level = 'critical' THEN 1 ELSE 0 END) as critical_sessions,
                    SUM(CASE WHEN risk_level = 'high' THEN 1 ELSE 0 END) as high_sessions
                 FROM trajectory_fraud_data
                 WHERE timestamp > DATE_SUB(NOW(), INTERVAL 24 HOUR)`
            );

            const [alertStats] = await db.query(
                `SELECT 
                    COUNT(*) as total_alerts,
                    SUM(CASE WHEN escalation_level = 'critical' THEN 1 ELSE 0 END) as critical_alerts
                 FROM trajectory_fraud_alerts
                 WHERE timestamp > DATE_SUB(NOW(), INTERVAL 24 HOUR)`
            );

            return {
                sessions: stats[0],
                alerts: alertStats[0],
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
            escalationAlerts: this.escalationAlerts.length,
            featureCache: this.featureCache.size,
            config: TRAJECTORY_CONFIG
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
        
        // Keep only last 50 interactions
        if (this.interactions.length > TRAJECTORY_CONFIG.maxTrajectoryLength) {
            this.interactions.shift();
        }
    }

    getRiskHistory() {
        return this.riskHistory;
    }

    addRiskScore(score) {
        this.riskHistory.push(score);
        if (this.riskHistory.length > TRAJECTORY_CONFIG.maxTrajectoryLength) {
            this.riskHistory.shift();
        }
    }

    getAverageRisk() {
        if (this.riskHistory.length === 0) return 0;
        return this.riskHistory.reduce((a, b) => a + b, 0) / this.riskHistory.length;
    }

    getMaxRisk() {
        if (this.riskHistory.length === 0) return 0;
        return Math.max(...this.riskHistory);
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

module.exports = new TrajectoryFraudDetectionService();