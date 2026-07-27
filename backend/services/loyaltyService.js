// backend/services/loyaltyService.js
//
// Loyalty & Reward Points — ledger core (issue #1232, PR 1/3).
//
// LEDGER IS THE SOURCE OF TRUTH.
// `loyalty_transactions` is an append-only ledger; every points change is one
// immutable row with a signed `points` value and a `balance_after` snapshot.
// `loyalty_accounts.points_balance` is only a cache of that ledger (the sum of
// a user's `points`), kept so reads don't have to aggregate the whole history.
//
// The danger with a cached balance is drift: if the ledger row is written but
// the cache update fails (or two concurrent earns/redeems interleave), the
// cache silently disagrees with the ledger. To make drift impossible, every
// write path here does BOTH the ledger append and the cache update inside a
// single DB transaction, with the account row locked FOR UPDATE so concurrent
// mutations serialize instead of racing on a stale read. A failure anywhere
// rolls the whole thing back, so the cache can never move without a matching
// ledger row and vice versa.

const db = require("../config/db");

// EARN_RATE: points granted per whole currency unit spent (1 unit -> 1 point).
// REDEEM_RATE: currency value of a single point when redeemed (100 pts -> 1.00).
const EARN_RATE = 1;
const REDEEM_RATE = 0.01;

// Ascending lifetime-points thresholds; the highest one a member clears is
// their tier. Kept here (not the DB) because it's program config, not data.
const TIER_THRESHOLDS = [
    ["Bronze", 0],
    ["Silver", 1000],
    ["Gold", 5000],
    ["Platinum", 20000],
];

const ENSURE_ACCOUNT_SQL =
    "INSERT INTO loyalty_accounts (user_id) VALUES (?) ON DUPLICATE KEY UPDATE user_id = user_id";

const INSERT_LEDGER_SQL =
    `INSERT INTO loyalty_transactions
        (user_id, order_id, type, points, balance_after, reason, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`;

class LoyaltyService {
    constructor() {
        this.isInitialized = false;
        this.tablePresent = false;
    }

    // Idempotent. Probes for the migration so callers can boot the service
    // before `loyalty_points.sql` has been applied without crashing.
    async initialize() {
        if (this.isInitialized) return this;
        try {
            await db.query("SELECT 1 FROM loyalty_accounts LIMIT 1");
            this.tablePresent = true;
            console.log("✅ Loyalty service initialized");
        } catch (error) {
            this.tablePresent = false;
            console.warn(`Loyalty tables not present yet, service is a no-op: ${error.message}`);
        }
        this.isInitialized = true;
        return this;
    }

    async getOrCreateAccount(userId) {
        await db.query(ENSURE_ACCOUNT_SQL, [userId]);
        const [rows] = await db.query(
            `SELECT user_id, points_balance, lifetime_points, tier, created_at, updated_at
             FROM loyalty_accounts WHERE user_id = ?`,
            [userId]
        );
        return rows[0];
    }

    // Grant points for a purchase. Ledger append + balance/lifetime bump happen
    // atomically; returns the new cached balance.
    async award(userId, { orderId = null, amount, reason = null } = {}) {
        const points = _earnedPoints(amount);

        const conn = await db.getConnection();
        try {
            await db.beginTransaction(conn);

            await conn.query(ENSURE_ACCOUNT_SQL, [userId]);
            const [rows] = await conn.query(
                "SELECT points_balance, lifetime_points FROM loyalty_accounts WHERE user_id = ? FOR UPDATE",
                [userId]
            );
            const { points_balance: balance, lifetime_points: lifetime } = rows[0];

            const newBalance = balance + points;
            const newLifetime = lifetime + points;
            const tier = _tierForLifetime(newLifetime);

            await conn.query(
                "UPDATE loyalty_accounts SET points_balance = ?, lifetime_points = ?, tier = ? WHERE user_id = ?",
                [newBalance, newLifetime, tier, userId]
            );
            await conn.query(INSERT_LEDGER_SQL, [
                userId,
                orderId,
                "earn",
                points,
                newBalance,
                reason,
                JSON.stringify({ amount, earnRate: EARN_RATE }),
            ]);

            await db.commitTransaction(conn);
            return newBalance;
        } catch (error) {
            await db.rollbackTransaction(conn);
            throw error;
        } finally {
            conn.release();
        }
    }

    // Spend points. Rejects (before any write) if the balance can't cover the
    // request, naming the exact shortfall. Ledger row is signed-negative.
    async redeem(userId, { points, reason = null } = {}) {
        if (!Number.isInteger(points) || points <= 0) {
            throw new Error(`redeem requires a positive integer points amount, got: ${points}`);
        }

        const conn = await db.getConnection();
        try {
            await db.beginTransaction(conn);

            await conn.query(ENSURE_ACCOUNT_SQL, [userId]);
            const [rows] = await conn.query(
                "SELECT points_balance FROM loyalty_accounts WHERE user_id = ? FOR UPDATE",
                [userId]
            );
            const balance = rows[0].points_balance;

            if (balance < points) {
                throw new Error(
                    `Insufficient loyalty points for user ${userId}: requested ${points}, ` +
                        `available ${balance}, short by ${points - balance}`
                );
            }

            const newBalance = balance - points;
            await conn.query(
                "UPDATE loyalty_accounts SET points_balance = ? WHERE user_id = ?",
                [newBalance, userId]
            );
            await conn.query(INSERT_LEDGER_SQL, [
                userId,
                null,
                "redeem",
                -points,
                newBalance,
                reason,
                JSON.stringify({ redeemRate: REDEEM_RATE }),
            ]);

            await db.commitTransaction(conn);
            return {
                pointsRedeemed: points,
                discountValue: points * REDEEM_RATE,
                balance: newBalance,
            };
        } catch (error) {
            await db.rollbackTransaction(conn);
            throw error;
        } finally {
            conn.release();
        }
    }

    async getBalance(userId) {
        const [rows] = await db.query(
            "SELECT points_balance FROM loyalty_accounts WHERE user_id = ?",
            [userId]
        );
        return rows.length > 0 ? rows[0].points_balance : 0;
    }

    async getHistory(userId, { limit = 50, offset = 0 } = {}) {
        const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 500));
        const safeOffset = Math.max(0, Number(offset) || 0);
        const [rows] = await db.query(
            `SELECT id, user_id, order_id, type, points, balance_after, reason, metadata, created_at
             FROM loyalty_transactions
             WHERE user_id = ?
             ORDER BY id DESC
             LIMIT ? OFFSET ?`,
            [userId, safeLimit, safeOffset]
        );
        return {
            userId,
            limit: safeLimit,
            offset: safeOffset,
            count: rows.length,
            transactions: rows,
        };
    }
}

function _earnedPoints(amount) {
    if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0) {
        throw new Error(`award requires a non-negative numeric amount, got: ${amount}`);
    }
    // Whole points only: fractional spend never rounds up into a free point.
    return Math.floor(amount * EARN_RATE);
}

function _tierForLifetime(lifetimePoints) {
    let tier = TIER_THRESHOLDS[0][0];
    for (const [name, minPoints] of TIER_THRESHOLDS) {
        if (lifetimePoints >= minPoints) tier = name;
    }
    return tier;
}

module.exports = {
    loyaltyService: new LoyaltyService(),
    LoyaltyService,
    EARN_RATE,
    REDEEM_RATE,
};
