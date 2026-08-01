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
//
// The threshold itself is a rate rule now rather than a constant in the
// engine, so it is seeded into the rules the fixture serves. Its selection is
// covered on its own in shippingRates.test.js.

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
    min_days: 3,
    max_days: 6,
    is_default: 1,
    sort_order: 10
};

const EXPRESS = {
    code: 'express',
    label: 'Express delivery',
    description: 'Arrives in one to two days.',
    base_rate: '149.00',
    min_days: 1,
    max_days: 2,
    is_default: 0,
    sort_order: 20
};

// The threshold as migration 0037 seeds it: a waiver over basket value, with
// no stated amount, so it covers whatever the default option costs.
const THRESHOLD_RULE = {
    id: 1,
    name: 'Free delivery over 999',
    method_code: null,
    destination_scope: 'any',
    destination_value: null,
    min_weight_kg: null,
    max_weight_kg: null,
    min_order_value: PRICING_CONFIG.FREE_SHIPPING_THRESHOLD,
    max_order_value: null,
    effect: 'waive',
    amount: null,
    priority: 100
};

// Comfortably under the free-shipping threshold, so a charge actually applies.
const SMALL_BASKET = 500;
const LARGE_BASKET = PRICING_CONFIG.FREE_SHIPPING_THRESHOLD + 1;

function offering(methods, rules = [THRESHOLD_RULE]) {
    db.query.mockImplementation(async (sql) =>
        /shipping_rate_rules/.test(sql) ? [rules] : [methods]
    );
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
            waiverRate: 0,
            isWaiverEarned: false
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

describe('rules reaching the quote', () => {
    it('tells the shopper how far short of free delivery they are', async () => {
        const { freeShipping } = await shipping.quoteOptions({
            postDiscountSubtotal: 799
        });

        expect(freeShipping).toEqual({
            threshold: PRICING_CONFIG.FREE_SHIPPING_THRESHOLD,
            remaining: 200,
            qualified: false
        });
    });

    it('keeps the rule\'s internal name out of the response', async () => {
        const { freeShipping } = await shipping.quoteOptions({
            postDiscountSubtotal: 799
        });

        expect(freeShipping).not.toHaveProperty('name');
    });

    it('surcharges by weight when a rule says so', async () => {
        offering([STANDARD, EXPRESS], [
            {
                ...THRESHOLD_RULE,
                id: 2,
                name: 'Heavy parcel',
                min_order_value: null,
                min_weight_kg: 5,
                effect: 'surcharge',
                amount: 60,
                priority: 50
            }
        ]);
        shipping.clearCache();

        const light = await shipping.quoteOptions({
            postDiscountSubtotal: SMALL_BASKET,
            weightKg: 2
        });
        const heavy = await shipping.quoteOptions({
            postDiscountSubtotal: SMALL_BASKET,
            weightKg: 8
        });

        expect(light.options[0].cost).toBe(49);
        expect(heavy.options[0].cost).toBe(109);
    });

    it('falls back to flat rates when the rules cannot be read', async () => {
        db.query.mockImplementation(async (sql) => {
            if (/shipping_rate_rules/.test(sql)) {
                throw new Error('Table shipping_rate_rules does not exist');
            }
            return [[STANDARD, EXPRESS]];
        });
        shipping.clearCache();

        const { options, freeShipping } = await shipping.quoteOptions({
            postDiscountSubtotal: LARGE_BASKET
        });

        // No rules means no waiver: the options cost what they cost. Charging
        // is the safe direction — the alternative is giving delivery away
        // because a table could not be read.
        expect(options.map((option) => option.cost)).toEqual([49, 149]);
        expect(freeShipping).toBeNull();
    });
});

describe('the delivery window an option promises', () => {
    // A fixed placement date, so the window is arithmetic rather than a race
    // with the clock.
    const PLACED_AT = new Date(2026, 7, 1);

    it('runs from the option\'s near end to its far end', () => {
        expect(
            shipping.deliveryWindow({ placedAt: PLACED_AT, minDays: 3, maxDays: 6 })
        ).toMatchObject({ from: '2026-08-04', to: '2026-08-07' });
    });

    it('crosses a month boundary correctly', () => {
        expect(
            shipping.deliveryWindow({
                placedAt: new Date(2026, 7, 30),
                minDays: 3,
                maxDays: 6
            })
        ).toMatchObject({ from: '2026-09-02', to: '2026-09-05' });
    });

    it('pushes the window out for a destination the courier is slower to reach', () => {
        const slowerBy = 3;

        expect(
            shipping.deliveryWindow({
                placedAt: PLACED_AT,
                minDays: 3,
                maxDays: 6,
                destinationEtaDays:
                    SHIPPING_CONFIG.BASELINE_DESTINATION_ETA_DAYS + slowerBy
            })
        ).toMatchObject({ from: '2026-08-07', to: '2026-08-10' });
    });

    it('does not pull the window in for a destination that looks faster', () => {
        // A short lead time may just be a figure nobody has kept up to date.
        // Shortening a promise on that basis is how a store misses it.
        expect(
            shipping.deliveryWindow({
                placedAt: PLACED_AT,
                minDays: 3,
                maxDays: 6,
                destinationEtaDays: 1
            })
        ).toMatchObject({ from: '2026-08-04', to: '2026-08-07' });
    });

    it('promises nothing when the option states no window', () => {
        expect(
            shipping.deliveryWindow({ placedAt: PLACED_AT, minDays: null, maxDays: 6 })
        ).toBeNull();
        expect(
            shipping.deliveryWindow({ placedAt: PLACED_AT, minDays: 3, maxDays: null })
        ).toBeNull();
    });

    it('promises nothing when the placement date is unusable', () => {
        expect(
            shipping.deliveryWindow({ placedAt: 'not a date', minDays: 3, maxDays: 6 })
        ).toBeNull();
    });

    it('names the option the estimate belongs to', async () => {
        await expect(
            shipping.estimateDelivery({
                methodCode: 'express',
                placedAt: PLACED_AT
            })
        ).resolves.toMatchObject({
            code: 'express',
            label: 'Express delivery',
            from: '2026-08-02',
            to: '2026-08-03'
        });
    });

    it('estimates nothing for an option that is not offered', async () => {
        await expect(
            shipping.estimateDelivery({ methodCode: 'teleport', placedAt: PLACED_AT })
        ).resolves.toBeNull();
    });
});

describe('basket weight', () => {
    it('assumes a weight for products that have none recorded', () => {
        expect(
            shipping.basketWeightKg([{ weight: null, qty: 2 }])
        ).toBe(SHIPPING_CONFIG.DEFAULT_ITEM_WEIGHT_KG * 2);
    });

    it('counts each unit of a line', () => {
        expect(shipping.basketWeightKg([{ weight: 1.5, qty: 3 }])).toBe(4.5);
    });

    it('is zero for an empty basket', () => {
        expect(shipping.basketWeightKg([])).toBe(0);
        expect(shipping.basketWeightKg(null)).toBe(0);
    });
});
