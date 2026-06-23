const { validatePromo, calculateDiscount } = require("../services/promo.service");
const { safeNumber, sanitizeString } = require("../utils/helpers");

const validatePromoCode = async (req, res) => {
    try {
        const promoCode = sanitizeString(req.body.promoCode);
        const cartTotal = safeNumber(req.body.cartTotal);

        if (!promoCode || cartTotal <= 0) {
            return res.status(400).json({ success: false, message: "Invalid promo code or cart total" });
        }

        const validation = await validatePromo(promoCode, cartTotal);
        if (!validation.valid) {
            return res.status(400).json({ success: false, message: validation.message });
        }

        const discount = calculateDiscount(validation.promo, cartTotal);
        const finalAmount = Number((cartTotal - discount).toFixed(2));

        return res.status(200).json({
            success: true,
            promo: {
                code: validation.promo.code,
                discountType: validation.promo.discount_type,
                discountValue: validation.promo.discount_value
            },
            discount,
            finalAmount
        });

    } catch (error) {
        console.error("PROMO VALIDATION ERROR:", error);
        return res.status(500).json({ success: false, message: "Server error" });
    }
};

module.exports = { validatePromoCode };
