const db =
    require("../config/db");

const {
    createOrderService
} = require(
    "../services/order.service"
);

const {
    safeNumber,
    safeInteger,
    sanitizeString,
    getPagination,
    buildPaginationMeta,
    safeArray
} = require(
    "../utils/helpers"
);

// create order
const createOrder =
    async (
        req,
        res
    ) => {
        let connection;
        try {
            connection = await db.getConnection();

            const {
                customer,
                address,
                paymentMethod,
                items,
                total,
                promoCode
            } = req.body;

            // validation
            if (
                !customer
                ||
                !customer.name
                ||
                !customer.email
            ) {
                return res.status(400)
                    .json({
                        success: false,
                        message:
                            "Customer information required"
                    });
            }

            if (
                !address
                ||
                !address.fullAddress
            ) {
                return res.status(400)
                    .json({
                        success: false,
                        message:
                            "Delivery address required"
                    });
            }

            if (
                !Array.isArray(
                    items
                )
                ||
                !items.length
            ) {
                return res.status(400)
                    .json({
                        success: false,
                        message:
                            "Order items required"
                    });
            }

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

            const validPaymentMethods = [
                "cod",
                "card",
                "upi",
                "paypal"
            ];

            if (
                !validPaymentMethods.includes(
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

            // begin transaction
            await connection.beginTransaction();

            // create order via service
            const result =
                await createOrderService(
                    connection,
                    {
                        user_id: req.user.id,
                        customer_name: sanitizeString(customer.name),
                        customer_email: sanitizeString(customer.email),
                        customer_phone: sanitizeString(customer.phone),
                        city: sanitizeString(address.city),
                        state: sanitizeString(address.state),
                        zip: sanitizeString(address.zip),
                        full_address: sanitizeString(address.fullAddress),
                        payment_method: sanitizeString(paymentMethod).toLowerCase(),
                        total: safeNumber(total),
                        items,
                        promo_code: promoCode ? sanitizeString(promoCode) : null
                    }
                );

            return res.status(201)
                .json({
                    success: true,
                    message:
                        "Order placed successfully",
                    orderId:
                        result.orderId
                });

        } catch (error) {
            if (connection) {
                await connection.rollback();
            }
            console.error(
                "CREATE ORDER ERROR:",
                error
            );

            return res.status(500)
                .json({
                    success: false,
                    message:
                        error.message
                        || "Failed to create order"
                });
        } finally {
            if (connection) {
                connection.release();
            }
        }
    };

// get all orders
const getAllOrders = async (req, res) => {
    const {
        page,
        limit,
        offset
    } = getPagination(
        req.query.page,
        req.query.limit,
        50
    );

    const countQuery = `
        SELECT COUNT(*) AS total
        FROM orders
    `;

    try {
        const [countResults] = await db.query(countQuery);
        const total = Number(countResults?.[0]?.total || 0);

        const query = `
            SELECT
                id,
                user_id,
                customer_name,
                customer_email,
                payment_method,
                total,
                status,
                created_at
            FROM orders
            ORDER BY id DESC
            LIMIT ?
            OFFSET ?
        `;

        const [results] = await db.query(query, [limit, offset]);

        res.status(200).json({
            success: true,
            page,
            limit,
            total,
            ...buildPaginationMeta(total, page, limit),
            orders: safeArray(results)
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({
            success: false,
            message: "Server error"
        });
    }
};

// get user orders
const getUserOrders = async (req, res) => {
    const query = `
        SELECT
            id,
            customer_name,
            payment_method,
            total,
            status,
            created_at
        FROM orders
        WHERE user_id = ?
        ORDER BY id DESC
    `;

    try {
        const [results] = await db.query(query, [req.user.id]);
        res.status(200).json({
            success: true,
            orders: safeArray(results)
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({
            success: false,
            message: "Server error"
        });
    }
};

// get order by id
const getOrderById = async (req, res) => {
    const id = safeInteger(req.params.id);

    if (!id) {
        return res.status(400).json({
            success: false,
            message: "Invalid order ID"
        });
    }

    let query = `
        SELECT *
        FROM orders
        WHERE id = ?
    `;

    const queryParams = [id];

    // normal users can only access own orders
    if (req.user.role !== "admin") {
        query += `
            AND user_id = ?
        `;
        queryParams.push(req.user.id);
    }

    try {
        const [results] = await db.query(query, queryParams);

        if (!safeArray(results).length) {
            return res.status(404).json({
                success: false,
                message: "Order not found"
            });
        }

        res.status(200).json({
            success: true,
            order: results[0]
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({
            success: false,
            message: "Server error"
        });
    }
};

// shared helper for updating order status and managing inventory
const performOrderStatusUpdate = async (connection, id, currentStatus, newStatus) => {
    // if cancelling a previously un-cancelled order, restore stock
    if (newStatus === "cancelled" && currentStatus !== "cancelled") {
        const [items] = await connection.query(
            "SELECT product_id, qty FROM order_items WHERE order_id = ?",
            [id]
        );

        for (const item of safeArray(items)) {
            if (item.product_id) {
                await connection.query(
                    "UPDATE products SET stock = stock + ? WHERE id = ?",
                    [item.qty, item.product_id]
                );
            }
        }
    }

    // update order status
    await connection.query(
        "UPDATE orders SET status = ? WHERE id = ?",
        [newStatus, id]
    );
};

// update order status
const updateOrderStatus =
    async (req, res) => {
        const id = safeInteger(req.params.id);
        const newStatus = sanitizeString(req.body.status).toLowerCase();

        const validStatuses = [
            "pending",
            "processing",
            "shipped",
            "delivered",
            "cancelled"
        ];

        if (!id) {
            return res.status(400).json({ success: false, message: "Invalid order ID" });
        }

        if (!validStatuses.includes(newStatus)) {
            return res.status(400).json({ success: false, message: "Invalid order status" });
        }

        let connection;
        try {
            connection = await db.getConnection();
            await connection.beginTransaction();

            // fetch current order status
            const [orders] = await connection.query(
                "SELECT status FROM orders WHERE id = ? FOR UPDATE",
                [id]
            );

            if (!safeArray(orders).length) {
                await connection.rollback();
                return res.status(404).json({ success: false, message: "Order not found" });
            }

            const currentStatus = orders[0].status;

            await performOrderStatusUpdate(connection, id, currentStatus, newStatus);

            await connection.commit();

            return res.status(200).json({ success: true, message: "Order status updated" });

        } catch (error) {
            if (connection) {
                await connection.rollback();
            }
            console.error("UPDATE ORDER STATUS ERROR:", error);
            return res.status(500).json({ success: false, message: "Server error" });
        } finally {
            if (connection) {
                connection.release();
            }
        }
    };

// cancel user order
const cancelUserOrder = async (req, res) => {
    const id = safeInteger(req.params.id);

    if (!id) {
        return res.status(400).json({ success: false, message: "Invalid order ID" });
    }

    let connection;
    try {
        connection = await db.getConnection();
        await connection.beginTransaction();

        // fetch current order status and check ownership
        const [orders] = await connection.query(
            "SELECT user_id, status FROM orders WHERE id = ? FOR UPDATE",
            [id]
        );

        if (!safeArray(orders).length || orders[0].user_id !== req.user.id) {
            await connection.rollback();
            return res.status(404).json({ success: false, message: "Order not found" });
        }

        const currentStatus = orders[0].status;

        // check if order can be cancelled
        if (["shipped", "delivered", "cancelled"].includes(currentStatus)) {
            await connection.rollback();
            return res.status(400).json({ success: false, message: `Cannot cancel a ${currentStatus} order` });
        }

        await performOrderStatusUpdate(connection, id, currentStatus, "cancelled");

        await connection.commit();

        return res.status(200).json({ success: true, message: "Order cancelled successfully" });

    } catch (error) {
        if (connection) {
            await connection.rollback();
        }
        console.error("CANCEL ORDER ERROR:", error);
        return res.status(500).json({ success: false, message: "Server error" });
    } finally {
        if (connection) {
            connection.release();
        }
    }
};

module.exports = {
    createOrder,
    getAllOrders,
    getUserOrders,
    getUserOrders,
    getOrderById,
    updateOrderStatus,
    cancelUserOrder
};