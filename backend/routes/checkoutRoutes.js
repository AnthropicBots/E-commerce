const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { resolveOrderLines } = require('../services/order.service');
const { validatePromo } = require('../services/promo.service');
const pricing = require('../services/pricing.service');
const { safeArray, sanitizeString } = require('../utils/helpers');

// Pricing only. Orders are created on the orders path, which is the one that
// resolves prices under lock, enforces stock and consumes inventory holds.
router.post('/quote', async (req, res) => {
    try {
        const { items, promoCode } = req.body;
        const requestedItems = safeArray(items);

        if (!requestedItems.length) {
            return res.status(200).json({
                success: true,
                breakdown: pricing.quote({ items: [] })
            });
        }

        // Prices come from the database, never from the request body.
        const lines = await resolveOrderLines(db, requestedItems, {
            lockRows: false,
            enforceStock: false
        });

        const requestedCode = promoCode ? sanitizeString(promoCode) : '';
        let promo = null;
        let promoMessage = null;

        if (requestedCode) {
            const { subtotal } = pricing.priceLineItems(lines);
            const validation = await validatePromo(requestedCode, subtotal);

            if (validation.valid) {
                promo = validation.promo;
            } else {
                // An unusable code must not fail the quote — the shopper still
                // needs to see what the basket costs without it.
                promoMessage = validation.message;
            }
        }

        const breakdown = pricing.quote({
            items: lines,
            promo,
            promoCode: promo ? promo.code : null
        });

        return res.status(200).json({
            success: true,
            breakdown,
            promoMessage
        });
    } catch (error) {
        console.error('Quote error:', error);
        return res.status(400).json({
            success: false,
            error: error.message || 'Could not price this basket'
        });
    }
});

module.exports = router;
