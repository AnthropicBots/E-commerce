// backend/controllers/productQAController.js
//
// HTTP surface for product Q&A (#1353).
//
// Thin by design: everything that spans more than one row -- author standing,
// vote idempotence, the report threshold, answer counts -- lives in
// productQAService, because each needs a transaction.

const productQAService = require('../services/productQAService');
const {
    QAError,
    REPORT_REASONS,
    MIN_QUESTION_LENGTH,
    MAX_QUESTION_LENGTH
} = require('../services/productQAService');
const { safeUUID } = require('../utils/helpers');

/**
 * The authenticated user's id.
 *
 * authMiddleware attaches the decoded token, which carries `id` on some paths
 * and `userId` on others. Reaching for one shape and silently getting undefined
 * on the other means a `WHERE user_id = ?` that matches nothing.
 */
function resolveUserId(req) {
    return req.user?.id ?? req.user?.userId;
}

/**
 * Map a thrown error onto a response.
 *
 * QAError carries its own status; anything else is unexpected, so the detail
 * goes to the log and the caller gets a generic message (#1076).
 */
function handleError(res, error, context) {
    if (error instanceof QAError) {
        return res.status(error.status).json({
            success: false,
            message: error.message,
            code: error.code
        });
    }

    console.error(`${context}:`, error);

    return res.status(500).json({
        success: false,
        message: 'Something went wrong. Please try again.'
    });
}

/**
 * GET /api/products/:id/questions
 *
 * Public. `viewerId` is optional and used only to tell the client which items
 * it has already voted on, so a button renders as pressed rather than
 * discovering it on click.
 */
const listQuestions = async (req, res) => {
    const productId = safeUUID(req.params.id);

    if (!productId) {
        return res.status(400).json({ success: false, message: 'Invalid product ID' });
    }

    try {
        const result = await productQAService.listQuestions(productId, {
            page: req.query.page,
            limit: req.query.limit,
            sort: req.query.sort,
            unansweredOnly: req.query.unanswered === 'true',
            viewerId: resolveUserId(req)
        });

        return res.status(200).json({
            success: true,
            ...result,
            // So the client does not carry its own copy of the constraints and
            // reject something the server would have accepted, or vice versa.
            limits: {
                minQuestionLength: MIN_QUESTION_LENGTH,
                maxQuestionLength: MAX_QUESTION_LENGTH
            },
            reportReasons: REPORT_REASONS
        });
    } catch (error) {
        return handleError(res, error, 'LIST PRODUCT QUESTIONS ERROR');
    }
};

/**
 * POST /api/products/:id/questions
 *
 * No purchase check, unlike reviews. The asker has not bought yet -- that is
 * the entire reason this endpoint exists.
 */
const askQuestion = async (req, res) => {
    const productId = safeUUID(req.params.id);

    if (!productId) {
        return res.status(400).json({ success: false, message: 'Invalid product ID' });
    }

    try {
        const question = await productQAService.askQuestion(
            resolveUserId(req),
            productId,
            req.body?.body
        );

        return res.status(201).json({
            success: true,
            message: 'Question posted. Other shoppers and the seller can answer it.',
            data: question
        });
    } catch (error) {
        return handleError(res, error, 'ASK PRODUCT QUESTION ERROR');
    }
};

/**
 * POST /api/products/questions/:questionId/answers
 *
 * The answerer's standing is resolved server-side; a client cannot claim to be
 * a verified owner.
 */
const answerQuestion = async (req, res) => {
    try {
        const answer = await productQAService.answerQuestion(
            req.user,
            req.params.questionId,
            req.body?.body
        );

        return res.status(201).json({
            success: true,
            message: 'Answer posted.',
            data: answer
        });
    } catch (error) {
        return handleError(res, error, 'ANSWER PRODUCT QUESTION ERROR');
    }
};

/**
 * POST /api/products/questions/:questionId/helpful
 * POST /api/products/answers/:answerId/helpful
 */
function voteHandler(targetType, idParam) {
    return async (req, res) => {
        try {
            const result = await productQAService.vote(resolveUserId(req), {
                targetType,
                targetId: req.params[idParam],
                voteType: 'helpful'
            });

            return res.status(200).json({
                success: true,
                message: result.alreadyVoted
                    ? 'You have already marked this as helpful'
                    : 'Thanks for the feedback',
                ...result
            });
        } catch (error) {
            return handleError(res, error, `VOTE ${targetType.toUpperCase()} ERROR`);
        }
    };
}

/**
 * DELETE /api/products/questions/:questionId/helpful
 * DELETE /api/products/answers/:answerId/helpful
 */
function unvoteHandler(targetType, idParam) {
    return async (req, res) => {
        try {
            const result = await productQAService.unvote(resolveUserId(req), {
                targetType,
                targetId: req.params[idParam]
            });

            return res.status(200).json({ success: true, message: 'Vote withdrawn', ...result });
        } catch (error) {
            return handleError(res, error, `UNVOTE ${targetType.toUpperCase()} ERROR`);
        }
    };
}

/**
 * POST /api/products/questions/:questionId/report
 * POST /api/products/answers/:answerId/report
 *
 * The response is identical whether or not this report crossed the auto-flag
 * threshold. Telling a reporter "two more and it disappears" is an invitation
 * to organise.
 */
function reportHandler(targetType, idParam) {
    return async (req, res) => {
        try {
            const result = await productQAService.vote(resolveUserId(req), {
                targetType,
                targetId: req.params[idParam],
                voteType: 'report',
                reason: req.body?.reason,
                details: req.body?.details
            });

            return res.status(200).json({
                success: true,
                message: result.alreadyVoted
                    ? 'You have already reported this'
                    : 'Thanks — this has been sent for moderation',
                targetId: result.targetId
            });
        } catch (error) {
            return handleError(res, error, `REPORT ${targetType.toUpperCase()} ERROR`);
        }
    };
}

/**
 * GET /api/products/qa/moderation/queue  (admin)
 *
 * Questions and answers together: a moderator works one queue, and an answer is
 * usually only judgeable next to its question.
 */
const getModerationQueue = async (req, res) => {
    try {
        const queue = await productQAService.getModerationQueue({
            status: req.query.status,
            limit: req.query.limit
        });

        return res.status(200).json({ success: true, ...queue });
    } catch (error) {
        return handleError(res, error, 'QA MODERATION QUEUE ERROR');
    }
};

/**
 * PATCH /api/products/qa/:targetType/:targetId/moderate  (admin)
 */
const moderate = async (req, res) => {
    try {
        const result = await productQAService.moderate(resolveUserId(req), {
            targetType: req.params.targetType,
            targetId: req.params.targetId,
            status: req.body?.status,
            notes: req.body?.notes
        });

        return res.status(200).json({
            success: true,
            message: `${result.targetType} ${result.status}`,
            ...result
        });
    } catch (error) {
        return handleError(res, error, 'QA MODERATE ERROR');
    }
};

/**
 * DELETE /api/products/qa/:targetType/:targetId  (admin)
 *
 * Soft delete, so a takedown stays reviewable.
 */
const removeItem = async (req, res) => {
    try {
        const result = await productQAService.softDelete(resolveUserId(req), {
            targetType: req.params.targetType,
            targetId: req.params.targetId,
            reason: req.body?.reason
        });

        return res.status(200).json({ success: true, message: 'Removed', ...result });
    } catch (error) {
        return handleError(res, error, 'QA DELETE ERROR');
    }
};

module.exports = {
    listQuestions,
    askQuestion,
    answerQuestion,
    voteQuestion: voteHandler('question', 'questionId'),
    unvoteQuestion: unvoteHandler('question', 'questionId'),
    reportQuestion: reportHandler('question', 'questionId'),
    voteAnswer: voteHandler('answer', 'answerId'),
    unvoteAnswer: unvoteHandler('answer', 'answerId'),
    reportAnswer: reportHandler('answer', 'answerId'),
    getModerationQueue,
    moderate,
    removeItem
};
