// backend/tests/cartRestore.test.js
//
// Restore links (#1429).
//
// This is the security surface of the recovery work: a credential that travels
// by email, is spent by somebody who is not signed in, and must not be worth
// anything to whoever else ends up holding it. The tests are written against
// the refusals rather than the happy path, because the happy path failing is
// visible and a refusal that quietly does not happen is not.

jest.mock('../config/db', () => {
    const query = jest.fn();
    const pool = { query, getConnection: jest.fn() };
    pool.promise = pool;
    return pool;
});

const crypto = require('crypto');
const express = require('express');
const request = require('supertest');

const db = require('../config/db');
const cartRestoreService = require('../services/cartRestoreService');
const cartRoutes = require('../routes/cartRoutes');
const { PUBLIC_ROUTES, isPublicRoute } = require('../config/routePolicy');
const { collectRoutes } = require('../middleware/routeAudit');

const CART = '33333333-3333-4333-8333-333333333333';
const USER = '11111111-1111-4111-8111-111111111111';
const TOKEN_ID = '55555555-5555-4555-8555-555555555555';

const wellFormedToken = () => crypto.randomBytes(32).toString('hex');

function buildApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/cart', cartRoutes);
    return app;
}

/**
 * Answer the redemption path's queries: the lookup, the spend, and the lines.
 */
function mockRedemption({ record, spent = { affectedRows: 1 }, lines = [] }) {
    db.query.mockImplementation(async (sql) => {
        if (/FROM cart_restore_tokens/i.test(sql)) return [record ? [record] : []];
        if (/UPDATE cart_restore_tokens/i.test(sql)) return [spent];
        if (/FROM cart_items ci/i.test(sql)) return [lines];
        return [{ affectedRows: 1 }];
    });
}

const liveRecord = (overrides = {}) => ({
    id: TOKEN_ID,
    cart_id: CART,
    user_id: USER,
    redeemed_at: null,
    is_expired: 0,
    ...overrides
});

const productLine = (overrides = {}) => ({
    product_id: '77777777-7777-4777-8777-777777777777',
    variant_id: 0,
    color: '',
    size: '',
    quantity: 2,
    name: 'Tee',
    price: '19.99',
    image: 'tee.png',
    ...overrides
});

afterEach(() => {
    db.query.mockReset();
});

describe('issuing a link', () => {
    test('mints an unguessable token and stores only its hash', async () => {
        db.query.mockResolvedValue([{ affectedRows: 1 }]);

        const { token } = await cartRestoreService.issueRestoreToken({
            cartId: CART,
            userId: USER
        });

        expect(token).toMatch(cartRestoreService.RESTORE_TOKEN_REGEX);

        const [, params] = db.query.mock.calls
            .find(([sql]) => /INSERT INTO cart_restore_tokens/i.test(sql));
        const expectedHash = crypto.createHash('sha256').update(token).digest('hex');

        expect(params).toContain(expectedHash);
        // The token itself must never reach a column.
        expect(params).not.toContain(token);
    });

    test('binds the link to one cart, and expires it on a clock', async () => {
        db.query.mockResolvedValue([{ affectedRows: 1 }]);

        await cartRestoreService.issueRestoreToken({ cartId: CART, userId: USER, ttlMinutes: 90 });

        const [sql, params] = db.query.mock.calls
            .find(([statement]) => /INSERT INTO cart_restore_tokens/i.test(statement));

        expect(sql).toMatch(/DATE_ADD\(NOW\(\), INTERVAL \? MINUTE\)/i);
        expect(params).toContain(CART);
        expect(params).toContain(90);
    });

    // The sequence asks about a basket more than once. Without this, the number
    // of live credentials for one cart grows with the number of reminders.
    test('supersedes the basket\'s previous link', async () => {
        db.query.mockResolvedValue([{ affectedRows: 1 }]);

        await cartRestoreService.issueRestoreToken({ cartId: CART, userId: USER });

        const [sql, params] = db.query.mock.calls[0];

        expect(sql).toMatch(/UPDATE cart_restore_tokens/i);
        expect(sql).toMatch(/SET expires_at = NOW\(\)/i);
        expect(params).toEqual([CART]);
    });

    test('refuses to issue an unowned link', async () => {
        await expect(
            cartRestoreService.issueRestoreToken({ cartId: CART, userId: null })
        ).rejects.toThrow(/cart and the account/i);

        expect(db.query).not.toHaveBeenCalled();
    });

    test('the link lands on the cart page carrying the token', () => {
        const token = wellFormedToken();

        expect(cartRestoreService.buildRestoreUrl(token)).toContain(`restore=${token}`);
    });
});

describe('spending a link', () => {
    test('returns the basket, and nothing about the account', async () => {
        mockRedemption({ record: liveRecord(), lines: [productLine()] });

        const result = await cartRestoreService.redeemRestoreToken(wellFormedToken());

        expect(result.itemCount).toBe(1);
        expect(result.items[0]).toMatchObject({ name: 'Tee', price: 19.99, qty: 2 });
        // Not a login, and not a way to learn whose basket this is.
        expect(result).not.toHaveProperty('userId');
        expect(result).not.toHaveProperty('cartId');
        expect(result).not.toHaveProperty('token');
    });

    test('looks the token up by hash, never by its plain text', async () => {
        mockRedemption({ record: liveRecord(), lines: [productLine()] });

        const token = wellFormedToken();
        await cartRestoreService.redeemRestoreToken(token);

        const [, params] = db.query.mock.calls
            .find(([sql]) => /SELECT id, cart_id/i.test(sql));

        expect(params[0]).toBe(crypto.createHash('sha256').update(token).digest('hex'));
    });

    test('the request names no cart, so it cannot name someone else\'s', async () => {
        mockRedemption({ record: liveRecord(), lines: [productLine()] });

        await cartRestoreService.redeemRestoreToken(wellFormedToken());

        const [, lineParams] = db.query.mock.calls
            .find(([sql]) => /FROM cart_items ci/i.test(sql));

        // The cart read is keyed by what the token was bound to at issue.
        expect(lineParams).toEqual([CART]);
    });

    test('spends the link with a guard, so a replay cannot race the original', async () => {
        mockRedemption({ record: liveRecord(), lines: [productLine()] });

        await cartRestoreService.redeemRestoreToken(wellFormedToken());

        const [sql] = db.query.mock.calls
            .find(([statement]) => /UPDATE cart_restore_tokens/i.test(statement));

        expect(sql).toMatch(/redeemed_at IS NULL/i);
        expect(sql).toMatch(/expires_at > NOW\(\)/i);
    });

    test('a link that lost the race is refused, not honoured', async () => {
        mockRedemption({
            record: liveRecord(),
            spent: { affectedRows: 0 },
            lines: [productLine()]
        });

        await expect(cartRestoreService.redeemRestoreToken(wellFormedToken()))
            .rejects.toMatchObject({ status: 410, code: 'RESTORE_LINK_ALREADY_USED' });
    });

    test.each([
        ['already spent', { redeemed_at: '2026-01-01 10:00:00' }, 'RESTORE_LINK_ALREADY_USED'],
        ['expired', { is_expired: 1 }, 'RESTORE_LINK_EXPIRED']
    ])('refuses a link that is %s', async (_name, overrides, code) => {
        mockRedemption({ record: liveRecord(overrides) });

        await expect(cartRestoreService.redeemRestoreToken(wellFormedToken()))
            .rejects.toMatchObject({ status: 410, code });

        expect(db.query.mock.calls.filter(([sql]) => /UPDATE/i.test(sql))).toHaveLength(0);
    });

    // An unknown token and a malformed one answer identically, so the endpoint
    // cannot be used to learn which tokens exist.
    test('a forged link is indistinguishable from a mistyped one', async () => {
        mockRedemption({ record: null });

        const forged = await cartRestoreService
            .redeemRestoreToken(wellFormedToken())
            .catch((error) => error);
        const mistyped = await cartRestoreService
            .redeemRestoreToken('not-a-token')
            .catch((error) => error);

        expect(forged.code).toBe(mistyped.code);
        expect(forged.message).toBe(mistyped.message);
        expect(forged.status).toBe(mistyped.status);
    });

    test('a malformed token never reaches the database', async () => {
        await expect(cartRestoreService.redeemRestoreToken('../../etc/passwd'))
            .rejects.toMatchObject({ status: 400 });

        expect(db.query).not.toHaveBeenCalled();
    });

    test('an emptied basket still costs the link', async () => {
        mockRedemption({ record: liveRecord(), lines: [] });

        await expect(cartRestoreService.redeemRestoreToken(wellFormedToken()))
            .rejects.toMatchObject({ status: 410, code: 'RESTORE_BASKET_EMPTY' });

        const spends = db.query.mock.calls
            .filter(([sql]) => /UPDATE cart_restore_tokens/i.test(sql));
        expect(spends).toHaveLength(1);
    });

    test('a product withdrawn from the catalogue does not come back', async () => {
        mockRedemption({ record: liveRecord(), lines: [productLine()] });

        await cartRestoreService.redeemRestoreToken(wellFormedToken());

        const [sql] = db.query.mock.calls.find(([statement]) => /FROM cart_items ci/i.test(statement));

        expect(sql).toMatch(/JOIN products p ON p\.id = ci\.product_id/i);
    });
});

describe('the restore route', () => {
    test('answers without a session', async () => {
        mockRedemption({ record: liveRecord(), lines: [productLine()] });

        const response = await request(buildApp())
            .post('/api/cart/restore')
            .send({ token: wellFormedToken() });

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.items).toHaveLength(1);
    });

    test('passes a refusal through with its own status, and leaks nothing', async () => {
        mockRedemption({ record: liveRecord({ is_expired: 1 }) });

        const response = await request(buildApp())
            .post('/api/cart/restore')
            .send({ token: wellFormedToken() });

        expect(response.status).toBe(410);
        expect(response.body).toMatchObject({ success: false, code: 'RESTORE_LINK_EXPIRED' });
        expect(response.body).not.toHaveProperty('items');
    });

    test('an unexpected fault does not become a description of the fault', async () => {
        db.query.mockRejectedValue(new Error('ER_NO_SUCH_TABLE: cart_restore_tokens'));

        const response = await request(buildApp())
            .post('/api/cart/restore')
            .send({ token: wellFormedToken() });

        expect(response.status).toBe(500);
        expect(response.body.message).not.toMatch(/ER_NO_SUCH_TABLE/);
    });

    test('is the only cart route open to anonymous traffic', () => {
        const unguarded = collectRoutes(cartRoutes, '/api/cart')
            .filter((route) => !route.isProtected)
            .map((route) => `${route.method} ${route.path}`);

        expect(unguarded).toEqual(['POST /api/cart/restore']);
    });

    test('is on the public allowlist, with the decision written down', () => {
        expect(isPublicRoute('POST', '/api/cart/restore')).toBe(true);

        const entry = PUBLIC_ROUTES
            .find((route) => route.path === '/api/cart/restore');

        expect(entry.reason).toMatch(/token/i);
    });
});
