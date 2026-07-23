// backend/middleware/promptInjectionMiddleware.js
const contentSecurityService = require('../services/contentSecurityService');

/**
 * Middleware to sanitize content for agent consumption
 */
async function sanitizeAgentContent(req, res, next) {
    try {
        const { content, contentType, context = {} } = req.body;

        if (!content) {
            return next();
        }

        // Sanitize content
        const result = await contentSecurityService.sanitizeContent(
            content,
            contentType || 'user_comment',
            context
        );

        // Store sanitized content
        req.sanitizedContent = result;

        // Block unsafe content
        if (!result.isSafe) {
            return res.status(403).json({
                success: false,
                error: 'Content failed security validation',
                trustScore: result.trustScore,
                flags: result.flags,
                threshold: SECURITY_CONFIG.trustThreshold
            });
        }

        // Update content with sanitized version
        req.body.content = result.sanitized;
        req.body._originalContent = content;

        next();
    } catch (error) {
        console.error('Content sanitization error:', error);
        next();
    }
}

/**
 * Middleware to validate product reviews
 */
async function validateProductReview(req, res, next) {
    try {
        const { review, rating, productId } = req.body;

        if (!review) {
            return next();
        }

        // Sanitize review
        const result = await contentSecurityService.sanitizeContent(
            review,
            'product_review',
            { productId, rating, source: 'product_review' }
        );

        // Update review with sanitized version
        req.body.review = result.sanitized;
        req.body._originalReview = review;
        req.body._reviewTrustScore = result.trustScore;

        // Block unsafe reviews
        if (!result.isSafe) {
            return res.status(403).json({
                success: false,
                error: 'Review failed security validation',
                trustScore: result.trustScore,
                flags: result.flags,
                threshold: SECURITY_CONFIG.trustThreshold
            });
        }

        next();
    } catch (error) {
        console.error('Review validation error:', error);
        next();
    }
}

module.exports = {
    sanitizeAgentContent,
    validateProductReview
};