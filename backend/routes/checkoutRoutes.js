const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { validateDiscountMiddleware } = require('../middleware/discountValidator');
const {
    calculateShipping,
    calculateTax,
    processOrder
} = require('../services/checkoutService');

// Apply discount validation to checkout
router.post(
    '/checkout',
    authMiddleware,
    validateDiscountMiddleware,
    async (req, res) => {
        try {
            const { items, shippingAddress } = req.body;
            const { finalDiscount, appliedRules } = req.validatedDiscount;
            const orderTotal = req.validatedOrderTotal;

            const shippingCost = calculateShipping(shippingAddress);
            const tax = calculateTax(orderTotal);
            const finalTotal = orderTotal + shippingCost + tax - finalDiscount;

            const order = await processOrder({
                userId: req.user.id,
                items,
                shippingAddress,
                discount: finalDiscount,
                total: finalTotal,
                appliedRules
            });

            res.status(201).json({
                success: true,
                message: 'Order placed successfully',
                orderId: order.id,
                discount: finalDiscount,
                originalTotal: orderTotal,
                finalTotal,
                appliedRules
            });
        } catch (error) {
            console.error('Checkout error:', error);
            res.status(500).json({
                success: false,
                error: 'Order processing failed'
            });
        }
    }
);

module.exports = router;