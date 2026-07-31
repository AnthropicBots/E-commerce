// backend/middleware/planInjectionMiddleware.js
const planInjectionProtection = require('../services/planInjectionProtectionService');

/**
 * Middleware to protect against plan injections
 */
async function protectAgainstPlanInjections(req, res, next) {
    try {
        const { agentId, context, contextType } = req.body;
        const userId = req.user?.id;

        if (!agentId || !context) {
            return next();
        }

        // Check if secure memory exists
        const memoryId = await planInjectionProtection.getMemoryId(agentId);
        
        if (!memoryId) {
            // Initialize secure memory
            await planInjectionProtection.initializeSecureMemory(agentId, context);
            return next();
        }

        // Store context securely
        const result = await planInjectionProtection.storeContext(agentId, context, contextType);

        // Attach result to request
        req.planInjectionProtection = {
            memoryId,
            version: result.version,
            integrityHash: result.integrityHash,
            protected: true
        };

        next();
    } catch (error) {
        console.error('Plan injection protection error:', error);
        
        if (error.message.includes('Plan injection detected')) {
            return res.status(403).json({
                success: false,
                error: error.message,
                action: 'blocked'
            });
        }

        next();
    }
}

/**
 * Middleware to retrieve protected context
 */
async function retrieveProtectedContext(req, res, next) {
    try {
        const { agentId, contextType } = req.body;
        const userId = req.user?.id;

        if (!agentId) {
            return next();
        }

        const context = await planInjectionProtection.retrieveContext(agentId, contextType);

        req.protectedContext = context;

        next();
    } catch (error) {
        console.error('Context retrieval error:', error);
        
        if (error.message.includes('integrity violation')) {
            return res.status(403).json({
                success: false,
                error: 'Memory integrity violation detected',
                action: 'blocked'
            });
        }

        next();
    }
}

module.exports = {
    protectAgainstPlanInjections,
    retrieveProtectedContext
};