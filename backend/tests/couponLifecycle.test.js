'use strict';

/**
 * Guards for the coupon lifecycle rules that validateCoupon used to skip:
 * start_date, deleted_at and per_user_limit.
 *
 * The service is exercised against a stub connection rather than a live
 * database so the tests describe the decision logic, which is where the
 * defects were, without needing MySQL in CI.
 */

jest.mock('../config/db', () => ({ query: jest.fn() }));

const couponService = require('../services/couponService');

/**
 * Build a stub connection that answers coupon lookups with `couponRow`,
 * redemption counts with `redemptions`, and records every statement it sees.
 */
function makeConnection({ couponRow = null, promoRow = null, redemptions = 0 } = {}) {
    const statements = [];

    return {
        statements,
        query: jest.fn(async (sql, params) => {
            statements.push({ sql: String(sql).replace(/\s+/g, ' ').trim(), params });

            if (/FROM coupons WHERE UPPER\(code\)/i.test(sql)) {
                return [couponRow ? [couponRow] : []];
            }

            if (/FROM promo_codes WHERE UPPER\(code\)/i.test(sql)) {
                return [promoRow ? [promoRow] : []];
            }

            if (/COUNT\(\*\) AS redemptions/i.test(sql)) {
                return [[{ redemptions }]];
            }

            return [[]];
        })
    };
}

function baseCoupon(overrides = {}) {
    return {
        id: 7,
        code: 'SAVE20',
        type: 'percent',
        value: 20,
        minimum_order_amount: 0,
        maximum_discount_amount: null,
        usage_limit: null,
        used_count: 0,
        per_user_limit: null,
        start_date: '2020-01-01 00:00:00',
        end_date: null,
        expires_at: null,
        is_active: 1,
        deleted_at: null,
        ...overrides
    };
}

function futureDate(days = 7) {
    return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

function pastDate(days = 7) {
    return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

describe('validateCoupon - campaign start date', () => {
    it('rejects a coupon whose start_date has not been reached', async () => {
        const connection = makeConnection({
            couponRow: baseCoupon({ start_date: futureDate(7) })
        });

        const result = await couponService.validateCoupon('SAVE20', 1000, null, connection);

        expect(result.valid).toBe(false);
        expect(result.message).toMatch(/not active yet/i);
    });

    it('accepts a coupon whose start_date has already passed', async () => {
        const connection = makeConnection({
            couponRow: baseCoupon({ start_date: pastDate(1) })
        });

        const result = await couponService.validateCoupon('SAVE20', 1000, null, connection);

        expect(result.valid).toBe(true);
        expect(result.coupon.discountAmount).toBe(200);
    });

    it('accepts a coupon with no start date at all', async () => {
        const connection = makeConnection({
            couponRow: baseCoupon({ start_date: null })
        });

        const result = await couponService.validateCoupon('SAVE20', 500, null, connection);

        expect(result.valid).toBe(true);
    });

    it('honours the starts_at and valid_from spellings', async () => {
        for (const column of ['starts_at', 'valid_from']) {
            const row = baseCoupon({ start_date: null });
            row[column] = futureDate(3);

            const connection = makeConnection({ couponRow: row });
            const result = await couponService.validateCoupon('SAVE20', 1000, null, connection);

            expect(result.valid).toBe(false);
            expect(result.message).toMatch(/not active yet/i);
        }
    });

    it('does not reject a live coupon because a date column is unparseable', async () => {
        const connection = makeConnection({
            couponRow: baseCoupon({ start_date: 'not-a-date', expires_at: 'also-garbage' })
        });

        const result = await couponService.validateCoupon('SAVE20', 1000, null, connection);

        expect(result.valid).toBe(true);
    });
});

describe('validateCoupon - soft deletion', () => {
    it('rejects a coupon with a deleted_at timestamp', async () => {
        const connection = makeConnection({
            couponRow: baseCoupon({ deleted_at: pastDate(2) })
        });

        const result = await couponService.validateCoupon('SAVE20', 1000, null, connection);

        expect(result.valid).toBe(false);
        expect(result.message).toMatch(/invalid coupon code/i);
    });

    it('still accepts a coupon whose deleted_at is null', async () => {
        const connection = makeConnection({ couponRow: baseCoupon({ deleted_at: null }) });

        const result = await couponService.validateCoupon('SAVE20', 1000, null, connection);

        expect(result.valid).toBe(true);
    });
});

describe('validateCoupon - per-account usage limit', () => {
    it('rejects a second redemption of a one-per-customer coupon', async () => {
        const connection = makeConnection({
            couponRow: baseCoupon({ per_user_limit: 1 }),
            redemptions: 1
        });

        const result = await couponService.validateCoupon('SAVE20', 1000, 'user-1', connection);

        expect(result.valid).toBe(false);
        expect(result.message).toMatch(/already used/i);
    });

    it('allows a redemption while the account is under the limit', async () => {
        const connection = makeConnection({
            couponRow: baseCoupon({ per_user_limit: 3 }),
            redemptions: 2
        });

        const result = await couponService.validateCoupon('SAVE20', 1000, 'user-1', connection);

        expect(result.valid).toBe(true);
    });

    it('reports the cap in the message when more than one use is allowed', async () => {
        const connection = makeConnection({
            couponRow: baseCoupon({ per_user_limit: 2 }),
            redemptions: 2
        });

        const result = await couponService.validateCoupon('SAVE20', 1000, 'user-1', connection);

        expect(result.valid).toBe(false);
        expect(result.message).toMatch(/2 times per account/i);
    });

    it('counts redemptions against coupon_usage for a coupons-table code', async () => {
        const connection = makeConnection({
            couponRow: baseCoupon({ per_user_limit: 1 }),
            redemptions: 0
        });

        await couponService.validateCoupon('SAVE20', 1000, 'user-1', connection);

        const countQuery = connection.statements.find((s) => /COUNT\(\*\) AS redemptions/i.test(s.sql));
        expect(countQuery).toBeDefined();
        expect(countQuery.sql).toContain('coupon_usage');
        expect(countQuery.sql).toContain('coupon_id');
    });

    it('counts redemptions against promo_usage for a promo_codes code', async () => {
        const connection = makeConnection({
            couponRow: null,
            promoRow: {
                id: 4,
                code: 'PROMO10',
                discount_type: 'percentage',
                discount_value: 10,
                usage_limit_per_user: 1,
                is_active: 1
            },
            redemptions: 0
        });

        await couponService.validateCoupon('PROMO10', 1000, 'user-1', connection);

        const countQuery = connection.statements.find((s) => /COUNT\(\*\) AS redemptions/i.test(s.sql));
        expect(countQuery).toBeDefined();
        expect(countQuery.sql).toContain('promo_usage');
        expect(countQuery.sql).toContain('promo_id');
    });

    it('skips the per-account check for a guest with no user id', async () => {
        const connection = makeConnection({
            couponRow: baseCoupon({ per_user_limit: 1 }),
            redemptions: 5
        });

        const result = await couponService.validateCoupon('SAVE20', 1000, null, connection);

        expect(result.valid).toBe(true);
        expect(connection.statements.some((s) => /COUNT\(\*\)/i.test(s.sql))).toBe(false);
    });

    it('treats a zero or negative cap as uncapped rather than locking everyone out', () => {
        expect(couponService.resolvePerUserLimit({ per_user_limit: 0 })).toBeNull();
        expect(couponService.resolvePerUserLimit({ per_user_limit: -1 })).toBeNull();
        expect(couponService.resolvePerUserLimit({})).toBeNull();
        expect(couponService.resolvePerUserLimit({ per_user_limit: 4 })).toBe(4);
        expect(couponService.resolvePerUserLimit({ usage_limit_per_user: 2 })).toBe(2);
    });

    it('does not block checkout when the ledger table is missing', async () => {
        const connection = {
            query: jest.fn(async (sql) => {
                if (/FROM coupons WHERE UPPER\(code\)/i.test(sql)) {
                    return [[baseCoupon({ per_user_limit: 1 })]];
                }
                if (/COUNT\(\*\)/i.test(sql)) {
                    throw new Error("Table 'shop.coupon_usage' doesn't exist");
                }
                return [[]];
            })
        };

        const result = await couponService.validateCoupon('SAVE20', 1000, 'user-1', connection);

        expect(result.valid).toBe(true);
    });
});

describe('recordCouponUsage - redemption ledger', () => {
    it('writes a coupon_usage row when the redeeming account is known', async () => {
        const connection = makeConnection({});

        await couponService.recordCouponUsage(connection, 7, 'SAVE20', {
            userId: 'user-1',
            orderId: 'order-1',
            discountAmount: 200
        });

        const insert = connection.statements.find((s) => /INSERT INTO coupon_usage/i.test(s.sql));
        expect(insert).toBeDefined();
        expect(insert.params).toEqual([7, 'user-1', 'order-1', 200]);
    });

    it('still bumps used_count for a guest but writes no ledger row', async () => {
        const connection = makeConnection({});

        await couponService.recordCouponUsage(connection, 7, 'SAVE20', { orderId: 'order-1' });

        expect(connection.statements.some((s) => /UPDATE coupons SET used_count/i.test(s.sql))).toBe(true);
        expect(connection.statements.some((s) => /INSERT INTO coupon_usage/i.test(s.sql))).toBe(false);
    });

    it('remains callable with the original three-argument signature', async () => {
        const connection = makeConnection({});

        await expect(couponService.recordCouponUsage(connection, 7, 'SAVE20')).resolves.toBeUndefined();
        expect(connection.statements.some((s) => /UPDATE coupons SET used_count/i.test(s.sql))).toBe(true);
    });

    it('resolves the coupon id from the code when only a code is supplied', async () => {
        const connection = makeConnection({ couponRow: baseCoupon() });

        await couponService.recordCouponUsage(connection, null, 'SAVE20', {
            userId: 'user-1',
            orderId: 'order-1',
            discountAmount: 50
        });

        const insert = connection.statements.find((s) => /INSERT INTO coupon_usage/i.test(s.sql));
        expect(insert).toBeDefined();
        expect(insert.params[0]).toBe(7);
    });

    it('swallows a ledger write failure so a paid order is never lost', async () => {
        const connection = {
            query: jest.fn(async (sql) => {
                if (/INSERT INTO coupon_usage/i.test(sql)) {
                    throw new Error('duplicate entry');
                }
                return [[]];
            })
        };

        await expect(
            couponService.recordCouponUsage(connection, 7, 'SAVE20', {
                userId: 'user-1',
                orderId: 'order-1',
                discountAmount: 10
            })
        ).resolves.toBeUndefined();
    });
});

describe('parseDate', () => {
    it('accepts Date instances, strings and rejects junk', () => {
        const now = new Date();
        expect(couponService.parseDate(now)).toBe(now);
        expect(couponService.parseDate('2024-01-01').getFullYear()).toBe(2024);
        expect(couponService.parseDate('')).toBeNull();
        expect(couponService.parseDate(null)).toBeNull();
        expect(couponService.parseDate(undefined)).toBeNull();
        expect(couponService.parseDate('nonsense')).toBeNull();
    });
});
