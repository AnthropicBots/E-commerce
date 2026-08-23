// backend/routes/reviewRoutes.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const reviewRepo = require('../repositories/reviewRepository');

/**
 * @route   POST /api/reviews
 * @desc    Create a review for a product
 * @access  Private
 */
router.post('/', authMiddleware, async (req, res) => {
    try {
        const { productId, rating, comment, title, images } = req.body;
        const userId = req.user.id;

        if (!productId) {
            return res.status(400).json({ success: false, message: 'Product ID is required' });
        }

        const numRating = Number(rating);
        if (isNaN(numRating) || numRating < 1 || numRating > 5) {
            return res.status(400).json({ success: false, message: 'Rating must be an integer between 1 and 5' });
        }

        if (!comment || typeof comment !== 'string' || comment.trim().length < 3) {
            return res.status(400).json({ success: false, message: 'Comment must be at least 3 characters long' });
        }

        const review = await reviewRepo.create({
            productId,
            userId,
            rating: numRating,
            comment: comment.trim(),
            title: title ? String(title).trim() : null,
            images
        });

        return res.status(201).json({
            success: true,
            message: 'Review created successfully',
            review
        });
    } catch (error) {
        console.error('Error creating review:', error);
        return res.status(500).json({ success: false, message: error.message || 'Server error creating review' });
    }
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

        const updated = await reviewRepo.update(req.params.id, req.body);
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

        const deleted = await reviewRepo.delete(req.params.id);
        return res.status(200).json({ success: true, message: 'Review deleted successfully', deleted });
    } catch (error) {
        console.error('Error deleting review:', error);
        return res.status(500).json({ success: false, message: error.message || 'Server error deleting review' });
    }
});

module.exports = router;
