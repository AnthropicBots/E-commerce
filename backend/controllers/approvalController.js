// backend/controllers/approvalController.js
//
// Fixes #1293.
//
// This file previously contained three concatenated copies of the same seven
// handlers. Each copy re-declared `const ApprovalService` in module scope, so
// the file did not parse:
//
//     SyntaxError: Identifier 'ApprovalService' has already been declared
//
// That took `routes/approvalRoutes.js` down with it, and because server.js
// requires that router at load time, the whole process failed to boot.
//
// The three copies also disagreed on the response envelope, so deduplicating
// alone would have silently changed the API. Responses here follow the shape
// documented in CONTRIBUTING.md: { success, message, data }.

const ApprovalService = require('../services/approvalService');
const { safeObject, sanitizeString } = require('../utils/helpers');

// The service throws tagged errors (ValidationError 400, AuthorizationError
// 403, NotFoundError 404, ConflictError 409), each carrying a `statusCode`.
// The previous implementation collapsed all of them to 500 and echoed
// `error.message` straight to the client, which both misreported the failure
// and leaked internal detail on genuine faults.
const CLIENT_ERROR_NAMES = new Set([
    'ValidationError',
    'AuthorizationError',
    'NotFoundError',
    'ConflictError'
]);

/**
 * Translate a service-layer error into an HTTP response.
 *
 * Expected, client-caused failures keep their message so the caller can act on
 * it. Anything else is logged server-side and reported generically.
 *
 * @param {import('express').Response} res
 * @param {Error} error
 * @param {string} context - Handler name, used for the server-side log line.
 */
function respondWithError(res, error, context) {
    const status = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
    const isClientError = CLIENT_ERROR_NAMES.has(error?.name) && status < 500;

    if (!isClientError) {
        console.error(`APPROVAL ${context} ERROR:`, error);
    }

    return res.status(status).json({
        success: false,
        message: isClientError ? error.message : 'Approval request could not be processed'
    });
}

/**
 * Read the authenticated user id, or null when the request is unauthenticated.
 *
 * Every handler below except `requestApproval` dereferenced `req.user.id`
 * directly. `authMiddleware` normally guarantees `req.user`, but a throw here
 * produces an opaque 500 rather than a 401, so it is checked explicitly.
 *
 * @param {import('express').Request} req
 * @returns {string|number|null}
 */
function getUserId(req) {
    return req.user?.id ?? null;
}

/**
 * Guard for handlers that need an authenticated user.
 *
 * @returns {boolean} true when the request was rejected.
 */
function rejectIfUnauthenticated(req, res) {
    if (getUserId(req) === null) {
        res.status(401).json({
            success: false,
            message: 'Authentication required'
        });
        return true;
    }
    return false;
}

/**
 * Validate the `:approvalId` route parameter.
 *
 * @returns {string|null} The trimmed id, or null when it is missing/blank.
 */
function readApprovalId(req) {
    const approvalId = sanitizeString(req.params.approvalId);
    return approvalId.length > 0 ? approvalId : null;
}

/**
 * Reject a request whose `:approvalId` is missing or blank.
 *
 * @returns {boolean} true when the request was rejected.
 */
function rejectIfNoApprovalId(approvalId, res) {
    if (!approvalId) {
        res.status(400).json({
            success: false,
            message: 'A valid approval ID is required'
        });
        return true;
    }
    return false;
}

/**
 * POST /api/approvals/request
 *
 * Request approval for a transaction.
 */
exports.requestApproval = async (req, res) => {
    try {
        if (rejectIfUnauthenticated(req, res)) return;

        const transactionId = sanitizeString(req.body?.transactionId);
        if (!transactionId) {
            return res.status(400).json({
                success: false,
                message: 'transactionId is required'
            });
        }

        // `requiredApprovals` is optional and defaults to 1 in the service.
        // It is validated here so a malformed body is a 400 rather than a 500
        // thrown from inside the service.
        let requiredApprovals = 1;
        if (req.body?.requiredApprovals !== undefined) {
            requiredApprovals = Number(req.body.requiredApprovals);
            if (!Number.isInteger(requiredApprovals) || requiredApprovals < 1) {
                return res.status(400).json({
                    success: false,
                    message: 'requiredApprovals must be a positive integer'
                });
            }
        }

        const context = safeObject(req.body?.context, {});

        const approval = await ApprovalService.requestApproval(
            transactionId,
            requiredApprovals,
            context
        );

        return res.status(201).json({
            success: true,
            message: 'Approval request created successfully',
            data: approval
        });
    } catch (error) {
        return respondWithError(res, error, 'REQUEST');
    }
};

/**
 * POST /api/approvals/:approvalId/approve
 *
 * Record an approval decision for the authenticated user.
 */
exports.approveTransaction = async (req, res) => {
    try {
        if (rejectIfUnauthenticated(req, res)) return;

        const approvalId = readApprovalId(req);
        if (rejectIfNoApprovalId(approvalId, res)) return;

        const comment = sanitizeString(req.body?.comment);

        const approval = await ApprovalService.approveTransaction(
            approvalId,
            getUserId(req),
            comment
        );

        return res.status(200).json({
            success: true,
            message: 'Transaction approved',
            data: approval
        });
    } catch (error) {
        return respondWithError(res, error, 'APPROVE');
    }
};

/**
 * POST /api/approvals/:approvalId/reject
 *
 * Record a rejection for the authenticated user.
 */
exports.rejectTransaction = async (req, res) => {
    try {
        if (rejectIfUnauthenticated(req, res)) return;

        const approvalId = readApprovalId(req);
        if (rejectIfNoApprovalId(approvalId, res)) return;

        const comment = sanitizeString(req.body?.comment);

        const approval = await ApprovalService.rejectTransaction(
            approvalId,
            getUserId(req),
            comment
        );

        return res.status(200).json({
            success: true,
            message: 'Transaction rejected',
            data: approval
        });
    } catch (error) {
        return respondWithError(res, error, 'REJECT');
    }
};

/**
 * GET /api/approvals/pending
 *
 * List approvals still awaiting the authenticated user's decision.
 */
exports.getPendingApprovals = async (req, res) => {
    try {
        if (rejectIfUnauthenticated(req, res)) return;

        const approvals = await ApprovalService.getPendingApprovals(getUserId(req));

        return res.status(200).json({
            success: true,
            message: 'Pending approvals retrieved',
            data: approvals
        });
    } catch (error) {
        return respondWithError(res, error, 'PENDING');
    }
};

/**
 * POST /api/approvals/:approvalId/checkpoint
 *
 * Attach a verification checkpoint to an approval.
 */
exports.addCheckpoint = async (req, res) => {
    try {
        if (rejectIfUnauthenticated(req, res)) return;

        const approvalId = readApprovalId(req);
        if (rejectIfNoApprovalId(approvalId, res)) return;

        const checkpointName = sanitizeString(req.body?.checkpointName);
        if (!checkpointName) {
            return res.status(400).json({
                success: false,
                message: 'checkpointName is required'
            });
        }

        const metadata = safeObject(req.body?.metadata, {});

        const approval = await ApprovalService.addVerificationCheckpoint(
            approvalId,
            checkpointName,
            metadata
        );

        return res.status(200).json({
            success: true,
            message: 'Checkpoint added',
            data: approval
        });
    } catch (error) {
        return respondWithError(res, error, 'ADD_CHECKPOINT');
    }
};

/**
 * POST /api/approvals/:approvalId/verify
 *
 * Mark a previously added checkpoint as verified.
 */
exports.verifyCheckpoint = async (req, res) => {
    try {
        if (rejectIfUnauthenticated(req, res)) return;

        const approvalId = readApprovalId(req);
        if (rejectIfNoApprovalId(approvalId, res)) return;

        const checkpointName = sanitizeString(req.body?.checkpointName);
        if (!checkpointName) {
            return res.status(400).json({
                success: false,
                message: 'checkpointName is required'
            });
        }

        const approval = await ApprovalService.verifyCheckpoint(
            approvalId,
            checkpointName,
            getUserId(req)
        );

        return res.status(200).json({
            success: true,
            message: 'Checkpoint verified',
            data: approval
        });
    } catch (error) {
        return respondWithError(res, error, 'VERIFY_CHECKPOINT');
    }
};

/**
 * POST /api/approvals/:approvalId/escalate
 *
 * Escalate an approval to an administrator. Admin-only at the route layer.
 */
exports.escalateApproval = async (req, res) => {
    try {
        if (rejectIfUnauthenticated(req, res)) return;

        const approvalId = readApprovalId(req);
        if (rejectIfNoApprovalId(approvalId, res)) return;

        const reason = sanitizeString(req.body?.reason);
        if (!reason) {
            return res.status(400).json({
                success: false,
                message: 'An escalation reason is required'
            });
        }

        const approval = await ApprovalService.escalateApproval(
            approvalId,
            getUserId(req),
            reason
        );

        return res.status(200).json({
            success: true,
            message: 'Approval escalated successfully',
            data: approval
        });
    } catch (error) {
        return respondWithError(res, error, 'ESCALATE');
    }
};
