// routes/orderRoutes.js
const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/authMiddleware");
const { optionalAuth } = authMiddleware;
const cartIdentity = require("../middleware/cartIdentity");
const { authorizeRoles } = require("../middleware/rbacMiddleware");
const { ROLES } = require("../config/policy");
const { requireOwnership, ownerFromTable } = require("../middleware/requireOwnership");
const { guestOrderLookupLimiter } = require("../middleware/rateLimiter");
const orderController = require("../controllers/orderController");
const { safeArray, safeNumber, sanitizeString } = require("../utils/helpers");

// ============================================
// CONSTANTS
// ============================================

const ALLOWED_STATUSES = ["pending", "processing", "shipped", "delivered", "cancelled"];
const ALLOWED_PAYMENT_METHODS = ["card", "cod", "upi", "paypal"];
const MAX_ITEMS = 50;
const MAX_TOTAL = 1000000; // ₹10 Lakhs
const MAX_REASON_LENGTH = 500;
const MAX_PAGE = 100;
const MAX_LIMIT = 100;

// Every `/:id` route below is one account reaching for one order, so the
// ownership rule is declared once here rather than restated per handler.
const ownsOrder = requireOwnership(ownerFromTable({ table: "orders" }), {
    resourceName: "Order"
});

// Cancelling is the exception: staff have never been able to cancel on a
// customer's behalf through this endpoint, and quietly granting that here
// would be a policy change smuggled in as a refactor.
const ownsOrderStrictly = requireOwnership(ownerFromTable({ table: "orders" }), {
    resourceName: "Order",
    allowPrivileged: false
});

// ============================================
// VALIDATION FUNCTIONS
// ============================================

/**
 * Validate order ID
 */
function validateOrderId(id) {
    const parsedId = parseInt(id, 10);
    if (!parsedId || parsedId < 1) {
        throw new Error('Invalid order ID');
    }
    return parsedId;
}

/**
 * Validate items array
 */
function validateItems(items) {
    const errors = [];

    if (!Array.isArray(items) || items.length === 0) {
        errors.push('Order items are required and must be a non-empty array');
        return { valid: false, errors };
    }

    if (items.length > MAX_ITEMS) {
        errors.push(`Order items cannot exceed ${MAX_ITEMS} items`);
    }

    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const index = i + 1;

        if (!item.productId || typeof item.productId !== 'string') {
            errors.push(`Item ${index}: productId is required and must be a string`);
        }

        if (!item.quantity || typeof item.quantity !== 'number' || item.quantity < 1 || item.quantity > 100) {
            errors.push(`Item ${index}: quantity must be between 1 and 100`);
        }

        if (!item.price || typeof item.price !== 'number' || item.price < 0) {
            errors.push(`Item ${index}: price must be a positive number`);
        }
    }

    return {
        valid: errors.length === 0,
        errors
    };
}

/**
 * Validate total amount
 */
function validateTotal(total) {
    const errors = [];

    if (typeof total !== 'number' || total <= 0) {
        errors.push('Total must be a positive number');
    }

    if (total > MAX_TOTAL) {
        errors.push(`Total cannot exceed ₹${MAX_TOTAL.toLocaleString()}`);
    }

    return {
        valid: errors.length === 0,
        errors
    };
}

/**
 * Validate payment method
 */
function validatePaymentMethod(method) {
    const errors = [];

    if (!method || typeof method !== 'string') {
        errors.push('Payment method is required');
    } else {
        const sanitized = method.trim().toLowerCase();
        if (!ALLOWED_PAYMENT_METHODS.includes(sanitized)) {
            errors.push(`Payment method must be one of: ${ALLOWED_PAYMENT_METHODS.join(', ')}`);
        }
    }

    return {
        valid: errors.length === 0,
        errors
    };
}

/**
 * Validate status
 */
function validateStatus(status) {
    const errors = [];

    if (!status || typeof status !== 'string') {
        errors.push('Status is required');
    } else {
        const sanitized = status.trim().toLowerCase();
        if (!ALLOWED_STATUSES.includes(sanitized)) {
            errors.push(`Status must be one of: ${ALLOWED_STATUSES.join(', ')}`);
        }
    }

    return {
        valid: errors.length === 0,
        errors
    };
}

/**
 * Validate reason length
 */
function validateReason(reason) {
    const errors = [];

    if (reason && typeof reason === 'string' && reason.length > MAX_REASON_LENGTH) {
        errors.push(`Reason cannot exceed ${MAX_REASON_LENGTH} characters`);
    }

    return {
        valid: errors.length === 0,
        errors
    };
}

/**
 * Validate pagination
 */
function validatePagination(page, limit) {
    const errors = [];

    const parsedPage = parseInt(page, 10);
    const parsedLimit = parseInt(limit, 10);

    if (page && (isNaN(parsedPage) || parsedPage < 1 || parsedPage > MAX_PAGE)) {
        errors.push(`Page must be between 1 and ${MAX_PAGE}`);
    }

    if (limit && (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > MAX_LIMIT)) {
        errors.push(`Limit must be between 1 and ${MAX_LIMIT}`);
    }

    return {
        valid: errors.length === 0,
        errors,
        page: parsedPage || 1,
        limit: parsedLimit || 20
    };
}

/**
 * Validate date format
 */
function validateDate(dateStr) {
    if (!dateStr) return { valid: true };
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) {
        return {
            valid: false,
            error: 'Invalid date format. Use YYYY-MM-DD or ISO format'
        };
    }
    return { valid: true };
}

/**
 * Validate order IDs for bulk operations
 */
function validateOrderIds(orderIds) {
    const errors = [];

    if (!Array.isArray(orderIds) || orderIds.length === 0) {
        errors.push('Order IDs are required and must be a non-empty array');
        return { valid: false, errors };
    }

    for (let i = 0; i < orderIds.length; i++) {
        const id = parseInt(orderIds[i], 10);
        if (isNaN(id) || id < 1) {
            errors.push(`Order ID at index ${i} is invalid`);
        }
    }

    return {
        valid: errors.length === 0,
        errors
    };
}

// ============================================
// ROUTE HANDLERS
// ============================================

// Validate order ID parameter
router.param("id", (req, res, next, id) => {
    try {
        req.orderId = validateOrderId(id);
        next();
    } catch (error) {
        return res.status(400).json({
            success: false,
            message: error.message
        });
    }
});

// Order API status
router.get("/status/check", (req, res) => {
    res.status(200).json({
        success: true,
        message: "Order API running"
    });
});

// ==================== PUBLIC ENDPOINTS ====================

// Validate order data before submission
router.post("/validate", orderController.validateOrder);

// Find an order without an account, on the order number and the email it was
// placed with (#1427). Rate-limited because it is an unauthenticated endpoint
// that says whether a credential pair was right; see guestOrderService.js for
// why every failure looks identical.
router.post("/lookup", guestOrderLookupLimiter, (req, res, next) => {
    const orderNumber = sanitizeString(req.body?.orderNumber);
    const email = sanitizeString(req.body?.email);

    // Only that both were supplied. Whether either is *correct* is the
    // handler's answer to give, and it gives the same one for both.
    if (!orderNumber || !email) {
        return res.status(400).json({
            success: false,
            message: "Order number and email are required"
        });
    }

    next();
}, orderController.lookupGuestOrder);

// ==================== USER ENDPOINTS ====================

// Create payment intent.
//
// Guest-reachable on the same terms as order creation (#1427). Leaving it
// behind authentication would mean a shopper without an account could pay by
// anything except a card, which is not a meaningful guest checkout.
router.post(
    "/create-payment-intent",
    optionalAuth,
    cartIdentity,
    require("../middleware/checkoutChallengeMiddleware").checkoutChallengeMiddleware,
    orderController.createPaymentIntent
);

// Create order.
//
// The one route on this router that a shopper without an account may reach
// (#1427). `optionalAuth` attaches the account when there is one; `cartIdentity`
// is the guard, settling whether this is an account checkout or a guest one and
// refusing anything in between. The bot-resistance gate is unchanged and still
// runs -- it already read the caller as optional.
router.post("/", optionalAuth, cartIdentity, require("../middleware/checkoutChallengeMiddleware").checkoutChallengeMiddleware, (req, res, next) => {
    const { items, total, paymentMethod } = req.body;

    // Validate items
    const itemsValidation = validateItems(items);
    if (!itemsValidation.valid) {
        return res.status(400).json({
            success: false,
            message: "Validation failed",
            details: itemsValidation.errors
        });
    }

    // Validate total
    const totalValidation = validateTotal(total);
    if (!totalValidation.valid) {
        return res.status(400).json({
            success: false,
            message: "Validation failed",
            details: totalValidation.errors
        });
    }

    // Validate payment method
    const paymentValidation = validatePaymentMethod(paymentMethod);
    if (!paymentValidation.valid) {
        return res.status(400).json({
            success: false,
            message: "Validation failed",
            details: paymentValidation.errors
        });
    }

    next();
}, orderController.createOrder);

// Get current user orders with pagination and filtering
router.get("/my-orders", authMiddleware, (req, res, next) => {
    const errors = [];

    // Validate status filter
    if (req.query.status) {
        const statusValidation = validateStatus(req.query.status);
        if (!statusValidation.valid) {
            errors.push(...statusValidation.errors);
        }
    }

    // Validate pagination
    const paginationValidation = validatePagination(req.query.page, req.query.limit);
    if (!paginationValidation.valid) {
        errors.push(...paginationValidation.errors);
    }

    if (errors.length > 0) {
        return res.status(400).json({
            success: false,
            message: "Validation failed",
            details: errors
        });
    }

    req.pagination = {
        page: paginationValidation.page,
        limit: paginationValidation.limit
    };

    next();
}, orderController.getUserOrders);

// ---------------------------------------------------------------------------
// Status history (#1351)
// ---------------------------------------------------------------------------
//
// Declared above "/:id" -- Express matches in declaration order, so a
// parameterised route placed first would capture "reports" as an order id.

// Fulfilment timings. This is what the shipped_at / delivered_at columns were
// in the schema for; nothing wrote them, so it was never answerable.
router.get(
    "/reports/fulfilment",
    authMiddleware,
    authorizeRoles(ROLES.ADMIN),
    orderController.getFulfilmentReport
);

// The order's progress ladder plus the recorded history behind it. Scoped to
// the order's owner; admins additionally see the actor and internal notes.
router.get("/:id/timeline", authMiddleware, ownsOrder, orderController.getOrderTimeline);

// Get order summary
router.get("/:id/summary", authMiddleware, ownsOrder, orderController.getOrderSummary);

// Get single order with items
router.get("/:id", authMiddleware, ownsOrder, orderController.getOrderById);

// Download order invoice
router.get("/:id/invoice", authMiddleware, ownsOrder, orderController.downloadInvoice);

// Cancel order with reason
router.patch("/:id/cancel", authMiddleware, ownsOrderStrictly, (req, res, next) => {
    const reasonValidation = validateReason(req.body.reason);
    if (!reasonValidation.valid) {
        return res.status(400).json({
            success: false,
            message: "Validation failed",
            details: reasonValidation.errors
        });
    }
    next();
}, orderController.cancelUserOrder);

// ==================== ADMIN ENDPOINTS ====================

// Export orders as CSV (admin/support)
router.get(
    "/export/csv",
    authMiddleware,
    authorizeRoles(ROLES.ADMIN, ROLES.SUPPORT),
    (req, res, next) => {
        if (req.query.status) {
            const statusValidation = validateStatus(req.query.status);
            if (!statusValidation.valid) {
                return res.status(400).json({
                    success: false,
                    message: "Validation failed",
                    details: statusValidation.errors
                });
            }
        }
        next();
    },
    orderController.exportOrders
);

// GET ORDER STATUS (Issue #778)
router.get(
    "/:id/status",
    authMiddleware,
    ownsOrder,
    orderController.getOrderStatus
);

// get all orders (admin)
router.get(
    "/",
    authMiddleware,
    authorizeRoles(ROLES.ADMIN),
    orderController.getAllOrders
);

// update order status (admin)
router.put(
    "/:id/status",
    authMiddleware,
    authorizeRoles(ROLES.ADMIN),
    (req, res, next) => {
        const { status } = req.body;
        const statusValidation = validateStatus(status);
        if (!statusValidation.valid) {
            return res.status(400).json({
                success: false,
                message: "Validation failed",
                details: statusValidation.errors
            });
        }
        next();
    },
    orderController.updateOrderStatus
);


// ==================== 404 FALLBACK ====================

router.use((req, res) => {
    res.status(404).json({
        success: false,
        message: "Order route not found"
    });
});

module.exports = router;