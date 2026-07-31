// Tests for the total-verification step order creation performs (#1256).
//
// The client's total is a claim: it has to agree with what the server prices
// the same basket at, or the order is refused. The helper is pure, so nothing
// is mocked and no database is involved.

const PRICING_CONFIG = require("../config/pricingConfig");
const { MINOR_UNIT, verifyClaimedTotal, quote } = require("../services/pricing.service");

const SYMBOL = PRICING_CONFIG.CURRENCY.symbol;

describe("claimed total verification", () => {
    it("accepts a total that matches exactly", () => {
        const result = verifyClaimedTotal(1111, 1111);

        expect(result.isAcceptable).toBe(true);
        expect(result.difference).toBe(0);
        expect(result.message).toBeNull();
    });

    it("accepts a string total, as it arrives over JSON from some clients", () => {
        expect(verifyClaimedTotal("1111.00", 1111).isAcceptable).toBe(true);
    });

    it("tolerates drift of a single minor unit in either direction", () => {
        expect(verifyClaimedTotal(1111 + MINOR_UNIT, 1111).isAcceptable).toBe(true);
        expect(verifyClaimedTotal(1111 - MINOR_UNIT, 1111).isAcceptable).toBe(true);
    });

    it("rejects drift beyond one minor unit", () => {
        const result = verifyClaimedTotal(1111.05, 1111);

        expect(result.isAcceptable).toBe(false);
        expect(result.difference).toBe(0.05);
    });

    it("names both figures when it rejects, so the shopper can be told why", () => {
        const result = verifyClaimedTotal(900, 1111);

        expect(result.isAcceptable).toBe(false);
        expect(result.claimed).toBe(900);
        expect(result.computed).toBe(1111);
        expect(result.message).toContain(`${SYMBOL}900.00`);
        expect(result.message).toContain(`${SYMBOL}1111.00`);
    });

    it("rejects a total that undercuts the computed price", () => {
        expect(verifyClaimedTotal(1, 1111).isAcceptable).toBe(false);
    });

    it.each([
        ["undefined", undefined],
        ["null", null],
        ["an empty string", ""],
        ["a non-numeric string", "free please"],
        ["NaN", NaN],
        ["Infinity", Infinity],
        ["an object", { total: 1111 }]
    ])("refuses to verify when the claim is %s", (_label, claimed) => {
        const result = verifyClaimedTotal(claimed, 1111);

        expect(result.isAcceptable).toBe(false);
        expect(result.claimed).toBeNull();
        expect(result.message).toContain(`${SYMBOL}1111.00`);
    });

    it("still reports the computed figure when the computed side is unusable", () => {
        const result = verifyClaimedTotal(10, undefined);

        expect(result.computed).toBe(0);
        expect(result.isAcceptable).toBe(false);
    });

    it("accepts the engine's own total for the basket it priced", () => {
        const breakdown = quote({
            items: [
                { id: "a", price: 499.5, qty: 2 },
                { id: "b", price: 12.34, qty: 3 }
            ]
        });

        expect(verifyClaimedTotal(breakdown.total, breakdown.total).isAcceptable)
            .toBe(true);
    });

    it("rejects a claim built from the wrong ordering of discount and tax", () => {
        const items = [{ id: "a", price: 1000, qty: 1 }];
        const promo = {
            code: "PCT10",
            discount_type: "percentage",
            discount_value: 10,
            maximum_discount: null
        };

        const breakdown = quote({ items, promo });
        // What a client that taxed before discounting would have submitted.
        const discountAfterTax = 1000 + 1000 * PRICING_CONFIG.TAX_RATE - 100;

        expect(verifyClaimedTotal(discountAfterTax, breakdown.total).isAcceptable)
            .toBe(false);
    });
});
