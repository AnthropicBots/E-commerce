/**
 * Checkout controller — quotes + mid-session FX lock (#1392).
 */

"use strict";

const db = require("../config/db");
const { resolveOrderLines } = require("../services/order.service");
const { validatePromo } = require("../services/promo.service");
const pricing = require("../services/pricing.service");
const { safeArray, sanitizeString, safeNumber } = require("../utils/helpers");
const CURRENCY = require("../config/currency");
const { isSupportedCurrency, getCurrencyMeta, SUPPORTED_CURRENCIES } = CURRENCY;
const fxLockService = require("../services/fxLockService");

/**
 * POST /api/checkout/quote
 * Prices the basket in settlement currency and optionally locks FX for display.
 */
async function quoteCheckout(req, res) {
    try {
        const { items, promoCode, currency, lockFx } = req.body || {};
        const requestedItems = safeArray(items);
        const displayCurrency = sanitizeString(
            currency || req.query?.currency || CURRENCY.code
        ).toUpperCase() || CURRENCY.code;

        if (displayCurrency && !isSupportedCurrency(displayCurrency)) {
            return res.status(400).json({
                success: false,
                code: "FX_CURRENCY_UNSUPPORTED",
                message: `Unsupported currency: ${displayCurrency}`
            });
        }

        if (!requestedItems.length) {
            const empty = pricing.createSignedQuote(pricing.quote({ items: [] }), {
                items: []
            });
            return res.status(200).json({
                success: true,
                breakdown: empty,
                quoteId: empty.quoteId,
                quoteToken: empty.quoteToken,
                quote: empty.quote,
                pricingVersion: empty.pricingVersion,
                displayCurrency,
                fxLock: null
            });
        }

        const lines = await resolveOrderLines(db, requestedItems, {
            lockRows: false,
            enforceStock: false
        });

        const requestedCode = promoCode ? sanitizeString(promoCode) : "";
        let promo = null;
        let promoMessage = null;

        if (requestedCode) {
            const { subtotal } = pricing.priceLineItems(lines);
            const validation = await validatePromo(requestedCode, subtotal);
            if (validation.valid) {
                promo = validation.promo;
            } else {
                promoMessage = validation.message;
            }
        }

        const breakdown = pricing.quote({
            items: lines,
            promo,
            promoCode: promo ? promo.code : null
        });

        const signed = pricing.createSignedQuote(breakdown, {
            items: requestedItems.length ? requestedItems : lines
        });

        let fxLock = null;
        const shouldLock =
            lockFx !== false &&
            displayCurrency &&
            displayCurrency !== CURRENCY.code;

        if (shouldLock || lockFx === true) {
            const locked = await fxLockService.createFxLock({
                displayCurrency: displayCurrency || CURRENCY.code,
                baseTotal: signed.total,
                quoteId: signed.quoteId
            });
            fxLock = locked.lock;
            fxLock.token = locked.token;
        }

        const meta = getCurrencyMeta(displayCurrency);
        const rate = fxLock ? fxLock.rate : (await fxLockService.getSpotRate(displayCurrency)).rate;

        return res.status(200).json({
            success: true,
            breakdown: signed,
            quoteId: signed.quoteId,
            quoteToken: signed.quoteToken,
            quote: signed.quote,
            pricingVersion: signed.pricingVersion,
            promoMessage,
            displayCurrency,
            currency: meta,
            fx: {
                baseCurrency: CURRENCY.code,
                displayCurrency,
                rate,
                displayTotal: fxLockService.toDisplayAmount(
                    signed.total,
                    rate,
                    displayCurrency
                )
            },
            fxLock
        });
    } catch (error) {
        console.error("Quote error:", error);
        const status = error.status || 400;
        return res.status(status).json({
            success: false,
            code: error.code || "QUOTE_FAILED",
            error: error.message || "Could not price this basket",
            message: error.message || "Could not price this basket"
        });
    }
}

/**
 * POST /api/checkout/fx/lock
 * Explicitly mint/refresh an FX lock for the active display currency.
 */
async function lockFxRate(req, res) {
    try {
        const displayCurrency = sanitizeString(
            req.body?.currency || req.body?.displayCurrency || ""
        ).toUpperCase();
        const baseTotal =
            req.body?.baseTotal !== undefined
                ? safeNumber(req.body.baseTotal)
                : null;

        if (!displayCurrency || !isSupportedCurrency(displayCurrency)) {
            return res.status(400).json({
                success: false,
                code: "FX_CURRENCY_UNSUPPORTED",
                message: "A supported display currency is required"
            });
        }

        const locked = await fxLockService.createFxLock({
            displayCurrency,
            baseTotal: baseTotal > 0 ? baseTotal : null,
            quoteId: sanitizeString(req.body?.quoteId || "") || null
        });

        return res.status(201).json({
            success: true,
            message: "FX rate locked for checkout",
            fxLock: { ...locked.lock, token: locked.token }
        });
    } catch (error) {
        return res.status(error.status || 500).json({
            success: false,
            code: error.code || "FX_LOCK_FAILED",
            message: error.message || "Failed to lock FX rate"
        });
    }
}

/**
 * POST /api/checkout/fx/validate
 * Ensure a lock is still valid before place-order.
 */
async function validateFxLock(req, res) {
    try {
        const token = sanitizeString(
            req.body?.fxLockToken || req.body?.token || ""
        );
        const displayCurrency = req.body?.currency
            ? sanitizeString(req.body.currency).toUpperCase()
            : null;
        const baseTotal =
            req.body?.baseTotal !== undefined
                ? safeNumber(req.body.baseTotal)
                : null;

        const lock = await fxLockService.validateFxLock(token, {
            displayCurrency,
            baseTotal: baseTotal > 0 ? baseTotal : null
        });

        return res.status(200).json({
            success: true,
            message: "FX lock is valid",
            lock
        });
    } catch (error) {
        return res.status(error.status || 400).json({
            success: false,
            code: error.code || "FX_LOCK_INVALID",
            message: error.message || "FX lock validation failed"
        });
    }
}

/**
 * GET /api/checkout/fx/rates
 * Spot (or fallback) rates for the currency switcher.
 */
async function getFxRates(req, res) {
    try {
        const bundle = await fxLockService.fetchProviderRates();
        return res.status(200).json({
            success: true,
            base: bundle.base,
            source: bundle.source,
            rates: bundle.rates,
            fetchedAt: bundle.fetchedAt,
            currencies: SUPPORTED_CURRENCIES
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: error.message || "Failed to load FX rates"
        });
    }
}

module.exports = {
    quoteCheckout,
    lockFxRate,
    validateFxLock,
    getFxRates
};
