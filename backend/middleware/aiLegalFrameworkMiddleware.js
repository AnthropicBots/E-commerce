// backend/middleware/aiLegalFrameworkMiddleware.js
const auditTrail = require('../services/aiAuditTrailService');

/**
 * Middleware to enforce legal framework for AI actions
 */
async function aiLegalFrameworkMiddleware(req, res, next) {
    try {
        const { action, data, agentId } = req.body;
        const userId = req.user?.id || 'system';

        // Check if this is a negotiation action
        if (action === 'negotiate' || action === 'deal') {
            // Start audit session
            const sessionId = auditTrail.startSession(agentId, userId, {
                ip: req.ip,
                userAgent: req.headers['user-agent'],
                action
            });

            // Log negotiation step
            auditTrail.logNegotiationStep('initiated', data, {
                userId,
                agentId,
                timestamp: new Date().toISOString()
            });

            // Attach session to request
            req.auditSessionId = sessionId;
            req.auditTrail = auditTrail;
        }

        next();
    } catch (error) {
        console.error('Legal framework error:', error);
        next(error);
    }
}

/**
 * Middleware to create Certificate of Action
 */
async function createCertificateOfAction(req, res, next) {
    try {
        const { action, data } = req.body;
        const sessionId = req.auditSessionId;

        if (sessionId) {
            // Log decision
            auditTrail.logDecision(action, data.rationale || 'No rationale provided', data.options || []);

            // Create certificate
            const certificate = await auditTrail.createCertificate(action, {
                ...data,
                sessionId,
                timestamp: new Date().toISOString()
            });

            req.certificate = certificate;
        }

        next();
    } catch (error) {
        console.error('Certificate creation error:', error);
        next(error);
    }
}

module.exports = {
    aiLegalFrameworkMiddleware,
    createCertificateOfAction
};