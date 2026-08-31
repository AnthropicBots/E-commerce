const { findRecoveryCandidates } = require('../services/cartRecoveryService');
const db = require('../config/db');

jest.mock('../config/db', () => ({
    query: jest.fn()
}));

describe('CartRecoveryService - Candidate Product Visibility Filter', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('findRecoveryCandidates should include product status = active and deleted_at IS NULL in line_count subquery', async () => {
        db.query.mockResolvedValueOnce([
            [{
                cart_id: 'cart-1',
                user_id: 'user-1',
                line_count: 2,
                messages_for_cart: 0,
                messages_in_window: 0,
                orders_since_abandoned: 0
            }]
        ]);

        const candidates = await findRecoveryCandidates();

        expect(candidates).toHaveLength(1);
        expect(db.query).toHaveBeenCalledTimes(1);

        const sql = db.query.mock.calls[0][0];
        const params = db.query.mock.calls[0][1];

        expect(sql).toContain('JOIN products p ON p.id = ci.product_id');
        expect(sql).toContain('p.status IN (?)');
        expect(sql).toContain('p.deleted_at IS NULL');
        expect(params).toContain('active');
    });
});
