// backend/middleware/uuidParam.js
//
// A `router.param` guard for the route segments that carry a UUID.
//
// `users`, `products` and `orders` are keyed by CHAR(36) UUIDs -- declared that
// way in migrations/0001_baseline_schema.sql and settled as the key strategy in
// migrations/0023_settle_uuid_key_strategy.sql. Two routers nonetheless
// validated `:id` with `parseInt`:
//
//     const parsedId = parseInt(id, 10);
//     if (!parsedId || parsedId < 1) return res.status(400)...
//
// `parseInt` reads a UUID from the left and stops at the first character that
// is not a digit. So the guard behaved two different ways depending on nothing
// more than the first character of the key:
//
//   "550e8400-e29b-41d4-a716-446655440000" -> 550  -> truthy -> passes
//   "f47ac10b-58cc-4372-a567-0e02b2c3d479" -> NaN  -> falsy  -> 400
//
// A v4 UUID starts with a hex letter six times out of sixteen, so roughly 37%
// of products and orders answered "Invalid product ID" for a perfectly valid
// id, and the other 63% got through on a number that was never the id. The
// handlers then re-read `req.params.id` through `safeUUID` and worked, which is
// why the guard survived: it never validated anything, it only ever produced
// false rejections (#1443).
//
// This module replaces both with one definition. Declaring it once is the
// point -- the third router to grow a UUID `:id` should not have to rediscover
// any of the above.

const { safeUUID } = require('../utils/helpers');

/**
 * Build a `router.param` handler that accepts a UUID and rejects anything else.
 *
 * The validated id is attached as `req[attachAs]` when asked for, so a handler
 * can take it without re-parsing. `req.params` is deliberately left alone --
 * handlers already read it through `safeUUID`, and a param guard that rewrites
 * the request is harder to reason about than one that only ever answers yes or
 * no.
 *
 * @param {object} [options]
 * @param {string} [options.resourceName="Resource"] - Used in the rejection
 *   message, e.g. "Product" produces "Invalid product ID".
 * @param {string} [options.attachAs] - Property to hang the validated id on,
 *   e.g. "productId" for `req.productId`.
 * @returns {import('express').RequestParamHandler}
 */
function uuidParam(options = {}) {
    const resourceName = options.resourceName || 'Resource';
    const attachAs = options.attachAs || null;

    // "Invalid product ID", not "Invalid Product ID" -- the exact message the
    // controllers already send for this condition, so a client matching on the
    // text keeps working and the two layers cannot disagree.
    const message = `Invalid ${resourceName.toLowerCase()} ID`;

    return function validateUuidParam(req, res, next, value) {
        const id = safeUUID(value);

        if (!id) {
            return res.status(400).json({
                success: false,
                message
            });
        }

        if (attachAs) {
            req[attachAs] = id;
        }

        return next();
    };
}

module.exports = uuidParam;
module.exports.uuidParam = uuidParam;
