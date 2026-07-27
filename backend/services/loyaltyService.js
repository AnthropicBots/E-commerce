// backend/services/loyaltyService.js
const db = require('../config/db');

// ============================================
// LOYALTY CONFIGURATION
// ============================================

// Points earned per unit of order value.
const EARN_RATE = 1;

// Currency value of a single point when redeemed (100 points => 1.00).
const REDEEM_RATE = 0.01;

const TIER_THRESHOLDS = [
    { tier: 'Platinum', minLifetimePoints: 50000 },
    { tier: 'Gold', minLifetimePoints: 10000 },
    { tier: 'Silver', minLifetimePoints: 2000 },
    { tier: 'Bronze', minLifetimePoints: 0 }
];

const TRANSACTION_TYPE = {
    EARN: 'earn',
    REDEEM: 'redeem',
    EXPIRE: 'expire',
    ADJUST: 'adjust'
};

// Thrown when a redemption exceeds the available balance. The `code` lets
// the HTTP layer map this to a 400 without string-matching the message.
class InsufficientPointsError extends Error {
    constructor(message) {
        super(message);
        this.name = 'InsufficientPointsError';
        this.code = 'INSUFFICIENT_POINTS';
    }
}

// ============================================
// LOYALTY SERVICE
// ============================================

class LoyaltyService {
    constructor() {
        this.isInitialized = false;
    }

    async initialize() {
        if (this.isInitialized) return this;

        this.isInitialized = true;
        console.log('✅ Loyalty service initialized');
        return this;
    }

    /**
     * Fetch a user's loyalty account, creating a Bronze account on first use.
     */
    async getOrCreateAccount(userId) {
        if (!userId) {
            throw new Error('userId is required');
        }

        const [existing] = await db.query(
            'SELECT * FROM loyalty_accounts WHERE user_id = ?',
            [userId]
        );
        if (existing.length > 0) {
            return existing[0];
        }

        await db.query(
            `INSERT INTO loyalty_accounts (user_id, points_balance, lifetime_points, tier)
             VALUES (?, 0, 0, 'Bronze')
             ON DUPLICATE KEY UPDATE user_id = user_id`,
            [userId]
        );

        const [created] = await db.query(
            'SELECT * FROM loyalty_accounts WHERE user_id = ?',
            [userId]
        );
        return created[0];
    }

    /**
     * Award points for an order. Writes the ledger row and updates the
     * balance atomically under a row lock so concurrent awards can't race.
     */
    async award(userId, { orderId = null, amount, reason = 'Points earned' } = {}) {
        if (!userId) {
            throw new Error('userId is required');
        }

        const orderValue = Number(amount);
        if (!Number.isFinite(orderValue) || orderValue <= 0) {
            throw new Error('amount must be a positive number');
        }

        const pointsToAward = Math.floor(orderValue * EARN_RATE);

        const connection = await db.getConnection();
        try {
            await db.beginTransaction(connection);

            await connection.query(
                `INSERT INTO loyalty_accounts (user_id, points_balance, lifetime_points, tier)
                 VALUES (?, 0, 0, 'Bronze')
                 ON DUPLICATE KEY UPDATE user_id = user_id`,
                [userId]
            );

            const [rows] = await connection.query(
                'SELECT * FROM loyalty_accounts WHERE user_id = ? FOR UPDATE',
                [userId]
            );
            const account = rows[0];

            const newBalance = account.points_balance + pointsToAward;
            const newLifetime = account.lifetime_points + pointsToAward;
            const tier = this._computeTier(newLifetime);

            await connection.query(
                `UPDATE loyalty_accounts
                 SET points_balance = ?, lifetime_points = ?, tier = ?
                 WHERE user_id = ?`,
                [newBalance, newLifetime, tier, userId]
            );

            await connection.query(
                `INSERT INTO loyalty_transactions
                 (user_id, order_id, type, points, balance_after, reason, metadata)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [
                    userId,
                    orderId,
                    TRANSACTION_TYPE.EARN,
                    pointsToAward,
                    newBalance,
                    reason,
                    JSON.stringify({ orderValue, earnRate: EARN_RATE })
                ]
            );

            await db.commitTransaction(connection);

            return { pointsAwarded: pointsToAward, balance: newBalance, tier };
        } catch (error) {
            await db.rollbackTransaction(connection);
            throw error;
        } finally {
            connection.release();
        }
    }

    /**
     * Redeem points for a discount. Validates the balance under a row lock and
     * throws InsufficientPointsError when the request exceeds what's available.
     */
    async redeem(userId, { points, reason = 'Points redeemed' } = {}) {
        if (!userId) {
            throw new Error('userId is required');
        }

        const pointsToRedeem = Number(points);
        if (!Number.isInteger(pointsToRedeem) || pointsToRedeem <= 0) {
            throw new Error('points must be a positive integer');
        }

        const connection = await db.getConnection();
        try {
            await db.beginTransaction(connection);

            const [rows] = await connection.query(
                'SELECT * FROM loyalty_accounts WHERE user_id = ? FOR UPDATE',
                [userId]
            );
            const available = rows.length > 0 ? rows[0].points_balance : 0;

            if (pointsToRedeem > available) {
                throw new InsufficientPointsError(
                    `Insufficient points: requested ${pointsToRedeem} but only ${available} available`
                );
            }

            const newBalance = available - pointsToRedeem;
            const discountValue = Number((pointsToRedeem * REDEEM_RATE).toFixed(2));

            await connection.query(
                'UPDATE loyalty_accounts SET points_balance = ? WHERE user_id = ?',
                [newBalance, userId]
            );

            await connection.query(
                `INSERT INTO loyalty_transactions
                 (user_id, order_id, type, points, balance_after, reason, metadata)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [
                    userId,
                    null,
                    TRANSACTION_TYPE.REDEEM,
                    -pointsToRedeem,
                    newBalance,
                    reason,
                    JSON.stringify({ discountValue, redeemRate: REDEEM_RATE })
                ]
            );

            await db.commitTransaction(connection);

            return { pointsRedeemed: pointsToRedeem, discountValue, balance: newBalance };
        } catch (error) {
            await db.rollbackTransaction(connection);
            throw error;
        } finally {
            connection.release();
        }
    }

    async getBalance(userId) {
        const account = await this.getOrCreateAccount(userId);
        return {
            balance: account.points_balance,
            lifetimePoints: account.lifetime_points,
            tier: account.tier
        };
    }

    async getHistory(userId, { limit = 50, offset = 0 } = {}) {
        if (!userId) {
            throw new Error('userId is required');
        }

        const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
        const safeOffset = Math.max(parseInt(offset, 10) || 0, 0);

        const [rows] = await db.query(
            `SELECT * FROM loyalty_transactions
             WHERE user_id = ?
             ORDER BY created_at DESC, id DESC
             LIMIT ? OFFSET ?`,
            [userId, safeLimit, safeOffset]
        );

        return { transactions: rows, limit: safeLimit, offset: safeOffset };
    }

    _computeTier(lifetimePoints) {
        for (const { tier, minLifetimePoints } of TIER_THRESHOLDS) {
            if (lifetimePoints >= minLifetimePoints) {
                return tier;
            }
        }
        return 'Bronze';
    }
}

// ============================================
// EXPORT
// ============================================

module.exports = {
    LoyaltyService,
    InsufficientPointsError,
    EARN_RATE,
    REDEEM_RATE,
    loyaltyService: new LoyaltyService()
};
