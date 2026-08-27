'use strict';

/**
 * `coupons` and `promo_codes` are independent tables whose INT AUTO_INCREMENT
 * ids overlap from 1. Recording a redemption by id alone therefore wrote to
 * whichever table the caller happened to assume, and a coupon redemption was
 * burning an unrelated promo's budget.
 *
 * These tests pin down which ledger each kind of redemption reaches.
 */

jest.mock('../config/db', () => ({ query: jest.fn() }));
jest.mock('../utils/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
}));

const logger = require('../utils/logger');
const discountUsage = require('../services/discountUsageService');

function makeConnection({ failOn = null } = {}) {
    const statements = [];

    return {
        statements,
        query: jest.fn(async (sql, params) => {
            const normalized = String(sql).replace(/\s+/g, ' ').trim();
            statements.push({ sql: normalized, params });

            if (failOn && failOn.test(normalized)) {
                throw new Error('simulated database failure');
            }

            if (/SELECT id FROM coupons/i.test(normalized)) {
                return [[{ id: 42 }]];
            }

            return [[]];
        }),
        touched(pattern) {
            return statements.some((s) => pattern.test(s.sql));
        }
    };
}

const couponRow = { id: 3, code: 'SAVE20', type: 'percent', value: 20, isPromoTable: false };
const promoRow = { id: 3, code: 'PROMO10', discount_type: 'percentage', discount_value: 10 };

beforeEach(() => {
    jest.clearAllMocks();
});

describe('resolveDiscountSource', () => {
    it('trusts an explicitly declared source over anything inferred', () => {
        expect(
            discountUsage.resolveDiscountSource(promoRow, discountUsage.SOURCE_COUPONS)
        ).toBe(discountUsage.SOURCE_COUPONS);
    });

    it('reads the isPromoTable flag couponService already reports', () => {
        expect(discountUsage.resolveDiscountSource({ isPromoTable: true })).toBe(
            discountUsage.SOURCE_PROMO_CODES
        );
        expect(discountUsage.resolveDiscountSource({ isPromoTable: false })).toBe(
            discountUsage.SOURCE_COUPONS
        );
    });

    it('infers promo_codes from columns that only promo rows carry', () => {
        expect(discountUsage.resolveDiscountSource({ discount_type: 'fixed' })).toBe(
            discountUsage.SOURCE_PROMO_CODES
        );
        expect(discountUsage.resolveDiscountSource({ discount_value: 5 })).toBe(
            discountUsage.SOURCE_PROMO_CODES
        );
    });

    it('returns null rather than guessing when there is nothing to go on', () => {
        expect(discountUsage.resolveDiscountSource(null)).toBeNull();
        expect(discountUsage.resolveDiscountSource({})).toBeNull();
        expect(discountUsage.resolveDiscountSource('SAVE20')).toBeNull();
        expect(discountUsage.resolveDiscountSource({}, 'nonsense')).toBeNull();
    });
});

describe('recordDiscountUsage - coupons-table redemption', () => {
    it('never touches promo_codes', async () => {
        const connection = makeConnection();

        await discountUsage.recordDiscountUsage(connection, {
            promo: couponRow,
            source: discountUsage.SOURCE_COUPONS,
            discountId: 3,
            discountCode: 'SAVE20',
            userId: 'user-1',
            orderId: 'order-1',
            discountAmount: 200
        });

        expect(connection.touched(/UPDATE promo_codes/i)).toBe(false);
        expect(connection.touched(/INSERT INTO promo_usage/i)).toBe(false);
    });

    it('bumps coupons.used_count for the redeemed row', async () => {
        const connection = makeConnection();

        await discountUsage.recordDiscountUsage(connection, {
            promo: couponRow,
            source: discountUsage.SOURCE_COUPONS,
            discountId: 3,
            discountCode: 'SAVE20',
            userId: 'user-1',
            orderId: 'order-1',
            discountAmount: 200
        });

        const update = connection.statements.find((s) => /UPDATE coupons SET used_count/i.test(s.sql));
        expect(update).toBeDefined();
        expect(update.params).toEqual([3]);
    });

    it('reports the source it wrote to', async () => {
        const connection = makeConnection();

        const source = await discountUsage.recordDiscountUsage(connection, {
            promo: couponRow,
            discountId: 3,
            discountCode: 'SAVE20',
            orderId: 'order-1'
        });

        expect(source).toBe(discountUsage.SOURCE_COUPONS);
    });
});

describe('recordDiscountUsage - promo_codes redemption', () => {
    it('increments promo_codes and files a promo_usage row', async () => {
        const connection = makeConnection();

        await discountUsage.recordDiscountUsage(connection, {
            promo: promoRow,
            source: discountUsage.SOURCE_PROMO_CODES,
            discountId: 3,
            discountCode: 'PROMO10',
            userId: 'user-9',
            orderId: 'order-2',
            discountAmount: 100
        });

        const update = connection.statements.find((s) => /UPDATE promo_codes/i.test(s.sql));
        expect(update).toBeDefined();
        expect(update.params).toEqual([3]);

        const insert = connection.statements.find((s) => /INSERT INTO promo_usage/i.test(s.sql));
        expect(insert).toBeDefined();
        expect(insert.params[0]).toBe(3);
        expect(insert.params[2]).toBe('order-2');
        expect(insert.params[3]).toBe(100);
    });

    it('never touches the coupons ledger', async () => {
        const connection = makeConnection();

        await discountUsage.recordDiscountUsage(connection, {
            promo: promoRow,
            source: discountUsage.SOURCE_PROMO_CODES,
            discountId: 3,
            discountCode: 'PROMO10',
            userId: 'user-9',
            orderId: 'order-2',
            discountAmount: 100
        });

        expect(connection.touched(/UPDATE coupons/i)).toBe(false);
        expect(connection.touched(/INSERT INTO coupon_usage/i)).toBe(false);
    });

    it('skips the per-account row for a guest but still bumps the counter', async () => {
        const connection = makeConnection();

        await discountUsage.recordDiscountUsage(connection, {
            promo: promoRow,
            source: discountUsage.SOURCE_PROMO_CODES,
            discountId: 3,
            discountCode: 'PROMO10',
            userId: null,
            orderId: 'order-3',
            discountAmount: 50
        });

        expect(connection.touched(/UPDATE promo_codes/i)).toBe(true);
        expect(connection.touched(/INSERT INTO promo_usage/i)).toBe(false);
    });
});

describe('recordDiscountUsage - failure handling', () => {
    it('does not reject when the counter update fails', async () => {
        const connection = makeConnection({ failOn: /UPDATE promo_codes/i });

        await expect(
            discountUsage.recordDiscountUsage(connection, {
                promo: promoRow,
                source: discountUsage.SOURCE_PROMO_CODES,
                discountId: 3,
                discountCode: 'PROMO10',
                userId: 'user-9',
                orderId: 'order-4',
                discountAmount: 10
            })
        ).resolves.toBe(discountUsage.SOURCE_PROMO_CODES);

        expect(logger.error).toHaveBeenCalled();
    });

    it('logs the failure instead of swallowing it silently', async () => {
        const connection = makeConnection({ failOn: /INSERT INTO promo_usage/i });

        await discountUsage.recordDiscountUsage(connection, {
            promo: promoRow,
            source: discountUsage.SOURCE_PROMO_CODES,
            discountId: 3,
            discountCode: 'PROMO10',
            userId: 'user-9',
            orderId: 'order-5',
            discountAmount: 10
        });

        const messages = logger.error.mock.calls.map((call) => String(call[0]));
        expect(messages.some((m) => /promo_usage/i.test(m))).toBe(true);
    });

    it('writes nothing at all when the source cannot be attributed', async () => {
        const connection = makeConnection();

        const source = await discountUsage.recordDiscountUsage(connection, {
            promo: { id: 3, code: 'MYSTERY' },
            discountId: 3,
            discountCode: 'MYSTERY',
            userId: 'user-1',
            orderId: 'order-6',
            discountAmount: 25
        });

        expect(source).toBeNull();
        expect(connection.statements).toHaveLength(0);
        expect(logger.warn).toHaveBeenCalled();
    });

    it('is a no-op with neither an id nor a code', async () => {
        const connection = makeConnection();

        const source = await discountUsage.recordDiscountUsage(connection, {
            promo: promoRow,
            source: discountUsage.SOURCE_PROMO_CODES,
            orderId: 'order-7'
        });

        expect(source).toBeNull();
        expect(connection.statements).toHaveLength(0);
    });

    it('is a no-op without a connection', async () => {
        await expect(
            discountUsage.recordDiscountUsage(null, {
                discountId: 3,
                source: discountUsage.SOURCE_PROMO_CODES
            })
        ).resolves.toBeNull();
    });
});

describe('order.service wiring', () => {
    const source = require('fs').readFileSync(
        require('path').join(__dirname, '..', 'services', 'order.service.js'),
        'utf8'
    );

    it('no longer writes to promo_codes or promo_usage directly', () => {
        expect(source).not.toMatch(/UPDATE promo_codes SET usage_count/);
        expect(source).not.toMatch(/INSERT INTO promo_usage/);
    });

    it('routes redemptions through the usage service with a source', () => {
        expect(source).toMatch(/discountUsage\.recordDiscountUsage\(/);
        expect(source).toMatch(/source:\s*appliedPromoSource/);
    });

    it('derives the source from the validator rather than from the id', () => {
        expect(source).toMatch(/couponVal\.coupon\.isPromoTable/);
    });
});
