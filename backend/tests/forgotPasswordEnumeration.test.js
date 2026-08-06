// backend/tests/forgotPasswordEnumeration.test.js
//
// /api/auth/forgot-password must answer identically whatever it finds behind
// the address (#1455).
//
// It used to answer three ways -- 200 "If the email is registered..." for an
// unknown address, 400 "Please verify your email first..." for an unverified
// account, 200 "OTP sent to your email" for a verified one -- which is an
// account-existence oracle for anyone who can send a POST.
//
// The assertions here are deliberately written as "every case produces the same
// bytes" rather than "case X produces string Y". Pinning the literals would let
// someone change one branch's copy and still have a green suite; comparing the
// cases against each other is the property that actually matters, and it stays
// true if the wording is later reworded.

const mockCreateEmailToken = jest.fn().mockResolvedValue({ userId: 'appwrite-user' });

jest.mock('../config/db', () => ({
    query: jest.fn().mockResolvedValue([[]]),
    getConnection: jest.fn()
}));

jest.mock('../config/redis', () => ({
    eval: jest.fn().mockResolvedValue([1, 300000]),
    del: jest.fn().mockResolvedValue(1),
    scan: jest.fn().mockResolvedValue(['0', []]),
    connect: jest.fn().mockResolvedValue(undefined),
    on: jest.fn(function on() { return this; }),
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    setex: jest.fn().mockResolvedValue('OK'),
    duplicate: jest.fn(function duplicate() { return this; }),
    status: 'ready'
}));

jest.mock('../config/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
}));

// The controller builds an Appwrite client at module scope. Only the one call
// forgotPassword makes is interesting; the rest of the SDK is stubbed so the
// module can load without credentials or a network.
jest.mock('node-appwrite', () => ({
    Client: jest.fn().mockImplementation(() => ({
        setEndpoint() { return this; },
        setProject() { return this; },
        setSession() { return this; }
    })),
    Account: jest.fn().mockImplementation(() => ({
        createEmailToken: (...args) => mockCreateEmailToken(...args),
        createSession: jest.fn(),
        get: jest.fn(),
        updatePassword: jest.fn(),
        deleteSession: jest.fn()
    })),
    Databases: jest.fn().mockImplementation(() => ({})),
    ID: { unique: () => 'unique-id' }
}));

const db = require('../config/db');
const redis = require('../config/redis');
const otpRequestLimiter = require('../services/otpRequestLimiter');
const { forgotPassword } = require('../controllers/authController');

const UNKNOWN = 'nobody@example.com';
const UNVERIFIED = 'signed-up-never-clicked@example.com';
const VERIFIED = 'real-customer@example.com';

/** Rows the users lookup returns for each of the three cases. */
const rowsFor = (email) => {
    if (email === VERIFIED) return [{ id: 'user-1', email_verified: 1 }];
    if (email === UNVERIFIED) return [{ id: 'user-2', email_verified: 0 }];
    return [];
};

/** A minimal res that records what the handler said. */
const makeRes = () => {
    const res = {
        statusCode: null,
        body: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(payload) {
            this.body = payload;
            return this;
        }
    };
    return res;
};

/**
 * Call the handler and return everything a caller could observe.
 *
 * @param {string} email
 * @returns {Promise<{statusCode: number, body: object}>}
 */
const ask = async (email) => {
    const res = makeRes();
    await forgotPassword({ body: { email }, headers: {}, ip: '203.0.113.10' }, res);
    return { statusCode: res.statusCode, body: res.body };
};

beforeEach(async () => {
    jest.clearAllMocks();
    await otpRequestLimiter.clear();
    jest.clearAllMocks();

    // The budget is a real counter for these tests, not a stub that always
    // answers "first request" -- otherwise the suppression case below can never
    // be reached. The double implements the [count, ttl] contract the service's
    // Lua script has, keyed the same way Redis would key it.
    const counts = new Map();
    redis.eval.mockImplementation(async (_script, _numKeys, key, windowMs) => {
        const next = (counts.get(key) || 0) + 1;
        counts.set(key, next);
        return [next, Number(windowMs)];
    });

    db.query.mockImplementation(async (_sql, params) => [rowsFor(params?.[0])]);
    mockCreateEmailToken.mockResolvedValue({ userId: 'appwrite-user' });
});

describe('the response carries no information about the account', () => {
    test('unknown, unverified and verified addresses get byte-identical replies', async () => {
        const unknown = await ask(UNKNOWN);
        const unverified = await ask(UNVERIFIED);
        const verified = await ask(VERIFIED);

        expect(unknown).toEqual(unverified);
        expect(unverified).toEqual(verified);
    });

    test('all three are 200 with success: true', async () => {
        // The status code alone used to separate registered from unregistered.
        for (const email of [UNKNOWN, UNVERIFIED, VERIFIED]) {
            const { statusCode, body } = await ask(email);
            expect(statusCode).toBe(200);
            expect(body.success).toBe(true);
        }
    });

    test('the message names no account state', async () => {
        const { body } = await ask(VERIFIED);

        // The old copy said "OTP sent to your email" for a verified account and
        // "Please verify your email first" for an unverified one. Neither the
        // address nor either word may appear.
        expect(body.message).not.toContain(VERIFIED);
        expect(body.message.toLowerCase()).not.toMatch(/verify your email/);
        expect(body.message.toLowerCase()).not.toMatch(/\bregistered\b/);
    });

    test('a malformed address is answered the same way', async () => {
        const malformed = await ask('not-an-email');
        const unknown = await ask(UNKNOWN);

        expect(malformed).toEqual(unknown);
    });

    test('a missing body field is answered the same way', async () => {
        const res = makeRes();
        await forgotPassword({ body: {}, headers: {}, ip: '203.0.113.10' }, res);

        expect({ statusCode: res.statusCode, body: res.body })
            .toEqual(await ask(UNKNOWN));
    });
});

describe('what actually happens behind the uniform response', () => {
    test('a verified account is sent a code', async () => {
        await ask(VERIFIED);
        expect(mockCreateEmailToken)
            .toHaveBeenCalledWith('unique-id', VERIFIED);
    });

    test('an unverified account is sent one too', async () => {
        // Redeeming a code mailed to an address proves control of it, which is
        // the whole content of "verified". Refusing here used to strand anyone
        // who signed up, never clicked, and then forgot their password --
        // reset is the only way back in.
        await ask(UNVERIFIED);
        expect(mockCreateEmailToken)
            .toHaveBeenCalledWith('unique-id', UNVERIFIED);
    });

    test('an unknown address is not mailed', async () => {
        await ask(UNKNOWN);
        expect(mockCreateEmailToken).not.toHaveBeenCalled();
    });

    test('a malformed address never reaches the database', async () => {
        await ask('not-an-email');
        expect(db.query).not.toHaveBeenCalled();
    });

    test('the address is lowercased before lookup', async () => {
        await ask('  REAL-CUSTOMER@EXAMPLE.COM  ');
        expect(db.query).toHaveBeenCalledWith(expect.any(String), [VERIFIED]);
    });
});

describe('failures do not become a signal', () => {
    test('a send failure still answers like everything else', async () => {
        // A 500 on send-failure and a 200 on unknown-address is the same oracle
        // wearing a different hat: only a real address reaches the send at all.
        mockCreateEmailToken.mockRejectedValue(new Error('provider down'));

        const failed = await ask(VERIFIED);
        mockCreateEmailToken.mockResolvedValue({ userId: 'x' });
        const unknown = await ask(UNKNOWN);

        expect(failed).toEqual(unknown);
    });

    test('a database failure still answers like everything else', async () => {
        db.query.mockRejectedValue(new Error('ER_LOCK_WAIT_TIMEOUT'));

        const broken = await ask(VERIFIED);

        db.query.mockImplementation(async (_sql, params) => [rowsFor(params?.[0])]);
        const unknown = await ask(UNKNOWN);

        expect(broken).toEqual(unknown);
    });
});

describe('the per-address budget', () => {
    test('suppresses the send once spent, without changing the response', async () => {
        // A 429 keyed on the *subject* would say "somebody asked about this
        // address recently", which is exactly what this endpoint must not say.
        // The per-caller 429 from the route limiter is unaffected.
        const budget = otpRequestLimiter.OTP_REQUEST_MAX;

        for (let i = 0; i < budget; i++) {
            await ask(VERIFIED);
        }
        expect(mockCreateEmailToken).toHaveBeenCalledTimes(budget);

        const overBudget = await ask(VERIFIED);

        expect(mockCreateEmailToken).toHaveBeenCalledTimes(budget);
        expect(overBudget.statusCode).toBe(200);
        expect(overBudget).toEqual(await ask(UNKNOWN));
    });

    test('is consumed before the lookup, so query count does not track existence', async () => {
        // If the budget were spent after the lookup, an unknown address would
        // cost one query and a known one would cost one query plus a send --
        // and the number of queries an address attracts would itself be the
        // answer. Both cases must look the same from outside.
        const budget = otpRequestLimiter.OTP_REQUEST_MAX;

        for (let i = 0; i <= budget; i++) {
            await ask(UNKNOWN);
        }
        const unknownQueries = db.query.mock.calls.length;

        jest.clearAllMocks();
        db.query.mockImplementation(async (_sql, params) => [rowsFor(params?.[0])]);

        for (let i = 0; i <= budget; i++) {
            await ask(VERIFIED);
        }

        expect(db.query.mock.calls.length).toBe(unknownQueries);
    });

    test('one address being exhausted does not affect another', async () => {
        for (let i = 0; i <= otpRequestLimiter.OTP_REQUEST_MAX; i++) {
            await ask(VERIFIED);
        }

        jest.clearAllMocks();
        db.query.mockImplementation(async (_sql, params) => [rowsFor(params?.[0])]);

        await ask('someone-else@example.com');
        // Unknown address, so no send -- but it got as far as the lookup, which
        // is what shows the budget is per address and not global.
        expect(db.query).toHaveBeenCalled();
    });
});
