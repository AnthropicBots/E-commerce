const db = require("../config/db");
const {
    safeArray,
    safeNumber,
    safeInteger,
    sanitizeString
} = require("../utils/helpers");

// create order service
const createOrderService = async (connection, orderData) => {
    try {
        const { user_id, customer_name, customer_email, customer_phone, city, state, zip, full_address, payment_method, items } = orderData;
        
        // validated items
        const validatedItems = [];
        
        // validate empty cart
        if (!safeArray(items).length) {
            throw new Error("Cart is empty");
        }
        
        // secure total
        let calculatedTotal = 0;

        // validate each item
        for (const item of safeArray(items)) {
            const productId = safeInteger(item.id);

            // invalid product id
            if (productId <= 0) {
                throw new Error("Invalid product ID");
            }

            const productQuery = `
                SELECT
                    id,
                    name,
                    price,
                    stock,
                    image
                FROM products
                WHERE id = ?
                LIMIT 1
            `;

            const [productResults] = await connection.query(productQuery, [productId]);
            const safeResults = safeArray(productResults);

            // product missing
            if (!safeResults.length) {
                throw new Error(`Product not found: ${productId}`);
            }

            const product = safeResults[0];
            const qty = Math.max(1, safeInteger(item.qty, 1));

            // stock validation
            if (safeInteger(product.stock) < qty) {
                throw new Error(`Insufficient stock for ${sanitizeString(product.name)}`);
            }

            // safe db price
            const realPrice = safeNumber(product.price);
            const itemTotal = realPrice * qty;

            // floating-safe total
            calculatedTotal = Number((calculatedTotal + itemTotal).toFixed(2));

            // save validated item
            validatedItems.push({
                id: safeInteger(product.id),
                name: sanitizeString(product.name),
                image: sanitizeString(product.image),
                price: realPrice,
                qty,
                color: sanitizeString(item.color),
                size: sanitizeString(item.size)
            });
        }

        // create order
        const orderQuery = `
            INSERT INTO orders (
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
                status
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        const [orderResult] = await connection.query(orderQuery, [
            safeInteger(user_id),
            customer_name,
            customer_email,
            customer_phone,
            city,
            state,
            zip,
            full_address,
            payment_method,
            calculatedTotal,
            "pending"
        ]);

        const orderId = orderResult.insertId;

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
                    size
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
            `;
            await connection.query(itemQuery, [
                orderId,
                item.id,
                item.name,
                item.price,
                item.qty,
                item.color,
                item.size
            ]);
        }

        // reduce stock
        for (const item of validatedItems) {
            const stockQuery = `
                UPDATE products
                SET stock = stock - ?
                WHERE id = ?
            `;
            await connection.query(stockQuery, [item.qty, item.id]);
        }

        await connection.commit();

        return {
            success: true,
            orderId: orderResult.insertId,
            total: calculatedTotal,
            items: validatedItems
        };

    } catch (error) {
        await connection.rollback();
        throw error;
    }
};

// get orders service
const getOrdersService = async () => {
    const query = `
        SELECT *
        FROM orders
        ORDER BY created_at DESC
    `;
    const [results] = await db.query(query);
    return safeArray(results);
};

module.exports = {
    createOrderService,
    getOrdersService
};