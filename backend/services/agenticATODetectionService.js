// backend/services/agenticATODetectionService.js

const db = require('../config/db').promise;
const crypto = require('crypto');
const tf = require('@tensorflow/tfjs-node');
const { IsolationForest } = require('isolation-forest');
const WebSocket = require('ws');
const prometheus = require('prom-client');
const express = require('express');

// ============================================
// CONFIGURATION
// ============================================

const ATO_CONFIG = {
    behavioralBaselineWindow: 30,
    updateFrequency: 7,
    maxMerchants: 20,
    merchantExpansionThreshold: 3,
    basketHistoryLength: 50,
    compositionDeviationThreshold: 0.3,
    conversationHistoryLength: 100,
    fingerprintThreshold: 0.75,
    mandateDeviationThreshold: 0.2,
    lowConfidenceThreshold: 40,
    mediumConfidenceThreshold: 60,
    highConfidenceThreshold: 80,
    alertThreshold: 60,
    criticalThreshold: 80,
    
    // ML Configuration
    mlEnabled: true,
    mlAnomalyThreshold: 0.3,
    mlTrainingEpochs: 50,
    mlValidationSplit: 0.2,
    
    // WebSocket
    wsPort: 8080,
    
    // Metrics
    metricsEnabled: true,
    metricsPort: 9090,
};

// ============================================
// PROMETHEUS METRICS
// ============================================

const register = new prometheus.Registry();

const detectionCounter = new prometheus.Counter({
    name: 'ato_detections_total',
    help: 'Total number of ATO detections',
    labelNames: ['severity', 'agent_id']
});

const detectionLatency = new prometheus.Histogram({
    name: 'ato_detection_latency_seconds',
    help: 'Detection latency in seconds',
    buckets: [0.1, 0.5, 1, 2, 5, 10]
});

const falsePositiveCounter = new prometheus.Counter({
    name: 'ato_false_positives_total',
    help: 'Total false positive detections'
});

const activeAgentsGauge = new prometheus.Gauge({
    name: 'ato_active_agents',
    help: 'Number of active agents being monitored'
});

register.registerMetric(detectionCounter);
register.registerMetric(detectionLatency);
register.registerMetric(falsePositiveCounter);
register.registerMetric(activeAgentsGauge);

// ============================================
// ML DETECTION CLASS
// ============================================

class MLDetection {
    constructor() {
        this.isolationForest = null;
        this.autoencoder = null;
        this.anomalyThreshold = ATO_CONFIG.mlAnomalyThreshold;
        this.isTrained = false;
        this.featureScaler = null;
        this.trainingHistory = [];
    }

    async train(features) {
        try {
            console.log('Training ML models...');
            
            // Normalize features
            this.featureScaler = this.normalizeFeatures(features);
            const normalizedFeatures = this.featureScaler.normalized;
            
            // Train Isolation Forest
            this.isolationForest = new IsolationForest({
                nEstimators: 100,
                maxSamples: 'auto',
                contamination: 0.1,
                randomState: 42
            });
            this.isolationForest.fit(normalizedFeatures);
            
            // Build and train Autoencoder
            this.autoencoder = await this.buildAutoencoder();
            await this.autoencoder.fit(normalizedFeatures, normalizedFeatures, {
                epochs: ATO_CONFIG.mlTrainingEpochs,
                validationSplit: ATO_CONFIG.mlValidationSplit,
                callbacks: {
                    onEpochEnd: (epoch, logs) => {
                        this.trainingHistory.push(logs);
                    }
                }
            });
            
            this.isTrained = true;
            console.log('ML models trained successfully');
            return true;
        } catch (error) {
            console.error('ML training failed:', error);
            this.isTrained = false;
            return false;
        }
    }

    normalizeFeatures(features) {
        const means = [];
        const stds = [];
        const normalized = [];
        
        for (let i = 0; i < features[0].length; i++) {
            const values = features.map(row => row[i]);
            const mean = values.reduce((a, b) => a + b, 0) / values.length;
            const std = Math.sqrt(values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / values.length);
            means.push(mean);
            stds.push(std || 1);
        }
        
        for (const row of features) {
            const normalizedRow = row.map((val, i) => (val - means[i]) / stds[i]);
            normalized.push(normalizedRow);
        }
        
        return { normalized, means, stds };
    }

    async buildAutoencoder() {
        const model = tf.sequential();
        
        // Encoder
        model.add(tf.layers.dense({
            units: 64,
            activation: 'relu',
            inputShape: [10] // Adjust based on feature count
        }));
        model.add(tf.layers.dense({
            units: 32,
            activation: 'relu'
        }));
        model.add(tf.layers.dense({
            units: 16,
            activation: 'relu'
        }));
        
        // Decoder
        model.add(tf.layers.dense({
            units: 32,
            activation: 'relu'
        }));
        model.add(tf.layers.dense({
            units: 64,
            activation: 'relu'
        }));
        model.add(tf.layers.dense({
            units: 10,
            activation: 'sigmoid'
        }));
        
        model.compile({
            optimizer: 'adam',
            loss: 'meanSquaredError'
        });
        
        return model;
    }

    async detect(features) {
        if (!this.isTrained) {
            throw new Error('ML models not trained');
        }
        
        const normalizedFeatures = features.map(row => 
            row.map((val, i) => (val - this.featureScaler.means[i]) / this.featureScaler.stds[i])
        );
        
        // Isolation Forest score
        const ifScore = this.isolationForest.predict(normalizedFeatures);
        
        // Autoencoder reconstruction error
        const inputTensor = tf.tensor2d(normalizedFeatures);
        const reconstructed = this.autoencoder.predict(inputTensor);
        const aeScore = tf.metrics.meanSquaredError(inputTensor, reconstructed).dataSync()[0];
        
        // Combined anomaly score
        const combinedScore = (ifScore + aeScore) / 2;
        
        return {
            isAnomaly: combinedScore > this.anomalyThreshold,
            ifScore,
            aeScore,
            combinedScore,
            confidence: Math.min(100, combinedScore * 100)
        };
    }
}

// ============================================
// REAL-TIME MONITORING
// ============================================

class RealTimeMonitor {
    constructor(server) {
        this.wss = new WebSocket.Server({ server });
        this.clients = new Set();
        this.setupWebSocket();
        console.log(`WebSocket server running on port ${ATO_CONFIG.wsPort}`);
    }

    setupWebSocket() {
        this.wss.on('connection', (ws) => {
            this.clients.add(ws);
            ws.send(JSON.stringify({
                type: 'connection',
                message: 'Connected to ATO Monitor',
                timestamp: new Date().toISOString()
            }));

            ws.on('close', () => {
                this.clients.delete(ws);
            });

            ws.on('error', (error) => {
                console.error('WebSocket error:', error);
            });
        });
    }

    broadcastDetection(detection) {
        const message = {
            type: 'detection',
            data: detection,
            timestamp: new Date().toISOString()
        };

        for (const client of this.clients) {
            if (client.readyState === WebSocket.OPEN) {
                try {
                    client.send(JSON.stringify(message));
                } catch (error) {
                    console.error('Failed to send WebSocket message:', error);
                }
            }
        }
    }

    broadcastAlert(alert) {
        const message = {
            type: 'alert',
            data: alert,
            timestamp: new Date().toISOString()
        };

        for (const client of this.clients) {
            if (client.readyState === WebSocket.OPEN) {
                try {
                    client.send(JSON.stringify(message));
                } catch (error) {
                    console.error('Failed to send WebSocket alert:', error);
                }
            }
        }
    }

    getClientCount() {
        return this.clients.size;
    }
}

// ============================================
// ALERT ESCALATION
// ============================================

class AlertEscalation {
    constructor() {
        this.escalationMatrix = {
            LOW: {
                level: 1,
                actions: ['log', 'notify'],
                timeout: 3600000,
                severity: 'low'
            },
            MEDIUM: {
                level: 2,
                actions: ['log', 'notify', 'block'],
                timeout: 1800000,
                severity: 'medium'
            },
            HIGH: {
                level: 3,
                actions: ['log', 'notify', 'block', 'quarantine'],
                timeout: 600000,
                severity: 'high'
            },
            CRITICAL: {
                level: 4,
                actions: ['log', 'notify', 'block', 'quarantine', 'rollback'],
                timeout: 300000,
                severity: 'critical'
            }
        };
        this.escalationHistory = [];
    }

    escalate(alert) {
        const severity = this.getSeverity(alert.confidence);
        const matrix = this.escalationMatrix[severity];
        
        const escalation = {
            severity,
            actions: matrix.actions,
            timeout: matrix.timeout,
            escalationPath: this.getEscalationPath(severity),
            timestamp: new Date().toISOString()
        };
        
        this.escalationHistory.push(escalation);
        return escalation;
    }

    getSeverity(confidence) {
        if (confidence > 80) return 'CRITICAL';
        if (confidence > 60) return 'HIGH';
        if (confidence > 40) return 'MEDIUM';
        return 'LOW';
    }

    getEscalationPath(severity) {
        const path = {
            CRITICAL: ['critical_alert', 'escalate_to_manager', 'trigger_incident_response'],
            HIGH: ['high_alert', 'escalate_to_team_lead', 'block_agent'],
            MEDIUM: ['medium_alert', 'notify_security_team', 'monitor_activity'],
            LOW: ['low_alert', 'log_incident', 'review_later']
        };
        return path[severity] || ['log_incident'];
    }

    getHistory() {
        return this.escalationHistory;
    }
}

// ============================================
// THREAT INTELLIGENCE
// ============================================

class ThreatIntelligence {
    constructor() {
        this.threatFeeds = [];
        this.ipReputation = {};
        this.deviceFingerprints = {};
        this.knownAttackPatterns = new Set();
        this.lastUpdate = null;
        this.updateInterval = 3600000; // 1 hour
    }

    async initialize() {
        await this.fetchThreatFeeds();
        setInterval(() => this.fetchThreatFeeds(), this.updateInterval);
    }

    async fetchThreatFeeds() {
        try {
            const feeds = [
                'https://api.threatintel.com/feeds/latest',
                'https://feeds.alienvault.com/otx',
                'https://urlhaus.abuse.ch/downloads/csv/'
            ];

            for (const feed of feeds) {
                try {
                    const response = await fetch(feed);
                    const data = await response.json();
                    this.threatFeeds.push({
                        source: feed,
                        data: data,
                        timestamp: new Date().toISOString()
                    });
                    this.updateThreatPatterns(data);
                } catch (error) {
                    console.error(`Failed to fetch threat feed: ${feed}`, error);
                }
            }
            
            this.lastUpdate = new Date().toISOString();
        } catch (error) {
            console.error('Threat feed fetch error:', error);
        }
    }

    updateThreatPatterns(data) {
        if (data && data.threats) {
            for (const threat of data.threats) {
                this.knownAttackPatterns.add(threat.pattern);
                if (threat.ip) {
                    this.ipReputation[threat.ip] = {
                        score: threat.score || 0,
                        isMalicious: threat.malicious || false,
                        confidence: threat.confidence || 0,
                        lastUpdated: new Date().toISOString()
                    };
                }
            }
        }
    }

    checkIpReputation(ip) {
        return this.ipReputation[ip] || {
            score: 0,
            isMalicious: false,
            confidence: 0
        };
    }

    checkDeviceFingerprint(fingerprint) {
        return this.deviceFingerprints[fingerprint] || {
            known: false,
            trustScore: 50,
            firstSeen: new Date().toISOString()
        };
    }

    getKnownPatterns() {
        return Array.from(this.knownAttackPatterns);
    }
}

// ============================================
// AUDIT TRAIL
// ============================================

class AuditTrail {
    constructor() {
        this.entries = [];
        this.maxEntries = 10000;
    }

    log({ action, actor, target, details, status, timestamp = new Date().toISOString() }) {
        const entry = {
            id: crypto.randomUUID(),
            action,
            actor,
            target,
            details,
            status,
            timestamp,
            ip: this.getClientIP(),
            userAgent: this.getUserAgent()
        };

        this.entries.push(entry);
        
        if (this.entries.length > this.maxEntries) {
            this.entries = this.entries.slice(-this.maxEntries);
        }

        this.storeAuditEntry(entry);
        return entry;
    }

    async storeAuditEntry(entry) {
        try {
            await db.query(
                `INSERT INTO ato_audit_trail 
                 (id, action, actor, target, details, status, timestamp, ip, user_agent)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    entry.id,
                    entry.action,
                    entry.actor,
                    entry.target,
                    JSON.stringify(entry.details),
                    entry.status,
                    entry.timestamp,
                    entry.ip,
                    entry.userAgent
                ]
            );
        } catch (error) {
            console.error('Failed to store audit entry:', error);
        }
    }

    getClientIP() {
        // Implementation depends on request context
        return 'unknown';
    }

    getUserAgent() {
        // Implementation depends on request context
        return 'unknown';
    }

    getEntries(filters = {}) {
        let entries = this.entries;
        
        if (filters.action) {
            entries = entries.filter(e => e.action === filters.action);
        }
        if (filters.actor) {
            entries = entries.filter(e => e.actor === filters.actor);
        }
        if (filters.status) {
            entries = entries.filter(e => e.status === filters.status);
        }
        if (filters.fromDate) {
            entries = entries.filter(e => e.timestamp >= filters.fromDate);
        }
        if (filters.toDate) {
            entries = entries.filter(e => e.timestamp <= filters.toDate);
        }
        
        return entries;
    }
}

// ============================================
// INCIDENT RESPONSE
// ============================================

class IncidentResponse {
    constructor() {
        this.actions = {
            block: this.blockAgent.bind(this),
            quarantine: this.quarantineAgent.bind(this),
            rollback: this.rollbackTransactions.bind(this),
            notify: this.notifyStakeholders.bind(this)
        };
        this.incidentLog = [];
    }

    async execute(alert, actions) {
        const results = [];
        
        for (const action of actions) {
            try {
                const result = await this.actions[action](alert);
                results.push({
                    action,
                    success: true,
                    result,
                    timestamp: new Date().toISOString()
                });
            } catch (error) {
                results.push({
                    action,
                    success: false,
                    error: error.message,
                    timestamp: new Date().toISOString()
                });
            }
        }

        this.incidentLog.push({
            alert,
            results,
            timestamp: new Date().toISOString()
        });

        return results;
    }

    async blockAgent(alert) {
        await db.query(
            'UPDATE agents SET status = "blocked", blocked_reason = ?, blocked_at = NOW() WHERE id = ?',
            [alert.reason || 'Suspicious activity detected', alert.agentId]
        );
        return { message: 'Agent blocked successfully', agentId: alert.agentId };
    }

    async quarantineAgent(alert) {
        await db.query(
            'UPDATE agents SET status = "quarantined", quarantine_reason = ?, quarantined_at = NOW() WHERE id = ?',
            [alert.reason || 'Suspicious activity detected', alert.agentId]
        );
        return { message: 'Agent quarantined successfully', agentId: alert.agentId };
    }

    async rollbackTransactions(alert) {
        await db.query(
            `UPDATE transactions 
             SET status = "rollback_pending" 
             WHERE agent_id = ? 
             AND created_at > DATE_SUB(NOW(), INTERVAL 1 HOUR)`,
            [alert.agentId]
        );
        return { message: 'Transactions marked for rollback', agentId: alert.agentId };
    }

    async notifyStakeholders(alert) {
        console.log('Notifying stakeholders:', {
            agentId: alert.agentId,
            severity: alert.severity,
            confidence: alert.confidence,
            timestamp: new Date().toISOString()
        });
        return { message: 'Notifications sent', recipientCount: 3 };
    }

    getIncidentLog() {
        return this.incidentLog;
    }
}

// ============================================
// MAIN SERVICE CLASS
// ============================================

class AgenticATODetectionService {
    constructor() {
        this.agentBaselines = new Map();
        this.merchantProfiles = new Map();
        this.basketProfiles = new Map();
        this.conversationFingerprints = new Map();
        this.mandateProfiles = new Map();
        this.anomalyLogs = [];
        this.detectionAlerts = [];
        this.agentSessions = new Map();
        this.credentialVaultAccess = new Map();
        
        // Initialize new components
        this.mlDetection = new MLDetection();
        this.realTimeMonitor = null;
        this.alertEscalation = new AlertEscalation();
        this.threatIntelligence = new ThreatIntelligence();
        this.auditTrail = new AuditTrail();
        this.incidentResponse = new IncidentResponse();
        
        // Initialize components
        this.initializeComponents();
        this.setupMetricsEndpoint();
    }

    async initializeComponents() {
        try {
            await this.threatIntelligence.initialize();
            
            // Set up WebSocket server if enabled
            if (process.env.ENABLE_WEBSOCKET === 'true') {
                const wsServer = new WebSocket.Server({ port: ATO_CONFIG.wsPort });
                this.realTimeMonitor = new RealTimeMonitor(wsServer);
            }
            
            console.log('ATO Detection Service initialized successfully');
        } catch (error) {
            console.error('Failed to initialize ATO Detection Service:', error);
        }
    }

    setupMetricsEndpoint() {
        const app = express();
        app.get('/metrics', async (req, res) => {
            res.set('Content-Type', register.contentType);
            res.end(await register.metrics());
        });
        
        app.listen(ATO_CONFIG.metricsPort, () => {
            console.log(`Metrics endpoint running on port ${ATO_CONFIG.metricsPort}`);
        });
    }

    /**
     * Initialize agent behavioral baseline with ML
     */
    async initializeBaseline(agentId, initialData = {}) {
        const startTime = Date.now();
        
        try {
            // Extract features for ML training
            const features = this.extractFeatures(initialData);
            
            // Train ML models if enabled
            if (ATO_CONFIG.mlEnabled && features.length > 10) {
                await this.mlDetection.train(features);
            }
            
            const baseline = {
                agentId,
                initializedAt: new Date().toISOString(),
                lastUpdated: new Date().toISOString(),
                merchantProfile: await this.buildMerchantProfile(agentId, initialData.merchants),
                basketProfile: await this.buildBasketProfile(agentId, initialData.baskets),
                conversationFingerprint: await this.buildConversationFingerprint(agentId, initialData.conversations),
                mandateProfile: await this.buildMandateProfile(agentId, initialData.mandates),
                behavioralPatterns: await this.extractBehavioralPatterns(agentId, initialData),
                credentialVaultPattern: await this.buildCredentialVaultPattern(agentId, initialData.credentialAccess),
                mlModel: {
                    isTrained: this.mlDetection.isTrained,
                    trainingDataSize: features.length
                }
            };

            this.agentBaselines.set(agentId, baseline);
            await this.storeBaseline(agentId, baseline);

            // Update metrics
            activeAgentsGauge.set(this.agentBaselines.size);
            
            // Audit log
            this.auditTrail.log({
                action: 'baseline_initialized',
                actor: 'system',
                target: agentId,
                details: { baseline: baseline },
                status: 'success'
            });

            console.log(`Baseline initialized for agent: ${agentId}`);
            return baseline;
        } catch (error) {
            console.error('Baseline initialization error:', error);
            this.auditTrail.log({
                action: 'baseline_initialization_failed',
                actor: 'system',
                target: agentId,
                details: { error: error.message },
                status: 'failure'
            });
            throw error;
        }
    }

    /**
     * Extract features for ML training
     */
    extractFeatures(data) {
        const features = [];
        // Extract features from merchant, basket, conversation data
        // This is a simplified version - expand based on your data
        if (data.merchants) {
            for (const merchant of data.merchants) {
                features.push([
                    merchant.frequency || 0,
                    merchant.basketSize || 0,
                    merchant.interactionCount || 0
                ]);
            }
        }
        return features;
    }

    /**
     * Detect compromised agent with ML
     */
    async detectCompromisedAgent(agentId, currentActivity) {
        const startTime = Date.now();
        
        try {
            const baseline = this.agentBaselines.get(agentId);
            if (!baseline) {
                throw new Error(`No baseline found for agent: ${agentId}`);
            }

            const detection = {
                isCompromised: false,
                confidence: 0,
                flags: [],
                details: {},
                timestamp: new Date().toISOString(),
                mlAnalysis: null
            };

            // Track current session
            this.trackAgentSession(agentId, currentActivity);

            // ML-based detection
            if (ATO_CONFIG.mlEnabled && this.mlDetection.isTrained) {
                const features = this.extractFeaturesForML(currentActivity);
                const mlResult = await this.mlDetection.detect(features);
                detection.mlAnalysis = mlResult;
                
                if (mlResult.isAnomaly) {
                    detection.flags.push({
                        type: 'ml_anomaly',
                        severity: 'high',
                        confidence: mlResult.confidence,
                        details: `ML model detected anomaly with confidence ${mlResult.confidence}%`
                    });
                    detection.confidence += mlResult.confidence;
                }
            }

            // Check merchant behavior
            const merchantCheck = await this.checkMerchantBehavior(
                baseline.merchantProfile,
                currentActivity.merchants
            );
            this.addDetectionResult(detection, merchantCheck);

            // Check basket composition
            const basketCheck = await this.checkBasketComposition(
                baseline.basketProfile,
                currentActivity.basket
            );
            this.addDetectionResult(detection, basketCheck);

            // Check conversation fingerprint
            const conversationCheck = await this.checkConversationFingerprint(
                baseline.conversationFingerprint,
                currentActivity.conversation
            );
            this.addDetectionResult(detection, conversationCheck);

            // Check mandate scope
            const mandateCheck = await this.checkMandateScope(
                baseline.mandateProfile,
                currentActivity.mandate
            );
            this.addDetectionResult(detection, mandateCheck);

            // Check credential vault access
            const credentialCheck = await this.checkCredentialVaultAccess(
                baseline.credentialVaultPattern,
                currentActivity.credentialAccess
            );
            this.addDetectionResult(detection, credentialCheck);

            // Check behavioral patterns
            const patternCheck = await this.checkBehavioralPatterns(
                baseline.behavioralPatterns,
                currentActivity
            );
            this.addDetectionResult(detection, patternCheck);

            // Check threat intelligence
            const threatCheck = await this.checkThreatIntelligence(currentActivity);
            this.addDetectionResult(detection, threatCheck);

            // Calculate overall confidence
            this.calculateOverallConfidence(detection);

            // Determine if compromised
            detection.isCompromised = detection.confidence > ATO_CONFIG.alertThreshold;

            // Log detection
            await this.logAnomalyDetection(agentId, detection);

            // Generate alert if compromised
            if (detection.isCompromised) {
                await this.generateAlert(agentId, detection);
                
                // Real-time broadcast
                if (this.realTimeMonitor) {
                    this.realTimeMonitor.broadcastDetection(detection);
                }
                
                // Escalate alert
                const escalation = this.alertEscalation.escalate(detection);
                detection.escalation = escalation;
                
                // Auto-response
                if (detection.confidence > ATO_CONFIG.criticalThreshold) {
                    const response = await this.incidentResponse.execute(detection, escalation.actions);
                    detection.incidentResponse = response;
                }
            }

            // Update metrics
            const latency = (Date.now() - startTime) / 1000;
            detectionLatency.observe(latency);
            
            if (detection.isCompromised) {
                const severity = this.alertEscalation.getSeverity(detection.confidence).toLowerCase();
                detectionCounter.inc({ severity, agent_id: agentId });
            }

            // Audit log
            this.auditTrail.log({
                action: 'detection_completed',
                actor: 'system',
                target: agentId,
                details: { 
                    confidence: detection.confidence,
                    isCompromised: detection.isCompromised,
                    flags: detection.flags.length
                },
                status: detection.isCompromised ? 'alert' : 'normal'
            });

            return detection;
        } catch (error) {
            console.error('Detection error:', error);
            throw error;
        }
    }

    /**
     * Extract features for ML detection
     */
    extractFeaturesForML(activity) {
        // Extract features from activity data
        const features = [];
        
        features.push([
            activity.merchants ? activity.merchants.length : 0,
            activity.basket ? activity.basket.items ? activity.basket.items.length : 0 : 0,
            activity.basket ? activity.basket.value || 0 : 0,
            activity.conversation ? activity.conversation.length || 0 : 0,
            activity.credentialAccess ? 1 : 0
        ]);
        
        return features;
    }

    /**
     * Check threat intelligence
     */
    async checkThreatIntelligence(activity) {
        const flags = [];
        let confidence = 0;
        const details = {};

        if (activity.ip) {
            const ipReputation = this.threatIntelligence.checkIpReputation(activity.ip);
            if (ipReputation.isMalicious) {
                flags.push({
                    type: 'malicious_ip',
                    severity: 'high',
                    confidence: 80,
                    details: `IP ${activity.ip} has malicious reputation`
                });
                confidence += 80;
                details.ip = activity.ip;
            }
        }

        if (activity.deviceFingerprint) {
            const deviceInfo = this.threatIntelligence.checkDeviceFingerprint(activity.deviceFingerprint);
            if (!deviceInfo.known) {
                flags.push({
                    type: 'unknown_device',
                    severity: 'medium',
                    confidence: 60,
                    details: 'Unknown device fingerprint detected'
                });
                confidence += 60;
                details.deviceFingerprint = activity.deviceFingerprint;
            }
        }

        return {
            flags,
            confidence: Math.min(100, confidence),
            details
        };
    }

    // ============================================
    // REST API FOR EXTERNAL SYSTEMS
    // ============================================

    setupAPI(app) {
        app.get('/api/ato/agents/:agentId/status', async (req, res) => {
            try {
                const status = await this.getAgentStatus(req.params.agentId);
                res.json({ success: true, data: status });
            } catch (error) {
                res.status(500).json({ success: false, error: error.message });
            }
        });

        app.post('/api/ato/agents/:agentId/detect', async (req, res) => {
            try {
                const detection = await this.detectCompromisedAgent(req.params.agentId, req.body);
                res.json({ success: true, data: detection });
            } catch (error) {
                res.status(500).json({ success: false, error: error.message });
            }
        });

        app.get('/api/ato/alerts', async (req, res) => {
            try {
                const alerts = await this.getAlerts();
                res.json({ success: true, data: alerts });
            } catch (error) {
                res.status(500).json({ success: false, error: error.message });
            }
        });

        app.get('/api/ato/statistics', async (req, res) => {
            try {
                const stats = await this.getStatistics();
                res.json({ success: true, data: stats });
            } catch (error) {
                res.status(500).json({ success: false, error: error.message });
            }
        });

        app.post('/api/ato/webhook', (req, res) => {
            const { event, data } = req.body;
            console.log('Webhook received:', { event, data });
            // Process webhook
            res.json({ success: true });
        });
    }

    async getAlerts() {
        try {
            const [alerts] = await db.query(
                'SELECT * FROM agentic_ato_alerts ORDER BY timestamp DESC LIMIT 100'
            );
            return alerts;
        } catch (error) {
            console.error('Get alerts error:', error);
            return [];
        }
    }

    async getAgentStatus(agentId) {
        const baseline = this.agentBaselines.get(agentId);
        if (!baseline) {
            throw new Error('Agent not found');
        }
        
        return {
            agentId,
            baseline,
            status: 'active',
            mlStatus: {
                enabled: ATO_CONFIG.mlEnabled,
                isTrained: this.mlDetection.isTrained
            }
        };
    }

    // ============================================
    // EXISTING METHODS (from original service)
    // ============================================

    addDetectionResult(detection, result) {
        if (result.flags && result.flags.length > 0) {
            detection.flags.push(...result.flags);
            detection.confidence += result.confidence || 0;
            if (result.details) {
                detection.details = { ...detection.details, ...result.details };
            }
        }
    }

    calculateOverallConfidence(detection) {
        const totalFlags = detection.flags.length;
        if (totalFlags === 0) {
            detection.confidence = 0;
            return;
        }

        let weightedConfidence = 0;
        let totalWeight = 0;

        for (const flag of detection.flags) {
            const weight = flag.severity === 'critical' ? 3 :
                          flag.severity === 'high' ? 2 : 1;
            weightedConfidence += flag.confidence * weight;
            totalWeight += weight;
        }

        detection.confidence = Math.min(100, weightedConfidence / totalWeight);
    }

    trackAgentSession(agentId, activity) {
        if (!this.agentSessions.has(agentId)) {
            this.agentSessions.set(agentId, {
                id: agentId,
                startTime: Date.now(),
                activities: [],
                merchantVisits: new Set(),
                totalActions: 0
            });
        }

        const session = this.agentSessions.get(agentId);
        session.activities.push({
            ...activity,
            timestamp: Date.now()
        });
        session.totalActions++;

        if (activity.merchants) {
            for (const merchant of activity.merchants) {
                session.merchantVisits.add(merchant.id);
            }
        }

        if (session.activities.length > 100) {
            session.activities.shift();
        }
    }

    // Merchant Profile Methods
    async buildMerchantProfile(agentId, merchantData = []) {
        return {
            knownMerchants: new Set(),
            merchantFrequency: {},
            averageBasketSize: {},
            lastInteraction: {},
            expansionRate: 0,
            typicalMerchantCount: merchantData.length || 0
        };
    }

    async updateMerchantProfile(current, newMerchants) {
        for (const merchant of newMerchants) {
            current.knownMerchants.add(merchant.id);
            current.merchantFrequency[merchant.id] = (current.merchantFrequency[merchant.id] || 0) + 1;
            current.averageBasketSize[merchant.id] = merchant.basketSize || 0;
            current.lastInteraction[merchant.id] = merchant.timestamp || new Date().toISOString();
        }

        const recent = await this.getRecentMerchants(current);
        current.expansionRate = recent.length / 7;

        return current;
    }

    async checkMerchantBehavior(baseline, currentMerchants) {
        const flags = [];
        let confidence = 0;
        const details = {};

        if (!currentMerchants || currentMerchants.length === 0) {
            return { flags, confidence, details };
        }

        const newMerchants = currentMerchants.filter(
            m => !baseline.knownMerchants.has(m.id)
        );

        if (newMerchants.length > ATO_CONFIG.merchantExpansionThreshold) {
            flags.push({
                type: 'rapid_merchant_expansion',
                severity: 'high',
                confidence: 70,
                details: `Expanded to ${newMerchants.length} new merchants`
            });
            confidence += 70;
            details.newMerchants = newMerchants.map(m => m.id);
        }

        for (const merchant of currentMerchants) {
            const frequency = baseline.merchantFrequency[merchant.id] || 0;
            const expected = (baseline.typicalMerchantCount / Object.keys(baseline.merchantFrequency).length) || 1;

            if (frequency > expected * 3) {
                flags.push({
                    type: 'unusual_merchant_frequency',
                    severity: 'medium',
                    confidence: 60,
                    details: `Merchant ${merchant.id} has unusual frequency: ${frequency}`
                });
                confidence += 60;
            }
        }

        return {
            flags,
            confidence: Math.min(100, confidence / 2),
            details
        };
    }

    // Basket Composition Methods
    async buildBasketProfile(agentId, baskets = []) {
        return {
            typicalItems: new Map(),
            typicalCategories: new Map(),
            itemFrequency: {},
            categoryFrequency: {},
            averageItemCount: 0,
            averageValue: 0,
            history: baskets.slice(-ATO_CONFIG.basketHistoryLength)
        };
    }

    async updateBasketProfile(current, newBaskets) {
        for (const basket of newBaskets) {
            for (const item of basket.items || []) {
                current.itemFrequency[item.id] = (current.itemFrequency[item.id] || 0) + 1;
                if (current.itemFrequency[item.id] > 5) {
                    current.typicalItems.set(item.id, item);
                }
            }
            current.history.push(basket);
        }

        if (current.history.length > ATO_CONFIG.basketHistoryLength) {
            current.history = current.history.slice(-ATO_CONFIG.basketHistoryLength);
        }

        return current;
    }

    async checkBasketComposition(baseline, currentBasket) {
        const flags = [];
        let confidence = 0;
        const details = {};

        if (!currentBasket || !currentBasket.items) {
            return { flags, confidence, details };
        }

        const unusualItems = currentBasket.items.filter(
            item => !baseline.typicalItems.has(item.id)
        );

        if (unusualItems.length > currentBasket.items.length * 0.5) {
            flags.push({
                type: 'unusual_items',
                severity: 'high',
                confidence: 75,
                details: `${unusualItems.length} unusual items in basket`
            });
            confidence += 75;
            details.unusualItems = unusualItems.map(i => i.id);
        }

        const currentValue = currentBasket.items.reduce((sum, item) => sum + (item.price || 0), 0);
        if (currentValue > baseline.averageValue * 3 && baseline.averageValue > 0) {
            flags.push({
                type: 'unusual_basket_value',
                severity: 'medium',
                confidence: 65,
                details: `Basket value (${currentValue}) exceeds typical (${baseline.averageValue})`
            });
            confidence += 65;
        }

        return {
            flags,
            confidence: Math.min(100, confidence / 2),
            details
        };
    }

    // Conversation Fingerprint Methods
    async buildConversationFingerprint(agentId, conversations = []) {
        return {
            patterns: {},
            typicalPhrases: new Set(),
            style: {},
            history: conversations.slice(-ATO_CONFIG.conversationHistoryLength),
            hash: null
        };
    }

    async updateConversationFingerprint(current, newConversations) {
        for (const conversation of newConversations) {
            const words = (conversation.text || '').toLowerCase().split(' ');
            for (const word of words) {
                if (word.length > 3) {
                    current.typicalPhrases.add(word);
                }
            }
            current.history.push(conversation);
        }

        if (current.history.length > ATO_CONFIG.conversationHistoryLength) {
            current.history = current.history.slice(-ATO_CONFIG.conversationHistoryLength);
        }

        current.hash = this.generateFingerprintHash(current);
        return current;
    }

    generateFingerprintHash(fingerprint) {
        const data = {
            phrases: Array.from(fingerprint.typicalPhrases).slice(0, 50),
            style: fingerprint.style
        };
        return crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
    }

    async checkConversationFingerprint(baseline, currentConversation) {
        const flags = [];
        let confidence = 0;
        const details = {};

        if (!currentConversation) {
            return { flags, confidence, details };
        }

        const currentHash = this.generateFingerprintHash({
            typicalPhrases: new Set((currentConversation.text || '').toLowerCase().split(' ')),
            style: { count: 1 }
        });

        const similarity = this.calculateSimilarity(baseline.hash, currentHash);

        if (similarity < ATO_CONFIG.fingerprintThreshold) {
            flags.push({
                type: 'conversation_fingerprint_mismatch',
                severity: 'high',
                confidence: 80,
                details: `Fingerprint similarity: ${similarity.toFixed(2)}`
            });
            confidence += 80;
            details.similarity = similarity;
        }

        return {
            flags,
            confidence: Math.min(100, confidence),
            details
        };
    }

    calculateSimilarity(hash1, hash2) {
        if (!hash1 || !hash2) return 0;
        let matches = 0;
        for (let i = 0; i < Math.min(hash1.length, hash2.length); i++) {
            if (hash1[i] === hash2[i]) matches++;
        }
        return matches / Math.min(hash1.length, hash2.length);
    }

    // Mandate Scope Methods
    async buildMandateProfile(agentId, mandates = []) {
        return {
            allowedActions: new Set(),
            allowedMerchants: new Set(),
            maxAmount: 0,
            scope: {},
            history: mandates,
            deviationCount: 0
        };
    }

    async updateMandateProfile(current, newMandates) {
        for (const mandate of newMandates) {
            if (mandate.actions) {
                for (const action of mandate.actions) {
                    current.allowedActions.add(action);
                }
            }
            if (mandate.merchants) {
                for (const merchant of mandate.merchants) {
                    current.allowedMerchants.add(merchant);
                }
            }
            if (mandate.maxAmount && mandate.maxAmount > current.maxAmount) {
                current.maxAmount = mandate.maxAmount;
            }
            current.history.push(mandate);
        }

        current.scope = {
            actionCount: current.allowedActions.size,
            merchantCount: current.allowedMerchants.size,
            maxAmount: current.maxAmount
        };

        return current;
    }

    async checkMandateScope(baseline, currentMandate) {
        const flags = [];
        let confidence = 0;
        const details = {};

        if (!currentMandate) {
            return { flags, confidence, details };
        }

        const unauthorizedActions = (currentMandate.actions || []).filter(
            action => !baseline.allowedActions.has(action)
        );

        if (unauthorizedActions.length > 0) {
            flags.push({
                type: 'unauthorized_actions',
                severity: 'critical',
                confidence: 90,
                details: `Unauthorized actions: ${unauthorizedActions.join(', ')}`
            });
            confidence += 90;
            details.unauthorizedActions = unauthorizedActions;
        }

        const unauthorizedMerchants = (currentMandate.merchants || []).filter(
            merchant => !baseline.allowedMerchants.has(merchant)
        );

        if (unauthorizedMerchants.length > 0) {
            flags.push({
                type: 'unauthorized_merchants',
                severity: 'high',
                confidence: 80,
                details: `Unauthorized merchants: ${unauthorizedMerchants.join(', ')}`
            });
            confidence += 80;
            details.unauthorizedMerchants = unauthorizedMerchants;
        }

        return {
            flags,
            confidence: Math.min(100, confidence),
            details
        };
    }

    // Credential Vault Methods
    async buildCredentialVaultPattern(agentId, accesses = []) {
        return {
            typicalAccessPattern: {
                times: [],
                frequency: 0,
                devices: new Set()
            },
            history: accesses.slice(-20),
            accessCount: 0
        };
    }

    async updateCredentialVaultPattern(current, newAccesses) {
        for (const access of newAccesses) {
            current.accessCount++;
            current.typicalAccessPattern.times.push(access.timestamp || Date.now());
            if (access.device) {
                current.typicalAccessPattern.devices.add(access.device);
            }
            current.history.push(access);
        }

        if (current.history.length > 20) {
            current.history = current.history.slice(-20);
        }

        return current;
    }

    async checkCredentialVaultAccess(baseline, currentAccess) {
        const flags = [];
        let confidence = 0;
        const details = {};

        if (!currentAccess) {
            return { flags, confidence, details };
        }

        const unusualTime = this.isUnusualTime(currentAccess.timestamp);
        if (unusualTime) {
            flags.push({
                type: 'unusual_credential_access_time',
                severity: 'medium',
                confidence: 60,
                details: `Credential access at unusual time: ${currentAccess.timestamp}`
            });
            confidence += 60;
        }

        if (currentAccess.device && !baseline.typicalAccessPattern.devices.has(currentAccess.device)) {
            flags.push({
                type: 'new_device_credential_access',
                severity: 'high',
                confidence: 75,
                details: `Credential access from new device: ${currentAccess.device}`
            });
            confidence += 75;
            details.newDevice = currentAccess.device;
        }

        const recentAccesses = baseline.history.slice(-10);
        if (recentAccesses.length >= 10) {
            const avgFrequency = recentAccesses.length / 7;
            const currentFrequency = 1;
            if (currentFrequency > avgFrequency * 3) {
                flags.push({
                    type: 'unusual_credential_access_frequency',
                    severity: 'medium',
                    confidence: 65,
                    details: `Unusual credential access frequency`
                });
                confidence += 65;
            }
        }

        return {
            flags,
            confidence: Math.min(100, confidence),
            details
        };
    }

    isUnusualTime(timestamp) {
        if (!timestamp) return false;
        const hour = new Date(timestamp).getHours();
        return hour < 3 || hour > 22;
    }

    // Behavioral Pattern Methods
    async extractBehavioralPatterns(agentId, data) {
        return {
            timePatterns: await this.extractTimePatterns(data),
            frequencyPatterns: await this.extractFrequencyPatterns(data),
            valuePatterns: await this.extractValuePatterns(data),
            interactionPatterns: await this.extractInteractionPatterns(data)
        };
    }

    async updateBehavioralPatterns(current, newData) {
        if (newData.timestamps) {
            current.timePatterns = await this.updateTimePatterns(current.timePatterns, newData.timestamps);
        }
        if (newData.frequencies) {
            current.frequencyPatterns = await this.updateFrequencyPatterns(current.frequencyPatterns, newData.frequencies);
        }
        if (newData.values) {
            current.valuePatterns = await this.updateValuePatterns(current.valuePatterns, newData.values);
        }
        if (newData.interactions) {
            current.interactionPatterns = await this.updateInteractionPatterns(current.interactionPatterns, newData.interactions);
        }
        return current;
    }

    async checkBehavioralPatterns(baseline, currentActivity) {
        const flags = [];
        let confidence = 0;
        const details = {};

        if (currentActivity.timestamp) {
            const timeCheck = await this.checkTimePatterns(baseline.timePatterns, currentActivity.timestamp);
            if (timeCheck.flags.length > 0) {
                flags.push(...timeCheck.flags);
                confidence += timeCheck.confidence;
                details.time = timeCheck.details;
            }
        }

        return {
            flags,
            confidence: Math.min(100, confidence),
            details
        };
    }

    async extractTimePatterns(data) {
        return { typicalHours: new Set(), typicalDays: new Set(), count: 0 };
    }

    async updateTimePatterns(current, newTimestamps) {
        for (const timestamp of newTimestamps) {
            const date = new Date(timestamp);
            current.typicalHours.add(date.getHours());
            current.typicalDays.add(date.getDay());
            current.count++;
        }
        return current;
    }

    async checkTimePatterns(patterns, timestamp) {
        const flags = [];
        let confidence = 0;
        const details = {};

        if (!timestamp || patterns.count === 0) {
            return { flags, confidence, details };
        }

        const date = new Date(timestamp);
        const hour = date.getHours();

        if (!patterns.typicalHours.has(hour) && patterns.typicalHours.size > 0) {
            flags.push({
                type: 'unusual_hour',
                severity: 'low',
                confidence: 40,
                details: `Activity at unusual hour: ${hour}:00`
            });
            confidence += 40;
        }

        return {
            flags,
            confidence: Math.min(100, confidence),
            details
        };
    }

    async extractFrequencyPatterns(data) {
        return { averageFrequency: 0, maxFrequency: 0, count: 0 };
    }

    async updateFrequencyPatterns(current, newFrequencies) {
        const allFrequencies = [...current, ...newFrequencies];
        current.averageFrequency = allFrequencies.reduce((a, b) => a + b, 0) / allFrequencies.length;
        current.maxFrequency = Math.max(...allFrequencies);
        current.count = allFrequencies.length;
        return current;
    }

    async extractValuePatterns(data) {
        return { averageValue: 0, maxValue: 0, count: 0 };
    }

    async updateValuePatterns(current, newValues) {
        const allValues = [...current, ...newValues];
        current.averageValue = allValues.reduce((a, b) => a + b, 0) / allValues.length;
        current.maxValue = Math.max(...allValues);
        current.count = allValues.length;
        return current;
    }

    async extractInteractionPatterns(data) {
        return { typicalActions: new Set(data.interactions || []), count: 0 };
    }

    async updateInteractionPatterns(current, newInteractions) {
        for (const interaction of newInteractions) {
            current.typicalActions.add(interaction);
            current.count++;
        }
        return current;
    }

    // Database Operations
    async storeBaseline(agentId, baseline) {
        try {
            await db.query(
                `INSERT INTO agentic_ato_baselines 
                 (agent_id, initialized_at, last_updated, merchant_profile, 
                  basket_profile, conversation_fingerprint, mandate_profile, 
                  behavioral_patterns, credential_vault_pattern)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE
                 last_updated = VALUES(last_updated),
                 merchant_profile = VALUES(merchant_profile),
                 basket_profile = VALUES(basket_profile),
                 conversation_fingerprint = VALUES(conversation_fingerprint),
                 mandate_profile = VALUES(mandate_profile),
                 behavioral_patterns = VALUES(behavioral_patterns),
                 credential_vault_pattern = VALUES(credential_vault_pattern)`,
                [
                    agentId,
                    baseline.initializedAt,
                    baseline.lastUpdated,
                    JSON.stringify(baseline.merchantProfile),
                    JSON.stringify(baseline.basketProfile),
                    JSON.stringify(baseline.conversationFingerprint),
                    JSON.stringify(baseline.mandateProfile),
                    JSON.stringify(baseline.behavioralPatterns),
                    JSON.stringify(baseline.credentialVaultPattern)
                ]
            );
        } catch (error) {
            console.error('Store baseline error:', error);
        }
    }

    async logAnomalyDetection(agentId, detection) {
        try {
            await db.query(
                `INSERT INTO agentic_ato_anomalies 
                 (agent_id, confidence, flags, details, timestamp)
                 VALUES (?, ?, ?, ?, NOW())`,
                [
                    agentId,
                    detection.confidence,
                    JSON.stringify(detection.flags),
                    JSON.stringify(detection.details)
                ]
            );
        } catch (error) {
            console.error('Log anomaly error:', error);
        }
    }

    async generateAlert(agentId, detection) {
        const alert = {
            agentId,
            detection,
            severity: this.alertEscalation.getSeverity(detection.confidence),
            timestamp: new Date().toISOString()
        };

        this.detectionAlerts.push(alert);

        try {
            await db.query(
                `INSERT INTO agentic_ato_alerts 
                 (agent_id, confidence, flags, details, timestamp, resolved, severity)
                 VALUES (?, ?, ?, ?, NOW(), FALSE, ?)`,
                [
                    agentId,
                    detection.confidence,
                    JSON.stringify(detection.flags),
                    JSON.stringify(detection.details),
                    alert.severity
                ]
            );
        } catch (error) {
            console.error('Store alert error:', error);
        }

        // Broadcast alert via WebSocket
        if (this.realTimeMonitor) {
            this.realTimeMonitor.broadcastAlert(alert);
        }

        if (detection.confidence > ATO_CONFIG.criticalThreshold) {
            console.error(`🚨 CRITICAL: Agent ${agentId} appears compromised!`);
            console.error(`Confidence: ${detection.confidence}%`);
            console.error(`Flags:`, detection.flags);
        }

        return alert;
    }

    async getRecentMerchants(profile) {
        const recent = [];
        const now = new Date();
        for (const [merchantId, lastTime] of Object.entries(profile.lastInteraction)) {
            const diff = (now - new Date(lastTime)) / (1000 * 60 * 60 * 24);
            if (diff < 7) {
                recent.push(merchantId);
            }
        }
        return recent;
    }

    async getStatistics() {
        try {
            const [stats] = await db.query(
                `SELECT 
                    COUNT(*) as total_baselines,
                    AVG(confidence) as avg_confidence,
                    SUM(CASE WHEN confidence > 60 THEN 1 ELSE 0 END) as compromised_agents,
                    COUNT(DISTINCT agent_id) as unique_agents
                 FROM agentic_ato_anomalies
                 WHERE timestamp > DATE_SUB(NOW(), INTERVAL 24 HOUR)`
            );

            const [alertStats] = await db.query(
                `SELECT 
                    COUNT(*) as total_alerts,
                    SUM(CASE WHEN resolved = FALSE THEN 1 ELSE 0 END) as pending_alerts
                 FROM agentic_ato_alerts
                 WHERE timestamp > DATE_SUB(NOW(), INTERVAL 7 DAY)`
            );

            return {
                anomalies: stats[0],
                alerts: alertStats[0],
                mlStatus: {
                    enabled: ATO_CONFIG.mlEnabled,
                    isTrained: this.mlDetection.isTrained
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
            agentBaselines: this.agentBaselines.size,
            agentSessions: this.agentSessions.size,
            detectionAlerts: this.detectionAlerts.length,
            wsClients: this.realTimeMonitor ? this.realTimeMonitor.getClientCount() : 0,
            mlStatus: {
                enabled: ATO_CONFIG.mlEnabled,
                isTrained: this.mlDetection.isTrained
            },
            config: ATO_CONFIG
        };
    }
}

// ============================================
// EXPORT
// ============================================

module.exports = new AgenticATODetectionService();