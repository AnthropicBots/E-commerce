// backend/services/reviewModerationService.js
//
// Review engagement and moderation (#1349).
//
// `reviews` shipped with helpful_count, reported_count, is_approved,
// is_verified, moderation_notes, title, images, deleted_at and deleted_by.
// None had a writer, and `is_approved` had no reader either -- so a rejected
// review still appeared on the product page and still counted toward the
// product's star rating.
//
// The rules that make this work all span more than one row, which is why they
// live here rather than in the controller:
//
//   * a vote is idempotent per user, so counters are *recalculated* from
//     review_votes rather than incremented blind;
//   * a review crossing the report threshold moves to `pending` for a human
//     rather than disappearing, so the report button is not a takedown weapon;
//   * only approved reviews count toward a product's rating;
//   * removal is a soft delete with an author and a reason.

const db = require('../config/db');
const { safeArray, safeInteger, sanitizeString } = require('../utils/helpers');

/**
 * Reports needed before a review is pulled for review by a human.
 *
 * Deliberately a threshold and not one: a single report is a disagreement, and
 * letting one shopper hide a review they dislike turns the report button into
 * a censorship tool. Configurable because the right number depends on traffic.
 */
const REPORT_FLAG_THRESHOLD = Number(process.env.REVIEW_REPORT_THRESHOLD) || 3;

const MODERATION_STATUSES = Object.freeze(['approved', 'pending', 'rejected']);

/** Report reasons offered in the UI. `other` carries free text in `details`. */
const REPORT_REASONS = Object.freeze([
    'spam',
    'offensive',
    'off_topic',
    'fake',
    'personal_info',
    'other'
]);

/**
 * Sort options for the public list.
 *
 * A whitelist mapping keys to fixed SQL fragments, not interpolation: this
 * string lands directly in an ORDER BY, and the repo has already had one SQL
 * injection through exactly this shape (#1085).
 */
const SORT_OPTIONS = Object.freeze({
    newest: 'r.created_at DESC, r.id DESC',
    oldest: 'r.created_at ASC, r.id ASC',
    highest: 'r.rating DESC, r.helpful_count DESC, r.id DESC',
    lowest: 'r.rating ASC, r.helpful_count DESC, r.id DESC',
    // The most useful review on a product, which is what a shopper actually
    // wants and what the chronological-only ordering could never surface.
    helpful: 'r.helpful_count DESC, r.created_at DESC, r.id DESC'
});

const MAX_PAGE_SIZE = 50;
const DEFAULT_PAGE_SIZE = 10;

class ReviewError extends Error {
    constructor(message, status = 400, code = 'REVIEW_ERROR') {
        super(message);
        this.name = 'ReviewError';
        this.status = status;
        this.code = code;
    }
}

/**
 * Shape a row for the public API.
 *
 * `images` is stored as JSON and arrives as either a parsed array or a string
 * depending on the driver's configuration, so it is normalised here rather
 * than at each call site. A malformed value degrades to an empty list: a
 * broken image column must not fail the whole review list.
 */
function toPublicReview(row, viewerVotes = {}) {
    if (!row) return null;

    let images = [];
    try {
        if (Array.isArray(row.images)) {
            images = row.images;
        } else if (typeof row.images === 'string' && row.images.trim()) {
            const parsed = JSON.parse(row.images);
            if (Array.isArray(parsed)) images = parsed;
        }
    } catch (error) {
        images = [];
    }

    return {
        id: row.id,
        productId: row.product_id,
        userId: row.user_id,
        userName: row.user_name || 'Anonymous',
        rating: Number(row.rating) || 0,
        title: row.title || null,
        comment: row.comment,
        images,
        isVerified: Boolean(row.is_verified),
        helpfulCount: Number(row.helpful_count) || 0,
        reportedCount: Number(row.reported_count) || 0,
        moderationStatus: row.moderation_status || 'approved',
        createdAt: row.created_at,
        // Lets the client render the button as already-pressed instead of
        // discovering it on click.
        viewerHasVotedHelpful: Boolean(viewerVotes[`${row.id}:helpful`]),
        viewerHasReported: Boolean(viewerVotes[`${row.id}:report`])
    };
}

class ReviewModerationService {
    // ----------------------------------------------------------------
    // Public reads
    // ----------------------------------------------------------------

    /**
     * Approved reviews for a product, paginated and sortable.
     *
     * The unfiltered, unbounded, chronological-only list this replaces
     * returned every review a product had ever received in one response, and
     * included ones a moderator had rejected.
     *
     * @param {string} productId
     * @param {{page?: number, limit?: number, sort?: string, viewerId?: string}} options
     */
    async listProductReviews(productId, options = {}) {
        const page = Math.max(1, safeInteger(options.page) || 1);
        const limit = Math.min(
            Math.max(1, safeInteger(options.limit) || DEFAULT_PAGE_SIZE),
            MAX_PAGE_SIZE
        );
        const offset = (page - 1) * limit;

        const orderBy = SORT_OPTIONS[options.sort] || SORT_OPTIONS.newest;

        const [rows] = await db.query(
            `SELECT
                r.id, r.product_id, r.user_id, u.name AS user_name,
                r.rating, r.title, r.comment, r.images,
                r.is_verified, r.helpful_count, r.reported_count,
                r.moderation_status, r.created_at
             FROM reviews r
             JOIN users u ON u.id = r.user_id
             WHERE r.product_id = ?
               AND r.moderation_status = 'approved'
               AND r.deleted_at IS NULL
             ORDER BY ${orderBy}
             LIMIT ? OFFSET ?`,
            [productId, limit, offset]
        );

        const [counts] = await db.query(
            `SELECT COUNT(*) AS total
               FROM reviews
              WHERE product_id = ? AND moderation_status = 'approved' AND deleted_at IS NULL`,
            [productId]
        );

        const reviewIds = safeArray(rows).map((r) => r.id);
        const viewerVotes = await this.getViewerVotes(options.viewerId, reviewIds);

        const total = safeArray(counts)[0]?.total || 0;

        return {
            reviews: safeArray(rows).map((row) => toPublicReview(row, viewerVotes)),
            pagination: {
                page,
                limit,
                total,
                pages: Math.ceil(total / limit)
            },
            sort: SORT_OPTIONS[options.sort] ? options.sort : 'newest'
        };
    }

    /**
     * The rating distribution behind the average.
     *
     * "4.2 stars" from a hundred reviews and "4.2 stars" from two are the same
     * number and very different information, and only the histogram tells them
     * apart. Approved-only, matching the average.
     */
    async getRatingBreakdown(productId) {
        const [rows] = await db.query(
            `SELECT rating, COUNT(*) AS count
               FROM reviews
              WHERE product_id = ? AND moderation_status = 'approved' AND deleted_at IS NULL
              GROUP BY rating`,
            [productId]
        );

        // Every bucket present even when empty, so the client renders five bars
        // rather than however many happen to have votes.
        const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
        let total = 0;
        let sum = 0;

        for (const row of safeArray(rows)) {
            const rating = Number(row.rating);
            const count = Number(row.count) || 0;
            if (distribution[rating] !== undefined) distribution[rating] = count;
            total += count;
            sum += rating * count;
        }

        return {
            distribution,
            total,
            average: total > 0 ? Number((sum / total).toFixed(2)) : 0,
            verifiedCount: await this.countVerified(productId)
        };
    }

    async countVerified(productId) {
        const [rows] = await db.query(
            `SELECT COUNT(*) AS total
               FROM reviews
              WHERE product_id = ? AND is_verified = 1
                AND moderation_status = 'approved' AND deleted_at IS NULL`,
            [productId]
        );

        return safeArray(rows)[0]?.total || 0;
    }

    /**
     * Which of these reviews the viewer has already voted on.
     *
     * One query for the whole page rather than one per review -- the N+1 that
     * version would be is the reason this exists as its own method.
     */
    async getViewerVotes(viewerId, reviewIds) {
        if (!viewerId || !safeArray(reviewIds).length) return {};

        const placeholders = reviewIds.map(() => '?').join(',');

        const [rows] = await db.query(
            `SELECT review_id, vote_type
               FROM review_votes
              WHERE user_id = ? AND review_id IN (${placeholders})`,
            [viewerId, ...reviewIds]
        );

        const votes = {};
        for (const row of safeArray(rows)) {
            votes[`${row.review_id}:${row.vote_type}`] = true;
        }

        return votes;
    }

    // ----------------------------------------------------------------
    // Voting
    // ----------------------------------------------------------------

    /**
     * Record a helpful vote.
     *
     * Idempotent by way of the UNIQUE key on review_votes: a duplicate is
     * reported as already-voted rather than inflating the counter. The counter
     * is then *recalculated* from the vote table rather than incremented, so a
     * counter that has drifted repairs itself on the next vote instead of
     * drifting further.
     */
    async voteHelpful(userId, reviewId) {
        if (!userId) throw new ReviewError('Sign in to vote', 401, 'UNAUTHENTICATED');

        const connection = await db.getConnection();

        try {
            await connection.beginTransaction();

            const review = await this.lockReview(reviewId, connection);

            // Voting for your own review is not useful signal.
            if (review.user_id === userId) {
                throw new ReviewError(
                    'You cannot mark your own review as helpful',
                    409,
                    'SELF_VOTE'
                );
            }

            const [existing] = await connection.query(
                `SELECT id FROM review_votes
                  WHERE review_id = ? AND user_id = ? AND vote_type = 'helpful'
                  LIMIT 1`,
                [reviewId, userId]
            );

            if (safeArray(existing).length > 0) {
                await connection.rollback();

                return {
                    reviewId,
                    helpfulCount: review.helpful_count,
                    alreadyVoted: true
                };
            }

            await connection.query(
                `INSERT INTO review_votes (review_id, user_id, vote_type)
                 VALUES (?, ?, 'helpful')`,
                [reviewId, userId]
            );

            const helpfulCount = await this.recountVotes(reviewId, 'helpful', connection);

            await connection.commit();

            return { reviewId, helpfulCount, alreadyVoted: false };
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    /**
     * Withdraw a helpful vote.
     */
    async unvoteHelpful(userId, reviewId) {
        if (!userId) throw new ReviewError('Sign in to vote', 401, 'UNAUTHENTICATED');

        const connection = await db.getConnection();

        try {
            await connection.beginTransaction();

            await this.lockReview(reviewId, connection);

            await connection.query(
                `DELETE FROM review_votes
                  WHERE review_id = ? AND user_id = ? AND vote_type = 'helpful'`,
                [reviewId, userId]
            );

            const helpfulCount = await this.recountVotes(reviewId, 'helpful', connection);

            await connection.commit();

            return { reviewId, helpfulCount };
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    /**
     * Report a review.
     *
     * Crossing REPORT_FLAG_THRESHOLD moves the review to `pending` -- hidden
     * from the product page and queued for a human -- rather than deleting it.
     * The distinction matters: a report is an accusation, not a verdict, and a
     * button that removes content on accusation alone is a weapon.
     *
     * The response deliberately does not say whether the threshold was
     * crossed. Telling a reporter "two more and it disappears" is an
     * invitation to organise.
     */
    async reportReview(userId, reviewId, { reason, details } = {}) {
        if (!userId) throw new ReviewError('Sign in to report a review', 401, 'UNAUTHENTICATED');

        const safeReason = REPORT_REASONS.includes(reason) ? reason : 'other';
        const safeDetails = sanitizeString(details || '').slice(0, 500) || null;

        const connection = await db.getConnection();

        try {
            await connection.beginTransaction();

            const review = await this.lockReview(reviewId, connection);

            if (review.user_id === userId) {
                throw new ReviewError('You cannot report your own review', 409, 'SELF_REPORT');
            }

            const [existing] = await connection.query(
                `SELECT id FROM review_votes
                  WHERE review_id = ? AND user_id = ? AND vote_type = 'report'
                  LIMIT 1`,
                [reviewId, userId]
            );

            if (safeArray(existing).length > 0) {
                await connection.rollback();
                return { reviewId, alreadyReported: true };
            }

            await connection.query(
                `INSERT INTO review_votes (review_id, user_id, vote_type, reason, details)
                 VALUES (?, ?, 'report', ?, ?)`,
                [reviewId, userId, safeReason, safeDetails]
            );

            const reportedCount = await this.recountVotes(reviewId, 'report', connection);

            if (
                reportedCount >= REPORT_FLAG_THRESHOLD &&
                review.moderation_status === 'approved'
            ) {
                await connection.query(
                    `UPDATE reviews
                        SET moderation_status = 'pending', is_approved = 0
                      WHERE id = ?`,
                    [reviewId]
                );

                // Pulling a review out of the approved set changes the
                // product's rating, so the cached aggregate has to move with it.
                await this.refreshProductStats(review.product_id, connection);
            }

            await connection.commit();

            return { reviewId, alreadyReported: false };
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    // ----------------------------------------------------------------
    // Moderation (admin)
    // ----------------------------------------------------------------

    /**
     * The moderation queue: pending reviews first, most-reported first.
     *
     * There was no queue at all, so moderation was reactive to whatever an
     * admin happened to read.
     */
    async getModerationQueue({ status = 'pending', page = 1, limit = 20 } = {}) {
        const safeStatus = MODERATION_STATUSES.includes(status) ? status : 'pending';
        const safePage = Math.max(1, safeInteger(page) || 1);
        const safeLimit = Math.min(Math.max(1, safeInteger(limit) || 20), MAX_PAGE_SIZE);
        const offset = (safePage - 1) * safeLimit;

        const [rows] = await db.query(
            `SELECT
                r.id, r.product_id, p.name AS product_name,
                r.user_id, u.name AS user_name,
                r.rating, r.title, r.comment, r.images,
                r.is_verified, r.helpful_count, r.reported_count,
                r.moderation_status, r.moderation_notes,
                r.moderated_by, r.moderated_at, r.created_at
             FROM reviews r
             JOIN users u ON u.id = r.user_id
             LEFT JOIN products p ON p.id = r.product_id
             WHERE r.moderation_status = ? AND r.deleted_at IS NULL
             ORDER BY r.reported_count DESC, r.created_at ASC
             LIMIT ? OFFSET ?`,
            [safeStatus, safeLimit, offset]
        );

        const [counts] = await db.query(
            `SELECT moderation_status, COUNT(*) AS total
               FROM reviews
              WHERE deleted_at IS NULL
              GROUP BY moderation_status`,
            []
        );

        const byStatus = { approved: 0, pending: 0, rejected: 0 };
        for (const row of safeArray(counts)) {
            byStatus[row.moderation_status] = Number(row.total) || 0;
        }

        return {
            reviews: safeArray(rows).map((row) => ({
                ...toPublicReview(row),
                productName: row.product_name || null,
                moderationNotes: row.moderation_notes || null,
                moderatedBy: row.moderated_by || null,
                moderatedAt: row.moderated_at || null
            })),
            counts: byStatus,
            pagination: {
                page: safePage,
                limit: safeLimit,
                total: byStatus[safeStatus],
                pages: Math.ceil(byStatus[safeStatus] / safeLimit)
            }
        };
    }

    /**
     * The reports filed against one review, so a moderator sees the case
     * rather than only the count.
     */
    async getReviewReports(reviewId) {
        const [rows] = await db.query(
            `SELECT v.id, v.user_id, u.name AS user_name,
                    v.reason, v.details, v.created_at
               FROM review_votes v
               LEFT JOIN users u ON u.id = v.user_id
              WHERE v.review_id = ? AND v.vote_type = 'report'
              ORDER BY v.created_at DESC`,
            [reviewId]
        );

        return safeArray(rows).map((row) => ({
            id: row.id,
            userId: row.user_id,
            userName: row.user_name || 'Unknown',
            reason: row.reason || 'other',
            details: row.details || null,
            createdAt: row.created_at
        }));
    }

    /**
     * Approve or reject a review.
     *
     * `is_approved` is written alongside `moderation_status` so the legacy
     * boolean cannot fall out of step with the status any reader might use.
     * The product's cached rating is refreshed in the same transaction,
     * because a rejected review must stop counting toward it -- which is the
     * defect that started all of this.
     */
    async moderateReview(moderatorId, reviewId, { status, notes } = {}) {
        if (!moderatorId) throw new ReviewError('Unauthorized', 401, 'UNAUTHENTICATED');

        if (!MODERATION_STATUSES.includes(status)) {
            throw new ReviewError(
                `status must be one of: ${MODERATION_STATUSES.join(', ')}`,
                400,
                'INVALID_STATUS'
            );
        }

        const connection = await db.getConnection();

        try {
            await connection.beginTransaction();

            const review = await this.lockReview(reviewId, connection);

            await connection.query(
                `UPDATE reviews
                    SET moderation_status = ?,
                        is_approved = ?,
                        moderation_notes = ?,
                        moderated_by = ?,
                        moderated_at = NOW()
                  WHERE id = ?`,
                [
                    status,
                    status === 'approved' ? 1 : 0,
                    sanitizeString(notes || '').slice(0, 1000) || null,
                    moderatorId,
                    reviewId
                ]
            );

            const stats = await this.refreshProductStats(review.product_id, connection);

            await connection.commit();

            return { reviewId, status, ...stats };
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    /**
     * Soft-delete a review.
     *
     * The columns for this (`deleted_at`, `deleted_by`) were already in the
     * schema and ignored: removal was a hard `DELETE FROM reviews`, leaving no
     * record that the review had existed, who removed it, or why. That is
     * precisely the record you want when a seller disputes a takedown.
     */
    async softDeleteReview(moderatorId, reviewId, reason) {
        if (!moderatorId) throw new ReviewError('Unauthorized', 401, 'UNAUTHENTICATED');

        const connection = await db.getConnection();

        try {
            await connection.beginTransaction();

            const review = await this.lockReview(reviewId, connection);

            await connection.query(
                `UPDATE reviews
                    SET deleted_at = NOW(),
                        deleted_by = ?,
                        moderation_status = 'rejected',
                        is_approved = 0,
                        moderation_notes = ?
                  WHERE id = ?`,
                [moderatorId, sanitizeString(reason || '').slice(0, 1000) || null, reviewId]
            );

            const stats = await this.refreshProductStats(review.product_id, connection);

            await connection.commit();

            return { reviewId, deleted: true, ...stats };
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

    /**
     * Select a review FOR UPDATE.
     *
     * The lock serialises concurrent votes on the same review, so two requests
     * cannot both read `helpful_count = 4` and both write 5.
     */
    async lockReview(reviewId, connection) {
        const [rows] = await connection.query(
            `SELECT id, product_id, user_id, helpful_count, reported_count, moderation_status
               FROM reviews
              WHERE id = ? AND deleted_at IS NULL
              FOR UPDATE`,
            [reviewId]
        );

        const review = safeArray(rows)[0];

        if (!review) {
            throw new ReviewError('Review not found', 404, 'REVIEW_NOT_FOUND');
        }

        return review;
    }

    /**
     * Recalculate a denormalised counter from review_votes.
     *
     * Recalculated rather than incremented: `SET helpful_count = helpful_count + 1`
     * is only correct if it has been correct every time before, and a counter
     * that has drifted for any reason drifts further with every vote. This way
     * the next vote repairs it.
     */
    async recountVotes(reviewId, voteType, connection) {
        const column = voteType === 'report' ? 'reported_count' : 'helpful_count';

        const [rows] = await connection.query(
            `SELECT COUNT(*) AS total
               FROM review_votes
              WHERE review_id = ? AND vote_type = ?`,
            [reviewId, voteType]
        );

        const total = safeArray(rows)[0]?.total || 0;

        await connection.query(`UPDATE reviews SET ${column} = ? WHERE id = ?`, [
            total,
            reviewId
        ]);

        return total;
    }

    /**
     * Recompute a product's cached rating from its **approved** reviews.
     *
     * The version this replaces averaged every review the product had,
     * approved or not, so rejecting a review left its stars in the average.
     */
    async refreshProductStats(productId, connection = db) {
        const [rows] = await connection.query(
            `SELECT
                COALESCE(ROUND(AVG(rating), 2), 0) AS average_rating,
                COUNT(*) AS review_count
             FROM reviews
             WHERE product_id = ?
               AND moderation_status = 'approved'
               AND deleted_at IS NULL`,
            [productId]
        );

        const averageRating = Number(safeArray(rows)[0]?.average_rating || 0);
        const reviewCount = Number(safeArray(rows)[0]?.review_count || 0);

        await connection.query('UPDATE products SET rating = ?, num_reviews = ? WHERE id = ?', [
            averageRating,
            reviewCount,
            productId
        ]);

        return { averageRating, reviewCount };
    }
}

const reviewModerationService = new ReviewModerationService();

module.exports = reviewModerationService;
module.exports.ReviewModerationService = ReviewModerationService;
module.exports.ReviewError = ReviewError;
module.exports.toPublicReview = toPublicReview;
module.exports.SORT_OPTIONS = SORT_OPTIONS;
module.exports.REPORT_REASONS = REPORT_REASONS;
module.exports.MODERATION_STATUSES = MODERATION_STATUSES;
module.exports.REPORT_FLAG_THRESHOLD = REPORT_FLAG_THRESHOLD;
