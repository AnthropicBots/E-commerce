// backend/middleware/factTrustMiddleware.js
const factTrustService = require('../services/factTrustService');

/**
 * Middleware for FACT trust verification
 */
async function verifyFACTTrust(req, res, next) {
    try {
        const { agentId, action, data } = req.body;
        const userId = req.user?.id;

        if (!agentId) {
            return next();
        }

        // Check if trust record exists
        let trustRecord = factTrustService.trustRecords.get(agentId);

        if (!trustRecord) {
            // Initialize trust record
            trustRecord = await factTrustService.initializeTrust(agentId, {
                policies: req.body.policies || [],
                constraints: req.body.constraints || {}
            });
        }

        // Verify action
        const verification = await factTrustService.verifyAction(agentId, action, {
            ...data,
            userId,
            timestamp: new Date().toISOString()
        });

        // Attach verification to request
        req.factVerification = verification;

        // Block if not verified
        if (!verification.verified) {
            return res.status(403).json({
                success: false,
                error: 'FACT trust verification failed',
                trustScore: verification.trustScore,
                violations: verification.violations,
                attestation: verification.attestation,
                action: 'blocked'
            });
        }

        // Add trust headers
        res.setHeader('X-FACT-Trust-Score', verification.trustScore);
        res.setHeader('X-FACT-Verified', verification.verified ? 'true' : 'false');
        if (verification.attestation) {
            res.setHeader('X-FACT-Attestation', verification.attestation.id);
        }

        next();
    } catch (error) {
        console.error('FACT trust verification error:', error);
        next();
    }
}

module.exports = {
    verifyFACTTrust
};