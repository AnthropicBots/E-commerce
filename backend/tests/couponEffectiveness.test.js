// backend/tests/couponEffectiveness.test.js
//
// Which table a coupon lives in, and whether the columns a query names exist
// (#1581).
//
// `GET /api/metrics/coupon-effectiveness` returned 500 on every call. The query
// read `c.discount_type`, `c.discount_value` and `c.usage_count` off `coupons`,
// and `coupons` (migrations/0001_baseline_schema.sql) names those columns
// `type`, `value` and `used_count`. There is no filter that avoids them:
// `c.usage_count > 0` is unconditional and the other two are in the select list
// and in the `net_value` expression.
//
// The names were not invented. `discount_type`, `discount_value` and
// `usage_count` are precisely the columns on `promo_codes`
// (migrations/0002_promo_schema.sql), and the join reads
// `o.promo_code = c.code` -- `orders.promo_code` is written by `order.service`
// from the code `promo.service` resolved out of `promo_codes`. The query was
// written for `promo_codes` and pointed at `coupons`, a baseline table with no
// writer anywhere in the codebase; even with the column names corrected it
// would have joined to nothing and returned an empty report.
//
// businessMetrics.test.js already covers what this metric sums and who may read
// it. This suite covers where it reads from, and generalises: the last case
// checks every qualified column reference in the statement against the schema
// in migrations/, so the next rename fails here rather than in production.

jest.mock('../config/db', () => {
    const query = jest.fn();
    return { query, promise: { query }, getConnection: jest.fn() };
});

const db = require('../config/db');
const {
    MetricsAggregationService,
    TIME_PERIODS,
} = require('../services/metricsAggregationService');

const { columnsOf, unknownColumns } = require('./helpers/migrationSchema');

/** The statement issued, whitespace collapsed. */
const statement = (index = 0) =>
    String(db.query.mock.calls[index][0]).replace(/\s+/g, ' ').trim();

const paramsOf = (index = 0) => db.query.mock.calls[index][1];

let metrics;

beforeEach(() => {
    db.query.mockReset();
    db.query.mockResolvedValue([[]]);
    // A fresh instance per test: the service caches by metric and period, and a
    // cached answer issues no statement to assert on.
    metrics = new MetricsAggregationService();
});

// ---------------------------------------------------------------------------
// The two tables, as the migrations define them
// ---------------------------------------------------------------------------

describe('what the migrations say', () => {
    test('coupons does not have the columns the query was naming', () => {
        const coupons = columnsOf('coupons');

        expect(coupons.has('discount_type')).toBe(false);
        expect(coupons.has('discount_value')).toBe(false);
        expect(coupons.has('usage_count')).toBe(false);
    });

    test('coupons calls them type, value and used_count', () => {
        const coupons = columnsOf('coupons');

        expect(coupons.has('type')).toBe(true);
        expect(coupons.has('value')).toBe(true);
        expect(coupons.has('used_count')).toBe(true);
    });

    test('promo_codes has every column the query names', () => {
        const promos = columnsOf('promo_codes');

        for (const column of ['code', 'discount_type', 'discount_value', 'usage_count', 'is_deleted', 'created_at']) {
            expect(promos.has(column)).toBe(true);
        }
    });

    test('orders carries the code the join matches on', () => {
        expect(columnsOf('orders').has('promo_code')).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// The query
// ---------------------------------------------------------------------------

describe('coupon effectiveness reads promo_codes', () => {
    test('selects from promo_codes, not coupons', async () => {
        await metrics.getCouponEffectiveness(TIME_PERIODS.WEEK);

        expect(statement()).toMatch(/FROM promo_codes c/);
        expect(statement()).not.toMatch(/FROM coupons/);
    });

    test('still joins orders on the column the order path writes', async () => {
        await metrics.getCouponEffectiveness(TIME_PERIODS.WEEK);

        expect(statement()).toMatch(/o\.promo_code = c\.code/);
        expect(statement()).not.toMatch(/coupon_code/);
    });

    test('excludes withdrawn codes', async () => {
        // is_deleted is how the rest of the promo path filters this table. A
        // code that has been pulled should not appear in an effectiveness
        // report alongside live ones.
        await metrics.getCouponEffectiveness(TIME_PERIODS.WEEK);

        expect(statement()).toMatch(/c\.is_deleted = 0/);
    });

    test('keeps the type filter parameterised and in the WHERE clause', async () => {
        await metrics.getCouponEffectiveness(TIME_PERIODS.WEEK, {
            couponType: 'percentage',
        });

        expect(statement()).toMatch(/WHERE[\s\S]*discount_type = \?[\s\S]*GROUP BY/);
        expect(statement()).not.toMatch(/ORDER BY[\s\S]*AND c\.discount_type/);
        expect(paramsOf()).toContain('percentage');
    });

    test('does not alias the COUNT over a real column of the same table', async () => {
        // `usage_count` is a column on promo_codes and was also the alias for
        // COUNT(o.id). One name meaning the lifetime counter in the WHERE
        // clause and the in-period total in the select list is what made the
        // original mismatch hard to see.
        await metrics.getCouponEffectiveness(TIME_PERIODS.WEEK);

        expect(statement()).toMatch(/COUNT\(o\.id\) as redemption_count/);
        expect(statement()).not.toMatch(/as usage_count/);
    });
});

// ---------------------------------------------------------------------------
// The shape that reaches the route
// ---------------------------------------------------------------------------

describe('the report it returns', () => {
    test('maps a row onto the documented keys', async () => {
        db.query.mockResolvedValueOnce([[
            {
                code: 'SUMMER20',
                discount_type: 'percentage',
                discount_value: '20.00',
                redemption_count: 14,
                revenue_generated: '18400.50',
                avg_order_value: '1314.32',
                net_value: '1294.32',
            },
        ]]);

        const report = await metrics.getCouponEffectiveness(TIME_PERIODS.WEEK);

        expect(report.metric).toBe('coupon_effectiveness');
        expect(report.coupons).toHaveLength(1);
        expect(report.coupons[0]).toMatchObject({
            code: 'SUMMER20',
            discountType: 'percentage',
            discountValue: 20,
            usageCount: 14,
            revenueGenerated: 18400.5,
        });
    });

    test('the response key stayed usageCount when the SQL alias changed', async () => {
        // Renaming the alias is an internal change; anything reading this
        // endpoint should not have to notice.
        db.query.mockResolvedValueOnce([[
            { code: 'A', discount_type: 'fixed', discount_value: '5', redemption_count: 3 },
        ]]);

        const report = await metrics.getCouponEffectiveness(TIME_PERIODS.WEEK);

        expect(report.coupons[0].usageCount).toBe(3);
    });

    test('totals across the rows it got', async () => {
        db.query.mockResolvedValueOnce([[
            { code: 'A', discount_value: '5', redemption_count: 1, revenue_generated: '100.00' },
            { code: 'B', discount_value: '5', redemption_count: 2, revenue_generated: '250.50' },
        ]]);

        const report = await metrics.getCouponEffectiveness(TIME_PERIODS.WEEK);

        expect(report.totalCoupons).toBe(2);
        expect(report.totalRevenue).toBeCloseTo(350.5, 2);
    });

    test('an empty window is an empty report, not a failure', async () => {
        const report = await metrics.getCouponEffectiveness(TIME_PERIODS.WEEK);

        expect(report.coupons).toEqual([]);
        expect(report.totalCoupons).toBe(0);
        expect(report.totalRevenue).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// The general rule, so the next one fails here
// ---------------------------------------------------------------------------

describe('every column the statement names', () => {
    test('exists in the migration schema', async () => {
        await metrics.getCouponEffectiveness(TIME_PERIODS.WEEK, {
            couponType: 'percentage',
        });

        // Stating the alias map here rather than parsing it out of the SQL is
        // deliberate: it documents which table this query is meant to be
        // reading, which is the thing that was wrong.
        expect(
            unknownColumns(statement(), { c: 'promo_codes', o: 'orders' })
        ).toEqual([]);
    });

    test('would have caught the bug this suite exists for', () => {
        // A guard on the guard. If unknownColumns ever stops resolving, the
        // case above passes over nothing and the next rename ships.
        const broken = `
            SELECT c.discount_type, c.discount_value
            FROM coupons c
            LEFT JOIN orders o ON o.promo_code = c.code
            WHERE c.usage_count > 0
        `;

        expect(unknownColumns(broken, { c: 'coupons', o: 'orders' }).sort()).toEqual([
            'c.discount_type is not a column of coupons',
            'c.discount_value is not a column of coupons',
            'c.usage_count is not a column of coupons',
        ]);
    });
});
