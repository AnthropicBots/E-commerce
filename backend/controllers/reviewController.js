const db = require("../config/db");
const Review = require("../models/Review");
const {
    safeArray,
    safeInteger,
    safeUUID,
    sanitizeString
} = require("../utils/helpers");

async function productExists(productId) {
    const [products] = await db.query(
        "SELECT id FROM products WHERE id = ? LIMIT 1",
        [productId]
    );

    return safeArray(products).length > 0;
}

async function refreshProductReviewStats(productId, connection = db) {
    const [stats] = await connection.query(
        `
            SELECT
                COALESCE(ROUND(AVG(rating), 2), 0) AS average_rating,
                COUNT(*) AS review_count
            FROM reviews
            WHERE product_id = ?
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

        const [reviews] = await db.query(
            `
                SELECT
                    r.id,
                    r.product_id,
                    r.user_id,
                    u.name AS user_name,
                    r.rating,
                    r.comment,
                    r.created_at
                FROM reviews r
                JOIN users u ON u.id = r.user_id
                WHERE r.product_id = ?
                ORDER BY r.created_at DESC, r.id DESC
            `,
            [productId]
        );

        const [stats] = await db.query(
            `
                SELECT
                    rating AS average_rating,
                    num_reviews AS review_count
                FROM products
                WHERE id = ?
                LIMIT 1
            `,
            [productId]
        );

        return res.status(200).json({
            success: true,
            message: "Reviews fetched successfully",
            averageRating: Number(stats?.[0]?.average_rating || 0),
            reviewCount: Number(stats?.[0]?.review_count || 0),
            reviews: safeArray(reviews).map((review) => new Review(review))
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

        const [products] = await connection.query(
            "SELECT id FROM products WHERE id = ? LIMIT 1",
            [productId]
        );

        if (!safeArray(products).length) {
            await connection.rollback();

            return res.status(404).json({
                success: false,
                message: "Product not found"
            });
        }

        const [existing] = await connection.query(
            "SELECT id FROM reviews WHERE product_id = ? AND user_id = ? LIMIT 1",
            [productId, userId]
        );

        if (safeArray(existing).length > 0) {
            await connection.rollback();

            return res.status(400).json({
                success: false,
                message: "You have already reviewed this product"
            });
        }

        const [result] = await connection.query(
            `
                INSERT INTO reviews (product_id, user_id, rating, comment)
                VALUES (?, ?, ?, ?)
            `,
            [productId, userId, rating, comment]
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

        const [result] = await connection.query(
            "DELETE FROM reviews WHERE id = ? AND product_id = ?",
            [reviewId, productId]
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

module.exports = {
    getProductReviews,
    createProductReview,
    deleteProductReview
};
