// backend/controllers/pincodeController.js
//
// "Do you deliver to my pincode?" (#1496).
//
// Four handlers lived here and one had a route. `checkMultiplePincodes`,
// `searchPincodes` and `clearPincodeCache` were exported and unreachable --
// including the only one that could clear a cache.
//
// The rest of what changed:
//
//   * this file kept its own NodeCache, a second one under the same key scheme
//     as the model's, and neither invalidation reached the other. Both now go
//     through services/pincodeCache.js; see that file for the whole story.
//   * `clearPincodeCache` guarded itself with `req.user && !hasPermission(...)`,
//     so a caller with no `req.user` short-circuited the `&&` and flushed the
//     cache. The route was unmounted, which is the only thing that made it
//     latent -- and mounting it, which is the obvious fix for the paragraph
//     above, would have published an unauthenticated cache-flush endpoint under
//     a message reading "Only admins can clear pincode cache". The guard is
//     `config/policy.authorize` now, applied at the route.
//   * the rate limiter was a hand-rolled `Map` that inserted one entry per
//     client address and never removed one: an unbounded map keyed by
//     attacker-supplied source addresses, on an endpoint reachable from the
//     open internet. It is a limiter from middleware/rateLimiter.js now, which
//     already solves the multi-process and proxy cases this got wrong.
//   * `PINCODE_REGEX` was read from the environment as if it were a regex.
//     `process.env` values are strings, so setting the variable that exists to
//     configure this turned every request into
//     `TypeError: PINCODE_REGEX.test is not a function`.
//   * `delivery_charges` and `cod_available` are on the row and were dropped
//     from the answer. For a shopper about to pay cash on delivery, whether
//     cash on delivery is available is the question they came to ask.

const Pincode = require("../models/Pincode");
const pincodeCache = require("../services/pincodeCache");

/**
 * Six digits, or whatever `PINCODE_REGEX` says.
 *
 * Compiled if it comes from the environment. It used to be used raw, and a
 * string has no `.test`.
 */
const PINCODE_REGEX = (() => {
    const configured = process.env.PINCODE_REGEX;

    if (!configured) {
        return /^\d{6}$/;
    }

    try {
        return new RegExp(configured);
    } catch (error) {
        console.error(
            `PINCODE_REGEX is not a valid regular expression (${error.message}); ` +
                "falling back to the six-digit default"
        );
        return /^\d{6}$/;
    }
})();

const BATCH_MAX_LIMIT = parseInt(process.env.PINCODE_BATCH_LIMIT, 10) || 50;

function validatePincode(pincode) {
    if (!pincode || typeof pincode !== 'string') {
        return { valid: false, message: "Pincode is required" };
    }

    const sanitized = pincode.replace(/[^\d]/g, '');

    if (!PINCODE_REGEX.test(sanitized)) {
        return {
            valid: false,
            message: "Please enter a valid 6-digit pincode."
        };
    }

    return { valid: true, sanitized };
}

/**
 * Turn the row into the answer a shopper asked for.
 *
 * @param {object|undefined} row
 * @returns {object}
 */
function toVerdict(row) {
    if (!row) {
        return {
            deliverable: false,
            message: "Sorry, delivery is not currently available at this pincode."
        };
    }

    const etaDays = Number(row.eta_days);
    const deliveryCharges = Number(row.delivery_charges || 0);
    const codAvailable = row.cod_available === 1 || row.cod_available === true;

    return {
        deliverable: true,
        eta_days: etaDays,
        city: row.city,
        state: row.state,
        // Both were on the row and neither was returned. Someone checking
        // their pincode before buying wants to know what shipping costs and
        // whether they can pay on delivery, not only when it turns up.
        delivery_charges: deliveryCharges,
        cod_available: codAvailable,
        message:
            `Delivery available! Estimated delivery in ${etaDays} day(s) to ` +
            `${row.city}, ${row.state}.` +
            (codAvailable ? " Cash on delivery is available." : "")
    };
}

/**
 * GET /api/pincode/check/:pincode
 */
const checkPincode = async (req, res) => {
    const { pincode } = req.params;
    const validation = validatePincode(pincode);

    if (!validation.valid) {
        return res.status(400).json({
            success: false,
            message: validation.message
        });
    }

    const sanitizedPincode = validation.sanitized;

    const cached = pincodeCache.get(pincodeCache.NAMESPACE_VERDICT, sanitizedPincode);

    if (cached) {
        return res.status(200).json({
            success: true,
            ...cached,
            // The documented envelope is { success, message, data }. The
            // top-level fields stay because frontend/scripts/pincode.js reads
            // `data.message` and `data.deliverable` off the top level; both
            // shapes are served until that caller moves.
            data: cached,
            cached: true
        });
    }

    try {
        const results = await Pincode.findByCode(sanitizedPincode);
        const verdict = toVerdict(results?.[0]);

        pincodeCache.set(pincodeCache.NAMESPACE_VERDICT, sanitizedPincode, verdict);

        return res.status(200).json({
            success: true,
            ...verdict,
            data: verdict,
            cached: false
        });

    } catch (error) {
        console.error("Pincode check error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Server error. Please try again."
        });
    }
};

/**
 * POST /api/pincode/check-multiple
 *
 * Exported and unrouted until now.
 */
const checkMultiplePincodes = async (req, res) => {
    const { pincodes } = req.body || {};

    if (!Array.isArray(pincodes) || pincodes.length === 0) {
        return res.status(400).json({
            success: false,
            message: "Please provide an array of pincodes"
        });
    }

    if (pincodes.length > BATCH_MAX_LIMIT) {
        return res.status(400).json({
            success: false,
            message: `Maximum ${BATCH_MAX_LIMIT} pincodes allowed per request`
        });
    }

    try {
        const results = [];
        const uniquePincodes = [...new Set(pincodes)];

        for (const code of uniquePincodes) {
            const validation = validatePincode(code);

            if (!validation.valid) {
                results.push({
                    pincode: typeof code === "string" ? code : String(code),
                    valid: false,
                    error: validation.message
                });
                continue;
            }

            const sanitized = validation.sanitized;
            const cached = pincodeCache.get(pincodeCache.NAMESPACE_VERDICT, sanitized);

            if (cached) {
                results.push({ pincode: sanitized, ...cached, cached: true });
                continue;
            }

            const rows = await Pincode.findByCode(sanitized);
            const verdict = toVerdict(rows?.[0]);

            pincodeCache.set(pincodeCache.NAMESPACE_VERDICT, sanitized, verdict);

            results.push({ pincode: sanitized, ...verdict, cached: false });
        }

        return res.status(200).json({
            success: true,
            message: "Pincode availability retrieved",
            data: results,
            total: results.length
        });

    } catch (error) {
        console.error("Batch pincode check error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Server error. Please try again."
        });
    }
};

/**
 * GET /api/pincode/search?query=
 *
 * Exported and unrouted until now.
 */
const searchPincodes = async (req, res) => {
    const { query } = req.query;

    if (!query || String(query).trim().length < 3) {
        return res.status(400).json({
            success: false,
            message: "Search query must be at least 3 characters"
        });
    }

    try {
        const results = await Pincode.search(String(query).trim());

        return res.status(200).json({
            success: true,
            message: "Pincode search completed",
            data: results,
            total: results.length
        });

    } catch (error) {
        console.error("Pincode search error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Server error. Please try again."
        });
    }
};

/**
 * POST /api/pincode/cache/clear
 *
 * Authorisation is `authorize(PERMISSIONS.CACHE_MANAGE)` at the route, not a
 * check in here. The check that was in here read
 *
 *     if (req.user && !hasPermission(req.user, PERMISSIONS.CACHE_MANAGE))
 *
 * which refuses a signed-in non-admin and waves an anonymous caller straight
 * through to `flushAll()`. `hasPermission(undefined, ...)` already returns
 * false, so the `req.user &&` was not guarding against a crash -- it only
 * weakened the check.
 */
const clearPincodeCache = async (req, res) => {
    try {
        const cleared = pincodeCache.flush();

        console.log(
            `Pincode cache cleared by ${req.user?.id || "unknown"}: ${cleared} entries removed`
        );

        return res.status(200).json({
            success: true,
            message: `Pincode cache cleared successfully (${cleared} entries removed)`,
            data: { cleared }
        });

    } catch (error) {
        console.error("Clear pincode cache error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Failed to clear pincode cache"
        });
    }
};

module.exports = {
    checkPincode,
    checkMultiplePincodes,
    searchPincodes,
    clearPincodeCache,
    toVerdict,
    validatePincode,
    PINCODE_REGEX
};
