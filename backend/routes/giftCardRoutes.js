// backend/routes/giftCardRoutes.js
const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/authMiddleware");
const { authorizeRoles } = require("../middleware/rbacMiddleware");
const giftCardService = require("../services/giftCardService");

const { GiftCardError } = giftCardService;

// Map business-rule failures to HTTP status codes; anything else is a 500.
const ERROR_STATUS = {
    INVALID_AMOUNT: 400,
    INACTIVE: 400,
    EXPIRED: 410,
    INSUFFICIENT_BALANCE: 402,
    NOT_FOUND: 404
};

function handleError(res, error, logLabel) {
    if (error instanceof GiftCardError) {
        return res.status(ERROR_STATUS[error.code] || 400).json({
            success: false,
            message: error.message
        });
    }

    console.error(logLabel, error);

    return res.status(500).json({
        success: false,
        message: "Internal server error"
    });
}

// ==================== ADMIN ROUTES ====================

// Issue a new gift card. Returns the plaintext code exactly once.
router.post("/issue", authMiddleware, authorizeRoles("admin"), async (req, res) => {
    try {
        const { amount, currency, expiresAt } = req.body;

        const giftCard = await giftCardService.issue({ amount, currency, expiresAt });

        return res.status(201).json({
            success: true,
            message: "Gift card issued",
            data: giftCard
        });
    } catch (error) {
        return handleError(res, error, "GIFT CARD ISSUE ERROR:");
    }
});

// ==================== CUSTOMER ROUTES ====================

// Check a gift card balance. Code travels in the body, never the URL.
router.post("/balance", authMiddleware, async (req, res) => {
    try {
        const { code } = req.body;

        if (!code) {
            return res.status(400).json({
                success: false,
                message: "Gift card code is required"
            });
        }

        const balance = await giftCardService.getBalance(code);

        return res.status(200).json({
            success: true,
            message: "Gift card balance fetched",
            data: balance
        });
    } catch (error) {
        return handleError(res, error, "GIFT CARD BALANCE ERROR:");
    }
});

// Redeem an amount off a gift card. Atomic + double-spend safe in the service.
router.post("/redeem", authMiddleware, async (req, res) => {
    try {
        const { code, amount, orderId } = req.body;

        if (!code) {
            return res.status(400).json({
                success: false,
                message: "Gift card code is required"
            });
        }

        const result = orderId
            ? await giftCardService.applyToOrder(code, orderId, amount)
            : await giftCardService.redeem(code, amount);

        return res.status(200).json({
            success: true,
            message: "Gift card redeemed",
            data: result
        });
    } catch (error) {
        return handleError(res, error, "GIFT CARD REDEEM ERROR:");
    }
});

module.exports = router;
