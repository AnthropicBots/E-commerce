const db = require("../config/db");
const { safeArray, safeNumber, sanitizeString } = require("../utils/helpers");

const getPromoByCode = async (code) => {
    const [results] = await db.query("SELECT * FROM promo_codes WHERE code = ? LIMIT 1", [code]);
    return safeArray(results)[0];
};

const validatePromo = async (code, cartTotal) => {
    const promo = await getPromoByCode(code);
    if (!promo) {
        return { valid: false, message: "Invalid promo code" };
    }
    if (!promo.is_active) {
        return { valid: false, message: "Promo code is inactive" };
    }
    const now = new Date();
    if (new Date(promo.start_date) > now) {
        return { valid: false, message: "Promo code is not yet active" };
    }
    if (new Date(promo.expiry_date) < now) {
        return { valid: false, message: "Promo code has expired" };
    }
    if (safeNumber(cartTotal) < safeNumber(promo.minimum_order_amount)) {
        return { valid: false, message: `Minimum order amount of ₹${promo.minimum_order_amount} required` };
    }

    return { valid: true, promo };
};

const calculateDiscount = (promo, cartTotal) => {
    let discount = 0;
    const value = safeNumber(promo.discount_value);
    
    if (promo.discount_type === 'percentage') {
        discount = safeNumber(cartTotal) * (value / 100);
        if (promo.maximum_discount && safeNumber(promo.maximum_discount) > 0) {
            discount = Math.min(discount, safeNumber(promo.maximum_discount));
        }
    } else {
        discount = value;
    }
    
    // final amount shouldn't be negative
    if (discount > cartTotal) discount = cartTotal;
    
    return Number(discount.toFixed(2));
};

module.exports = {
    getPromoByCode,
    validatePromo,
    calculateDiscount
};
