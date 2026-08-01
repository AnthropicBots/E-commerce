// Tests for the pricing engine (#1256). These pin the two things the issue
// cares about and that nothing enforced before: the order in which discount,
// tax and shipping are applied, and the guarantee that the figures a shopper
// is shown add up to the total that gets charged.
//
// The engine has no database or logger dependency, so nothing is mocked here.

const PRICING_CONFIG = require("../config/pricingConfig");
const {
    roundMoney,
    priceLineItems,
    applyDiscount,
    calculateTax,
    calculateShipping,
    quote,
    getRulesDocument,
    createSignedQuote,
    verifySignedQuote,
    fingerprintItems,
    QUOTE_EXPIRED_CODE,
    QUOTE_MISMATCH_CODE
} = require("../services/pricing.service");

// Every breakdown must satisfy this, whatever the inputs.
function expectReconciles(breakdown) {
    const linesTotal = breakdown.lines.reduce(
        (sum, line) => sum + line.lineTotal,
        0
    );

    expect(roundMoney(linesTotal)).toBe(breakdown.subtotal);
    expect(
        roundMoney(
            breakdown.subtotal -
                breakdown.discount +
                breakdown.tax +
                breakdown.shipping
        )
    ).toBe(breakdown.total);
}

const percentagePromo = (value, maximumDiscount = null) => ({
    code: "PCT",
    discount_type: "percentage",
    discount_value: value,
    maximum_discount: maximumDiscount
});

describe("rounding policy", () => {
    it("rounds half away from zero at two places", () => {
        expect(roundMoney(1.005)).toBe(1.01);
        expect(roundMoney(2.675)).toBe(2.68);
        expect(roundMoney(1.004)).toBe(1);
        expect(roundMoney(-1.005)).toBe(-1.01);
    });

    it("coerces unusable input to zero rather than NaN", () => {
        expect(roundMoney(undefined)).toBe(0);
        expect(roundMoney("not a price")).toBe(0);
    });
});

describe("line pricing", () => {
    it("keeps the subtotal equal to the sum of the rounded lines", () => {
        // A third of a cent per unit: rounding each line and summing gives
        // 3.03, while rounding one naive grand total gives 3.01. The lines are
        // what the shopper sees, so the lines are what the subtotal follows.
        const { lines, subtotal } = priceLineItems([
            { id: "a", price: 0.335, qty: 3 },
            { id: "b", price: 0.335, qty: 3 },
            { id: "c", price: 0.335, qty: 3 }
        ]);

        expect(lines.map((line) => line.lineTotal)).toEqual([1.01, 1.01, 1.01]);
        expect(subtotal).toBe(3.03);
        expect(subtotal).not.toBe(3.01);
    });

    it("treats a missing or invalid quantity as one unit", () => {
        const { subtotal } = priceLineItems([
            { price: 10 },
            { price: 10, qty: 0 },
            { price: 10, qty: "x" }
        ]);

        expect(subtotal).toBe(30);
    });
});

describe("discount application", () => {
    it("caps a percentage discount at its maximum", () => {
        expect(applyDiscount(percentagePromo(50, 100), 1000)).toEqual({
            amount: 100,
            isShippingWaived: false
        });
    });

    it("applies the full percentage when no cap is set", () => {
        expect(applyDiscount(percentagePromo(10), 1000).amount).toBe(100);
    });

    it("clamps a fixed discount to the amount being discounted", () => {
        const promo = {
            code: "BIG",
            discount_type: "fixed",
            discount_value: 500
        };

        expect(applyDiscount(promo, 200).amount).toBe(200);
    });

    it("waives shipping instead of discounting for a free_shipping promo", () => {
        const promo = {
            code: "FREESHIP",
            discount_type: "free_shipping",
            discount_value: 0
        };

        expect(applyDiscount(promo, 500)).toEqual({
            amount: 0,
            isShippingWaived: true
        });
    });

    it("returns no discount when there is no promo", () => {
        expect(applyDiscount(null, 500).amount).toBe(0);
    });
});

describe("tax and shipping rules", () => {
    it("taxes at the configured rate", () => {
        expect(calculateTax(900)).toBe(
            roundMoney(900 * PRICING_CONFIG.TAX_RATE)
        );
    });

    it("never taxes a negative base", () => {
        expect(calculateTax(-50)).toBe(0);
    });

    it("charges shipping just below the free-shipping threshold", () => {
        expect(calculateShipping(PRICING_CONFIG.FREE_SHIPPING_THRESHOLD - 0.01))
            .toBe(PRICING_CONFIG.SHIPPING_FLAT_RATE);
    });

    it("ships free at the threshold itself", () => {
        expect(calculateShipping(PRICING_CONFIG.FREE_SHIPPING_THRESHOLD)).toBe(0);
    });

    it("does not charge shipping on an empty basket", () => {
        expect(calculateShipping(0)).toBe(0);
    });
});

describe("quote", () => {
    it("applies the discount before tax", () => {
        const breakdown = quote({
            items: [{ id: "a", price: 1000, qty: 1 }],
            promo: percentagePromo(10)
        });

        // Tax is 18% of 900, not of 1000. Were the discount applied after tax
        // the tax would be 180 and the total 1080 rather than 1111, so this
        // assertion flips the moment the ordering regresses.
        expect(breakdown.discount).toBe(100);
        expect(breakdown.taxableBase).toBe(900);
        expect(breakdown.tax).toBe(162);
        expect(breakdown.shipping).toBe(49);
        expect(breakdown.total).toBe(1111);
        expectReconciles(breakdown);
    });

    it("derives shipping from the post-discount subtotal", () => {
        // 1200 would ship free on its own; after a 50% discount the basket
        // falls under the threshold and shipping is due.
        const breakdown = quote({
            items: [{ id: "a", price: 1200, qty: 1 }],
            promo: percentagePromo(50)
        });

        expect(breakdown.taxableBase).toBe(600);
        expect(breakdown.shipping).toBe(PRICING_CONFIG.SHIPPING_FLAT_RATE);
        expectReconciles(breakdown);
    });

    it("ships free at the threshold and charges a cent below it", () => {
        const atThreshold = quote({
            items: [
                { id: "a", price: PRICING_CONFIG.FREE_SHIPPING_THRESHOLD, qty: 1 }
            ]
        });
        const belowThreshold = quote({
            items: [
                {
                    id: "a",
                    price: PRICING_CONFIG.FREE_SHIPPING_THRESHOLD - 0.01,
                    qty: 1
                }
            ]
        });

        expect(atThreshold.shipping).toBe(0);
        expect(belowThreshold.shipping).toBe(PRICING_CONFIG.SHIPPING_FLAT_RATE);
        expectReconciles(atThreshold);
        expectReconciles(belowThreshold);
    });

    it("honours the maximum on a percentage promo", () => {
        const breakdown = quote({
            items: [{ id: "a", price: 500, qty: 2 }],
            promo: percentagePromo(50, 100)
        });

        expect(breakdown.subtotal).toBe(1000);
        expect(breakdown.discount).toBe(100);
        expect(breakdown.taxableBase).toBe(900);
        expectReconciles(breakdown);
    });

    it("cannot be discounted below zero by an oversized fixed promo", () => {
        const breakdown = quote({
            items: [{ id: "a", price: 200, qty: 1 }],
            promo: {
                code: "BIG",
                discount_type: "fixed",
                discount_value: 500
            }
        });

        expect(breakdown.discount).toBe(200);
        expect(breakdown.taxableBase).toBe(0);
        expect(breakdown.tax).toBe(0);
        expect(breakdown.shipping).toBe(0);
        expect(breakdown.total).toBe(0);
        expectReconciles(breakdown);
    });

    it("zeroes shipping for a free_shipping promo without touching the base", () => {
        const breakdown = quote({
            items: [{ id: "a", price: 500, qty: 1 }],
            promo: {
                code: "FREESHIP",
                discount_type: "free_shipping",
                discount_value: 0
            }
        });

        expect(breakdown.discount).toBe(0);
        expect(breakdown.taxableBase).toBe(500);
        expect(breakdown.tax).toBe(90);
        expect(breakdown.shipping).toBe(0);
        expect(breakdown.total).toBe(590);
        expectReconciles(breakdown);
    });

    it("returns an all-zero breakdown for an empty basket", () => {
        const breakdown = quote({ items: [] });

        expect(breakdown.lines).toEqual([]);
        expect(breakdown.subtotal).toBe(0);
        expect(breakdown.discount).toBe(0);
        expect(breakdown.tax).toBe(0);
        expect(breakdown.shipping).toBe(0);
        expect(breakdown.total).toBe(0);
        expectReconciles(breakdown);
    });

    it("reconciles when per-line rounding and whole-basket rounding disagree", () => {
        const breakdown = quote({
            items: [
                { id: "a", price: 0.335, qty: 3 },
                { id: "b", price: 0.335, qty: 3 },
                { id: "c", price: 0.335, qty: 3 }
            ]
        });

        expect(breakdown.subtotal).toBe(3.03);
        expectReconciles(breakdown);
    });

    it("reports the currency and the ordering it applied", () => {
        const breakdown = quote({ items: [{ id: "a", price: 100, qty: 1 }] });

        expect(breakdown.currency).toBe(PRICING_CONFIG.CURRENCY);
        expect(breakdown.appliedOrder).toEqual(["discount", "tax", "shipping"]);
    });

    it("echoes the promo code that was applied", () => {
        const breakdown = quote({
            items: [{ id: "a", price: 100, qty: 1 }],
            promo: percentagePromo(10),
            promoCode: "PCT"
        });

        expect(breakdown.promoCode).toBe("PCT");
    });

    it("tolerates being called with nothing at all", () => {
        expect(quote().total).toBe(0);
    });
});

describe("tax and shipping edge cases (#1386)", () => {
    it("taxes the post-discount base, not the raw subtotal", () => {
        const breakdown = quote({
            items: [{ id: "a", price: 1000, qty: 1 }],
            promo: percentagePromo(10)
        });
        // 10% off → 900 taxable → 18% of 900 = 162; still below free-ship threshold
        expect(breakdown.taxableBase).toBe(900);
        expect(breakdown.tax).toBe(162);
        expect(breakdown.shipping).toBe(PRICING_CONFIG.SHIPPING_FLAT_RATE);
        expectReconciles(breakdown);
    });

    it("charges flat shipping just below the free-shipping threshold", () => {
        const breakdown = quote({
            items: [{ id: "a", price: 998, qty: 1 }]
        });
        expect(breakdown.shipping).toBe(PRICING_CONFIG.SHIPPING_FLAT_RATE);
        expect(breakdown.tax).toBe(roundMoney(998 * PRICING_CONFIG.TAX_RATE));
        expectReconciles(breakdown);
    });

    it("waives shipping at exactly the free-shipping threshold", () => {
        const breakdown = quote({
            items: [{ id: "a", price: 999, qty: 1 }]
        });
        expect(breakdown.shipping).toBe(0);
        expectReconciles(breakdown);
    });

    it("never ships an empty basket", () => {
        expect(calculateShipping(0)).toBe(0);
        expect(calculateTax(0)).toBe(0);
    });
});

describe("signed pricing quotes (#1386)", () => {
    it("exposes a versioned rules document", () => {
        const rules = getRulesDocument();
        expect(rules.version).toBe(PRICING_CONFIG.VERSION);
        expect(rules.authoritative).toBe(true);
        expect(rules.taxRate).toBe(PRICING_CONFIG.TAX_RATE);
        expect(rules.applicationOrder).toEqual(["discount", "tax", "shipping"]);
    });

    it("mints a signed quote with TTL and verifies it", () => {
        const items = [{ id: "p1", price: 100, qty: 2 }];
        const breakdown = quote({ items });
        const signed = createSignedQuote(breakdown, { items });

        expect(signed.quoteId).toBeTruthy();
        expect(signed.quoteToken).toContain(".");
        expect(signed.pricingVersion).toBe(PRICING_CONFIG.VERSION);

        const payload = verifySignedQuote(signed.quoteToken, {
            quoteId: signed.quoteId,
            items,
            expectedTotal: signed.total
        });
        expect(payload.total).toBe(signed.total);
        expect(payload.itemFingerprint).toBe(fingerprintItems(items));
    });

    it("rejects expired quotes", () => {
        const items = [{ id: "p1", price: 50, qty: 1 }];
        const signed = createSignedQuote(quote({ items }), { items, ttlSec: 60 });
        const [body, sig] = signed.quoteToken.split(".");
        const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
        payload.expiresAt = new Date(Date.now() - 1000).toISOString();
        const expiredBody = Buffer.from(JSON.stringify(payload)).toString("base64url");
        // Re-sign with same secret by calling through create — forge using crypto
        const crypto = require("crypto");
        const secret =
            process.env.PRICING_QUOTE_SECRET ||
            process.env.JWT_SECRET ||
            "pricing-quote-dev-secret";
        const forgedSig = crypto
            .createHmac("sha256", secret)
            .update(expiredBody)
            .digest("base64url");
        const expiredToken = `${expiredBody}.${forgedSig}`;

        expect(() => verifySignedQuote(expiredToken)).toThrow();
        try {
            verifySignedQuote(expiredToken);
        } catch (err) {
            expect(err.code).toBe(QUOTE_EXPIRED_CODE);
        }
    });

    it("rejects cart fingerprint mismatch", () => {
        const items = [{ id: "p1", price: 50, qty: 1 }];
        const signed = createSignedQuote(quote({ items }), { items });
        expect(() =>
            verifySignedQuote(signed.quoteToken, {
                items: [{ id: "p1", price: 50, qty: 2 }]
            })
        ).toThrow();
        try {
            verifySignedQuote(signed.quoteToken, {
                items: [{ id: "p1", price: 50, qty: 2 }]
            });
        } catch (err) {
            expect(err.code).toBe(QUOTE_MISMATCH_CODE);
        }
    });
});
