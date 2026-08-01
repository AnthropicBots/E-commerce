// backend/tests/shippingRates.test.js
//
// Shipping rate rules (#1430).
//
// Rule selection is the part of delivery pricing that is worth getting wrong
// loudly: a rule that matches when it should not undercharges every order it
// touches, and one that fails to match overcharges them. The module is pure,
// so nothing is mocked here.
//
// What these pin:
//
//   * an unstated condition matches everything, and a stated one must hold;
//   * weight and value bands are half-open, so bands written back to back
//     neither overlap nor leave a gap;
//   * surcharges accumulate and waivers do not;
//   * one set_rate wins, by priority, and the rest are ignored;
//   * a rule scoped to a place does not fire when the place is unknown;
//   * the free-shipping threshold is reported against the basket, including
//     how far short of it the shopper is.

const {
    EFFECTS,
    toRule,
    matches,
    applyRules,
    freeShippingProgress
} = require('../services/shippingRates.service');

const STANDARD_RATE = 49;
const EXPRESS_RATE = 149;

// A row as the database hands it over, so the normaliser is exercised too.
function rule(overrides = {}) {
    return toRule({
        id: 1,
        name: 'Rule',
        method_code: null,
        destination_scope: 'any',
        destination_value: null,
        min_weight_kg: null,
        max_weight_kg: null,
        min_order_value: null,
        max_order_value: null,
        effect: EFFECTS.SURCHARGE,
        amount: 0,
        priority: 100,
        ...overrides
    });
}

function context(overrides = {}) {
    return {
        methodCode: 'standard',
        orderValue: 500,
        weightKg: 1,
        destination: { pincode: '400001', city: 'Mumbai', state: 'Maharashtra' },
        ...overrides
    };
}

function priceStandard(rules, ctx = context()) {
    return applyRules({
        rules,
        baseRate: STANDARD_RATE,
        defaultRate: STANDARD_RATE,
        context: ctx
    });
}

describe('matching', () => {
    it('matches everything a rule does not mention', () => {
        expect(matches(rule(), context())).toBe(true);
    });

    it('honours the option a rule is scoped to', () => {
        const expressOnly = rule({ method_code: 'express' });

        expect(matches(expressOnly, context({ methodCode: 'express' }))).toBe(true);
        expect(matches(expressOnly, context({ methodCode: 'standard' }))).toBe(false);
    });

    it('matches a destination by pincode, city or state', () => {
        expect(
            matches(
                rule({ destination_scope: 'pincode', destination_value: '400001' }),
                context()
            )
        ).toBe(true);
        expect(
            matches(
                rule({ destination_scope: 'city', destination_value: 'mumbai' }),
                context()
            )
        ).toBe(true);
        expect(
            matches(
                rule({ destination_scope: 'state', destination_value: 'MAHARASHTRA' }),
                context()
            )
        ).toBe(true);
    });

    it('does not fire a placed rule when the destination is unknown', () => {
        // The cart page has no address. Quoting a surcharge that might not
        // apply, or a waiver that might not be earned, would both be a figure
        // the order path then contradicts.
        const scoped = rule({ destination_scope: 'state', destination_value: 'Kerala' });

        expect(matches(scoped, context({ destination: null }))).toBe(false);
        expect(matches(scoped, context({ destination: {} }))).toBe(false);
    });

    it('treats weight bands as half-open', () => {
        const band = rule({ min_weight_kg: 1, max_weight_kg: 5 });

        expect(matches(band, context({ weightKg: 0.999 }))).toBe(false);
        expect(matches(band, context({ weightKg: 1 }))).toBe(true);
        expect(matches(band, context({ weightKg: 4.999 }))).toBe(true);
        // Exclusive at the top, so a 5kg parcel belongs to the next band up and
        // not to both.
        expect(matches(band, context({ weightKg: 5 }))).toBe(false);
    });

    it('treats value bands as half-open', () => {
        const band = rule({ min_order_value: 999 });

        expect(matches(band, context({ orderValue: 998.99 }))).toBe(false);
        expect(matches(band, context({ orderValue: 999 }))).toBe(true);
    });

    it('leaves an unbounded side unbounded', () => {
        const heavy = rule({ min_weight_kg: 10 });

        expect(matches(heavy, context({ weightKg: 1000 }))).toBe(true);
    });
});

describe('applying rules to a rate', () => {
    it('charges the option\'s own rate when nothing matches', () => {
        expect(priceStandard([]).rate).toBe(STANDARD_RATE);
    });

    it('accumulates every matching surcharge', () => {
        // Two reasons to charge more are two costs. A remote destination does
        // not become free because the parcel is also heavy.
        const applied = priceStandard([
            rule({ id: 1, effect: EFFECTS.SURCHARGE, amount: 30, min_weight_kg: 0.5 }),
            rule({
                id: 2,
                effect: EFFECTS.SURCHARGE,
                amount: 20,
                destination_scope: 'state',
                destination_value: 'Maharashtra'
            })
        ]);

        expect(applied.rate).toBe(STANDARD_RATE + 50);
        expect(applied.appliedRules).toHaveLength(2);
    });

    it('lets one set_rate replace the rate, lowest priority number winning', () => {
        const applied = priceStandard([
            rule({ id: 1, effect: EFFECTS.SET_RATE, amount: 200, priority: 50 }),
            rule({ id: 2, effect: EFFECTS.SET_RATE, amount: 300, priority: 10 })
        ]);

        expect(applied.rate).toBe(300);
        expect(applied.appliedRules.map((r) => r.id)).toEqual([2]);
    });

    it('applies surcharges on top of a replaced rate', () => {
        const applied = priceStandard([
            rule({ id: 1, effect: EFFECTS.SET_RATE, amount: 200, priority: 10 }),
            rule({ id: 2, effect: EFFECTS.SURCHARGE, amount: 25 })
        ]);

        expect(applied.rate).toBe(225);
    });

    it('takes the largest waiver rather than stacking them', () => {
        // Two reasons to charge nothing are still one delivery. Summing them
        // would let a store owe money on the shipping line.
        const applied = priceStandard([
            rule({ id: 1, effect: EFFECTS.WAIVE, amount: 20, min_order_value: 100 }),
            rule({ id: 2, effect: EFFECTS.WAIVE, amount: 40, min_order_value: 200 })
        ]);

        expect(applied.waiverAmount).toBe(40);
        expect(applied.isWaiverEarned).toBe(true);
        expect(applied.appliedRules.map((r) => r.id)).toEqual([2]);
    });

    it('reads a waiver with no stated amount as the standard cost of delivery', () => {
        // This is the free-shipping threshold. It covers what the default
        // option costs, which is why an upgrade still costs its difference.
        const applied = applyRules({
            rules: [rule({ effect: EFFECTS.WAIVE, amount: null, min_order_value: 100 })],
            baseRate: EXPRESS_RATE,
            defaultRate: STANDARD_RATE,
            context: context({ methodCode: 'express', orderValue: 1000 })
        });

        expect(applied.rate).toBe(EXPRESS_RATE);
        expect(applied.waiverAmount).toBe(STANDARD_RATE);
    });

    it('reports no waiver when the basket has not earned one', () => {
        const applied = priceStandard(
            [rule({ effect: EFFECTS.WAIVE, amount: null, min_order_value: 999 })],
            context({ orderValue: 500 })
        );

        expect(applied.isWaiverEarned).toBe(false);
        expect(applied.waiverAmount).toBe(0);
    });

    it('never returns a negative rate', () => {
        const applied = priceStandard([
            rule({ effect: EFFECTS.SET_RATE, amount: 0, priority: 10 })
        ]);

        expect(applied.rate).toBe(0);
    });
});

describe('progress toward free delivery', () => {
    const threshold = rule({
        name: 'Free delivery over 999',
        effect: EFFECTS.WAIVE,
        amount: null,
        min_order_value: 999
    });

    it('reports how much further the basket has to go', () => {
        expect(
            freeShippingProgress({
                rules: [threshold],
                context: context({ orderValue: 799 })
            })
        ).toEqual({
            name: 'Free delivery over 999',
            threshold: 999,
            remaining: 200,
            qualified: false
        });
    });

    it('reports the threshold as met once it is', () => {
        expect(
            freeShippingProgress({
                rules: [threshold],
                context: context({ orderValue: 1200 })
            })
        ).toMatchObject({ remaining: 0, qualified: true });
    });

    it('reports the nearest unearned threshold, not the largest', () => {
        // Telling a shopper about a 5000 threshold while they are 50 short of
        // a 999 one is worse than saying nothing.
        const progress = freeShippingProgress({
            rules: [
                threshold,
                rule({ id: 2, effect: EFFECTS.WAIVE, amount: null, min_order_value: 5000 })
            ],
            context: context({ orderValue: 949 })
        });

        expect(progress.threshold).toBe(999);
        expect(progress.remaining).toBe(50);
    });

    it('says nothing when no threshold applies', () => {
        expect(
            freeShippingProgress({ rules: [], context: context() })
        ).toBeNull();

        // A waiver that is not about basket value is not progress anybody can
        // make, so it is not reported as such.
        expect(
            freeShippingProgress({
                rules: [
                    rule({
                        effect: EFFECTS.WAIVE,
                        amount: null,
                        destination_scope: 'state',
                        destination_value: 'Maharashtra'
                    })
                ],
                context: context()
            })
        ).toBeNull();
    });

    it('does not dangle a threshold the basket could never satisfy', () => {
        // Scoped to somewhere the parcel is not going: spending more would not
        // earn it, so promising it would be a lie.
        expect(
            freeShippingProgress({
                rules: [
                    rule({
                        effect: EFFECTS.WAIVE,
                        amount: null,
                        min_order_value: 999,
                        destination_scope: 'state',
                        destination_value: 'Kerala'
                    })
                ],
                context: context({ orderValue: 500 })
            })
        ).toBeNull();
    });
});
