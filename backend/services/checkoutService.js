const db = require("../config/db");

function calculateShipping(shippingAddress) {
    // Minimal safe default until shipping rules are formalized
    if (!shippingAddress) return 0;
    return 0;
}

function calculateTax(orderTotal) {
    const total = Number(orderTotal) || 0;
    if (total <= 0) return 0;

    // Keep behavior explicit and predictable until a tax engine/config is introduced
    return 0;
}

async function processOrder(orderData) {
    const {
        userId,
        items,
        shippingAddress,
        discount = 0,
        total = 0,
        appliedRules = []
    } = orderData;

    const [result] = await db.query(
        `
        INSERT INTO orders (
            user_id,
            items,
            shipping_address,
            discount_amount,
            total_amount,
            applied_rules,
            status,
            created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, 'pending', NOW())
        `,
        [
            userId,
            JSON.stringify(items || []),
            JSON.stringify(shippingAddress || {}),
            Number(discount) || 0,
            Number(total) || 0,
            JSON.stringify(appliedRules || [])
        ]
    );

    return {
        id: result.insertId,
        userId,
        total,
        discount
    };
}

module.exports = {
    calculateShipping,
    calculateTax,
    processOrder
};