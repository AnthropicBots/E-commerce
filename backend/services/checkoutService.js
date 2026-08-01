const db = require("../config/db");
const pricing = require("./pricing.service");
const shipping = require("./shipping.service");

// These two used to return a hardcoded zero, which is how this checkout path
// came to disagree with both the storefront and the order path. They now
// forward to the pricing engine, so there is nothing left that can drift.
//
// The first parameter is the post-discount subtotal, not the shipping address.
// Which delivery option was chosen now travels in `options`, resolved to a rate
// server-side before it gets here.
function calculateShipping(postDiscountSubtotal, options = {}) {
    return pricing.calculateShipping(postDiscountSubtotal, options);
}

function calculateTax(taxableBase) {
    return pricing.calculateTax(taxableBase);
}

/**
 * Price a basket through the engine, expressing an already-approved absolute
 * discount (the discount validator produces one) as a fixed-value promo so it
 * goes through the same discount-then-tax-then-shipping ordering as every
 * other pricing path.
 *
 * @param {Object} input
 * @param {Array<Object>} input.items
 * @param {number} [input.discountAmount]
 * @param {string|null} [input.promoCode]
 * @param {string|null} [input.shippingMethod] - code naming a delivery option
 * @returns {Promise<Object>} breakdown
 */
async function quoteOrder({
    items = [],
    discountAmount = 0,
    promoCode = null,
    shippingMethod = null
} = {}) {
    const discount = Number(discountAmount) || 0;

    const [selected, fallback] = await Promise.all([
        shipping.resolveMethod(shippingMethod),
        shipping.getDefaultMethod()
    ]);

    return pricing.quote({
        items,
        promo:
            discount > 0
                ? { discount_type: "fixed", discount_value: discount }
                : null,
        promoCode,
        shippingMethod: shipping.toPricingDescriptor(selected, fallback)
    });
}

async function processOrder(orderData) {
    const {
        userId,
        items,
        shippingAddress,
        breakdown,
        shippingMethod = null,
        appliedRules = []
    } = orderData;

    const priced = breakdown || (await quoteOrder({ items, shippingMethod }));

    const crypto = require("crypto");
    const orderId = crypto.randomUUID();

    const [result] = await db.query(
        `
        INSERT INTO orders (
            id,
            user_id,
            items,
            shipping_address,
            subtotal,
            discount_amount,
            tax,
            shipping_method,
            shipping_cost,
            total,
            total_amount,
            final_amount,
            promo_code,
            applied_rules,
            status,
            created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NOW())
        `,
        [
            orderId,
            userId,
            JSON.stringify(items || []),
            JSON.stringify(shippingAddress || {}),
            priced.subtotal,
            priced.discount,
            priced.tax,
            priced.shippingMethod ? priced.shippingMethod.code : null,
            priced.shipping,
            priced.total,
            priced.total,
            priced.total,
            priced.promoCode,
            JSON.stringify(appliedRules || [])
        ]
    );

    return {
        id: orderId,
        userId,
        breakdown: priced,
        total: priced.total,
        discount: priced.discount
    };
}

module.exports = {
    calculateShipping,
    calculateTax,
    quoteOrder,
    processOrder
};
