const { recordCouponUsage } = require('../services/couponService');

describe('CouponService - recordCouponUsage Promo Codes Fallback', () => {
    let connection;

    beforeEach(() => {
        connection = {
            query: jest.fn()
        };
    });

    test('should update promo_codes directly when isPromoTable is true', async () => {
        connection.query.mockResolvedValueOnce([{}]);

        await recordCouponUsage(connection, 'promo-1', 'SAVE10', true);

        expect(connection.query).toHaveBeenCalledTimes(1);
        expect(connection.query).toHaveBeenCalledWith(
            'UPDATE promo_codes SET usage_count = usage_count + 1 WHERE id = ?',
            ['promo-1']
        );
    });

    test('should fallback to promo_codes when coupons update affects 0 rows', async () => {
        connection.query
            .mockResolvedValueOnce([{ affectedRows: 0 }]) // coupons update affected 0 rows
            .mockResolvedValueOnce([{}]);                 // promo_codes update

        await recordCouponUsage(connection, null, 'DISCOUNT20', false);

        expect(connection.query).toHaveBeenCalledTimes(2);
        expect(connection.query.mock.calls[0][0]).toContain('UPDATE coupons');
        expect(connection.query.mock.calls[1][0]).toContain('UPDATE promo_codes');
    });
});
