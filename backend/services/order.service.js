const db = require("../config/db");
const {
    safeArray,
    safeNumber,
    safeInteger,
    safeUUID,
    sanitizeString,
} = require("../utils/helpers");
const logger = require("../utils/logger");
const { validatePromo } = require("./promo.service");
const pricing = require("./pricing.service");

// Marks the one failure the client can act on, so controllers can answer with
// the specific figures instead of a generic server error.
const TOTAL_MISMATCH_CODE = "ORDER_TOTAL_MISMATCH";

// Validation helper functions
const isValidEmail = (email) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
};

const isValidPhone = (phone) => {
    const phoneRegex = /^[0-9]{10}$/;
    return phoneRegex.test(phone);
};

const validateOrderData = (orderData) => {
    const errors = [];

    // Email validation
    if (!orderData.customer_email) {
        errors.push("Customer email is required");
    } else if (!isValidEmail(orderData.customer_email)) {
        errors.push("Invalid email format");
    }

    // Phone validation
    if (!orderData.customer_phone) {
        errors.push("Phone number is required");
    } else if (!isValidPhone(orderData.customer_phone)) {
        errors.push("Invalid phone number format (must be 10 digits)");
    }

    // Address validation
    if (!orderData.full_address) {
        errors.push("Shipping address is required");
    } else if (orderData.full_address.length < 10) {
        errors.push("Shipping address must be at least 10 characters");
    }

    // City validation
    if (!orderData.city) {
        errors.push("City is required");
    } else if (orderData.city.length < 2) {
        errors.push("City must be at least 2 characters");
    }

    // State validation
    if (!orderData.state) {
        errors.push("State is required");
    } else if (orderData.state.length < 2) {
        errors.push("State must be at least 2 characters");
    }

    // Zip validation
    if (!orderData.zip) {
        errors.push("ZIP code is required");
    } else if (!/^[0-9]{5,6}$/.test(orderData.zip)) {
        errors.push("Invalid ZIP code format (must be 5-6 digits)");
    }

    // Payment method validation
    const validPaymentMethods = ['credit_card', 'debit_card', 'paypal', 'cash_on_delivery', 'upi'];
    if (!orderData.payment_method) {
        errors.push("Payment method is required");
    } else if (!validPaymentMethods.includes(orderData.payment_method)) {
        errors.push(`Invalid payment method. Allowed: ${validPaymentMethods.join(', ')}`);
    }

    // Items validation
    if (!orderData.items || !safeArray(orderData.items).length) {
        errors.push("Order must contain at least one item");
    }

    return {
        isValid: errors.length === 0,
        errors: errors
    };
};

// Create order service with enhanced validations
// Resolve the priced product variant for an order item, if any. A variant is
// matched either by an explicit `variantId`/`variant_id` on the item, or —
// since the current cart payload only carries color/size — by matching those
// against the variant's `attributes` JSON. Only an unambiguous, active match
// is honored. The lookup is deliberately defensive: deployments without a
// `product_variants` table simply fall back to base product pricing.
//
// `lockRows` is off for read-only pricing (a quote holds no rows); order
// creation keeps it on so the price cannot move under the transaction.
const resolveItemVariant = async (connection, productId, item, lockRows = true) => {
    const explicitVariantId = safeInteger(item.variantId ?? item.variant_id, 0);
    const rowLock = lockRows ? " FOR UPDATE" : "";

    try {
        if (explicitVariantId > 0) {
            const [rows] = await connection.query(
                `SELECT id, price, stock FROM product_variants
                 WHERE id = ? AND product_id = ? AND is_active = 1
                 LIMIT 1${rowLock}`,
                [explicitVariantId, productId],
            );
            return safeArray(rows)[0] || null;
        }

        const color = sanitizeString(item.color);
        const size = sanitizeString(item.size);

        if (!color && !size) {
            return null;
        }

        const conditions = [];
        const params = [productId];

        if (color) {
            conditions.push(
                "LOWER(JSON_UNQUOTE(JSON_EXTRACT(attributes, '$.color'))) = LOWER(?)",
            );
            params.push(color);
        }

        if (size) {
            conditions.push(
                "LOWER(JSON_UNQUOTE(JSON_EXTRACT(attributes, '$.size'))) = LOWER(?)",
            );
            params.push(size);
        }

        const [rows] = await connection.query(
            `SELECT id, price, stock FROM product_variants
             WHERE product_id = ? AND is_active = 1
             AND ${conditions.join(" AND ")}
             LIMIT 2${rowLock}`,
            params,
        );

        const matches = safeArray(rows);

        // Ambiguous attribute matches are ignored so we never guess a price.
        return matches.length === 1 ? matches[0] : null;
    } catch (error) {
        logger.warn(
            `Variant lookup skipped for product ${productId}: ${error.message}`,
        );
        return null;
    }
};

/**
 * Turn a client-supplied basket into priced lines using the database's own
 * prices. Client-supplied prices are never read — the only fields taken from
 * the request are which product, which variant and how many.
 *
 * Order creation runs this inside its transaction with row locks and stock
 * enforcement; the quote endpoint runs it read-only, where an out-of-stock
 * item should still be priced rather than rejected.
 *
 * @param {Object} connection - pool or transactional connection
 * @param {Array<Object>} items
 * @param {{ lockRows?: boolean, enforceStock?: boolean }} [options]
 * @returns {Promise<Array<Object>>} priced lines
 */
const resolveOrderLines = async (connection, items, options = {}) => {
    const { lockRows = true, enforceStock = true } = options;
    const rowLock = lockRows ? " FOR UPDATE" : "";
    const resolvedLines = [];

    for (const item of safeArray(items)) {
        const productId = safeUUID(item.id);

        if (!productId) {
            throw new Error("Invalid product ID");
        }

        const [productResults] = await connection.query(
            `SELECT id, name, price, stock, image FROM products WHERE id = ?
             LIMIT 1${rowLock}`,
            [productId],
        );
        const safeResults = safeArray(productResults);

        if (!safeResults.length) {
            throw new Error(`Product not found: ${productId}`);
        }

        const product = safeResults[0];
        const qty = Math.max(1, safeInteger(item.qty, 1));

        if (enforceStock && safeInteger(product.stock) < qty) {
            throw new Error(
                `Insufficient stock for ${sanitizeString(product.name)}`,
            );
        }

        // Prefer the selected variant's price when it defines one; the base
        // product price is only a fallback. This keeps order totals correct
        // for variants that are priced differently from their parent.
        let realPrice = safeNumber(product.price);

        const variant = await resolveItemVariant(
            connection,
            productId,
            item,
            lockRows,
        );

        if (variant && variant.price !== null && variant.price !== undefined) {
            const variantPrice = safeNumber(variant.price);

            if (variantPrice > 0) {
                realPrice = variantPrice;
            }
        }

        resolvedLines.push({
            id: safeUUID(product.id),
            name: sanitizeString(product.name),
            image: sanitizeString(product.image),
            price: realPrice,
            qty,
            color: sanitizeString(item.color),
            size: sanitizeString(item.size),
        });
    }

    return resolvedLines;
};

const createOrderService = async (connection, orderData) => {
    try {
        // Validate order data first
        const validation = validateOrderData(orderData);
        if (!validation.isValid) {
            logger.error(`Order validation failed: ${validation.errors.join(', ')}`);
            throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
        }

        const {
            user_id,
            customer_name,
            customer_email,
            customer_phone,
            city,
            state,
            zip,
            full_address,
            payment_method,
            items,
            promo_code,
            total: claimedTotal,
        } = orderData;

        // validate empty cart
        if (!safeArray(items).length) {
            logger.error("Cart is empty");
            throw new Error("Cart is empty");
        }

        const validatedItems = await resolveOrderLines(connection, items);

        // Promo *validation* needs the database, so it stays here; the
        // arithmetic that follows belongs to the pricing engine, which is the
        // only place that knows the ordering of discount, tax and shipping.
        let appliedPromo = null;

        if (promo_code) {
            const { subtotal } = pricing.priceLineItems(validatedItems);
            const promoValidation = await validatePromo(promo_code, subtotal);

            if (!promoValidation.valid) {
                logger.error("Promo validation failed:", promoValidation.message);
                throw new Error("Invalid promo code.");
            }

            appliedPromo = promoValidation.promo;
        }

        const breakdown = pricing.quote({
            items: validatedItems,
            promo: appliedPromo,
            promoCode: appliedPromo ? appliedPromo.code : null,
        });

        const verification = pricing.verifyClaimedTotal(
            claimedTotal,
            breakdown.total,
        );

        if (!verification.isAcceptable) {
            logger.error(`Order total rejected: ${verification.message}`);
            const mismatch = new Error(verification.message);
            mismatch.code = TOTAL_MISMATCH_CODE;
            mismatch.submittedTotal = verification.claimed;
            mismatch.computedTotal = verification.computed;
            throw mismatch;
        }

        const appliedPromoCode = breakdown.promoCode;
        const appliedPromoId = appliedPromo ? appliedPromo.id : null;
        const discountAmount = breakdown.discount;

        const crypto = require("crypto");
        const orderId = crypto.randomUUID();

        // create order
        const orderQuery = `
            INSERT INTO orders (
                id,
                user_id,
                customer_name,
                customer_email,
                customer_phone,
                city,
                state,
                zip,
                full_address,
                shipping_address,
                payment_method,
                total,
                status,
                subtotal,
                tax,
                shipping_cost,
                discount,
                discount_code,
                promo_code,
                discount_amount,
                final_amount,
                created_at,
                updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
        `;

        const [orderResult] = await connection.query(orderQuery, [
            orderId,
            safeUUID(user_id),
            customer_name,
            customer_email,
            customer_phone,
            city,
            state,
            zip,
            full_address,
            JSON.stringify({ street: full_address, city, state, zip }),
            payment_method,
            breakdown.total,
            "pending",
            breakdown.subtotal,
            breakdown.tax,
            breakdown.shipping,
            discountAmount,
            appliedPromoCode,
            appliedPromoCode,
            discountAmount,
            breakdown.total,
        ]);

        // insert into order_items
        for (const item of validatedItems) {
            const itemQuery = `
                INSERT INTO order_items (
                    order_id,
                    product_id,
                    name,
                    price,
                    qty,
                    color,
                    size,
                    total
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `;
            await connection.query(itemQuery, [
                orderId,
                item.id,
                item.name,
                item.price,
                item.qty,
                item.color,
                item.size,
                item.price * item.qty,
            ]);
        }

        // reduce stock safely
        for (const item of validatedItems) {
            const stockQuery = `UPDATE products SET stock = stock - ? WHERE id = ? 
            AND stock >= ? `;

            const [result] = await connection.query(
                stockQuery,
                [
                    item.qty,
                    item.id,
                    item.qty
                ]
            );

            if (result.affectedRows === 0) {
                throw new Error(
                    `Insufficient stock for ${item.name}`
                );
            }
        }

        // record purchase interaction
        if (user_id) {
            for (const item of validatedItems) {
                const interactionQuery = `
                    INSERT INTO user_interactions (user_id, product_id, interaction_type)
                    VALUES (?, ?, ?)
                `;
                await connection.query(interactionQuery, [
                    user_id,
                    item.id,
                    "purchase",
                ]);
            }
        }

        // Clear authenticated user's cart
        if (user_id) {
            await connection.query(
                "DELETE FROM cart_items WHERE user_id = ?",
                [user_id]
            );
            logger.info(`Cleared cart for user ${user_id}`);
        }

        // Track promo usage
        if (appliedPromoId) {
            // Increment global usage count
            await connection.query(
                "UPDATE promo_codes SET usage_count = usage_count + 1 WHERE id = ?",
                [appliedPromoId]
            );
            
            // Record individual usage (if authenticated)
            if (user_id) {
                await connection.query(
                    "INSERT INTO promo_usage (promo_id, user_id, order_id, discount_amount, status) VALUES (?, ?, ?, ?, 'applied')",
                    [appliedPromoId, safeUUID(user_id), orderId, discountAmount]
                );
                logger.info(`Recorded promo usage for user ${user_id} and promo ${appliedPromoId}`);
            }
        }

        logger.info(`Order created successfully: ${orderId} by user ${user_id || 'guest'}`);

        // Return order summary
        const orderSummary = await getOrderSummaryById(connection, orderId);

        return {
            success: true,
            orderId: orderId,
            subtotal: breakdown.subtotal,
            total: breakdown.total,
            finalAmount: breakdown.total,
            discountAmount: discountAmount,
            promoCode: appliedPromoCode,
            breakdown,
            items: validatedItems,
            summary: orderSummary
        };
    } catch (error) {
        logger.error(`Error creating order: ${error.message}`);
        throw error;
    }
};

// Get order summary by ID
const getOrderSummaryById = async (connection, orderId) => {
    try {
        const query = `
            SELECT 
                o.id,
                o.customer_name,
                o.customer_email,
                o.customer_phone,
                o.city,
                o.state,
                o.zip,
                o.full_address,
                o.payment_method,
                o.total,
                o.status,
                o.subtotal,
                o.tax,
                o.shipping_cost,
                o.discount_amount,
                o.final_amount,
                o.created_at,
                o.updated_at,
                GROUP_CONCAT(
                    CONCAT(oi.name, ' (', oi.qty, ' x ₹', oi.price, ')')
                    SEPARATOR ', '
                ) as items_summary
            FROM orders o
            LEFT JOIN order_items oi ON o.id = oi.order_id
            WHERE o.id = ?
            GROUP BY o.id
        `;
        
        const [results] = await connection.query(query, [orderId]);
        return safeArray(results)[0] || null;
    } catch (error) {
        logger.error(`Error getting order summary: ${error.message}`);
        throw error;
    }
};

// Update order status
const updateOrderStatusService = async (orderId, status, userId) => {
    try {
        const validStatuses = ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled'];
        
        if (!validStatuses.includes(status)) {
            throw new Error(`Invalid status. Allowed: ${validStatuses.join(', ')}`);
        }

        const orderQuery = `SELECT id, status FROM orders WHERE id = ?`;
        const [orderResults] = await db.query(orderQuery, [orderId]);
        const order = safeArray(orderResults)[0];

        if (!order) {
            throw new Error('Order not found');
        }

        if (order.status === 'delivered' && status !== 'cancelled') {
            throw new Error('Cannot update status of delivered order');
        }

        if (order.status === 'cancelled') {
            throw new Error('Cannot update status of cancelled order');
        }

        const updateQuery = `
            UPDATE orders 
            SET status = ?, updated_at = NOW()
            WHERE id = ?
        `;
        
        await db.query(updateQuery, [status, orderId]);

        // Log status change
        const logQuery = `
            INSERT INTO order_status_logs (order_id, old_status, new_status, updated_by, created_at)
            VALUES (?, ?, ?, ?, NOW())
        `;
        await db.query(logQuery, [orderId, order.status, status, userId]);

        logger.info(`Order ${orderId} status updated from ${order.status} to ${status} by user ${userId}`);

        return {
            success: true,
            orderId: orderId,
            oldStatus: order.status,
            newStatus: status,
            updatedAt: new Date()
        };
    } catch (error) {
        logger.error(`Error updating order status: ${error.message}`);
        throw error;
    }
};

// Cancel order with reason
const cancelOrderService = async (orderId, reason, userId) => {
    try {
        const orderQuery = `SELECT id, status FROM orders WHERE id = ?`;
        const [orderResults] = await db.query(orderQuery, [orderId]);
        const order = safeArray(orderResults)[0];

        if (!order) {
            throw new Error('Order not found');
        }

        if (order.status === 'delivered') {
            throw new Error('Cannot cancel delivered order');
        }

        if (order.status === 'cancelled') {
            throw new Error('Order is already cancelled');
        }

        // Update order status and add cancellation reason
        const updateQuery = `
            UPDATE orders 
            SET status = 'cancelled', 
                cancellation_reason = ?,
                cancelled_at = NOW(),
                updated_at = NOW()
            WHERE id = ?
        `;
        
        await db.query(updateQuery, [reason, orderId]);

        // Log cancellation
        const logQuery = `
            INSERT INTO order_status_logs (order_id, old_status, new_status, reason, updated_by, created_at)
            VALUES (?, ?, 'cancelled', ?, ?, NOW())
        `;
        await db.query(logQuery, [orderId, order.status, reason, userId]);

        logger.info(`Order ${orderId} cancelled by user ${userId}. Reason: ${reason}`);

        return {
            success: true,
            orderId: orderId,
            status: 'cancelled',
            reason: reason,
            cancelledAt: new Date()
        };
    } catch (error) {
        logger.error(`Error cancelling order: ${error.message}`);
        throw error;
    }
};

// Get order history with pagination
const getOrderHistoryService = async (userId, page = 1, status = null, limit = 10) => {
    try {
        let query = `SELECT * FROM orders WHERE user_id = ?`;
        const params = [userId];

        if (status) {
            const validStatuses = ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled'];
            if (!validStatuses.includes(status)) {
                throw new Error(`Invalid status filter. Allowed: ${validStatuses.join(', ')}`);
            }
            query += ` AND status = ?`;
            params.push(status);
        }

        const offset = (page - 1) * limit;
        
        // Get total count
        const countQuery = `SELECT COUNT(*) as total FROM (${query}) as subquery`;
        const [countResults] = await db.query(countQuery, params);
        const totalOrders = countResults[0].total;

        // Get paginated results
        query += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
        params.push(limit, offset);

        const [orders] = await db.query(query, params);
        const safeOrders = safeArray(orders);

        const totalPages = Math.ceil(totalOrders / limit);

        logger.info(`Fetched ${safeOrders.length} orders for user ${userId}, page ${page}`);

        return {
            orders: safeOrders,
            pagination: {
                currentPage: page,
                pageSize: limit,
                totalOrders: totalOrders,
                totalPages: totalPages,
                hasNextPage: page < totalPages,
                hasPrevPage: page > 1
            }
        };
    } catch (error) {
        logger.error(`Error fetching order history: ${error.message}`);
        throw error;
    }
};

// Get admin order history with advanced filters
const getAdminOrderHistoryService = async (filters = {}, page = 1, limit = 10) => {
    try {
        let query = `SELECT * FROM orders WHERE 1=1`;
        const params = [];

        if (filters.status) {
            query += ` AND status = ?`;
            params.push(filters.status);
        }

        if (filters.customer_email) {
            query += ` AND customer_email LIKE ?`;
            params.push(`%${filters.customer_email}%`);
        }

        if (filters.date_from) {
            query += ` AND created_at >= ?`;
            params.push(filters.date_from);
        }

        if (filters.date_to) {
            query += ` AND created_at <= ?`;
            params.push(filters.date_to);
        }

        const offset = (page - 1) * limit;
        
        // Get total count
        const countQuery = `SELECT COUNT(*) as total FROM (${query}) as subquery`;
        const [countResults] = await db.query(countQuery, params);
        const totalOrders = countResults[0].total;

        // Get paginated results
        query += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
        params.push(limit, offset);

        const [orders] = await db.query(query, params);
        const safeOrders = safeArray(orders);

        const totalPages = Math.ceil(totalOrders / limit);

        logger.info(`Fetched ${safeOrders.length} orders with filters`);

        return {
            orders: safeOrders,
            pagination: {
                currentPage: page,
                pageSize: limit,
                totalOrders: totalOrders,
                totalPages: totalPages,
                hasNextPage: page < totalPages,
                hasPrevPage: page > 1
            }
        };
    } catch (error) {
        logger.error(`Error fetching admin orders: ${error.message}`);
        throw error;
    }
};

// Get single order by ID with items
const getOrderByIdService = async (orderId) => {
    try {
        const orderQuery = `
            SELECT o.*, 
                   GROUP_CONCAT(
                       JSON_OBJECT(
                           'id', oi.id,
                           'product_id', oi.product_id,
                           'name', oi.name,
                           'price', oi.price,
                           'qty', oi.qty,
                           'color', oi.color,
                           'size', oi.size
                       )
                   ) as items
            FROM orders o
            LEFT JOIN order_items oi ON o.id = oi.order_id
            WHERE o.id = ?
            GROUP BY o.id
        `;
        
        const [results] = await db.query(orderQuery, [orderId]);
        const order = safeArray(results)[0];

        if (!order) {
            throw new Error('Order not found');
        }

        // Parse items JSON if exists
        if (order.items) {
            order.items = order.items.split(',').map(item => JSON.parse(item));
        }

        return order;
    } catch (error) {
        logger.error(`Error fetching order: ${error.message}`);
        throw error;
    }
};

// Get all orders (existing)
const getOrdersService = async () => {
    try {
        const query = `
            SELECT *
            FROM orders
            ORDER BY created_at DESC
        `;
        const [results] = await db.query(query);
        return safeArray(results);
    } catch (error) {
        logger.error(`Error fetching all orders: ${error.message}`);
        throw error;
    }
};

// Generate order summary (HTML/PDF ready)
const generateOrderSummaryService = async (orderId) => {
    try {
        const order = await getOrderByIdService(orderId);
        
        const summary = {
            orderId: order.id,
            customerName: order.customer_name,
            customerEmail: order.customer_email,
            customerPhone: order.customer_phone,
            shippingAddress: {
                fullAddress: order.full_address,
                city: order.city,
                state: order.state,
                zip: order.zip
            },
            paymentMethod: order.payment_method,
            status: order.status,
            orderDate: order.created_at,
            items: order.items || [],
            subtotal: order.subtotal || order.total,
            discountAmount: order.discount_amount || 0,
            tax: order.tax || 0,
            shipping: order.shipping_cost || 0,
            total: order.final_amount || order.total,
            timeline: await getOrderTimeline(orderId)
        };

        logger.info(`Generated summary for order ${orderId}`);
        return summary;
    } catch (error) {
        logger.error(`Error generating order summary: ${error.message}`);
        throw error;
    }
};

// Get order timeline (status history)
const getOrderTimeline = async (orderId) => {
    try {
        const query = `
            SELECT * FROM order_status_logs 
            WHERE order_id = ? 
            ORDER BY created_at DESC
        `;
        const [results] = await db.query(query, [orderId]);
        return safeArray(results);
    } catch (error) {
        logger.error(`Error getting order timeline: ${error.message}`);
        return [];
    }
};

// Validate order data (exported for external use)
const validateOrderDataService = (orderData) => {
    return validateOrderData(orderData);
};

module.exports = {
    TOTAL_MISMATCH_CODE,
    resolveOrderLines,
    createOrderService,
    getOrdersService,
    getOrderByIdService,
    updateOrderStatusService,
    cancelOrderService,
    getOrderHistoryService,
    getAdminOrderHistoryService,
    generateOrderSummaryService,
    validateOrderDataService,
    getOrderSummaryById,
    getOrderTimeline
};