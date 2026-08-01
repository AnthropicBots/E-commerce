// backend/services/productQAService.js
//
// Product questions and answers (#1353).
//
// The gap this fills is structural, not cosmetic: `createProductReview` refuses
// anyone without a `delivered` order containing the product. That is correct
// for reviews -- it is what makes the verified-purchase badge mean anything --
// but it means the only people who could post about a product were those for
// whom the purchase decision was already made. The people with pre-purchase
// questions were precisely the ones locked out.
//
// So: anyone signed in may ask. Anyone may answer, with their standing shown
// rather than assumed.

const crypto = require('crypto');
const db = require('../config/db');
const { safeArray, safeInteger, sanitizeString } = require('../utils/helpers');

/**
 * How much weight an answer's author carries.
 *
 * A shopper reading an answer needs to know which of these they are reading: an
 * answer from someone holding the product is worth more than a guess, and
 * presenting them identically is how a confident guess outranks the truth.
 *
 * `owner` is resolved with exactly the check createProductReview performs, so
 * the badge means precisely what the verified-purchase badge on a review means.
 */
const AUTHOR_TYPES = Object.freeze(['owner', 'seller', 'staff', 'shopper']);

/** Ordering weight for author_type. Higher sorts first. */
const AUTHOR_RANK = Object.freeze({
    seller: 3,
    staff: 3,
    owner: 2,
    shopper: 1
});

const STATUSES = Object.freeze(['approved', 'pending', 'rejected']);

const REPORT_REASONS = Object.freeze([
    'spam',
    'offensive',
    'off_topic',
    'personal_info',
    'other'
]);

/**
 * Reports before an item is pulled for a human to look at.
 *
 * A threshold rather than one: a single report is a disagreement, and letting
 * one shopper hide a question they dislike turns the report button into a
 * censorship tool.
 */
const REPORT_FLAG_THRESHOLD = Number(process.env.QA_REPORT_THRESHOLD) || 3;

const MIN_QUESTION_LENGTH = 10;
const MAX_QUESTION_LENGTH = 1000;
const MIN_ANSWER_LENGTH = 2;
const MAX_ANSWER_LENGTH = 2000;

const MAX_PAGE_SIZE = 50;
const DEFAULT_PAGE_SIZE = 10;

class QAError extends Error {
    constructor(message, status = 400, code = 'QA_ERROR') {
        super(message);
        this.name = 'QAError';
        this.status = status;
        this.code = code;
    }
}

class ProductQAService {
    // ----------------------------------------------------------------
    // Asking
    // ----------------------------------------------------------------

    /**
     * Ask a question about a product.
     *
     * Deliberately no purchase check. The asker has not bought yet -- that is
     * the entire reason this exists.
     *
     * @param {string} userId
     * @param {string} productId
     * @param {string} body
     */
    async askQuestion(userId, productId, body) {
        if (!userId) throw new QAError('Sign in to ask a question', 401, 'UNAUTHENTICATED');

        const text = sanitizeString(body || '').trim();

        // A minimum length, because "?" and "hi" are not questions and a page
        // of them is worse than an empty section.
        if (text.length < MIN_QUESTION_LENGTH) {
            throw new QAError(
                `A question needs at least ${MIN_QUESTION_LENGTH} characters`,
                400,
                'QUESTION_TOO_SHORT'
            );
        }

        if (text.length > MAX_QUESTION_LENGTH) {
            throw new QAError(
                `A question can be at most ${MAX_QUESTION_LENGTH} characters`,
                400,
                'QUESTION_TOO_LONG'
            );
        }

        const [products] = await db.query(
            'SELECT id FROM products WHERE id = ? AND deleted_at IS NULL LIMIT 1',
            [productId]
        );

        if (!safeArray(products).length) {
            throw new QAError('Product not found', 404, 'PRODUCT_NOT_FOUND');
        }

        const id = crypto.randomUUID();

        await db.query(
            `INSERT INTO product_questions (id, product_id, user_id, body)
             VALUES (?, ?, ?, ?)`,
            [id, productId, userId, text]
        );

        return this.getQuestion(id);
    }

    // ----------------------------------------------------------------
    // Answering
    // ----------------------------------------------------------------

    /**
     * Answer a question.
     *
     * The answerer's standing is resolved here, once, and stored on the row --
     * not computed on read. Two reasons: the read path would otherwise need a
     * purchase lookup per answer, and standing is a fact about the moment the
     * answer was written. Someone who owned the product when they answered
     * still did, even if that order is later refunded.
     */
    async answerQuestion(user, questionId, body) {
        if (!user?.id) throw new QAError('Sign in to answer', 401, 'UNAUTHENTICATED');

        const text = sanitizeString(body || '').trim();

        if (text.length < MIN_ANSWER_LENGTH) {
            throw new QAError('An answer cannot be empty', 400, 'ANSWER_TOO_SHORT');
        }

        if (text.length > MAX_ANSWER_LENGTH) {
            throw new QAError(
                `An answer can be at most ${MAX_ANSWER_LENGTH} characters`,
                400,
                'ANSWER_TOO_LONG'
            );
        }

        const connection = await db.getConnection();

        try {
            await connection.beginTransaction();

            const question = await this.lockQuestion(questionId, connection);

            // An answer to a question nobody can see helps nobody, and would
            // silently reappear if the question were later approved.
            if (question.status !== 'approved') {
                throw new QAError(
                    'This question is not open for answers',
                    409,
                    'QUESTION_NOT_OPEN'
                );
            }

            const authorType = await this.resolveAuthorType(
                user,
                question.product_id,
                connection
            );

            const id = crypto.randomUUID();

            await connection.query(
                `INSERT INTO product_answers (id, question_id, user_id, body, author_type)
                 VALUES (?, ?, ?, ?, ?)`,
                [id, questionId, user.id, text, authorType]
            );

            await this.recountAnswers(questionId, connection);

            await connection.commit();

            return this.getAnswer(id);
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    /**
     * Work out what standing an answerer has.
     *
     * The `owner` branch runs the same query createProductReview uses, so the
     * two badges cannot come to mean different things.
     */
    async resolveAuthorType(user, productId, connection = db) {
        const role = String(user.role || '').toLowerCase();

        if (role === 'seller') return 'seller';
        if (role === 'admin' || role === 'support') return 'staff';

        const [purchases] = await connection.query(
            `SELECT o.id
               FROM orders o
               JOIN order_items oi ON oi.order_id = o.id
              WHERE o.user_id = ? AND oi.product_id = ? AND o.status = 'delivered'
              LIMIT 1`,
            [user.id, productId]
        );

        return safeArray(purchases).length > 0 ? 'owner' : 'shopper';
    }

    // ----------------------------------------------------------------
    // Reading
    // ----------------------------------------------------------------

    /**
     * Approved questions for a product, with their answers.
     *
     * Answers come back in ONE query for the whole page rather than one per
     * question -- the N+1 that version would be is the reason this is shaped
     * the way it is.
     *
     * @param {string} productId
     * @param {{page?: number, limit?: number, sort?: string, viewerId?: string,
     *          unansweredOnly?: boolean}} [options]
     */
    async listQuestions(productId, options = {}) {
        const page = Math.max(1, safeInteger(options.page) || 1);
        const limit = Math.min(
            Math.max(1, safeInteger(options.limit) || DEFAULT_PAGE_SIZE),
            MAX_PAGE_SIZE
        );
        const offset = (page - 1) * limit;

        // Whitelist, not interpolation: this fragment lands in an ORDER BY and
        // the repo has had an injection through exactly this shape (#1085).
        const SORTS = {
            newest: 'q.created_at DESC, q.id DESC',
            helpful: 'q.helpful_count DESC, q.created_at DESC',
            answered: 'q.answer_count DESC, q.created_at DESC'
        };
        const orderBy = SORTS[options.sort] || SORTS.helpful;

        const where = ['q.product_id = ?', "q.status = 'approved'", 'q.deleted_at IS NULL'];
        const params = [productId];

        if (options.unansweredOnly) {
            where.push('q.answer_count = 0');
        }

        const [rows] = await db.query(
            `SELECT q.id, q.product_id, q.user_id, u.name AS user_name,
                    q.body, q.answer_count, q.helpful_count, q.status, q.created_at
               FROM product_questions q
               JOIN users u ON u.id = q.user_id
              WHERE ${where.join(' AND ')}
              ORDER BY ${orderBy}
              LIMIT ? OFFSET ?`,
            [...params, limit, offset]
        );

        const [counts] = await db.query(
            `SELECT COUNT(*) AS total FROM product_questions q WHERE ${where.join(' AND ')}`,
            params
        );

        const questions = safeArray(rows);
        const questionIds = questions.map((q) => q.id);

        const answersByQuestion = await this.getAnswersFor(questionIds);
        const viewerVotes = await this.getViewerVotes(options.viewerId, questions, answersByQuestion);

        const total = safeArray(counts)[0]?.total || 0;

        return {
            questions: questions.map((row) => ({
                ...this.toPublicQuestion(row, viewerVotes),
                answers: (answersByQuestion[row.id] || []).map((answer) =>
                    this.toPublicAnswer(answer, viewerVotes)
                )
            })),
            pagination: { page, limit, total, pages: Math.ceil(total / limit) },
            sort: SORTS[options.sort] ? options.sort : 'helpful'
        };
    }

    /**
     * Approved answers for a set of questions, in one query.
     *
     * Ordered by author standing first, then votes: an answer from someone
     * holding the product should not sit below a confident guess that happened
     * to be posted earlier.
     */
    async getAnswersFor(questionIds) {
        if (!safeArray(questionIds).length) return {};

        const placeholders = questionIds.map(() => '?').join(',');

        const [rows] = await db.query(
            `SELECT a.id, a.question_id, a.user_id, u.name AS user_name,
                    a.body, a.author_type, a.helpful_count, a.status, a.created_at
               FROM product_answers a
               JOIN users u ON u.id = a.user_id
              WHERE a.question_id IN (${placeholders})
                AND a.status = 'approved'
                AND a.deleted_at IS NULL
              ORDER BY a.helpful_count DESC, a.created_at ASC`,
            questionIds
        );

        const grouped = {};

        for (const row of safeArray(rows)) {
            if (!grouped[row.question_id]) grouped[row.question_id] = [];
            grouped[row.question_id].push(row);
        }

        // Author rank is applied here rather than in SQL: expressing the
        // ordering as a CASE in the ORDER BY would make the index on
        // (question_id, author_type, helpful_count) unusable, and these are
        // page-sized lists.
        for (const id of Object.keys(grouped)) {
            grouped[id].sort((a, b) => {
                const rank = (AUTHOR_RANK[b.author_type] || 0) - (AUTHOR_RANK[a.author_type] || 0);
                if (rank !== 0) return rank;
                return (b.helpful_count || 0) - (a.helpful_count || 0);
            });
        }

        return grouped;
    }

    /**
     * Which questions and answers on this page the viewer has already voted on.
     *
     * One query covering both types, so a page of ten questions with forty
     * answers costs one lookup rather than fifty.
     */
    async getViewerVotes(viewerId, questions, answersByQuestion) {
        if (!viewerId) return {};

        const targets = [
            ...safeArray(questions).map((q) => ['question', q.id]),
            ...Object.values(answersByQuestion || {})
                .flat()
                .map((a) => ['answer', a.id])
        ];

        if (targets.length === 0) return {};

        const placeholders = targets.map(() => '(?, ?)').join(',');

        const [rows] = await db.query(
            `SELECT target_type, target_id, vote_type
               FROM product_qa_votes
              WHERE user_id = ? AND (target_type, target_id) IN (${placeholders})`,
            [viewerId, ...targets.flat()]
        );

        const votes = {};
        for (const row of safeArray(rows)) {
            votes[`${row.target_type}:${row.target_id}:${row.vote_type}`] = true;
        }

        return votes;
    }

    async getQuestion(questionId) {
        const [rows] = await db.query(
            `SELECT q.id, q.product_id, q.user_id, u.name AS user_name,
                    q.body, q.answer_count, q.helpful_count, q.status, q.created_at
               FROM product_questions q
               JOIN users u ON u.id = q.user_id
              WHERE q.id = ? AND q.deleted_at IS NULL
              LIMIT 1`,
            [questionId]
        );

        const row = safeArray(rows)[0];
        return row ? this.toPublicQuestion(row) : null;
    }

    async getAnswer(answerId) {
        const [rows] = await db.query(
            `SELECT a.id, a.question_id, a.user_id, u.name AS user_name,
                    a.body, a.author_type, a.helpful_count, a.status, a.created_at
               FROM product_answers a
               JOIN users u ON u.id = a.user_id
              WHERE a.id = ? AND a.deleted_at IS NULL
              LIMIT 1`,
            [answerId]
        );

        const row = safeArray(rows)[0];
        return row ? this.toPublicAnswer(row) : null;
    }

    toPublicQuestion(row, viewerVotes = {}) {
        return {
            id: row.id,
            productId: row.product_id,
            userId: row.user_id,
            userName: row.user_name || 'Anonymous',
            body: row.body,
            answerCount: Number(row.answer_count) || 0,
            helpfulCount: Number(row.helpful_count) || 0,
            status: row.status,
            createdAt: row.created_at,
            viewerHasVotedHelpful: Boolean(viewerVotes[`question:${row.id}:helpful`]),
            viewerHasReported: Boolean(viewerVotes[`question:${row.id}:report`])
        };
    }

    toPublicAnswer(row, viewerVotes = {}) {
        return {
            id: row.id,
            questionId: row.question_id,
            userId: row.user_id,
            userName: row.user_name || 'Anonymous',
            body: row.body,
            authorType: row.author_type,
            // Surfaced separately so a client cannot forget to distinguish an
            // answer from someone holding the product from a guess.
            isVerifiedOwner: row.author_type === 'owner',
            isSeller: row.author_type === 'seller' || row.author_type === 'staff',
            helpfulCount: Number(row.helpful_count) || 0,
            status: row.status,
            createdAt: row.created_at,
            viewerHasVotedHelpful: Boolean(viewerVotes[`answer:${row.id}:helpful`]),
            viewerHasReported: Boolean(viewerVotes[`answer:${row.id}:report`])
        };
    }

    // ----------------------------------------------------------------
    // Voting and reporting
    // ----------------------------------------------------------------

    /**
     * Vote an item helpful, or report it.
     *
     * One method for both targets and both vote types, because the rules are
     * identical and two near-copies would drift.
     *
     * Counters are recalculated from the vote table rather than incremented:
     * `count = count + 1` is only correct if it has been correct every time
     * before, and a counter that has drifted drifts further with every vote.
     */
    async vote(userId, { targetType, targetId, voteType, reason, details } = {}) {
        if (!userId) throw new QAError('Sign in to do that', 401, 'UNAUTHENTICATED');

        if (!['question', 'answer'].includes(targetType)) {
            throw new QAError('Unknown target', 400, 'INVALID_TARGET');
        }

        if (!['helpful', 'report'].includes(voteType)) {
            throw new QAError('Unknown vote', 400, 'INVALID_VOTE');
        }

        const table = targetType === 'question' ? 'product_questions' : 'product_answers';
        const connection = await db.getConnection();

        try {
            await connection.beginTransaction();

            const [rows] = await connection.query(
                `SELECT id, user_id, status FROM ${table}
                  WHERE id = ? AND deleted_at IS NULL
                  FOR UPDATE`,
                [targetId]
            );

            const target = safeArray(rows)[0];

            if (!target) {
                throw new QAError('Not found', 404, 'TARGET_NOT_FOUND');
            }

            if (target.user_id === userId) {
                throw new QAError(
                    voteType === 'helpful'
                        ? 'You cannot vote on your own post'
                        : 'You cannot report your own post',
                    409,
                    'SELF_VOTE'
                );
            }

            const [existing] = await connection.query(
                `SELECT id FROM product_qa_votes
                  WHERE target_type = ? AND target_id = ? AND user_id = ? AND vote_type = ?
                  LIMIT 1`,
                [targetType, targetId, userId, voteType]
            );

            if (safeArray(existing).length > 0) {
                await connection.rollback();
                return { targetId, alreadyVoted: true };
            }

            await connection.query(
                `INSERT INTO product_qa_votes
                    (target_type, target_id, user_id, vote_type, reason, details)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [
                    targetType,
                    targetId,
                    userId,
                    voteType,
                    voteType === 'report'
                        ? REPORT_REASONS.includes(reason)
                            ? reason
                            : 'other'
                        : null,
                    voteType === 'report'
                        ? sanitizeString(details || '').slice(0, 500) || null
                        : null
                ]
            );

            const total = await this.recountVotes(
                table,
                targetType,
                targetId,
                voteType,
                connection
            );

            // Queue for a human rather than deleting. A report is an
            // accusation, not a verdict, and a button that removes content on
            // accusation alone is a weapon.
            if (
                voteType === 'report' &&
                total >= REPORT_FLAG_THRESHOLD &&
                target.status === 'approved'
            ) {
                await connection.query(`UPDATE ${table} SET status = 'pending' WHERE id = ?`, [
                    targetId
                ]);

                // Hiding an answer changes its question's answer count.
                if (targetType === 'answer') {
                    await this.recountAnswersForAnswer(targetId, connection);
                }
            }

            await connection.commit();

            // Deliberately does not report whether the threshold was crossed.
            // Telling a reporter "two more and it disappears" is an invitation
            // to organise.
            return { targetId, alreadyVoted: false, count: total };
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    /** Withdraw a helpful vote. */
    async unvote(userId, { targetType, targetId } = {}) {
        if (!userId) throw new QAError('Sign in to do that', 401, 'UNAUTHENTICATED');

        if (!['question', 'answer'].includes(targetType)) {
            throw new QAError('Unknown target', 400, 'INVALID_TARGET');
        }

        const table = targetType === 'question' ? 'product_questions' : 'product_answers';
        const connection = await db.getConnection();

        try {
            await connection.beginTransaction();

            await connection.query(
                `DELETE FROM product_qa_votes
                  WHERE target_type = ? AND target_id = ? AND user_id = ? AND vote_type = 'helpful'`,
                [targetType, targetId, userId]
            );

            const total = await this.recountVotes(
                table,
                targetType,
                targetId,
                'helpful',
                connection
            );

            await connection.commit();

            return { targetId, count: total };
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    // ----------------------------------------------------------------
    // Moderation
    // ----------------------------------------------------------------

    /**
     * The moderation queue for questions and answers together.
     *
     * Both in one response because a moderator works a queue, not two queues,
     * and an answer is usually only judgeable next to its question.
     */
    async getModerationQueue({ status = 'pending', limit = 20 } = {}) {
        const safeStatus = STATUSES.includes(status) ? status : 'pending';
        const safeLimit = Math.min(Math.max(1, safeInteger(limit) || 20), MAX_PAGE_SIZE);

        const [questions] = await db.query(
            `SELECT q.id, q.product_id, p.name AS product_name, q.user_id,
                    u.name AS user_name, q.body, q.reported_count, q.status, q.created_at
               FROM product_questions q
               JOIN users u ON u.id = q.user_id
               LEFT JOIN products p ON p.id = q.product_id
              WHERE q.status = ? AND q.deleted_at IS NULL
              ORDER BY q.reported_count DESC, q.created_at ASC
              LIMIT ?`,
            [safeStatus, safeLimit]
        );

        const [answers] = await db.query(
            `SELECT a.id, a.question_id, q.body AS question_body, a.user_id,
                    u.name AS user_name, a.body, a.author_type,
                    a.reported_count, a.status, a.created_at
               FROM product_answers a
               JOIN users u ON u.id = a.user_id
               LEFT JOIN product_questions q ON q.id = a.question_id
              WHERE a.status = ? AND a.deleted_at IS NULL
              ORDER BY a.reported_count DESC, a.created_at ASC
              LIMIT ?`,
            [safeStatus, safeLimit]
        );

        return {
            status: safeStatus,
            questions: safeArray(questions),
            answers: safeArray(answers)
        };
    }

    /**
     * Approve or reject a question or an answer.
     */
    async moderate(moderatorId, { targetType, targetId, status, notes } = {}) {
        if (!moderatorId) throw new QAError('Unauthorized', 401, 'UNAUTHENTICATED');

        if (!['question', 'answer'].includes(targetType)) {
            throw new QAError('Unknown target', 400, 'INVALID_TARGET');
        }

        if (!STATUSES.includes(status)) {
            throw new QAError(
                `status must be one of: ${STATUSES.join(', ')}`,
                400,
                'INVALID_STATUS'
            );
        }

        const table = targetType === 'question' ? 'product_questions' : 'product_answers';
        const connection = await db.getConnection();

        try {
            await connection.beginTransaction();

            const [result] = await connection.query(
                `UPDATE ${table}
                    SET status = ?, moderation_notes = ?, moderated_by = ?, moderated_at = NOW()
                  WHERE id = ? AND deleted_at IS NULL`,
                [
                    status,
                    sanitizeString(notes || '').slice(0, 1000) || null,
                    moderatorId,
                    targetId
                ]
            );

            if (!result || result.affectedRows === 0) {
                throw new QAError('Not found', 404, 'TARGET_NOT_FOUND');
            }

            // Approving or rejecting an answer changes how many answers its
            // question has.
            if (targetType === 'answer') {
                await this.recountAnswersForAnswer(targetId, connection);
            }

            await connection.commit();

            return { targetType, targetId, status };
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    /**
     * Soft-delete a question or answer.
     *
     * Soft, so a takedown is reviewable: who removed what, and why.
     */
    async softDelete(moderatorId, { targetType, targetId, reason } = {}) {
        if (!moderatorId) throw new QAError('Unauthorized', 401, 'UNAUTHENTICATED');

        if (!['question', 'answer'].includes(targetType)) {
            throw new QAError('Unknown target', 400, 'INVALID_TARGET');
        }

        const table = targetType === 'question' ? 'product_questions' : 'product_answers';
        const connection = await db.getConnection();

        try {
            await connection.beginTransaction();

            const [result] = await connection.query(
                `UPDATE ${table}
                    SET deleted_at = NOW(), deleted_by = ?, status = 'rejected',
                        moderation_notes = ?
                  WHERE id = ? AND deleted_at IS NULL`,
                [moderatorId, sanitizeString(reason || '').slice(0, 1000) || null, targetId]
            );

            if (!result || result.affectedRows === 0) {
                throw new QAError('Not found', 404, 'TARGET_NOT_FOUND');
            }

            if (targetType === 'answer') {
                await this.recountAnswersForAnswer(targetId, connection);
            }

            await connection.commit();

            return { targetType, targetId, deleted: true };
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    // ----------------------------------------------------------------
    // Internals
    // ----------------------------------------------------------------

    async lockQuestion(questionId, connection) {
        const [rows] = await connection.query(
            `SELECT id, product_id, user_id, status
               FROM product_questions
              WHERE id = ? AND deleted_at IS NULL
              FOR UPDATE`,
            [questionId]
        );

        const question = safeArray(rows)[0];

        if (!question) {
            throw new QAError('Question not found', 404, 'QUESTION_NOT_FOUND');
        }

        return question;
    }

    /**
     * Recalculate a question's answer_count from the answers that are actually
     * visible.
     */
    async recountAnswers(questionId, connection) {
        const [rows] = await connection.query(
            `SELECT COUNT(*) AS total
               FROM product_answers
              WHERE question_id = ? AND status = 'approved' AND deleted_at IS NULL`,
            [questionId]
        );

        const total = safeArray(rows)[0]?.total || 0;

        await connection.query('UPDATE product_questions SET answer_count = ? WHERE id = ?', [
            total,
            questionId
        ]);

        return total;
    }

    /** Recount a question's answers, given one of its answers. */
    async recountAnswersForAnswer(answerId, connection) {
        const [rows] = await connection.query(
            'SELECT question_id FROM product_answers WHERE id = ? LIMIT 1',
            [answerId]
        );

        const questionId = safeArray(rows)[0]?.question_id;
        if (!questionId) return 0;

        return this.recountAnswers(questionId, connection);
    }

    /**
     * Recalculate a denormalised vote counter from the vote table.
     */
    async recountVotes(table, targetType, targetId, voteType, connection) {
        const column = voteType === 'report' ? 'reported_count' : 'helpful_count';

        const [rows] = await connection.query(
            `SELECT COUNT(*) AS total
               FROM product_qa_votes
              WHERE target_type = ? AND target_id = ? AND vote_type = ?`,
            [targetType, targetId, voteType]
        );

        const total = safeArray(rows)[0]?.total || 0;

        await connection.query(`UPDATE ${table} SET ${column} = ? WHERE id = ?`, [
            total,
            targetId
        ]);

        return total;
    }
}

const productQAService = new ProductQAService();

module.exports = productQAService;
module.exports.ProductQAService = ProductQAService;
module.exports.QAError = QAError;
module.exports.AUTHOR_TYPES = AUTHOR_TYPES;
module.exports.AUTHOR_RANK = AUTHOR_RANK;
module.exports.STATUSES = STATUSES;
module.exports.REPORT_REASONS = REPORT_REASONS;
module.exports.REPORT_FLAG_THRESHOLD = REPORT_FLAG_THRESHOLD;
module.exports.MIN_QUESTION_LENGTH = MIN_QUESTION_LENGTH;
module.exports.MAX_QUESTION_LENGTH = MAX_QUESTION_LENGTH;
