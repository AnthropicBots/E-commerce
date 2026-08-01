// backend/middleware/agenticFraudMiddleware.js
const agenticFraudDetection = require('../services/agenticFraudDetectionService');
const {
    detectContextPoisoning,
    isQuarantined,
    wrapWithBoundaryTags
} = require('../services/promptInjectionDetector');

/**
 * Collect likely user-generated text from the request body for injection scans.
 */
function extractUserFacingContent(body = {}) {
    const {
        review,
        message,
        address,
        shippingAddress,
        billingAddress,
        notes,
        prompt,
        chatMessage,
        content,
        comment,
        data
    } = body;

    return {
        review,
        message,
        address: typeof address === 'string' ? address : undefined,
        shippingAddress: typeof shippingAddress === 'string'
            ? shippingAddress
            : (shippingAddress && typeof shippingAddress === 'object'
                ? JSON.stringify(shippingAddress)
                : undefined),
        billingAddress: typeof billingAddress === 'string'
            ? billingAddress
            : (billingAddress && typeof billingAddress === 'object'
                ? JSON.stringify(billingAddress)
                : undefined),
        notes,
        prompt,
        chatMessage,
        content,
        comment,
        ...(data && typeof data === 'object' ? data : {})
    };
}

/**
 * Middleware to detect agentic fraud + prompt / context poisoning
 */
async function detectAgenticFraud(req, res, next) {
    try {
        const { agentId, action, data } = req.body;
        const userId = req.user?.id;
        const headerAgentId = req.headers['x-agent-id'];
        const resolvedAgentId = agentId || headerAgentId;

        if (!resolvedAgentId) {
            return next();
        }

        if (isQuarantined(resolvedAgentId) || (userId && isQuarantined(userId))) {
            return res.status(403).json({
                success: false,
                error: 'Agent or user is quarantined due to prompt injection activity',
                errorCode: 'AGENT_QUARANTINED'
            });
        }

        // Pre-scan user-facing fields (reviews, chat, address) before agent evaluation
        const userContent = extractUserFacingContent(req.body);
        const poisonScan = await detectContextPoisoning(userContent, userId || 'anonymous', {
            agentId: resolvedAgentId,
            action,
            ip: req.ip,
            userAgent: req.headers['user-agent'],
            source: 'agentic_fraud_middleware'
        });

        req.contextPoisoningScan = poisonScan;

        if (!poisonScan.safe && (poisonScan.riskLevel === 'high' || poisonScan.riskLevel === 'critical')) {
            return res.status(403).json({
                success: false,
                error: 'Context poisoning / prompt injection detected in agent inputs',
                errorCode: 'CONTEXT_POISONING_BLOCKED',
                riskLevel: poisonScan.riskLevel,
                fields: (poisonScan.fieldResults || [])
                    .filter(f => !f.safe)
                    .map(f => ({
                        field: f.field,
                        riskLevel: f.riskLevel,
                        patterns: f.detectedPatterns
                    }))
            });
        }

        // Prefer sanitized + boundary-wrapped text for any downstream LLM use
        if (poisonScan.fieldResults?.length) {
            req.safeAgentContext = poisonScan.fieldResults.reduce((acc, field) => {
                acc[field.field] = {
                    sanitized: field.sanitized,
                    contained: field.contained || wrapWithBoundaryTags(field.sanitized, field.field)
                };
                return acc;
            }, {});
        }

        // Build agent data
        const agentData = {
            agentId: resolvedAgentId,
            type: req.headers['x-agent-type'] || 'unknown',
            signature: req.headers['x-agent-signature'] || null,
            provider: req.headers['x-agent-provider'] || 'unknown',
            provenance: {
                provider: req.headers['x-agent-provider'],
                version: req.headers['x-agent-version'],
                createdAt: req.headers['x-agent-created-at']
            }
        };

        // Build context (include user text so the fraud service can re-scan)
        const context = {
            userId,
            action,
            data: poisonScan.sanitizedPayload || data,
            review: req.body.review,
            message: req.body.message,
            address: req.body.address,
            notes: req.body.notes,
            prompt: req.body.prompt,
            chatMessage: req.body.chatMessage,
            interactionSpeed: req.headers['x-interaction-speed'],
            navigationPattern: req.headers['x-navigation-pattern'],
            formCompletionTime: req.headers['x-form-completion-time'],
            mandate: req.session?.mandate || null,
            ip: req.ip,
            userAgent: req.headers['user-agent']
        };

        // Evaluate agent interaction
        const evaluation = await agenticFraudDetection.evaluateAgentInteraction(agentData, context);

        // Store evaluation in request
        req.agenticFraudEvaluation = evaluation;

        // Block fraudulent / quarantined agents
        if (evaluation.isFraudulent || evaluation.riskLevel === 'critical' || evaluation.quarantined) {
            return res.status(403).json({
                success: false,
                error: 'Agent interaction flagged as fraudulent',
                trustScore: evaluation.trustScore,
                riskLevel: evaluation.riskLevel,
                flags: evaluation.flags,
                recommendations: evaluation.recommendations,
                promptInjection: evaluation.promptInjection
                    ? {
                        riskLevel: evaluation.promptInjection.riskLevel,
                        riskScore: evaluation.promptInjection.riskScore
                    }
                    : undefined
            });
        }

        // Rate limit for high risk
        if (evaluation.riskLevel === 'high') {
            res.setHeader('X-Agent-Risk-Level', 'high');
            res.setHeader('X-Agent-Trust-Score', evaluation.trustScore);
        }

        if (poisonScan.riskLevel && poisonScan.riskLevel !== 'low') {
            res.setHeader('X-Context-Poison-Risk', poisonScan.riskLevel);
        }

        next();
    } catch (error) {
        console.error('Agentic fraud detection error:', error);
        next();
    }
}

/**
 * Middleware to get agent reputation
 */
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
        console.error('Agent reputation error:', error);
        next();
    }
}

module.exports = {
    detectAgenticFraud,
    getAgentReputation,
    extractUserFacingContent
};
