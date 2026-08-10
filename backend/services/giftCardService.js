const crypto = require("crypto");
const promisePool = require("../config/db");

// The store prices in exactly one currency and declares it here. A card is
// issued in that currency by default and may only be redeemed against it.
// `gift_cards.currency` defaulted to "USD" while the store priced in INR, and
// nothing ever compared the two -- latent while a redemption changed no order
// total, and not latent from the moment one does (#1478).
const CURRENCY = require("../config/currency");

// Orders a card may still pay towards. Anything else is either already settled
// or no longer payable, and a redemption against it would take a balance for
// something the customer is not being charged for.
const PAYABLE_PAYMENT_STATUSES = Object.freeze(["pending", "failed"]);

// Order lifecycle states that are over. `payment_status` alone is not enough:
// a cancelled order can still read `pending`.
const UNPAYABLE_ORDER_STATUSES = Object.freeze(["cancelled", "refunded"]);

// 8 random bytes -> 16 uppercase hex chars. Only the SHA-256 hash of this
// plaintext is ever persisted (code_hash); the plaintext is returned to the
// caller exactly once, at issue time.
const CODE_BYTES = 8;

const GIFT_CARD_STATUS = Object.freeze({
    ACTIVE: "active",
    REDEEMED: "redeemed",
    EXPIRED: "expired",
    DISABLED: "disabled"
});

const TRANSACTION_TYPE = Object.freeze({
    ISSUE: "issue",
    REDEEM: "redeem",
    REFUND: "refund"
});

// Thrown for expected business-rule failures (unknown code, inactive/expired
// card, insufficient balance, bad amount) so callers can map `.code` to an
// HTTP status instead of a generic 500.
class GiftCardError extends Error {
    constructor(message, code) {
        super(message);
        this.name = "GiftCardError";
        this.code = code;
    }
}

function hashCode(code) {
    return crypto.createHash("sha256").update(String(code)).digest("hex");
}

function generateCode() {
    return crypto.randomBytes(CODE_BYTES).toString("hex").toUpperCase();
}

// Money is DECIMAL(10,2); keep two-decimal precision and reject drift from
// float subtraction before it can be written back as a balance.
function roundMoney(value) {
    return Math.round(value * 100) / 100;
}

function normalizeAmount(amount) {
    const value = Number(amount);

    if (!Number.isFinite(value) || value <= 0) {
        throw new GiftCardError("Amount must be a positive number", "INVALID_AMOUNT");
    }

    return roundMoney(value);
}

function isExpired(giftCard, now) {
    if (giftCard.expires_at === null || giftCard.expires_at === undefined) {
        return false;
    }

    return new Date(giftCard.expires_at).getTime() <= now.getTime();
}

// Insert the card + its opening 'issue' ledger row. MUST run inside a
// transaction on `conn` so the card and its ledger never diverge.
async function issueInTransaction(conn, { amount, currency, expiresAt }, now) {
    const code = generateCode();
    const codeHash = hashCode(code);

    const [result] = await conn.query(
        "INSERT INTO gift_cards (code_hash, balance, currency, status, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [codeHash, amount, currency, GIFT_CARD_STATUS.ACTIVE, expiresAt, now, now]
    );

    const giftCardId = result.insertId;

    await conn.query(
        "INSERT INTO gift_card_transactions (gift_card_id, order_id, type, amount, balance_after, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        [giftCardId, null, TRANSACTION_TYPE.ISSUE, amount, amount, now]
    );

    return {
        id: giftCardId,
        code,
        balance: amount,
        currency,
        status: GIFT_CARD_STATUS.ACTIVE,
        expiresAt
    };
}

// Check-then-decrement guarded by `SELECT ... FOR UPDATE`. This MUST run inside
// a transaction on `conn`: the row lock only serializes concurrent redemptions
// while the surrounding transaction is open, which is what closes the
// double-spend race. Validation throws BEFORE any write, so a rejected redeem
// leaves the balance untouched and writes no ledger row.
/**
 * Take the row lock and run every check that does not depend on the amount.
 *
 * Split out of `redeemInTransaction` so a caller can see the balance before
 * deciding what to redeem -- `applyToOrder` pays "as much as this card can
 * cover", which is not a number anyone can know until the card is locked and
 * read. The lock is held either way, so nothing can move between this and the
 * decrement.
 */
async function lockAndValidateCard(conn, codeHash, now) {
    const [rows] = await conn.query(
        "SELECT id, balance, currency, status, expires_at FROM gift_cards WHERE code_hash = ? FOR UPDATE",
        [codeHash]
    );

    const giftCard = rows[0];

    if (!giftCard) {
        throw new GiftCardError("Gift card not found", "NOT_FOUND");
    }

    if (giftCard.status !== GIFT_CARD_STATUS.ACTIVE) {
        throw new GiftCardError("Gift card is not active", "INACTIVE");
    }

    if (isExpired(giftCard, now)) {
        throw new GiftCardError("Gift card has expired", "EXPIRED");
    }

    // The store prices in one currency. A card labelled in another cannot be
    // subtracted from an order total without choosing an exchange rate, and
    // there is none to choose -- so it is refused rather than applied 1:1.
    if (giftCard.currency !== CURRENCY.code) {
        throw new GiftCardError(
            `This gift card is issued in ${giftCard.currency} and cannot be used here`,
            "CURRENCY_MISMATCH"
        );
    }

    return giftCard;
}

async function redeemInTransaction(conn, codeHash, amount, orderId, now, lockedCard = null) {
    const giftCard = lockedCard || (await lockAndValidateCard(conn, codeHash, now));

    const balance = Number(giftCard.balance);

    if (amount > balance) {
        throw new GiftCardError("Insufficient gift card balance", "INSUFFICIENT_BALANCE");
    }

    const balanceAfter = roundMoney(balance - amount);
    const status = balanceAfter === 0 ? GIFT_CARD_STATUS.REDEEMED : GIFT_CARD_STATUS.ACTIVE;

    await conn.query(
        "UPDATE gift_cards SET balance = ?, status = ?, updated_at = ? WHERE id = ?",
        [balanceAfter, status, now, giftCard.id]
    );

    const [result] = await conn.query(
        "INSERT INTO gift_card_transactions (gift_card_id, order_id, type, amount, balance_after, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        [giftCard.id, orderId, TRANSACTION_TYPE.REDEEM, amount, balanceAfter, now]
    );

    return {
        giftCardId: giftCard.id,
        transactionId: result.insertId,
        amount,
        balanceAfter,
        currency: giftCard.currency,
        status
    };
}

// Shared redeem/applyToOrder body: run inside the caller's transaction when one
// is supplied, otherwise own the transaction so FOR UPDATE actually locks.
async function runRedemption(code, amount, orderId, connection) {
    const value = normalizeAmount(amount);
    const codeHash = hashCode(code);
    const now = new Date();

    if (connection) {
        return redeemInTransaction(connection, codeHash, value, orderId, now);
    }

    const conn = await promisePool.getConnection();
    try {
        await conn.beginTransaction();
        const result = await redeemInTransaction(conn, codeHash, value, orderId, now);
        await conn.commit();
        return result;
    } catch (error) {
        await conn.rollback();
        throw error;
    } finally {
        conn.release();
    }
}

/**
 * Load and lock the order a card is about to pay towards, and establish that it
 * may.
 *
 * The order is locked before the card is. Both locks are always taken in that
 * direction, so two redemptions against one order cannot deadlock by each
 * holding what the other wants.
 *
 * `userId` is required. `authMiddleware` establishes who is calling; it does
 * not establish that this order is theirs, and the route had no second check --
 * so any authenticated caller could attach a redemption to any order id.
 *
 * @returns {{id: string, total: number, giftCardAmount: number, outstanding: number}}
 */
async function lockPayableOrder(conn, orderId, userId) {
    if (!userId) {
        throw new GiftCardError(
            "A gift card can only be redeemed against an order by its owner",
            "FORBIDDEN"
        );
    }

    const [rows] = await conn.query(
        `SELECT id, user_id, status, payment_status, total, gift_card_amount, deleted_at
           FROM orders
          WHERE id = ?
          LIMIT 1
          FOR UPDATE`,
        [orderId]
    );

    const order = rows[0];

    // One answer for "no such order" and "not yours". Telling them apart hands
    // an attacker a way to enumerate order ids, and this endpoint is reachable
    // by anyone with an account.
    if (!order || order.deleted_at || String(order.user_id) !== String(userId)) {
        throw new GiftCardError("Order not found", "ORDER_NOT_FOUND");
    }

    if (UNPAYABLE_ORDER_STATUSES.includes(order.status)) {
        throw new GiftCardError(
            `This order is ${order.status} and cannot be paid`,
            "ORDER_NOT_PAYABLE"
        );
    }

    if (!PAYABLE_PAYMENT_STATUSES.includes(order.payment_status)) {
        throw new GiftCardError(
            `This order is already ${order.payment_status}`,
            "ORDER_NOT_PAYABLE"
        );
    }

    const total = roundMoney(Number(order.total) || 0);
    const giftCardAmount = roundMoney(Number(order.gift_card_amount) || 0);
    const outstanding = roundMoney(total - giftCardAmount);

    if (outstanding <= 0) {
        throw new GiftCardError("This order has nothing left to pay", "ORDER_SETTLED");
    }

    return { id: order.id, total, giftCardAmount, outstanding };
}

/**
 * Record on the order what the card just paid, and settle it if that covers it.
 *
 * In the same transaction as the balance decrement, so the ledger and the order
 * cannot disagree about what was paid.
 */
async function settleOrder(conn, order, amount, now) {
    const paid = roundMoney(order.giftCardAmount + amount);
    const remaining = roundMoney(order.total - paid);

    await conn.query(
        `UPDATE orders
            SET gift_card_amount = ?,
                payment_status   = ?,
                updated_at       = ?
          WHERE id = ?`,
        [paid, remaining <= 0 ? "paid" : "pending", now, order.id]
    );

    return { giftCardAmount: paid, outstanding: Math.max(remaining, 0) };
}

const giftCardService = {
    // Issue a new gift card. Returns the plaintext `code` — this is the only
    // time it is available, since only its hash is stored.
    // `currency` defaults to the store's, not to a hardcoded "USD". The store
    // prices in one currency and declares it in config/currency.js; a card
    // issued in anything else cannot be redeemed here (#1478).
    issue: async ({ amount, currency = CURRENCY.code, expiresAt = null }, connection = null) => {
        const value = normalizeAmount(amount);
        const now = new Date();
        const expiresAtDate = expiresAt ? new Date(expiresAt) : null;
        const params = { amount: value, currency, expiresAt: expiresAtDate };

        if (connection) {
            return issueInTransaction(connection, params, now);
        }

        const conn = await promisePool.getConnection();
        try {
            await conn.beginTransaction();
            const result = await issueInTransaction(conn, params, now);
            await conn.commit();
            return result;
        } catch (error) {
            await conn.rollback();
            throw error;
        } finally {
            conn.release();
        }
    },

    // Read-only balance lookup by plaintext code. No lock is needed.
    getBalance: async (code, connection = null) => {
        const pool = connection || promisePool;
        const codeHash = hashCode(code);

        const [rows] = await pool.query(
            "SELECT balance, currency, status, expires_at FROM gift_cards WHERE code_hash = ? LIMIT 1",
            [codeHash]
        );

        const giftCard = rows[0];

        if (!giftCard) {
            throw new GiftCardError("Gift card not found", "NOT_FOUND");
        }

        // Status is derived, not read back verbatim.
        //
        // Nothing sweeps `expires_at` into the `status` column -- no job, no
        // trigger, no migration -- so a card past its expiry still reads
        // `active` with its full balance, right up until the customer tries to
        // spend it and gets a 410. `redeemInTransaction` has always applied
        // `isExpired`; this is the same rule, applied where the customer can see
        // it (#1478).
        const expired = isExpired(giftCard, new Date());

        return {
            balance: Number(giftCard.balance),
            currency: giftCard.currency,
            status: expired ? GIFT_CARD_STATUS.EXPIRED : giftCard.status,
            expiresAt: giftCard.expires_at,
            // Whether it can be spent right now, which is the question a caller
            // is actually asking and one that four statuses plus an expiry date
            // make them re-derive.
            redeemable:
                !expired
                && giftCard.status === GIFT_CARD_STATUS.ACTIVE
                && giftCard.currency === CURRENCY.code
                && Number(giftCard.balance) > 0
        };
    },

    // Redeem `amount` off a card's balance, tied to nothing.
    //
    // Deliberately not reachable from the customer route any more: a redemption
    // that names no order settles nothing, cannot be reconciled, and is
    // indistinguishable from one that was later refunded. It stays here for
    // administrative correction and because `applyToOrder` is built on it.
    //
    // Atomic; safe against concurrent double-spend via the FOR UPDATE row lock
    // inside the transaction.
    redeem: async (code, amount, connection = null) => {
        return runRedemption(code, amount, null, connection);
    },

    /**
     * Pay part or all of an order with a gift card.
     *
     * What this used to do: write `orderId` into the ledger row and nothing
     * else. The order was never read, so any authenticated caller could attach a
     * redemption to any order id -- and even in the honest case the order total
     * was untouched, so the customer's balance was spent and they were still
     * charged in full (#1478).
     *
     * Now the order is loaded and locked first, the caller must own it, it must
     * still be payable, and the amount is clamped to what is outstanding on it.
     * The order is settled in the same transaction as the balance decrement, so
     * the ledger and the order cannot disagree about what was paid.
     *
     * `amount` is optional. Omitted, it means "as much as this card can cover",
     * which is what a customer paying with a gift card almost always wants and
     * what they would otherwise have to compute themselves.
     *
     * @param {string} code
     * @param {string} orderId
     * @param {number|null} amount
     * @param {object|null} connection Caller-owned transaction, for checkout.
     * @param {{userId: string}} options
     */
    applyToOrder: async (code, orderId, amount, connection = null, { userId } = {}) => {
        const run = async (conn) => {
            // Order first, then card -- always this direction, so two
            // redemptions against one order cannot deadlock by each holding what
            // the other is waiting for.
            const order = await lockPayableOrder(conn, orderId, userId);

            const now = new Date();
            const codeHash = hashCode(code);

            // The card is locked and read before the amount is decided, because
            // an omitted amount means "as much as this card can cover" and that
            // is not a number anyone can know until the balance is in hand. The
            // lock is held from here through the decrement either way.
            const card = await lockAndValidateCard(conn, codeHash, now);
            const cardBalance = roundMoney(Number(card.balance) || 0);

            // Clamped, not merely validated. A caller asking for more than is
            // owed is asking to overpay, and the answer is to take what is owed
            // rather than to refuse -- the balance is theirs and so is the
            // order. An explicit amount larger than the card holds is still an
            // error, though: that is the caller being wrong about their own
            // balance, and silently taking less would hide it.
            const toRedeem = amount === undefined || amount === null
                ? roundMoney(Math.min(order.outstanding, cardBalance))
                : roundMoney(Math.min(normalizeAmount(amount), order.outstanding));

            if (toRedeem <= 0) {
                throw new GiftCardError(
                    "This gift card has no balance left to apply",
                    "INSUFFICIENT_BALANCE"
                );
            }

            const redemption = await redeemInTransaction(
                conn,
                codeHash,
                toRedeem,
                orderId,
                now,
                card
            );
            const settlement = await settleOrder(conn, order, toRedeem, now);

            return {
                ...redemption,
                orderId,
                orderTotal: order.total,
                orderPaidByGiftCards: settlement.giftCardAmount,
                orderOutstanding: settlement.outstanding,
                orderSettled: settlement.outstanding <= 0
            };
        };

        if (connection) {
            return run(connection);
        }

        const conn = await promisePool.getConnection();
        try {
            await conn.beginTransaction();
            const result = await run(conn);
            await conn.commit();
            return result;
        } catch (error) {
            await conn.rollback();
            throw error;
        } finally {
            conn.release();
        }
    }
};

giftCardService.GiftCardError = GiftCardError;
giftCardService.GIFT_CARD_STATUS = GIFT_CARD_STATUS;
giftCardService.TRANSACTION_TYPE = TRANSACTION_TYPE;
giftCardService.hashCode = hashCode;

module.exports = giftCardService;
