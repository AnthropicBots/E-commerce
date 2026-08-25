const db = require("../config/db");
const Review = require("../models/Review");

// Engagement and moderation (#1349). Every rule there spans more than one row
// and therefore needs a transaction, which is why it is a service rather than
// more handler code.
const reviewModerationService = require("../services/reviewModerationService");

/** Cap on photos per review. */
const MAX_REVIEW_IMAGES = 5;

// Cap on one inlined photo, in characters of data URI.
//
// Photos arrive as base64 in the JSON body rather than as an upload, so the
// per-image cap and MAX_REVIEW_IMAGES together have to fit inside
// appConfig.bodyLimit, which is 10mb. Five images at the old 5,000,000 was a
// 25MB ceiling against a 10MB door: three ordinary photos already 413ed, and
// the failure surfaced as a generic "Failed to submit review" (#1654).
//
// 1,500,000 characters is about 1.1MB of image. Five of them is 7.5MB, which
// leaves the rest of the review room inside the limit. The frontend downscales
// to fit this before it uploads, so the cap is a backstop rather than
// something a shopper is expected to meet by choosing smaller photos.
const MAX_REVIEW_IMAGE_CHARS = 1500000;
const { ReviewError, REPORT_REASONS } = require("../services/reviewModerationService");
const {
    safeArray,
    safeInteger,
    safeUUID,
    sanitizeString
} = require("../utils/helpers");

// The same definition of "a shopper may see this product" the catalogue uses
// (#1456). Reviews were reachable for a product that had been withdrawn from
// sale: `SELECT id FROM products WHERE id = ?` matches a soft-deleted row, so
// a product that 404s at its own URL still accepted new reviews and still
// served old ones (#1547).
const { publicProductCondition } = require("../constants/productVisibility");

/**
 * Is this a product a shopper may still see?
 *
 * @param {string} productId
 * @param {object} [connection] A pool or an open transaction.
 * @returns {Promise<boolean>}
 */
async function productExists(productId, connection = db) {
    const visibility = publicProductCondition("p");

    const [products] = await connection.query(
        `SELECT p.id
           FROM products p
          WHERE p.id = ? AND ${visibility.sql}
          LIMIT 1`,
        [productId, ...visibility.params]
    );

    return safeArray(products).length > 0;
}

async function refreshProductReviewStats(productId, connection = db) {
    // Approved, undeleted reviews only.
    //
    // This used to average *every* review the product had. `is_approved`
    // existed but nothing filtered on it, so a review a moderator rejected
    // still contributed its stars to the product's rating -- the flag was
    // completely inert (#1349).
    const [stats] = await connection.query(
        `
            SELECT
                COALESCE(ROUND(AVG(rating), 2), 0) AS average_rating,
                COUNT(*) AS review_count
            FROM reviews
            WHERE product_id = ?
                AND moderation_status = 'approved'
                AND deleted_at IS NULL
        `,
        [productId]
    );

    const averageRating = Number(stats?.[0]?.average_rating || 0);
    const reviewCount = Number(stats?.[0]?.review_count || 0);

    await connection.query(
        `
            UPDATE products
            SET rating = ?, num_reviews = ?
            WHERE id = ?
        `,
        [averageRating, reviewCount, productId]
    );

    return {
        averageRating,
        reviewCount
    };
}

const getProductReviews = async (req, res) => {
    const productId = safeUUID(req.params.id);

    if (!productId) {
        return res.status(400).json({
            success: false,
            message: "Invalid product ID"
        });
    }

    try {
        if (!(await productExists(productId))) {
            return res.status(404).json({
                success: false,
                message: "Product not found"
            });
        }

        // Paginated, sortable and filtered to approved.
        //
        // The previous version returned every review a product had ever
        // received, in one unbounded response, ordered only by recency, and
        // including ones a moderator had rejected (#1349).
        //
        // `viewerId` is optional -- this route is public -- and is used only to
        // tell the client which reviews it has already voted on, so the button
        // renders as pressed instead of discovering it on click.
        const result = await reviewModerationService.listProductReviews(productId, {
            page: req.query.page,
            limit: req.query.limit,
            sort: req.query.sort,
            viewerId: req.user?.id
        });

        const breakdown = await reviewModerationService.getRatingBreakdown(productId);

        return res.status(200).json({
            success: true,
            message: "Reviews fetched successfully",
            averageRating: breakdown.average,
            reviewCount: breakdown.total,
            verifiedCount: breakdown.verifiedCount,
            ratingDistribution: breakdown.distribution,
            pagination: result.pagination,
            sort: result.sort,
            reviews: result.reviews
        });
    } catch (error) {
        console.error("GET PRODUCT REVIEWS ERROR:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to fetch reviews"
        });
    }
};

const createProductReview = async (req, res) => {
    const productId = safeUUID(req.params.id);
    const userId = safeUUID(req.user?.id);
    const rating = safeInteger(req.body.rating);
    const comment = sanitizeString(req.body.comment);

    // `title` and `images` are columns that existed from the start and that
    // nothing ever wrote, so a shopper could neither title a review nor attach
    // a photo of what actually arrived (#1349).
    const title = sanitizeString(req.body.title || "").slice(0, 255) || null;
    const images = normalizeReviewImages(req.body.images);

    if (!productId) {
        return res.status(400).json({
            success: false,
            message: "Invalid product ID"
        });
    }

    if (!userId) {
        return res.status(401).json({
            success: false,
            message: "Authentication required"
        });
    }

    if (rating < 1 || rating > 5) {
        return res.status(400).json({
            success: false,
            message: "Rating must be between 1 and 5"
        });
    }

    if (!comment || comment.length < 3 || comment.length > 1000) {
        return res.status(400).json({
            success: false,
            message: "Review comment must be between 3 and 1000 characters"
        });
    }

    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();

        if (!(await productExists(productId, connection))) {
            await connection.rollback();

            return res.status(404).json({
                success: false,
                message: "Product not found"
            });
        }

        // `deleted_at IS NULL`, and locked.
        //
        // Two separate problems lived in this one statement (#1547).
        //
        // Deletion is a *soft* delete -- #1349 made it one deliberately, so
        // there is a record of what was removed and by whom. This check matched
        // any row, so the tombstone of a review the shopper had withdrawn went
        // on blocking them forever: they were told "you have already reviewed
        // this product" while the product page showed no review of theirs,
        // because every read filters `deleted_at IS NULL`. There was no way out
        // of that state from the UI.
        //
        // And it was a plain read inside the transaction, which locks nothing.
        // Two submissions arriving together both saw no review and both
        // inserted one; there is no unique key on (product_id, user_id) to
        // catch it. `FOR UPDATE` makes the second wait for the first.
        const [existing] = await connection.query(
            `SELECT id
               FROM reviews
              WHERE product_id = ? AND user_id = ? AND deleted_at IS NULL
              LIMIT 1
              FOR UPDATE`,
            [productId, userId]
        );

        if (safeArray(existing).length > 0) {
            await connection.rollback();

            return res.status(400).json({
                success: false,
                message: "You have already reviewed this product"
            });
        }

        const [purchases] = await connection.query(
            `
                SELECT o.id
                FROM orders o
                JOIN order_items oi ON oi.order_id = o.id
                WHERE o.user_id = ?
                    AND oi.product_id = ?
                    AND o.status = 'delivered'
                LIMIT 1
            `,
            [userId, productId]
        );

        if (!safeArray(purchases).length) {
            await connection.rollback();

            return res.status(403).json({
                success: false,
                message: "You can only review products you have purchased"
            });
        }

        // is_verified is set here rather than left at its default.
        //
        // The purchase check immediately above has already established that
        // this user has a `delivered` order containing the product -- which is
        // exactly what the badge means. Every existing review was therefore a
        // verified purchase carrying `is_verified = 0`, because nothing ever
        // wrote the column (#1349).
        const [result] = await connection.query(
            `
                INSERT INTO reviews (
                    product_id, user_id, rating, title, comment, images,
                    is_verified, is_approved, moderation_status
                )
                VALUES (?, ?, ?, ?, ?, ?, 1, 1, 'approved')
            `,
            [
                productId,
                userId,
                rating,
                title,
                comment,
                images.length ? JSON.stringify(images) : null
            ]
        );

        const stats = await refreshProductReviewStats(productId, connection);

        await connection.commit();

        return res.status(201).json({
            success: true,
            message: "Review submitted successfully",
            reviewId: result.insertId,
            ...stats
        });
    } catch (error) {
        await connection.rollback();
        console.error("CREATE PRODUCT REVIEW ERROR:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to submit review"
        });
    } finally {
        connection.release();
    }
};

const deleteProductReview = async (req, res) => {
    const productId = safeUUID(req.params.id);
    const reviewId = safeInteger(req.params.reviewId);
    const connection = await db.getConnection();

    if (!productId || !reviewId) {
        connection.release();

        return res.status(400).json({
            success: false,
            message: "Invalid review request"
        });
    }

    try {
        await connection.beginTransaction();

        // Soft delete.
        //
        // `deleted_at` and `deleted_by` were in the schema from the start and
        // ignored: this was a hard `DELETE FROM reviews`, which left no record
        // that the review had existed, who removed it, or why. That is exactly
        // the record you want when a seller disputes a takedown (#1349).
        const [result] = await connection.query(
            `UPDATE reviews
                SET deleted_at = NOW(),
                    deleted_by = ?,
                    moderation_status = 'rejected',
                    is_approved = 0,
                    moderation_notes = ?
              WHERE id = ? AND product_id = ? AND deleted_at IS NULL`,
            [
                safeUUID(req.user?.id),
                sanitizeString(req.body?.reason || "").slice(0, 1000) || null,
                reviewId,
                productId
            ]
        );

        if (result.affectedRows === 0) {
            await connection.rollback();

            return res.status(404).json({
                success: false,
                message: "Review not found"
            });
        }

        const stats = await refreshProductReviewStats(productId, connection);

        await connection.commit();

        return res.status(200).json({
            success: true,
            message: "Review deleted successfully",
            ...stats
        });
    } catch (error) {
        await connection.rollback();
        console.error("DELETE PRODUCT REVIEW ERROR:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to delete review"
        });
    } finally {
        connection.release();
    }
};

/**
 * Normalise the `images` field of a review submission.
 *
 * Only http(s) URLs are kept, capped in count and length. The column is JSON,
 * so anything that survives here is rendered on the product page -- a
 * `javascript:` URL in an image list is a stored XSS, and the repo has already
 * had one class of that (#1276).
 *
 * @param {*} value
 * @returns {string[]}
 */
function normalizeReviewImages(value) {
    if (!Array.isArray(value)) return [];

    const isDataImage = (url) =>
        /^data:image\/(png|jpe?g|webp|gif);base64,/i.test(url);

    return value
        .slice(0, MAX_REVIEW_IMAGES)
        .map((url) => {
            const str = sanitizeString(url || "");

            // An oversized data URI is dropped, not trimmed.
            //
            // `slice()` cut the payload mid-stream and the result still began
            // `data:image/jpeg;base64,`, so it passed the filter below and was
            // written to reviews.images -- a truncated, undecodable URI that
            // renders as a broken image for as long as the review exists.
            // Truncating turns a rejectable request into permanent bad data;
            // rejecting is recoverable (#1654).
            if (isDataImage(str)) {
                return str.length > MAX_REVIEW_IMAGE_CHARS ? "" : str;
            }

            return str.slice(0, 500);
        })
        .filter((url) => /^https?:\/\//i.test(url) || isDataImage(url));
}

/**
 * Map a service error onto a response.
 *
 * ReviewError carries the status it wants. Anything else is unexpected, so the
 * detail goes to the log and the caller gets a generic message (#1076).
 */
function handleServiceError(res, error, context) {
    if (error instanceof ReviewError) {
        return res.status(error.status).json({
            success: false,
            message: error.message,
            code: error.code
        });
    }

    console.error(`${context}:`, error);

    return res.status(500).json({
        success: false,
        message: "Something went wrong. Please try again."
    });
}

/**
 * POST /api/products/:id/reviews/:reviewId/helpful
 *
 * Idempotent: a second vote from the same user reports `alreadyVoted` rather
 * than inflating the counter.
 */
const markReviewHelpful = async (req, res) => {
    const reviewId = safeInteger(req.params.reviewId);

    if (!reviewId) {
        return res.status(400).json({ success: false, message: "Invalid review ID" });
    }

    try {
        const result = await reviewModerationService.voteHelpful(req.user?.id, reviewId);

        return res.status(200).json({
            success: true,
            message: result.alreadyVoted
                ? "You have already marked this review as helpful"
                : "Thanks for the feedback",
            ...result
        });
    } catch (error) {
        return handleServiceError(res, error, "MARK REVIEW HELPFUL ERROR");
    }
};

/**
 * DELETE /api/products/:id/reviews/:reviewId/helpful
 */
const unmarkReviewHelpful = async (req, res) => {
    const reviewId = safeInteger(req.params.reviewId);

    if (!reviewId) {
        return res.status(400).json({ success: false, message: "Invalid review ID" });
    }

    try {
        const result = await reviewModerationService.unvoteHelpful(req.user?.id, reviewId);

        return res.status(200).json({ success: true, message: "Vote withdrawn", ...result });
    } catch (error) {
        return handleServiceError(res, error, "UNMARK REVIEW HELPFUL ERROR");
    }
};

/**
 * POST /api/products/:id/reviews/:reviewId/report
 *
 * The response is deliberately identical whether or not this report pushed the
 * review over the auto-flag threshold. Telling a reporter "two more and it
 * disappears" is an invitation to organise.
 */
const reportReview = async (req, res) => {
    const reviewId = safeInteger(req.params.reviewId);

    if (!reviewId) {
        return res.status(400).json({ success: false, message: "Invalid review ID" });
    }

    try {
        const result = await reviewModerationService.reportReview(req.user?.id, reviewId, {
            reason: req.body?.reason,
            details: req.body?.details
        });

        return res.status(200).json({
            success: true,
            message: result.alreadyReported
                ? "You have already reported this review"
                : "Thanks — this review has been sent for moderation",
            reviewId: result.reviewId
        });
    } catch (error) {
        return handleServiceError(res, error, "REPORT REVIEW ERROR");
    }
};

/**
 * GET /api/products/reviews/moderation/reasons
 *
 * So the client does not carry its own copy of the list and drift from it.
 */
const getReportReasons = (req, res) => {
    return res.status(200).json({ success: true, reasons: REPORT_REASONS });
};

/**
 * GET /api/products/reviews/moderation/queue  (admin)
 *
 * Pending first, most-reported first. There was no queue at all, so moderation
 * was reactive to whatever an admin happened to read.
 */
const getModerationQueue = async (req, res) => {
    try {
        const queue = await reviewModerationService.getModerationQueue({
            status: req.query.status,
            page: req.query.page,
            limit: req.query.limit
        });

        return res.status(200).json({ success: true, ...queue });
    } catch (error) {
        return handleServiceError(res, error, "REVIEW MODERATION QUEUE ERROR");
    }
};

/**
 * GET /api/products/reviews/:reviewId/reports  (admin)
 *
 * The reports themselves, so a moderator sees the case rather than the count.
 */
const getReviewReports = async (req, res) => {
    const reviewId = safeInteger(req.params.reviewId);

    if (!reviewId) {
        return res.status(400).json({ success: false, message: "Invalid review ID" });
    }

    try {
        const reports = await reviewModerationService.getReviewReports(reviewId);

        return res.status(200).json({ success: true, reviewId, reports });
    } catch (error) {
        return handleServiceError(res, error, "GET REVIEW REPORTS ERROR");
    }
};

/**
 * PATCH /api/products/reviews/:reviewId/moderate  (admin)
 *
 * Approve or reject, with a note recorded against the moderator. Refreshes the
 * product's cached rating, because a rejected review must stop counting toward
 * it -- the defect this whole change started from.
 */
const moderateReview = async (req, res) => {
    const reviewId = safeInteger(req.params.reviewId);

    if (!reviewId) {
        return res.status(400).json({ success: false, message: "Invalid review ID" });
    }

    try {
        const result = await reviewModerationService.moderateReview(req.user?.id, reviewId, {
            status: req.body?.status,
            notes: req.body?.notes
        });

        return res.status(200).json({
            success: true,
            message: `Review ${result.status}`,
            ...result
        });
    } catch (error) {
        return handleServiceError(res, error, "MODERATE REVIEW ERROR");
    }
};

module.exports = {
    // Exported so the /api/reviews router can keep the product's rating
    // aggregate in step after an edit, instead of leaving `products.rating`
    // reporting a number no review supports any more (#1653).
    refreshProductReviewStats,
    getProductReviews,
    createProductReview,
    deleteProductReview,
    markReviewHelpful,
    unmarkReviewHelpful,
    reportReview,
    getReportReasons,
    getModerationQueue,
    getReviewReports,
    moderateReview,

    // Exported for the size and truncation rules to be tested directly. What
    // goes wrong here is arithmetic against a request body limit, and reaching
    // it through a full createProductReview round trip would test the mocking
    // rather than the rule (#1654).
    normalizeReviewImages,
    MAX_REVIEW_IMAGES,
    MAX_REVIEW_IMAGE_CHARS
};
