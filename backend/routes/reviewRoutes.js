// backend/routes/reviewRoutes.js
//
// The account-facing view of reviews: "what have I written", and the writes a
// shopper makes against their own review.
//
// Every write here goes through reviewController rather than straight to the
// repository. That router shipped in #1643 calling `reviewRepo.create()`
// directly, which meant `POST /api/reviews` was a second door into the
// `reviews` table with none of the locks on the first one: no purchase check,
// no duplicate check, no `is_verified`, no rating refresh, no transaction. Any
// signed-in account could review any product, repeatedly, and the stars on the
// shop grid never moved because nothing recomputed them (#1653).
//
// The guards are not reimplemented here. They live in reviewController, which
// the product page already posts through, and this router adapts the request
// shape and hands over. One set of rules, two URLs -- rather than two sets of
// rules that drift.

const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const reviewRepo = require('../repositories/reviewRepository');
const reviewController = require('../controllers/reviewController');

/**
 * Hand a request to a controller that reads the product id from the path.
 *
 * `createProductReview` and `deleteProductReview` are mounted under
 * `/products/:id/...`, so they take the product from `req.params.id`. Here it
 * arrives in the body, or has to be looked up from the review. Rewriting
 * `req.params` is the whole adaptation.
 */
const withParams = (req, params) => {
    req.params = { ...req.params, ...params };
    return req;
};

/**
 * @route   POST /api/reviews
 * @desc    Create a review for a product
 * @access  Private -- and only for a product the caller has actually received
 */
router.post('/', authMiddleware, async (req, res) => {
    const productId = req.body?.productId;

    if (!productId) {
        return res.status(400).json({
            success: false,
            message: 'Product ID is required'
        });
    }

    // Everything after this -- the UUID check, the 1-5 rating, the comment
    // length, the product-exists check, the FOR UPDATE duplicate check, the
    // delivered-order purchase check, is_verified, moderation_status and the
    // rating refresh -- is the controller's, inside its transaction.
    return reviewController.createProductReview(
        withParams(req, { id: productId }),
        res
    );
});

/**
 * @route   GET /api/reviews
 * @desc    List reviews (filtered by productId or userId)
 * @access  Private
 */
router.get('/', authMiddleware, async (req, res) => {
    try {
        const { productId, userId, page = 1, limit = 20 } = req.query;

        let reviews = [];
        if (productId) {
            reviews = await reviewRepo.findByProduct(productId, { page: Number(page), limit: Number(limit) });
        } else if (userId) {
            reviews = await reviewRepo.findByUser(userId, { page: Number(page), limit: Number(limit) });
        } else {
            reviews = await reviewRepo.findByUser(req.user.id, { page: Number(page), limit: Number(limit) });
        }

        return res.status(200).json({
            success: true,
            count: reviews.length,
            reviews
        });
    } catch (error) {
        console.error('Error listing reviews:', error);
        return res.status(500).json({ success: false, message: error.message || 'Server error listing reviews' });
    }
});

/**
 * @route   GET /api/reviews/:id
 * @desc    Get review by ID
 * @access  Private
 */
router.get('/:id', authMiddleware, async (req, res) => {
    try {
        const review = await reviewRepo.findById(req.params.id);
        if (!review) {
            return res.status(404).json({ success: false, message: 'Review not found' });
        }
        return res.status(200).json({ success: true, review });
    } catch (error) {
        console.error('Error fetching review:', error);
        return res.status(500).json({ success: false, message: error.message || 'Server error fetching review' });
    }
});

/**
 * @route   PUT /api/reviews/:id
 * @desc    Update a review
 * @access  Private
 */
router.put('/:id', authMiddleware, async (req, res) => {
    try {
        const existing = await reviewRepo.findById(req.params.id);
        if (!existing) {
            return res.status(404).json({ success: false, message: 'Review not found' });
        }

        if (existing.user_id !== req.user.id && req.user.role !== 'admin') {
            return res.status(403).json({ success: false, message: 'Unauthorized to update this review' });
        }

        // A rating outside 1-5 is refused rather than clamped.
        //
        // `reviewRepository.update` computes `Math.max(1, Math.min(5, Number(x) || 5))`,
        // so a 0 became a 5 and a 99 became a 5 -- a shopper's one-star edit
        // silently stored as five stars. Clamping is the wrong answer to a
        // value nobody meant.
        if (req.body?.rating !== undefined) {
            const numRating = Number(req.body.rating);

            if (!Number.isInteger(numRating) || numRating < 1 || numRating > 5) {
                return res.status(400).json({
                    success: false,
                    message: 'Rating must be an integer between 1 and 5'
                });
            }
        }

        const updated = await reviewRepo.update(req.params.id, req.body);

        // An edited rating changes the product's average. Nothing recomputed
        // it, so `products.rating` kept reporting the figure from before the
        // edit indefinitely.
        if (req.body?.rating !== undefined && existing.product_id) {
            await reviewController.refreshProductReviewStats(existing.product_id);
        }

        return res.status(200).json({ success: true, message: 'Review updated successfully', review: updated });
    } catch (error) {
        console.error('Error updating review:', error);
        return res.status(500).json({ success: false, message: error.message || 'Server error updating review' });
    }
});

/**
 * @route   DELETE /api/reviews/:id
 * @desc    Delete a review
 * @access  Private
 */
router.delete('/:id', authMiddleware, async (req, res) => {
    try {
        const existing = await reviewRepo.findById(req.params.id);
        if (!existing) {
            return res.status(404).json({ success: false, message: 'Review not found' });
        }

        if (existing.user_id !== req.user.id && req.user.role !== 'admin') {
            return res.status(403).json({ success: false, message: 'Unauthorized to delete this review' });
        }

        // Delegated for the same reason the create is: the controller's delete
        // is a soft delete that records `deleted_by` and a reason, sets
        // `moderation_status`, and refreshes the product's rating -- all in one
        // transaction. `reviewRepo.delete()` only stamped `deleted_at`, so a
        // removed review went on counting towards the product's stars.
        return reviewController.deleteProductReview(
            withParams(req, {
                id: existing.product_id,
                reviewId: req.params.id
            }),
            res
        );
    } catch (error) {
        console.error('Error deleting review:', error);
        return res.status(500).json({ success: false, message: error.message || 'Server error deleting review' });
    }
});

module.exports = router;
