// backend/middleware/promptInjectionMiddleware.js
//
// Content screening in front of the two routes that take free text from a
// shopper and later feed it to a model: the agent content endpoint and product
// reviews.
//
// Both guards below had the same three defects, which stayed invisible for as
// long as `validateProductReview` was attached only to a route nothing could
// reach (#1493):
//
//   1. `SECURITY_CONFIG` was referenced in both 403 branches and imported by
//      neither, so reaching the block threw ReferenceError -- and the outer
//      catch turned that throw into `next()`. The guard let unsafe content
//      through at precisely the moment it decided the content was unsafe.
//   2. `validateProductReview` read `req.body.review`. Nothing sends `review`;
//      `createProductReview` reads `req.body.comment`. Attaching the guard to
//      the real route would have screened an always-absent field and returned
//      `next()` on every request.
//   3. The failure envelope used `error` where the rest of the API uses
//      `message` (AGENTS.md), so the frontend's `response.message` was
//      undefined and a blocked review surfaced as a blank toast.

const contentSecurityService = require('../services/contentSecurityService');

/**
 * The trust score a piece of content has to reach to be let through.
 *
 * Read off the service rather than restated here: it owns the number, and a
 * second copy of it in the middleware is a copy that can drift. `getStats()`
 * returns the whole config, which is where the threshold lives.
 *
 * @returns {number|null} the configured threshold, or null if it cannot be read
 */
function trustThreshold() {
    try {
        return contentSecurityService.getStats?.()?.config?.trustThreshold ?? null;
    } catch (error) {
        return null;
    }
}

/**
 * Build the 403 body for content that failed screening.
 *
 * `message` is the field the API envelope specifies and the frontend reads.
 * `error` is kept alongside it so any existing caller keyed on it does not
 * break -- this middleware has had that shape since it was written, and
 * removing it is a contract change that does not belong in a routing fix.
 *
 * @param {string} message
 * @param {{trustScore?: number, flags?: string[]}} result
 * @returns {object}
 */
function rejection(message, result) {
    return {
        success: false,
        message,
        error: message,
        trustScore: result.trustScore,
        flags: result.flags,
        threshold: trustThreshold()
    };
}

/**
 * Middleware to sanitize content for agent consumption.
 */
async function sanitizeAgentContent(req, res, next) {
    try {
        const { content, contentType, context = {} } = req.body || {};

        if (!content) {
            return next();
        }

        const result = await contentSecurityService.sanitizeContent(
            content,
            contentType || 'user_comment',
            context
        );

        // Store sanitized content
        req.sanitizedContent = result;

        // Block unsafe content
        if (!result.isSafe) {
            return res.status(403).json(
                rejection('Content failed security validation', result)
            );
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
 * Middleware to validate product reviews.
 *
 * Reads `comment`, which is the field `POST /api/products/:id/review` sends and
 * `createProductReview` reads. `review` is still accepted so that any caller
 * written against the old (unreachable) route keeps working, and whichever
 * field arrived is the one written back with the sanitized text.
 */
async function validateProductReview(req, res, next) {
    try {
        const body = req.body || {};
        const field = typeof body.comment === 'string' && body.comment
            ? 'comment'
            : 'review';
        const text = body[field];
        const { rating } = body;

        if (!text) {
            return next();
        }

        // `productId` comes from the path on the real route and from the body
        // on the agent-facing one. It is context for the log, not a lookup, so
        // either source is fine and neither is required.
        const productId = req.params?.id || body.productId;

        const result = await contentSecurityService.sanitizeContent(
            text,
            'product_review',
            { productId, rating, source: 'product_review' }
        );

        // Block unsafe reviews.
        //
        // Checked BEFORE the body is rewritten. Writing the sanitized text back
        // and then refusing the request leaves a mutated body behind for
        // anything downstream of a handler that swallows the 403.
        if (!result.isSafe) {
            return res.status(403).json(
                rejection('Review failed security validation', result)
            );
        }

        req.body[field] = result.sanitized;
        req.body._originalReview = text;
        req.body._reviewTrustScore = result.trustScore;

        next();
    } catch (error) {
        console.error('Review validation error:', error);
        next();
    }
}

module.exports = {
    sanitizeAgentContent,
    validateProductReview,
    trustThreshold
};
