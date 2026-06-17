const express =
    require("express");

const router =
    express.Router();

const authMiddleware =
    require(
        "../middleware/authMiddleware"
    );

const {
    authorizeRoles
} = authMiddleware;

const orderController =
    require(
        "../controllers/orderController"
    );

const {
    safeArray,
    safeNumber,
    sanitizeString
} = require(
    "../utils/helpers"
);

// validate order id
router.param(
    "id",
    (
        req,
        res,
        next,
        id
    ) => {

        const parsedId =
            parseInt(
                id,
                10
            );

        if (
            !parsedId
            || parsedId < 1
        ) {

            return res.status(400)
                .json({

                    success: false,

                    message:
                        "Invalid order ID"
                });
        }

        req.orderId =
            parsedId;

        next();
    }
);

// order api status
router.get(
    "/status/check",
    (
        req,
        res
    ) => {

        res.status(200)
            .json({

                success: true,

                message:
                    "Order API running"
            });
    }
);

// create order
router.post(
    "/",
    authMiddleware,
    (
        req,
        res,
        next
    ) => {

        const {
            items,
            total,
            paymentMethod
        } = req.body;

        // validate items
        if (
            !safeArray(items).length
        ) {

            return res.status(400)
                .json({

                    success: false,

                    message:
                        "Order items are required"
                });
        }

        // validate total
        if (
            safeNumber(total) <= 0
        ) {

            return res.status(400)
                .json({

                    success: false,

                    message:
                        "Invalid order total"
                });
        }

        // validate payment method
        const allowedPayments = [

            "card",

            "cod",

            "upi"
        ];

        if (
            !allowedPayments.includes(
                sanitizeString(
                    paymentMethod
                ).toLowerCase()
            )
        ) {

            return res.status(400)
                .json({

                    success: false,

                    message:
                        "Invalid payment method"
                });
        }

        next();
    },
    orderController.createOrder
);

// get current user orders
router.get(
    "/my-orders",
    authMiddleware,
    orderController.getUserOrders
);

// get single order
router.get(
    "/:id",
    authMiddleware,
    orderController.getOrderById
);

// get all orders (admin)
router.get(
    "/",
    authMiddleware,
    authorizeRoles(
        "admin"
    ),
    orderController.getAllOrders
);

// update order status
router.put(
    "/:id/status",
    authMiddleware,
    authorizeRoles(
        "admin"
    ),
    (
        req,
        res,
        next
    ) => {

        const {
            status
        } = req.body;

        const allowedStatuses = [

            "pending",

            "processing",

            "shipped",

            "delivered",

            "cancelled"
        ];

        if (
            !allowedStatuses.includes(
                sanitizeString(
                    status
                ).toLowerCase()
            )
        ) {

            return res.status(400)
                .json({

                    success: false,

                    message:
                        "Invalid order status"
                });
        }

        next();
    },
    orderController.updateOrderStatus
);

// cancel order (user)
router.patch(
    "/:id/cancel",
    authMiddleware,
    orderController.cancelUserOrder
);

// route fallback
router.use(
    (
        req,
        res
    ) => {

        res.status(404)
            .json({

                success: false,

                message:
                    "Order route not found"
            });
    }
);

module.exports =
    router;