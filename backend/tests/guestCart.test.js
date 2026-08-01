// backend/tests/guestCart.test.js
//
// The basket of a shopper with no account (#1427).
//
// The database is mocked at the module boundary, as the rest of this suite
// does. What is pinned here is not SQL text but the properties the token has
// to hold whatever the SQL looks like:
//
//   * it is unguessable, and the database never holds a usable copy of it;
//   * it reaches exactly one live cart, and nothing else;
//   * a signed-in shopper is never handed a guest cart by presenting one;
//   * a caller whose session expired is told so, rather than quietly demoted
//     to a guest and shown an empty basket.

jest.mock('../config/db', () => {
    const query = jest.fn();
    const pool = { query, getConnection: jest.fn() };
    pool.promise = pool;
    return pool;
});

jest.mock('../utils/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
}));

const crypto = require('crypto');

const db = require('../config/db');
const guestCart = require('../services/guestCartService');
const cartIdentity = require('../middleware/cartIdentity');
const cartConfig = require('../config/cartConfig');

const CART = '44444444-4444-4444-8444-444444444444';
const USER = '11111111-1111-4111-8111-111111111111';

/** A connection double that records every statement and answers by pattern. */
function fakeConnection(responder) {
    const calls = [];

    return {
        calls,
        query: jest.fn(async (sql, params = []) => {
            calls.push({ sql, params });
            return responder(sql, params);
        })
    };
}

function callsMatching(calls, regex) {
    return calls.filter(({ sql }) => regex.test(sql));
}

/** An Express-shaped request: `req.get` is how the middleware reads headers. */
function fakeRequest({ headers = {}, cookies = {}, user = null } = {}) {
    return {
        headers,
        cookies,
        user,
        get: (name) => headers[String(name).toLowerCase()]
    };
}

function fakeResponse() {
    const res = {
        statusCode: null,
        body: null,
        status(code) {
            res.statusCode = code;
            return res;
        },
        json(payload) {
            res.body = payload;
            return res;
        }
    };

    return res;
}

afterEach(() => {
    db.query.mockReset();
});

describe('the token a guest holds', () => {
    test('is long, random, and not repeated', () => {
        const tokens = new Set(
            Array.from({ length: 50 }, () => guestCart.issueToken())
        );

        expect(tokens.size).toBe(50);

        for (const token of tokens) {
            expect(guestCart.isWellFormedToken(token)).toBe(true);
            // 43 base64url characters is 32 bytes; anything materially
            // shorter would be worth guessing at.
            expect(token).toHaveLength(43);
        }
    });

    test('is never stored in a form that can be presented back', () => {
        const token = guestCart.issueToken();
        const stored = guestCart.hashToken(token);

        expect(stored).toBe(
            crypto.createHash('sha256').update(token, 'utf8').digest('hex')
        );
        expect(stored).not.toContain(token);
        expect(guestCart.isWellFormedToken(stored)).toBe(false);
    });

    test('rejects anything that is not one before it reaches a query', () => {
        for (const rubbish of [null, undefined, 42, '', 'short', `${'a'.repeat(43)}!`]) {
            expect(guestCart.isWellFormedToken(rubbish)).toBe(false);
            expect(guestCart.hashToken(rubbish)).toBeNull();
        }
    });
});

describe('resolving a guest cart', () => {
    test('looks the token up by hash, never by the token itself', async () => {
        const token = guestCart.issueToken();
        const connection = fakeConnection(() => [[{ id: CART }]]);

        await expect(guestCart.findCartIdByToken(token, connection)).resolves.toBe(CART);

        const [lookup] = connection.calls;
        expect(lookup.params[0]).toBe(guestCart.hashToken(token));
        expect(lookup.params).not.toContain(token);
    });

    test('only reaches a cart that is active, ownerless and unexpired', async () => {
        const connection = fakeConnection(() => [[{ id: CART }]]);

        await guestCart.findCartIdByToken(guestCart.issueToken(), connection);

        const [lookup] = connection.calls;
        expect(lookup.sql).toMatch(/status = \?/i);
        expect(lookup.sql).toMatch(/user_id IS NULL/i);
        expect(lookup.sql).toMatch(/guest_token_expires_at/i);
        expect(lookup.params).toContain('active');
    });

    test('a token that reaches nothing costs no query beyond the regex', async () => {
        await expect(guestCart.findCartIdByToken('not-a-token')).resolves.toBeNull();
        expect(db.query).not.toHaveBeenCalled();
    });

    // A cart converted at checkout, or swept as abandoned, is not an error to
    // report -- the shopper simply starts a new basket.
    test('an exhausted token opens a new cart rather than failing', async () => {
        let selects = 0;

        const connection = fakeConnection((sql) => {
            if (/SELECT id FROM carts/i.test(sql)) {
                selects += 1;
                return [[]];
            }
            return [{ affectedRows: 1 }];
        });

        const resolved = await guestCart.resolveCart(guestCart.issueToken(), connection);

        expect(selects).toBe(1);
        expect(resolved.isNew).toBe(true);
        expect(guestCart.isWellFormedToken(resolved.token)).toBe(true);
        expect(resolved.cartId).toMatch(/^[0-9a-f-]{36}$/i);
    });

    test('an existing cart is reused and no second token is minted', async () => {
        const connection = fakeConnection((sql) => {
            if (/SELECT id FROM carts/i.test(sql)) return [[{ id: CART }]];
            return [{ affectedRows: 1 }];
        });

        const resolved = await guestCart.resolveCart(guestCart.issueToken(), connection);

        expect(resolved).toEqual({ cartId: CART, token: null, isNew: false });
        expect(callsMatching(connection.calls, /INSERT INTO carts/i)).toHaveLength(0);
    });

    test('a new cart is opened with no owner, so it cannot take the account slot', async () => {
        const connection = fakeConnection((sql) => {
            if (/SELECT id FROM carts/i.test(sql)) return [[]];
            return [{ affectedRows: 1 }];
        });

        const { token } = await guestCart.createCart(connection);

        const [insert] = callsMatching(connection.calls, /INSERT INTO carts/i);
        expect(insert.sql).toMatch(/VALUES\s*\(\?,\s*NULL,/i);
        expect(insert.params).toContain(guestCart.hashToken(token));
        expect(insert.params).not.toContain(token);
    });

    test('the expiry is the configured one, applied by the database clock', async () => {
        const connection = fakeConnection(() => [{ affectedRows: 1 }]);

        await guestCart.createCart(connection);

        const [insert] = connection.calls;
        expect(insert.sql).toMatch(/DATE_ADD\(NOW\(\), INTERVAL \? MINUTE\)/i);
        expect(insert.params).toContain(cartConfig.GUEST_TOKEN_TTL_MINUTES);
    });

    test('activity pushes the expiry out, but not on a cart that has closed', async () => {
        const connection = fakeConnection(() => [{ affectedRows: 1 }]);

        await guestCart.extendToken(CART, connection);

        const [update] = connection.calls;
        expect(update.sql).toMatch(/guest_token_expires_at = DATE_ADD/i);
        expect(update.sql).toMatch(/status = \?/i);
        expect(update.params).toContain('active');
    });
});

describe('deciding whose cart a request is for', () => {
    const run = (req) => {
        const res = fakeResponse();
        let advanced = false;

        cartIdentity(req, res, () => { advanced = true; });

        return { res, advanced };
    };

    test('the account wins, even when a cart token is also presented', () => {
        const req = fakeRequest({
            user: { id: USER },
            headers: { 'x-cart-token': guestCart.issueToken() }
        });

        const { advanced } = run(req);

        expect(advanced).toBe(true);
        expect(req.cartIdentity).toEqual({ userId: USER, guestToken: null, isGuest: false });
    });

    test('a caller with no credentials at all is a guest', () => {
        const token = guestCart.issueToken();
        const req = fakeRequest({ headers: { 'x-cart-token': token } });

        const { advanced } = run(req);

        expect(advanced).toBe(true);
        expect(req.cartIdentity).toEqual({ userId: null, guestToken: token, isGuest: true });
    });

    test('a guest with no token yet is still a guest', () => {
        const req = fakeRequest();

        run(req);

        expect(req.cartIdentity).toEqual({ userId: null, guestToken: null, isGuest: true });
    });

    test('junk in the header is ignored rather than carried into a query', () => {
        const req = fakeRequest({ headers: { 'x-cart-token': "' OR '1'='1" } });

        run(req);

        expect(req.cartIdentity.guestToken).toBeNull();
    });

    // The regression this guards: an expired session arrives here looking
    // exactly like a guest, and answering it with an empty basket would swap a
    // shopper's cart out from under them instead of letting the client refresh.
    test('an expired session is a 401, not a demotion to guest', () => {
        const req = fakeRequest({ headers: { authorization: 'Bearer expired.jwt.value' } });

        const { res, advanced } = run(req);

        expect(advanced).toBe(false);
        expect(res.statusCode).toBe(401);
        expect(req.cartIdentity).toBeUndefined();
    });

    test('the same is true of a session carried in a cookie', () => {
        const req = fakeRequest({ cookies: { accessToken: 'expired.jwt.value' } });

        const { res } = run(req);

        expect(res.statusCode).toBe(401);
    });
});
