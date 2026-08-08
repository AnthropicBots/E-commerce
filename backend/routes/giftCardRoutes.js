// backend/routes/giftCardRoutes.js
const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/authMiddleware");
const { authorizeRoles } = require("../middleware/rbacMiddleware");
const { ROLES } = require("../config/policy");
const giftCardService = require("../services/giftCardService");

const { GiftCardError } = giftCardService;

// Map business-rule failures to HTTP status codes; anything else is a 500.
const ERROR_STATUS = {
    INVALID_AMOUNT: 400,
    INACTIVE: 400,
    EXPIRED: 410,
    INSUFFICIENT_BALANCE: 402,
    NOT_FOUND: 404,
    // 404 rather than 403: "not yours" and "no such order" have to answer
    // identically, or the endpoint becomes a way to enumerate order ids (#1478).
    ORDER_NOT_FOUND: 404,
    FORBIDDEN: 403,
    ORDER_NOT_PAYABLE: 409,
    ORDER_SETTLED: 409,
    CURRENCY_MISMATCH: 400
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
router.post("/issue", authMiddleware, authorizeRoles(ROLES.ADMIN), async (req, res) => {
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

// Pay part or all of an order with a gift card. Atomic + double-spend safe in
// the service, which also locks the order, checks it belongs to the caller and
// clamps the amount to what is outstanding on it.
//
// `orderId` is now required (#1478). It used to be optional, and omitting it
// called `redeem()`, which decremented the balance against nothing at all --
// a redemption that settles no order cannot be reconciled and is
// indistinguishable from one that was later refunded. There is no reason for a
// customer to burn store credit into thin air.
//
// `amount` is optional and means "as much as this card can cover" when absent.
router.post("/redeem", authMiddleware, async (req, res) => {
    try {
        const { code, amount, orderId } = req.body;

        if (!code) {
            return res.status(400).json({
                success: false,
                message: "Gift card code is required"
            });
        }

        if (!orderId) {
            return res.status(400).json({
                success: false,
                message: "An order ID is required to redeem a gift card"
            });
        }

        // The order's owner, from the token rather than from the body.
        // authMiddleware establishes who is calling; it does not establish that
        // this order is theirs, and nothing else here did either.
        const userId = req.user?.id ?? req.user?.userId;

        const result = await giftCardService.applyToOrder(
            code,
            orderId,
            amount,
            null,
            { userId }
        );

        return res.status(200).json({
            success: true,
            message: result.orderSettled
                ? "Gift card redeemed and order paid in full"
                : "Gift card redeemed",
            data: result
        });
    } catch (error) {
        return handleError(res, error, "GIFT CARD REDEEM ERROR:");
    }
});

module.exports = router;
