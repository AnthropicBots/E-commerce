// backend/controllers/rollbackController.js
//
// `routes/rollbackRoutes.js` destructures four handlers from this module:
//
//     const {
//         initiateRollback, executeRollback, getRollbackStatus, canRollback
//     } = require('../controllers/rollbackController');
//
// The file did not exist, so the require threw MODULE_NOT_FOUND. Because
// server.js mounts that router at load time, the whole process failed to
// start.
//
// `services/rollbackService.js` already implements every one of these
// operations, so this controller is the thin HTTP layer that was missing: it
// validates the route parameter, calls the service, and maps its thrown errors
// onto sensible status codes rather than letting everything surface as a 500.

const rollbackService = require('../services/rollbackService');
const Transaction = require('../models/Transaction');
const { sanitizeString } = require('../utils/helpers');

// The service signals failures by throwing plain Errors with descriptive
// messages. Mapping the known ones keeps the API honest: a request for a
// transaction that does not exist is a 404, and an operation that is not
// currently legal is a 409 -- neither is a server fault.
const NOT_FOUND_PATTERN = /not found/i;
const CONFLICT_PATTERN = /already|cannot|not allowed|in progress/i;

/**
 * Translate a service-layer error into an HTTP response.
 *
 * @param {import('express').Response} res
 * @param {Error} error
 * @param {string} context - Handler name, for the server-side log line.
 */
function respondWithError(res, error, context) {
    const message = error?.message || '';

    if (NOT_FOUND_PATTERN.test(message)) {
        return res.status(404).json({ success: false, message });
    }

    if (CONFLICT_PATTERN.test(message)) {
        return res.status(409).json({ success: false, message });
    }

    console.error(`ROLLBACK ${context} ERROR:`, error);

    return res.status(500).json({
        success: false,
        message: 'Rollback request could not be processed'
    });
}

/**
 * Read and validate the `:transactionId` route parameter.
 *
 * @param {import('express').Request} req
 * @returns {string|null}
 */
function readTransactionId(req) {
    const transactionId = sanitizeString(req.params.transactionId);
    return transactionId.length > 0 ? transactionId : null;
}

/**
 * Reject a request whose `:transactionId` is missing or blank.
 *
 * @returns {boolean} true when the request was already answered.
 */
function rejectIfNoTransactionId(transactionId, res) {
    if (!transactionId) {
        res.status(400).json({
            success: false,
            message: 'A valid transaction ID is required'
        });
        return true;
    }
    return false;
}

/**
 * Reject a request that carries no authenticated user.
 *
 * `authMiddleware` normally guarantees `req.user`, but dereferencing it
 * blindly turns a missing session into an opaque 500.
 *
 * @returns {boolean} true when the request was already answered.
 */
function rejectIfUnauthenticated(req, res) {
    if (!req.user || req.user.id === undefined || req.user.id === null) {
        res.status(401).json({
            success: false,
            message: 'Authentication required'
        });
        return true;
    }
    return false;
}

/**
 * POST /api/rollback/:transactionId/initiate
 *
 * Mark a transaction for rollback and record the reason.
 */
exports.initiateRollback = async (req, res) => {
    try {
        if (rejectIfUnauthenticated(req, res)) return;

        const transactionId = readTransactionId(req);
        if (rejectIfNoTransactionId(transactionId, res)) return;

        const reason = sanitizeString(req.body?.reason);
        if (!reason) {
            return res.status(400).json({
                success: false,
                message: 'A rollback reason is required'
            });
        }

        const result = await rollbackService.initiateRollback(
            transactionId,
            reason,
            req.user.id
        );

        return res.status(200).json({
            success: true,
            message: 'Rollback initiated',
            data: result
        });
    } catch (error) {
        return respondWithError(res, error, 'INITIATE');
    }
};

/**
 * POST /api/rollback/:transactionId/execute
 *
 * Run the compensating actions for a previously initiated rollback.
 * Admin-only at the route layer.
 */
exports.executeRollback = async (req, res) => {
    try {
        if (rejectIfUnauthenticated(req, res)) return;

        const transactionId = readTransactionId(req);
        if (rejectIfNoTransactionId(transactionId, res)) return;

        const result = await rollbackService.executeRollback(
            transactionId,
            req.user.id
        );

        return res.status(200).json({
            success: true,
            message: 'Rollback executed',
            data: result
        });
    } catch (error) {
        return respondWithError(res, error, 'EXECUTE');
    }
};

/**
 * GET /api/rollback/:transactionId/status
 *
 * Report where a transaction currently sits in the rollback lifecycle.
 */
exports.getRollbackStatus = async (req, res) => {
    try {
        const transactionId = readTransactionId(req);
        if (rejectIfNoTransactionId(transactionId, res)) return;

        const status = await rollbackService.getRollbackStatus(transactionId);

        return res.status(200).json({
            success: true,
            message: 'Rollback status retrieved',
            data: status
        });
    } catch (error) {
        return respondWithError(res, error, 'STATUS');
    }
};

/**
 * GET /api/rollback/:transactionId/can-rollback
 *
 * Report whether a rollback is currently permitted, without starting one.
 *
 * `rollbackService.canRollback()` takes the transaction document rather than
 * an id, so the record is loaded here first.
 */
exports.canRollback = async (req, res) => {
    try {
        const transactionId = readTransactionId(req);
        if (rejectIfNoTransactionId(transactionId, res)) return;

        const transaction = await Transaction.findById(transactionId);

        if (!transaction) {
            return res.status(404).json({
                success: false,
                message: 'Transaction not found'
            });
        }

        const allowed = rollbackService.canRollback(transaction);

        return res.status(200).json({
            success: true,
            message: allowed ? 'Rollback is available' : 'Rollback is not available',
            data: {
                transactionId,
                canRollback: allowed,
                status: transaction.status,
                rollbackStatus: transaction.rollback?.status || 'not_started'
            }
        });
    } catch (error) {
        return respondWithError(res, error, 'CAN_ROLLBACK');
    }
};
