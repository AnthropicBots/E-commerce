const crypto = require("crypto");
const promisePool = require("../config/db");

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
async function redeemInTransaction(conn, codeHash, amount, orderId, now) {
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

const giftCardService = {
    // Issue a new gift card. Returns the plaintext `code` — this is the only
    // time it is available, since only its hash is stored.
    issue: async ({ amount, currency = "USD", expiresAt = null }, connection = null) => {
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

        return {
            balance: Number(giftCard.balance),
            currency: giftCard.currency,
            status: giftCard.status,
            expiresAt: giftCard.expires_at
        };
    },

    // Redeem `amount` off a card's balance. Atomic; safe against concurrent
    // double-spend via the FOR UPDATE row lock inside the transaction.
    redeem: async (code, amount, connection = null) => {
        return runRedemption(code, amount, null, connection);
    },

    // Same as redeem, but ties the ledger row to an order. Accepts an optional
    // caller-owned `connection` so checkout can redeem inside its own
    // transaction (mirrors inventoryReservationService).
    applyToOrder: async (code, orderId, amount, connection = null) => {
        return runRedemption(code, amount, orderId, connection);
    }
};

giftCardService.GiftCardError = GiftCardError;
giftCardService.GIFT_CARD_STATUS = GIFT_CARD_STATUS;
giftCardService.TRANSACTION_TYPE = TRANSACTION_TYPE;
giftCardService.hashCode = hashCode;

module.exports = giftCardService;
