/**
 * Canonical pricing API (#1386) — versioned rules + authoritative quotes.
 */

"use strict";

const express = require("express");
const router = express.Router();
const pricing = require("../services/pricing.service");
const checkoutController = require("../controllers/checkoutController");

/**
 * GET /api/pricing/rules
 * Versioned pricing rules document (display sync only — not for charging).
 */
router.get("/rules", (req, res) => {
    return res.status(200).json({
        success: true,
        message: "Canonical pricing rules",
        rules: pricing.getRulesDocument()
    });
});

/**
 * POST /api/pricing/quote
 * Authoritative calculator — same engine as /api/checkout/quote.
 */
router.post("/quote", checkoutController.quoteCheckout);

/**
 * POST /api/pricing/quote/verify
 * Validate a quote token without placing an order (checkout preflight).
 */
router.post("/quote/verify", (req, res) => {
    try {
        const token = req.body?.quoteToken || req.body?.token || "";
        const quoteId = req.body?.quoteId || null;
        const items = req.body?.items || null;
        const expectedTotal =
            req.body?.total !== undefined ? req.body.total : null;

        const payload = pricing.verifySignedQuote(token, {
            quoteId,
            items,
            expectedTotal
        });

        return res.status(200).json({
            success: true,
            message: "Pricing quote is valid",
            quote: payload
        });
    } catch (error) {
        return res.status(error.status || 400).json({
            success: false,
            code: error.code || "PRICING_QUOTE_INVALID",
            message: error.message
        });
    }
});

module.exports = router;
