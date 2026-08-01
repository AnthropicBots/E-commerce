// backend/tests/shipping.service.test.js
//
// Delivery options (#1430).
//
// The properties worth pinning are the ones whose absence would cost money:
//
//   * a checkout that chooses nothing prices exactly as it did before there
//     were options at all;
//   * an option the client names but the store does not offer is rejected
//     rather than quietly substituted;
//   * free shipping covers the standard rate and no more, so upgrading on top
//     of an earned waiver still costs the difference;
//   * nothing on the request side of the boundary carries a rate.

jest.mock('../config/db', () => ({
    query: jest.fn()
}));

jest.mock('../utils/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
}));

const db = require('../config/db');
const PRICING_CONFIG = require('../config/pricingConfig');
const SHIPPING_CONFIG = require('../config/shippingConfig');
const pricing = require('../services/pricing.service');
const shipping = require('../services/shipping.service');

const STANDARD = {
    code: 'standard',
    label: 'Standard delivery',
    description: 'Arrives in three to six days.',
    base_rate: '49.00',
    is_default: 1,
    sort_order: 10
};

const EXPRESS = {
    code: 'express',
    label: 'Express delivery',
    description: 'Arrives in one to two days.',
    base_rate: '149.00',
    is_default: 0,
    sort_order: 20
};

// Comfortably under the free-shipping threshold, so a charge actually applies.
const SMALL_BASKET = 500;
const LARGE_BASKET = PRICING_CONFIG.FREE_SHIPPING_THRESHOLD + 1;

function offering(rows) {
    db.query.mockResolvedValue([rows]);
}

beforeEach(() => {
    jest.clearAllMocks();
    shipping.clearCache();
    offering([STANDARD, EXPRESS]);
});

describe('resolving a requested option', () => {
    it('falls back to the default when nothing was chosen', async () => {
        await expect(shipping.resolveMethod(null)).resolves.toMatchObject({
            code: 'standard'
        });
        await expect(shipping.resolveMethod('')).resolves.toMatchObject({
            code: 'standard'
        });
    });

    it('rejects an option the store does not offer rather than substituting one', async () => {
        // Silently defaulting would charge a shopper for delivery they did not
        // pick, and would hide a client sending a code that no longer exists.
        await expect(shipping.resolveMethod('teleport')).rejects.toMatchObject({
            code: shipping.UNKNOWN_METHOD_CODE
        });
    });

    it('names what is on offer when it rejects one', async () => {
        await expect(shipping.resolveMethod('teleport')).rejects.toThrow(/standard, express/);
    });

    it('keeps checkout working when the options cannot be read', async () => {
        db.query.mockRejectedValue(new Error('Table shipping_methods does not exist'));
        shipping.clearCache();

        const method = await shipping.getDefaultMethod();

        expect(method.code).toBe(SHIPPING_CONFIG.FALLBACK_METHOD.code);
        expect(method.rate).toBe(PRICING_CONFIG.SHIPPING_FLAT_RATE);
    });

    it('treats an empty table the same as an unreadable one', async () => {
        offering([]);
        shipping.clearCache();

        await expect(shipping.listMethods()).resolves.toEqual([
            SHIPPING_CONFIG.FALLBACK_METHOD
        ]);
    });

    it('reads the options once and reuses them', async () => {
        await shipping.listMethods();
        await shipping.listMethods();

        expect(db.query).toHaveBeenCalledTimes(1);
    });
});

describe('what a waiver covers', () => {
    it('waives the default option outright once the threshold is met', async () => {
        const { options } = await shipping.quoteOptions({
            postDiscountSubtotal: LARGE_BASKET
        });

        expect(options.find((option) => option.code === 'standard').cost).toBe(0);
    });

    it('charges the difference when an earned waiver is spent on an upgrade', async () => {
        // Free shipping means the store absorbs the standard cost of delivery.
        // Making it absorb an express upgrade as well would give away the whole
        // premium to every basket that crossed the threshold.
        const { options } = await shipping.quoteOptions({
            postDiscountSubtotal: LARGE_BASKET
        });

        expect(options.find((option) => option.code === 'express').cost).toBe(100);
    });

    it('charges each option in full below the threshold', async () => {
        const { options } = await shipping.quoteOptions({
            postDiscountSubtotal: SMALL_BASKET
        });

        expect(options.map((option) => option.cost)).toEqual([49, 149]);
    });

    it('treats a free_shipping promo the same as the threshold', async () => {
        const { options } = await shipping.quoteOptions({
            postDiscountSubtotal: SMALL_BASKET,
            isShippingWaived: true
        });

        expect(options.map((option) => option.cost)).toEqual([0, 100]);
    });
});

describe('backwards compatibility with the flat rate', () => {
    it('prices a basket that names no option exactly as the engine always did', async () => {
        const { selected } = await shipping.quoteOptions({
            postDiscountSubtotal: SMALL_BASKET
        });

        const withMethod = pricing.calculateShipping(SMALL_BASKET, {
            methodRate: selected.rate,
            waiverRate: selected.waiverRate
        });

        expect(withMethod).toBe(pricing.calculateShipping(SMALL_BASKET));
        expect(withMethod).toBe(PRICING_CONFIG.SHIPPING_FLAT_RATE);
    });

    it('still charges nothing above the threshold when no option is named', () => {
        expect(pricing.calculateShipping(LARGE_BASKET)).toBe(0);
    });

    it('leaves the breakdown reconciling when a paid option is chosen', async () => {
        const { selected } = await shipping.quoteOptions({
            postDiscountSubtotal: SMALL_BASKET,
            selectedCode: 'express'
        });

        const breakdown = pricing.quote({
            items: [{ id: 'a', price: SMALL_BASKET, qty: 1 }],
            shippingMethod: selected
        });

        expect(breakdown.shippingMethod).toEqual({
            code: 'express',
            label: 'Express delivery'
        });
        expect(breakdown.shipping).toBe(149);
        expect(
            pricing.roundMoney(
                breakdown.subtotal -
                    breakdown.discount +
                    breakdown.tax +
                    breakdown.shipping
            )
        ).toBe(breakdown.total);
    });
});

describe('the pricing descriptor handed across the boundary', () => {
    it('carries a rate the caller looked up, never one the caller supplied', async () => {
        const { selected } = await shipping.quoteOptions({
            postDiscountSubtotal: SMALL_BASKET,
            selectedCode: 'express'
        });

        expect(selected).toEqual({
            code: 'express',
            label: 'Express delivery',
            rate: 149,
            waiverRate: 49
        });
    });

    it('marks the chosen option so the shopper sees what they picked', async () => {
        const { options } = await shipping.quoteOptions({
            postDiscountSubtotal: SMALL_BASKET,
            selectedCode: 'express'
        });

        expect(options.map((option) => option.isSelected)).toEqual([false, true]);
        expect(options.map((option) => option.isDefault)).toEqual([true, false]);
    });
});
