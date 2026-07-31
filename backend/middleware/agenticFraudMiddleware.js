const agenticFraudDetection = require('../services/agenticFraudDetectionService');
const { promptInjectionGuard } = require('../services/promptInjectionDetector');
const logger = require('../utils/logger');

const rateLimits = {
    critical: { window: 60000, max: 1 },   // 1 per minute
    high: { window: 60000, max: 5 },        // 5 per minute
    medium: { window: 60000, max: 20 },     // 20 per minute
    low: { window: 60000, max: 100 }        // 100 per minute
};

const requestCounts = new Map();

function getRateLimit(riskLevel) {
    return rateLimits[riskLevel] || rateLimits.low;
}

function checkRateLimit(agentId, riskLevel) {
    const key = `${agentId}:${riskLevel}`;
    const now = Date.now();
    const limit = getRateLimit(riskLevel);
    
    if (!requestCounts.has(key)) {
        requestCounts.set(key, { count: 1, resetAt: now + limit.window });
        return true;
    }
    
    const data = requestCounts.get(key);
    if (now > data.resetAt) {
        requestCounts.set(key, { count: 1, resetAt: now + limit.window });
        return true;
    }
    
    if (data.count >= limit.max) {
        return false;
    }
    
    data.count++;
    requestCounts.set(key, data);
    return true;
}

async function detectAgenticFraud(req, res, next) {
    try {
        const { agentId, action, data, prompt } = req.body;
        const userId = req.user?.id;

        if (!agentId) {
            return next();
        }

        // First, run prompt injection guard if prompt exists
        if (prompt) {
            const injected = await new Promise((resolve) => {
                const mockRes = {
                    status: function(code) {
                        return {
                            json: function(data) {
                                resolve({ blocked: true, ...data });
                            }
                        };
                    }
                };
                const mockNext = () => resolve({ blocked: false });
                promptInjectionGuard(
                    { ...req, body: { ...req.body, prompt } },
                    mockRes,
                    mockNext
                );
            });

            if (injected.blocked) {
                logger.warn('Agentic fraud: Prompt injection blocked', {
                    agentId,
                    userId,
                    riskLevel: injected.riskLevel,
                    patterns: injected.detectedPatterns
                });
                return res.status(403).json({
                    success: false,
                    error: 'Prompt injection detected',
                    riskLevel: injected.riskLevel,
                    detectedPatterns: injected.detectedPatterns
                });
            }
        }

        // Build agent data
        const agentData = {
            agentId,
            type: req.headers['x-agent-type'] || 'unknown',
            signature: req.headers['x-agent-signature'] || null,
            provider: req.headers['x-agent-provider'] || 'unknown',
            version: req.headers['x-agent-version'] || '1.0.0',
            provenance: {
                provider: req.headers['x-agent-provider'],
                version: req.headers['x-agent-version'],
                createdAt: req.headers['x-agent-created-at'] || new Date().toISOString()
            }
        };

        const context = {
            userId,
            action,
            data,
            prompt,
            interactionSpeed: req.headers['x-interaction-speed'],
            navigationPattern: req.headers['x-navigation-pattern'],
            formCompletionTime: req.headers['x-form-completion-time'],
            mandate: req.session?.mandate || null,
            ip: req.ip,
            userAgent: req.headers['user-agent'],
            referer: req.headers['referer'],
            path: req.path,
            method: req.method,
            contextPoisoningIndicators: req.headers['x-context-poisoning']?.split(',') || []
        };

        // Evaluate agent interaction
        const evaluation = await agenticFraudDetection.evaluateAgentInteraction(agentData, context);
        req.agenticFraudEvaluation = evaluation;

        // Apply rate limiting based on risk level
        if (!checkRateLimit(agentId, evaluation.riskLevel)) {
            logger.warn('Rate limit exceeded for agent', {
                agentId,
                riskLevel: evaluation.riskLevel
            });
            return res.status(429).json({
                success: false,
                error: 'Rate limit exceeded',
                riskLevel: evaluation.riskLevel,
                retryAfter: getRateLimit(evaluation.riskLevel).window / 1000
            });
        }

        // Block fraudulent agents
        if (evaluation.isFraudulent || evaluation.riskLevel === 'critical') {
            logger.warn('Agentic fraud detected', {
                agentId,
                userId,
                riskLevel: evaluation.riskLevel,
                trustScore: evaluation.trustScore,
                flags: evaluation.flags,
                quarantineTriggered: evaluation.quarantineTriggered
            });
            return res.status(403).json({
                success: false,
                error: 'Agent interaction flagged as fraudulent',
                trustScore: evaluation.trustScore,
                riskLevel: evaluation.riskLevel,
                flags: evaluation.flags,
                recommendations: evaluation.recommendations,
                quarantineTriggered: evaluation.quarantineTriggered
            });
        }

        if (evaluation.riskLevel === 'high') {
            res.setHeader('X-Agent-Risk-Level', 'high');
            res.setHeader('X-Agent-Trust-Score', evaluation.trustScore);
            res.setHeader('X-Agent-Recommendations', JSON.stringify(evaluation.recommendations));
        }

        // Add warnings for medium risk
        if (evaluation.riskLevel === 'medium') {
            res.setHeader('X-Agent-Risk-Level', 'medium');
            res.setHeader('X-Agent-Trust-Score', evaluation.trustScore);
            if (evaluation.recommendations.length > 0) {
                res.setHeader('X-Agent-Warning', evaluation.recommendations[0]);
            }
        }

        // Log evaluation summary
        logger.info('Agentic fraud evaluation completed', {
            agentId,
            trustScore: evaluation.trustScore,
            riskLevel: evaluation.riskLevel,
            flagCount: evaluation.flags.length
        });

        next();
    } catch (error) {
        logger.error('Agentic fraud detection error:', error);
        next();
    }
}

async function getAgentReputation(req, res, next) {
    try {
        const { agentId } = req.params;

        if (!agentId) {
            return next();
        }

        const reputation = await agenticFraudDetection.getAgentReputation(agentId);
        req.agentReputation = reputation;

        next();
    } catch (error) {
        logger.error('Agent reputation error:', error);
        next();
    }
}

async function releaseFromQuarantine(req, res, next) {
    try {
        const { agentId } = req.params;
        const { reason } = req.body;
        const adminId = req.user?.id;

        if (!agentId) {
            return res.status(400).json({
                success: false,
                error: 'Agent ID is required'
            });
        }

        if (!adminId) {
            return res.status(401).json({
                success: false,
                error: 'Authentication required'
            });
        }

        const result = await agenticFraudDetection.releaseFromQuarantine(agentId, adminId, reason);
        res.status(200).json({
            success: true,
            ...result
        });
    } catch (error) {
        logger.error('Release from quarantine error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to release agent from quarantine'
        });
    }
}

async function getQuarantinedAgents(req, res, next) {
    try {
        const agents = agenticFraudDetection.getQuarantinedAgents();
        res.status(200).json({
            success: true,
            data: agents,
            count: agents.length
        });
    } catch (error) {
        logger.error('Get quarantined agents error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get quarantined agents'
        });
    }
}

module.exports = {
    detectAgenticFraud,
    getAgentReputation,
    releaseFromQuarantine,
    getQuarantinedAgents,
    checkRateLimit,
    getRateLimit
};