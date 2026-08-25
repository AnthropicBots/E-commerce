// Cart line identity, merge policy and ownership policy.
//
// These are the rules both sides of the cart have to agree on, so they live
// here as pure functions with no database or logging dependency: a cart line is
// a product plus the variant the shopper chose, combining two carts sums only
// lines that are the same line, and a stored cart may only be adopted by the
// identity it belongs to.

const {
    safeArray,
    safeInteger,
    safeUUID,
    sanitizeString
} = require("../utils/helpers");

// 0 and empty colour/size all mean "nothing chosen". They are normalized to
// these values rather than left as null/undefined because NULL never compares
// equal to NULL, which would split one line into two both in the uniqueness
// constraint and in every key comparison below.
const NO_VARIANT_ID = 0;

// Marker for a cart that is not attached to any account. Not a valid user id,
// so it can never collide with one.
const GUEST_CART_OWNER = "guest";

const CART_OWNERSHIP = {
    // The cart belongs to whoever is looking at it.
    ADOPT: "adopt",
    // A guest cart seen by a signed-in shopper: candidate material for a
    // deliberate sign-in merge, not the account cart.
    MERGE_CANDIDATE: "merge-candidate",
    // Somebody else's cart. Never merged — that would leak one shopper's
    // basket into another shopper's account.
    DISCARD: "discard"
};

const normalizeCartLine = (rawLine) => {
    if (!rawLine || typeof rawLine !== "object") {
        return null;
    }

    // Product ids are CHAR(36) UUIDs; anything that is not one is not a line.
    const productId = safeUUID(
        rawLine.productId ?? rawLine.product_id ?? rawLine.id
    );

    if (!productId) {
        return null;
    }

    const variantId = Math.max(
        NO_VARIANT_ID,
        safeInteger(rawLine.variantId ?? rawLine.variant_id, NO_VARIANT_ID)
    );

    const quantity = Math.max(
        1,
        safeInteger(rawLine.quantity ?? rawLine.qty, 1)
    );

    return {
        productId,
        variantId,
        color: sanitizeString(rawLine.color),
        size: sanitizeString(rawLine.size),
        quantity
    };
};

// Expects an already normalized line. Colour and size are compared
// case-insensitively so a shopper who picked "Red" twice ends up with one line;
// the sanitized original casing is what gets stored and displayed.
const cartLineKey = (line) => {
    return [
        sanitizeString(line?.productId),
        String(Math.max(NO_VARIANT_ID, safeInteger(line?.variantId, NO_VARIANT_ID))),
        sanitizeString(line?.color).toLowerCase(),
        sanitizeString(line?.size).toLowerCase()
    ].join("|");
};

// Collapses a submitted cart to one entry per line. A line stated twice in the
// same payload is the same line described twice, not two lines to add up, so
// the later quantity wins — which is also what keeps a cart from inflating when
// the same state is pushed or hydrated repeatedly.
const normalizeCartLines = (rawLines) => {
    const lines = new Map();

    for (const rawLine of safeArray(rawLines)) {
        const line = normalizeCartLine(rawLine);

        if (!line) {
            continue;
        }

        lines.set(cartLineKey(line), line);
    }

    return [...lines.values()];
};

// Combining two carts is the one place quantities are summed, and only for
// lines that are genuinely the same line.
const mergeCartLines = (accountLines, incomingLines) => {
    const merged = new Map();

    for (const line of normalizeCartLines(accountLines)) {
        merged.set(cartLineKey(line), line);
    }

    for (const line of normalizeCartLines(incomingLines)) {
        const key = cartLineKey(line);
        const existing = merged.get(key);

        if (existing) {
            merged.set(key, {
                ...existing,
                quantity: existing.quantity + line.quantity
            });

            continue;
        }

        merged.set(key, line);
    }

    return [...merged.values()];
};

const resolveCartOwnership = (cartOwner, viewerOwner) => {
    const owner = sanitizeString(cartOwner) || GUEST_CART_OWNER;
    const viewer = sanitizeString(viewerOwner) || GUEST_CART_OWNER;

    if (owner === viewer) {
        return CART_OWNERSHIP.ADOPT;
    }

    if (owner === GUEST_CART_OWNER) {
        return CART_OWNERSHIP.MERGE_CANDIDATE;
    }

    return CART_OWNERSHIP.DISCARD;
};

// Normalize database rows to match application-side normalization.
// DB may store NULL for color/size, but app normalizes to ''.
const normalizeDbLine = (row) => {
    if (!row) return row;
    return {
        ...row,
        color: sanitizeString(row.color),
        size: sanitizeString(row.size),
        variantId: safeInteger(row.variant_id ?? row.variantId, NO_VARIANT_ID),
        productId: safeUUID(row.product_id ?? row.productId),
        quantity: safeInteger(row.quantity ?? row.qty)
    };
};

const normalizeDbLines = (rows) => {
    return safeArray(rows).map(normalizeDbLine);
};

module.exports = {
    NO_VARIANT_ID,
    GUEST_CART_OWNER,
    CART_OWNERSHIP,
    normalizeCartLine,
    normalizeCartLines,
    cartLineKey,
    mergeCartLines,
    resolveCartOwnership,
    normalizeDbLine,
    normalizeDbLines
};
