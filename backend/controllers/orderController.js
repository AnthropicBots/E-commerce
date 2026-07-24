const db =
    require("../config/db");

const {
    createOrderService
} = require(
    "../services/order.service"
);

const paymentService = require("../services/payment.service");
const { generateInvoicePdf } = require("../services/invoice.service");
const inventoryReservationService = require("../services/inventoryReservationService");

const {
    safeNumber,
    safeInteger,
    sanitizeString,
    getPagination,
    buildPaginationMeta,
    safeArray,
    safeUUID
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
            
            // Validate inventory locks
            const locksValid = await inventoryReservationService.validateCartLocks(req.user.id, items, connection);
            if (!locksValid) {
                await connection.rollback();
                return res.status(400).json({ success: false, message: "Inventory locks expired or insufficient stock" });
            }
            
            // Consume inventory locks
            await inventoryReservationService.consumeLocks(req.user.id, items, connection);

            // commit transaction
            await connection.commit();

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
                    message: "Failed to create order"
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
    const id = safeUUID(req.params.id);

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

        const [items] = await db.query(
            "SELECT * FROM order_items WHERE order_id = ?",
            [id]
        );

        const orderData = {
            ...results[0],
            items: safeArray(items)
        };

        res.status(200).json({
            success: true,
            order: orderData,
            data: orderData
        });
    } catch (err) {
        console.error("GET ORDER BY ID ERROR:", err);
        return res.status(500).json({
            success: false,
            message: "Server error"
        });
    }
};

// get order status (Issue #778 / frontend order status tracking)
const getOrderStatus = async (req, res) => {
    const id = safeUUID(req.params.id);

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

        const [items] = await db.query(
            "SELECT * FROM order_items WHERE order_id = ?",
            [id]
        );

        const orderData = {
            ...results[0],
            items: safeArray(items)
        };

        res.status(200).json({
            success: true,
            order: orderData,
            data: orderData
        });
    } catch (err) {
        console.error("GET ORDER STATUS ERROR:", err);
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
const updateOrderStatus = async (req, res) => {
    const id = safeUUID(req.params.id);
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
    const id = safeUUID(req.params.id);

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

// validate order data before submission
const validateOrder = (req, res) => {
    try {
        const { validateOrderDataService } = require("../services/order.service");
        const result = validateOrderDataService(req.body);
        if (!result.isValid) {
            return res.status(400).json({
                success: false,
                message: "Validation failed",
                errors: result.errors
            });
        }
        return res.status(200).json({
            success: true,
            message: "Validation successful"
        });
    } catch (error) {
        console.error("VALIDATE ORDER ERROR:", error);
        return res.status(500).json({ success: false, message: "Server error" });
    }
};

// get order summary
const getOrderSummary = async (req, res) => {
    try {
        const id = safeUUID(req.params.id);
        if (!id) {
            return res.status(400).json({
                success: false,
                message: "Invalid order ID"
            });
        }

        const { getOrderSummaryById } = require("../services/order.service");
        const summary = await getOrderSummaryById(db, id);
        if (!summary) {
            return res.status(404).json({
                success: false,
                message: "Order not found"
            });
        }
        return res.status(200).json({
            success: true,
            summary
        });
    } catch (err) {
        console.error("GET ORDER SUMMARY ERROR:", err);
        return res.status(500).json({
            success: false,
            message: "Server error"
        });
    }
};

// download invoice
const downloadInvoice = async (req, res) => {
    try {
        const orderId = req.params.id;
        
        // Fetch order details
        const [orders] = await db.query("SELECT * FROM orders WHERE id = ?", [orderId]);
        if (!orders || orders.length === 0) {
            return res.status(404).json({ success: false, message: "Order not found" });
        }
        const order = orders[0];

        // Authorization: Ensure user is admin or the order belongs to them
        if (req.user && req.user.role !== 'admin' && order.user_id !== req.user.id) {
            return res.status(403).json({ success: false, message: "Unauthorized access to order" });
        }

        // Fetch order items
        const [items] = await db.query("SELECT * FROM order_items WHERE order_id = ?", [orderId]);

        // Generate PDF
        const pdfBuffer = await generateInvoicePdf(order, items);

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="invoice-${orderId}.pdf"`);
        return res.status(200).send(pdfBuffer);
    } catch (error) {
        console.error("Error generating invoice:", error);
        return res.status(500).json({ success: false, message: "Failed to generate invoice" });
    }
};

// create payment intent
const createPaymentIntent = async (req, res) => {
    let connection;
    try {
        connection = await db.getConnection();

        const { customer, address, items, total, promoCode } = req.body;

        if (!customer || !customer.name || !customer.email) {
            return res.status(400).json({ success: false, message: "Customer information required" });
        }
        if (!address || !address.fullAddress) {
            return res.status(400).json({ success: false, message: "Delivery address required" });
        }
        if (!Array.isArray(items) || !items.length) {
            return res.status(400).json({ success: false, message: "Order items required" });
        }
        if (safeNumber(total) <= 0) {
            return res.status(400).json({ success: false, message: "Invalid order total" });
        }

        await connection.beginTransaction();

        const result = await createOrderService(connection, {
            user_id: req.user.id,
            customer_name: sanitizeString(customer.name),
            customer_email: sanitizeString(customer.email),
            customer_phone: sanitizeString(customer.phone),
            city: sanitizeString(address.city),
            state: sanitizeString(address.state),
            zip: sanitizeString(address.zip),
            full_address: sanitizeString(address.fullAddress),
            payment_method: 'card',
            total: safeNumber(total),
            items,
            promo_code: promoCode ? sanitizeString(promoCode) : null
        });

        const locksValid = await inventoryReservationService.validateCartLocks(req.user.id, items, connection);
        if (!locksValid) {
            await connection.rollback();
            return res.status(400).json({ success: false, message: "Inventory locks expired or insufficient stock" });
        }
        
        await inventoryReservationService.consumeLocks(req.user.id, items, connection);

        const [orders] = await connection.query("SELECT final_amount, total FROM orders WHERE id = ?", [result.orderId]);
        const orderTotal = orders[0].final_amount || orders[0].total;

        const paymentIntentResult = await paymentService.createPaymentIntent(orderTotal, 'usd', { orderId: result.orderId, userId: req.user.id });
        if (!paymentIntentResult.success) {
            await connection.rollback();
            return res.status(500).json({ success: false, message: paymentIntentResult.error });
        }

        await connection.query("UPDATE orders SET payment_intent_id = ? WHERE id = ?", [paymentIntentResult.paymentIntentId, result.orderId]);

        await connection.commit();

        return res.status(201).json({
            success: true,
            clientSecret: paymentIntentResult.clientSecret,
            orderId: result.orderId
        });

    } catch (error) {
        if (connection) {
            await connection.rollback();
        }
        console.error("CREATE PAYMENT INTENT ERROR:", error);
        return res.status(500).json({ success: false, message: "Failed to create payment intent" });
    } finally {
        if (connection) {
            connection.release();
        }
    }
};

// export orders as CSV (admin/support)
const exportOrders = async (req, res) => {
    try {
        const { status } = req.query;
        let query = `
            SELECT 
                id, 
                user_id, 
                customer_name, 
                customer_email, 
                customer_phone, 
                city, 
                state, 
                zip, 
                full_address, 
                payment_method, 
                total, 
                status, 
                created_at
            FROM orders
        `;
        const params = [];

        if (status) {
            query += " WHERE status = ?";
            params.push(status.trim().toLowerCase());
        }

        query += " ORDER BY created_at DESC";

        const [orders] = await db.query(query, params);

        const { Parser } = require('json2csv');
        const fields = [
            'id', 'user_id', 'customer_name', 'customer_email', 'customer_phone',
            'city', 'state', 'zip', 'full_address', 'payment_method', 'total', 'status', 'created_at'
        ];
        
        const json2csvParser = new Parser({ fields });
        const csv = json2csvParser.parse(safeArray(orders));

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=orders_${Date.now()}.csv`);
        return res.status(200).send(csv);

    } catch (error) {
        console.error("CSV EXPORT ERROR:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to export orders as CSV"
        });
    }
};

module.exports = {
    createOrder,
    getAllOrders,
    getUserOrders,
    getOrderById,
    getOrderStatus,
    updateOrderStatus,
    cancelUserOrder,
    validateOrder,
    getOrderSummary,
    downloadInvoice,
    createPaymentIntent,
    exportOrders
};

