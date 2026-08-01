// backend/services/loyaltyService.js
//
// Loyalty & Reward Points program (#1232).
//   - PR 1/3: append-only ledger (`loyalty_transactions`) + running account
//     balance (`loyalty_accounts`). Every balance write is transactional so the
//     ledger row and the account snapshot can never diverge.
//   - PR 2/3: earn/redeem/getBalance/getHistory surface consumed by the REST API.
//   - PR 3/3 (primary): the tier engine. `award` multiplies base points by the
//     account's current tier multiplier, then recomputes and persists the tier
//     within the same transaction. `adjust` lets admins write a signed ledger row.
//
// The DB module (config/db) exposes a mysql2 promise pool; write paths grab a
// dedicated connection so START TRANSACTION / SELECT ... FOR UPDATE actually
// serialize concurrent earns/redeems against the same account.

const db = require('../config/db');
const EventEmitter = require('events');

// Base points earned per unit of order amount, before the tier multiplier.
const EARN_RATE = 1;

// Cash value of one point when redeemed (100 points => 1.00 currency unit).
const REDEEM_RATE = 0.01;

// Tier ladder, ascending by lifetime-points threshold. The multiplier is applied
// to base earned points, so higher tiers accrue points faster. This constant is
// authoritative at runtime; `loyalty_tiers` mirrors it for reporting.
const TIERS = [
    {
        name: 'Bronze',
        minLifetimePoints: 0,
        multiplier: 1.0,
        benefits: ['Standard earn rate']
    },
    {
        name: 'Silver',
        minLifetimePoints: 1000,
        multiplier: 1.25,
        benefits: ['1.25x points', 'Early sale access']
    },
    {
        name: 'Gold',
        minLifetimePoints: 5000,
        multiplier: 1.5,
        benefits: ['1.5x points', 'Free shipping', 'Priority support']
    },
    {
        name: 'Platinum',
        minLifetimePoints: 20000,
        multiplier: 2.0,
        benefits: ['2x points', 'Free shipping', 'Dedicated concierge']
    }
];

const BASE_TIER = TIERS[0].name;

class LoyaltyService extends EventEmitter {
    constructor() {
        super();
        this.isInitialized = false;
    }

    /**
     * Seed the loyalty_tiers reference table from the TIERS ladder. Idempotent
     * and non-fatal: a missing DB at boot must not crash bootstrap, matching the
     * other background services.
     */
    async initialize() {
        if (this.isInitialized) return this;

        try {
            for (const tier of TIERS) {
                await db.query(
                    `INSERT INTO loyalty_tiers (name, min_lifetime_points, multiplier, benefits)
                     VALUES (?, ?, ?, ?)
                     ON DUPLICATE KEY UPDATE
                        min_lifetime_points = VALUES(min_lifetime_points),
                        multiplier = VALUES(multiplier),
                        benefits = VALUES(benefits)`,
                    [tier.name, tier.minLifetimePoints, tier.multiplier, JSON.stringify(tier.benefits)]
                );
            }
            console.log(`✅ Loyalty service initialized (${TIERS.length} tiers)`);
        } catch (error) {
            console.error('Loyalty tier seed error:', error.message);
        }

        this.isInitialized = true;
        return this;
    }

    /**
     * Resolve the tier for a given lifetime-points total. Returns the highest
     * tier whose threshold is met.
     */
    computeTier(lifetimePoints) {
        const points = Number(lifetimePoints) || 0;
        let resolved = TIERS[0];
        for (const tier of TIERS) {
            if (points >= tier.minLifetimePoints) {
                resolved = tier;
            }
        }
        return resolved;
    }

    /**
     * Fetch a user's account, creating it (Bronze, zero balance) on first touch.
     */
    async getOrCreateAccount(userId, connection = null) {
        return this._withTransaction(connection, (conn) =>
            this._getOrCreateAccountTx(conn, userId)
        );
    }

    /**
     * Credit points for an order. Base points (amount * EARN_RATE) are scaled by
     * the account's CURRENT tier multiplier, then balance/lifetime are updated,
     * the tier is recomputed against the new lifetime total, and an `earn` ledger
     * row is appended — all in one transaction.
     */
    async award(userId, { orderId = null, amount = 0, reason = 'order' } = {}, connection = null) {
        return this._withTransaction(connection, async (conn) => {
            const account = await this._getOrCreateAccountTx(conn, userId);

            const currentTier = this.computeTier(account.lifetime_points);
            const basePoints = Math.floor(Number(amount) * EARN_RATE);
            const earnedPoints = Math.floor(basePoints * currentTier.multiplier);

            const newBalance = account.points_balance + earnedPoints;
            const newLifetime = account.lifetime_points + earnedPoints;
            const newTier = this.computeTier(newLifetime);

            await conn.query(
                `UPDATE loyalty_accounts
                    SET points_balance = ?, lifetime_points = ?, tier = ?, updated_at = NOW()
                  WHERE user_id = ?`,
                [newBalance, newLifetime, newTier.name, userId]
            );

            await this._appendLedgerRow(conn, {
                userId,
                orderId,
                type: 'earn',
                points: earnedPoints,
                balanceAfter: newBalance,
                reason,
                metadata: {
                    amount: Number(amount),
                    basePoints,
                    multiplier: currentTier.multiplier,
                    tierAtEarn: currentTier.name
                }
            });

            const result = {
                pointsEarned: earnedPoints,
                balance: newBalance,
                lifetimePoints: newLifetime,
                tier: newTier.name,
                tierUpgraded: newTier.name !== currentTier.name
            };
            this.emit('loyalty.earned', { userId, ...result });
            return result;
        });
    }

    /**
     * Spend points for a discount. Validates sufficient balance and appends a
     * negative `redeem` ledger row. Lifetime points (and therefore tier) are not
     * reduced by redemption.
     */
    async redeem(userId, { points, reason = 'redeem' } = {}, connection = null) {
        const redeemPoints = Math.floor(Number(points));
        if (!Number.isFinite(redeemPoints) || redeemPoints <= 0) {
            throw new Error(`Invalid redeem amount: ${points}. Points to redeem must be a positive integer.`);
        }

        return this._withTransaction(connection, async (conn) => {
            const account = await this._getOrCreateAccountTx(conn, userId);

            if (redeemPoints > account.points_balance) {
                throw new Error(
                    `Insufficient points to redeem: requested ${redeemPoints}, available ${account.points_balance}.`
                );
            }

            const newBalance = account.points_balance - redeemPoints;

            await conn.query(
                `UPDATE loyalty_accounts
                    SET points_balance = ?, updated_at = NOW()
                  WHERE user_id = ?`,
                [newBalance, userId]
            );

            await this._appendLedgerRow(conn, {
                userId,
                orderId: null,
                type: 'redeem',
                points: -redeemPoints,
                balanceAfter: newBalance,
                reason,
                metadata: { discountValue: redeemPoints * REDEEM_RATE }
            });

            const result = {
                pointsRedeemed: redeemPoints,
                discountValue: redeemPoints * REDEEM_RATE,
                balance: newBalance
            };
            this.emit('loyalty.redeemed', { userId, ...result });
            return result;
        });
    }

    /**
     * Admin manual correction. Writes a signed `adjust` ledger row: positive
     * points also increase lifetime (and can promote the tier); negative points
     * only reduce the spendable balance, never the lifetime total.
     */
    async adjust(userId, { points, reason = 'admin adjustment' } = {}, connection = null) {
        const delta = Math.trunc(Number(points));
        if (!Number.isFinite(delta) || delta === 0) {
            throw new Error(`Invalid adjustment: ${points}. Points must be a non-zero integer.`);
        }

        return this._withTransaction(connection, async (conn) => {
            const account = await this._getOrCreateAccountTx(conn, userId);

            const newBalance = account.points_balance + delta;
            if (newBalance < 0) {
                throw new Error(
                    `Adjustment would drive balance negative: current ${account.points_balance}, delta ${delta}.`
                );
            }

            const newLifetime = delta > 0 ? account.lifetime_points + delta : account.lifetime_points;
            const newTier = this.computeTier(newLifetime);

            await conn.query(
                `UPDATE loyalty_accounts
                    SET points_balance = ?, lifetime_points = ?, tier = ?, updated_at = NOW()
                  WHERE user_id = ?`,
                [newBalance, newLifetime, newTier.name, userId]
            );

            await this._appendLedgerRow(conn, {
                userId,
                orderId: null,
                type: 'adjust',
                points: delta,
                balanceAfter: newBalance,
                reason,
                metadata: { adjustedBy: 'admin' }
            });

            const result = {
                pointsAdjusted: delta,
                balance: newBalance,
                lifetimePoints: newLifetime,
                tier: newTier.name
            };
            this.emit('loyalty.adjusted', { userId, ...result });
            return result;
        });
    }

    /**
     * Current balance snapshot (read-only, no transaction needed).
     */
    async getBalance(userId) {
        const [rows] = await db.query(
            `SELECT user_id, points_balance, lifetime_points, tier
               FROM loyalty_accounts
              WHERE user_id = ?`,
            [userId]
        );

        if (!rows || rows.length === 0) {
            return {
                userId,
                pointsBalance: 0,
                lifetimePoints: 0,
                tier: BASE_TIER
            };
        }

        const account = rows[0];
        return {
            userId: account.user_id,
            pointsBalance: account.points_balance,
            lifetimePoints: account.lifetime_points,
            tier: account.tier
        };
    }

    /**
     * Ledger rows for a user, newest first.
     *
     * Takes an options object rather than a bare `limit`. The previous
     * signature had no `offset` at all, so `/api/loyalty/history` could only
     * ever return the most recent page -- an account with more than 500 ledger
     * rows had no way to reach the rest of them. The total is returned
     * alongside the rows so the caller can render a pager without a second
     * round trip.
     *
     * A number is still accepted for backwards compatibility with any caller
     * that has not been updated.
     *
     * @param {string} userId
     * @param {{limit?: number, offset?: number}|number} [options]
     * @returns {Promise<{transactions: Array, total: number, limit: number, offset: number}>}
     */
    async getHistory(userId, options = {}) {
        const { limit, offset } =
            typeof options === 'number' ? { limit: options, offset: 0 } : options;

        const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 500);
        const safeOffset = Math.max(parseInt(offset, 10) || 0, 0);

        const [rows] = await db.query(
            `SELECT id, user_id, order_id, type, points, balance_after, reason, metadata, created_at
               FROM loyalty_transactions
              WHERE user_id = ?
              ORDER BY created_at DESC, id DESC
              LIMIT ? OFFSET ?`,
            [userId, safeLimit, safeOffset]
        );

        const [counts] = await db.query(
            'SELECT COUNT(*) AS total FROM loyalty_transactions WHERE user_id = ?',
            [userId]
        );

        return {
            transactions: rows || [],
            total: counts?.[0]?.total ?? 0,
            limit: safeLimit,
            offset: safeOffset
        };
    }

    /**
     * Current tier for a user, with the ladder position it maps to.
     */
    async getTier(userId) {
        const balance = await this.getBalance(userId);
        const tier = this.computeTier(balance.lifetimePoints);
        return {
            userId,
            lifetimePoints: balance.lifetimePoints,
            tier: tier.name,
            multiplier: tier.multiplier,
            benefits: tier.benefits
        };
    }

    /**
     * The full tier ladder (used by GET /tiers).
     */
    getTiers() {
        return TIERS.map((tier) => ({ ...tier }));
    }

    // ============================================
    // INTERNALS
    // ============================================

    /**
     * Run `fn(conn)` inside a transaction. If a caller supplies its own
     * connection (already in a transaction), reuse it and let the caller own
     * commit/rollback; otherwise open, commit, and release our own.
     */
    async _withTransaction(connection, fn) {
        if (connection) {
            return fn(connection);
        }

        const conn = await db.getConnection();
        try {
            await conn.beginTransaction();
            const result = await fn(conn);
            await conn.commit();
            return result;
        } catch (error) {
            await conn.rollback();
            throw error;
        } finally {
            conn.release();
        }
    }

    // Locks the account row FOR UPDATE so concurrent earns/redeems serialize on
    // the read-modify-write of the balance.
    async _getOrCreateAccountTx(conn, userId) {
        const [rows] = await conn.query(
            `SELECT * FROM loyalty_accounts WHERE user_id = ? FOR UPDATE`,
            [userId]
        );
        if (rows.length > 0) {
            return rows[0];
        }

        await conn.query(
            `INSERT INTO loyalty_accounts (user_id, points_balance, lifetime_points, tier)
             VALUES (?, 0, 0, ?)`,
            [userId, BASE_TIER]
        );

        const [created] = await conn.query(
            `SELECT * FROM loyalty_accounts WHERE user_id = ?`,
            [userId]
        );
        return created[0];
    }

    async _appendLedgerRow(conn, { userId, orderId, type, points, balanceAfter, reason, metadata }) {
        await conn.query(
            `INSERT INTO loyalty_transactions
                (user_id, order_id, type, points, balance_after, reason, metadata)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [userId, orderId, type, points, balanceAfter, reason, JSON.stringify(metadata || {})]
        );
    }
}

module.exports = {
    loyaltyService: new LoyaltyService(),
    LoyaltyService,
    EARN_RATE,
    REDEEM_RATE,
    TIERS
};
