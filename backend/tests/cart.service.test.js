// Tests for the cart reconciliation policy (#1258): what makes two cart lines
// the same line, when quantities are allowed to sum, and who is allowed to
// adopt a stored cart. The service is pure, so nothing here needs a database.

const {
    CART_OWNERSHIP,
    NO_VARIANT_ID,
    cartLineKey,
    mergeCartLines,
    normalizeCartLine,
    normalizeCartLines,
    resolveCartOwnership
} = require("../services/cart.service");

const SHIRT = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
const MUG = "3f2504e0-4f89-11d3-9a0c-0305e82c3302";

function lineOf(lines, color, size) {
    return lines.find(
        (line) =>
            line.color.toLowerCase() === String(color).toLowerCase() &&
            line.size.toLowerCase() === String(size).toLowerCase()
    );
}

describe("line identity", () => {
    test("two variants of one product stay distinct instead of collapsing", () => {
        const lines = normalizeCartLines([
            { productId: SHIRT, color: "Red", size: "M", qty: 1 },
            { productId: SHIRT, color: "Blue", size: "M", qty: 2 }
        ]);

        expect(lines).toHaveLength(2);
        expect(lineOf(lines, "Red", "M").quantity).toBe(1);
        expect(lineOf(lines, "Blue", "M").quantity).toBe(2);
    });

    test("missing, null and blank variant fields describe the same line", () => {
        const lines = normalizeCartLines([
            { productId: MUG, qty: 1 },
            { productId: MUG, color: null, size: undefined, qty: 3 },
            { productId: MUG, color: "", size: "   ", qty: 5 }
        ]);

        expect(lines).toHaveLength(1);
        expect(lines[0].variantId).toBe(NO_VARIANT_ID);
        expect(lines[0].color).toBe("");
        expect(lines[0].size).toBe("");
    });

    test("one choice spelled two ways is one line", () => {
        expect(
            cartLineKey(normalizeCartLine({ productId: SHIRT, color: "RED", size: "m" }))
        ).toBe(
            cartLineKey(normalizeCartLine({ productId: SHIRT, color: " red ", size: "M" }))
        );
    });

    test("an explicit variant id separates lines that share colour and size", () => {
        const lines = normalizeCartLines([
            { productId: SHIRT, variantId: 7, color: "Red", size: "M", qty: 1 },
            { productId: SHIRT, color: "Red", size: "M", qty: 1 }
        ]);

        expect(lines).toHaveLength(2);
    });

    test("UUID product ids survive normalization and non-UUID ids are not lines", () => {
        expect(normalizeCartLine({ productId: SHIRT, qty: 1 }).productId).toBe(SHIRT);
        expect(normalizeCartLine({ id: SHIRT, quantity: 4 })).toEqual({
            productId: SHIRT,
            variantId: NO_VARIANT_ID,
            color: "",
            size: "",
            quantity: 4
        });

        expect(normalizeCartLine({ productId: 12, qty: 1 })).toBeNull();
        expect(normalizeCartLine({ productId: "", qty: 1 })).toBeNull();
        expect(normalizeCartLines([{ productId: 12 }, null, "nonsense"])).toEqual([]);
    });

    test("quantities below one are floored rather than dropping the line", () => {
        expect(normalizeCartLine({ productId: MUG, qty: 0 }).quantity).toBe(1);
        expect(normalizeCartLine({ productId: MUG, qty: -4 }).quantity).toBe(1);
    });
});

describe("hydration", () => {
    test("the same cart applied twice does not inflate", () => {
        const cart = [
            { productId: SHIRT, color: "Red", size: "M", qty: 2 },
            { productId: MUG, qty: 1 }
        ];

        const once = normalizeCartLines(cart);
        const twice = normalizeCartLines([...cart, ...cart]);

        expect(twice).toEqual(once);
        expect(normalizeCartLines(once)).toEqual(once);
    });
});

describe("merge policy", () => {
    test("only matching lines are summed", () => {
        const accountCart = [
            { productId: SHIRT, color: "Red", size: "M", qty: 2 },
            { productId: MUG, qty: 1 }
        ];

        const guestCart = [
            { productId: SHIRT, color: "red", size: "m", qty: 3 },
            { productId: SHIRT, color: "Blue", size: "M", qty: 1 }
        ];

        const merged = mergeCartLines(accountCart, guestCart);

        expect(merged).toHaveLength(3);
        expect(lineOf(merged, "Red", "M").quantity).toBe(5);
        expect(lineOf(merged, "Blue", "M").quantity).toBe(1);
        expect(lineOf(merged, "", "").quantity).toBe(1);
    });

    test("merging nothing in leaves the account cart untouched", () => {
        const accountCart = [{ productId: SHIRT, color: "Red", size: "M", qty: 2 }];

        expect(mergeCartLines(accountCart, [])).toEqual(normalizeCartLines(accountCart));
        expect(mergeCartLines(accountCart, null)).toEqual(normalizeCartLines(accountCart));
    });

    test("the account cart is not mutated by a merge", () => {
        const accountCart = [{ productId: SHIRT, color: "Red", size: "M", qty: 2 }];

        mergeCartLines(accountCart, [{ productId: SHIRT, color: "Red", size: "M", qty: 4 }]);

        expect(accountCart[0].qty).toBe(2);
    });
});

describe("ownership", () => {
    const ACCOUNT = "9f8b7c6d-5e4f-4a3b-8c1d-2e3f4a5b6c7d";
    const OTHER_ACCOUNT = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";

    test("a cart belonging to another account is discarded, never merged", () => {
        expect(resolveCartOwnership(OTHER_ACCOUNT, ACCOUNT)).toBe(CART_OWNERSHIP.DISCARD);
    });

    test("an account cart left behind after sign-out is discarded", () => {
        expect(resolveCartOwnership(ACCOUNT, "guest")).toBe(CART_OWNERSHIP.DISCARD);
        expect(resolveCartOwnership(ACCOUNT, null)).toBe(CART_OWNERSHIP.DISCARD);
    });

    test("a cart is adopted only by the identity it belongs to", () => {
        expect(resolveCartOwnership(ACCOUNT, ACCOUNT)).toBe(CART_OWNERSHIP.ADOPT);
        expect(resolveCartOwnership("guest", "guest")).toBe(CART_OWNERSHIP.ADOPT);
    });

    test("an unowned cart is merge material for a signed-in shopper, not their cart", () => {
        expect(resolveCartOwnership("guest", ACCOUNT)).toBe(CART_OWNERSHIP.MERGE_CANDIDATE);
        expect(resolveCartOwnership(null, ACCOUNT)).toBe(CART_OWNERSHIP.MERGE_CANDIDATE);
    });
});
