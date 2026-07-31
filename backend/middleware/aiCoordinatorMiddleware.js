// backend/middleware/aiCoordinatorMiddleware.js
const { AIAgentCoordinator } = require('../services/aiAgentCoordinator');
const rateLimit = require('express-rate-limit');
const logger = require('../utils/logger');
const { sanitizeString } = require('../utils/helpers');

// ============================================
// CONSTANTS
// ============================================

const coordinator = new AIAgentCoordinator();

const ACTION_TIMEOUT = parseInt(process.env.AI_ACTION_TIMEOUT) || 30000;
const MAX_SESSION_AGE = parseInt(process.env.AI_SESSION_MAX_AGE) || 3600000;

const actionLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    message: {
        success: false,
        error: 'Too many AI actions. Please try again later.'
    }
});

const priorityMap = {
    admin: 100,
    supervisor: 80,
    merchant: 60,
    customer: 40,
    guest: 20
};

const validActions = [
    'analyze', 'recommend', 'generate', 'moderate',
    'translate', 'summarize', 'classify', 'extract',
    'validate', 'predict', 'optimize', 'review'
];

// ============================================
// VALIDATION FUNCTIONS
// ============================================

function validateAction(action) {
    if (!action || typeof action !== 'string') {
        throw new Error('Action must be a non-empty string');
    }
    if (!validActions.includes(action)) {
        throw new Error(`Invalid action. Allowed: ${validActions.join(', ')}`);
    }
    return true;
}

function validateData(data) {
    if (data === null || data === undefined) {
        return {};
    }
    if (typeof data !== 'object') {
        throw new Error('Data must be an object');
    }
    const dataStr = JSON.stringify(data);
    if (dataStr.length > 100000) {
        throw new Error('Data too large (max 100KB)');
    }
    return data;
}

function validateApprovalId(approvalId) {
    if (!approvalId || typeof approvalId !== 'string' || approvalId.trim().length === 0) {
        throw new Error('Approval ID is required and must be a non-empty string');
    }
    return approvalId.trim();
}

function validateDecision(decision) {
    if (!decision || !['approve', 'reject'].includes(decision)) {
        throw new Error('Decision must be "approve" or "reject"');
    }
    return decision;
}

function validateNotes(notes) {
    if (notes !== undefined && notes !== null) {
        if (typeof notes !== 'string') {
            throw new Error('Notes must be a string');
        }
        if (notes.length > 1000) {
            throw new Error('Notes cannot exceed 1000 characters');
        }
        return sanitizeString(notes.trim());
    }
    return null;
}

function sanitizeData(data) {
    if (typeof data === 'string') {
        return sanitizeString(data);
    }
    if (typeof data === 'object' && data !== null) {
        const sanitized = {};
        for (const [key, value] of Object.entries(data)) {
            sanitized[key] = typeof value === 'string' ? sanitizeString(value) : value;
        }
        return sanitized;
    }
    return data;
}

function getAgentId(req) {
    return req.headers['x-agent-id'] || req.user?.id || `anonymous_${Date.now()}`;
}

function getPriority(userRole) {
    return priorityMap[userRole] || 20;
}

// ============================================
// SESSION CLEANUP
// ============================================

function cleanupSessions() {
    const now = Date.now();
    let cleaned = 0;
    for (const [agentId, session] of coordinator.agentSessions) {
        if (now - session.lastAction > MAX_SESSION_AGE) {
            coordinator.agentSessions.delete(agentId);
            cleaned++;
            logger.debug(`Cleaned up inactive session: ${agentId}`);
        }
    }
    if (cleaned > 0) {
        logger.info(`Cleaned ${cleaned} inactive sessions`);
    }
}

setInterval(cleanupSessions, 60000);

// ============================================
// MIDDLEWARE
// ============================================

async function aiCoordinatorMiddleware(req, res, next) {
    const startTime = Date.now();
    const requestId = req.headers['x-request-id'] || Math.random().toString(36).substring(7);

    try {
        const { action, data } = req.body;
        const agentId = getAgentId(req);
        const userRole = req.user?.role || 'guest';

        if (!action) {
            logger.warn('Missing action in request', { requestId, agentId });
            return res.status(400).json({
                success: false,
                error: 'Action is required'
            });
        }

        validateAction(action);
        const validatedData = validateData(data);
        const sanitizedData = sanitizeData(validatedData);

        const priority = getPriority(userRole);

        if (!coordinator.agentSessions.has(agentId)) {
            coordinator.agentSessions.set(agentId, {
                priority,
                count: 0,
                lastAction: new Date(),
                createdAt: new Date()
            });
        }

        const session = coordinator.agentSessions.get(agentId);
        session.count++;
        session.lastAction = new Date();

        logger.info(`AI Action: ${action}`, {
            requestId,
            agentId,
            userRole,
            priority,
            action
        });

        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Action timeout')), ACTION_TIMEOUT);
        });

        const actionPromise = coordinator.submitAction(
            agentId,
            action,
            sanitizedData,
            {
                userRole,
                ip: req.ip || req.connection.remoteAddress,
                userAgent: req.headers['user-agent'],
                requestId
            }
        );

        const result = await Promise.race([actionPromise, timeoutPromise]);

        const duration = Date.now() - startTime;
        logger.info(`AI Action completed: ${action}`, {
            requestId,
            agentId,
            duration,
            success: true
        });

        res.json({
            success: true,
            data: result,
            requestId,
            duration,
            coordinatorStatus: coordinator.getStatus()
        });

    } catch (error) {
        const duration = Date.now() - startTime;
        logger.error('Coordinator middleware error:', {
            requestId,
            error: error.message,
            stack: error.stack,
            duration
        });

        const statusCode = error.message === 'Action timeout' ? 408 : 500;

        return res.status(statusCode).json({
            success: false,
            error: error.message === 'Action timeout'
                ? 'Request timeout'
                : 'Agent coordination failed',
            requestId
        });
    }
}

// ============================================
// APPROVAL HANDLER
// ============================================

async function handleApproval(req, res) {
    try {
        const { approvalId } = req.params;
        const { decision, notes } = req.body;
        const approverId = req.user?.id || 'system';

        if (!approvalId) {
            return res.status(400).json({
                success: false,
                error: 'Approval ID is required'
            });
        }

        if (!decision || !['approve', 'reject'].includes(decision)) {
            return res.status(400).json({
                success: false,
                error: 'Decision must be "approve" or "reject"'
            });
        }

        const sanitizedNotes = notes ? sanitizeString(notes.trim()) : null;

        let result;
        if (decision === 'approve') {
            result = await coordinator.approveAction(approvalId, approverId, sanitizedNotes);
        } else {
            result = await coordinator.rejectAction(approvalId, approverId, sanitizedNotes);
        }

        logger.info(`Approval ${decision}d`, {
            approvalId,
            approverId,
            decision,
            notes: sanitizedNotes
        });

        res.json({
            success: true,
            message: `Action ${decision}d successfully`,
            data: result
        });

    } catch (error) {
        logger.error('Approval handling error:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to process approval'
        });
    }
}

// ============================================
// COORDINATOR STATUS
// ============================================

async function getCoordinatorStatus(req, res) {
    try {
        if (req.user?.role !== 'admin') {
            logger.warn(`Unauthorized status access attempt by user ${req.user?.id}`);
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const status = {
            coordinator: coordinator.getStatus(),
            metrics: coordinator.getMetrics ? coordinator.getMetrics() : null,
            activeActions: await coordinator.getActiveActions().catch(() => []),
            pendingApprovals: await coordinator.getPendingApprovals().catch(() => []),
            sessionCount: coordinator.agentSessions.size,
            timestamp: new Date().toISOString()
        };

        res.json({
            success: true,
            data: status
        });

    } catch (error) {
        logger.error('Status error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get coordinator status'
        });
    }
}

// ============================================
// AGENT SESSION
// ============================================

async function getAgentSession(req, res) {
    try {
        const agentId = req.params.agentId || req.user?.id;

        if (!agentId) {
            return res.status(400).json({
                success: false,
                error: 'Agent ID is required'
            });
        }

        if (req.user?.role !== 'admin' && req.user?.id !== agentId) {
            return res.status(403).json({
                success: false,
                error: 'Unauthorized access'
            });
        }

        const session = coordinator.agentSessions.get(agentId);

        if (!session) {
            return res.status(404).json({
                success: false,
                error: 'Agent session not found'
            });
        }

        res.json({
            success: true,
            data: {
                agentId,
                ...session,
                age: Date.now() - session.createdAt.getTime()
            }
        });

    } catch (error) {
        logger.error('Agent session error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get agent session'
        });
    }
}

// ============================================
// CLEAR SESSIONS
// ============================================

function clearInactiveSessions(req, res) {
    try {
        if (req.user?.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Admin access required'
            });
        }

        const before = coordinator.agentSessions.size;
        cleanupSessions();
        const after = coordinator.agentSessions.size;

        res.json({
            success: true,
            message: `Cleared ${before - after} inactive sessions`,
            before,
            after
        });

    } catch (error) {
        logger.error('Clear sessions error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to clear sessions'
        });
    }
}

// ============================================
// HEALTH CHECK
// ============================================

async function healthCheck(req, res) {
    try {
        const status = {
            status: 'healthy',
            coordinator: coordinator.getStatus(),
            sessionCount: coordinator.agentSessions.size,
            timestamp: new Date().toISOString()
        };

        res.json({
            success: true,
            data: status
        });

    } catch (error) {
        res.status(503).json({
            success: false,
            error: 'Coordinator service unavailable',
            timestamp: new Date().toISOString()
        });
    }
}

// ============================================
// EXPORTS - MOVED OUTSIDE THE FUNCTION ✅
// ============================================

module.exports = {
    aiCoordinatorMiddleware,
    handleApproval,
    getCoordinatorStatus,
    getAgentSession,
    clearInactiveSessions,
    healthCheck,
    coordinator,
    actionLimiter,
    validActions
};