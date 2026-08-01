// backend/tests/rateLimitClientIdentity.test.js
//
// What a limiter counts against decides whether it works at all (#1365): a key
// the caller can influence is not a limit, and a key that collapses every
// client onto one bucket throttles innocent traffic. These cover the key
// derivation and the trust-proxy setting that feeds it.

jest.mock('../config/redis', () => ({
    eval: jest.fn().mockResolvedValue([1, 60000]),
    del: jest.fn().mockResolvedValue(1),
    scan: jest.fn().mockResolvedValue(['0', []])
}));

jest.mock('../config/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
}));

const logger = require('../config/logger');
const { customKeyGenerator } = require('../middleware/rateLimiter');
const { resolveTrustProxy, DEFAULT_TRUSTED_HOPS } = require('../config/trustProxy');

/** Minimal shape of what the key generator reads off a request. */
const buildRequest = ({ ip, headers = {}, user, body = {}, remoteAddress } = {}) => ({
    ip,
    headers,
    user,
    body,
    socket: { remoteAddress }
});

describe('rate limit key derivation', () => {
    test('an authenticated request is counted against the account', () => {
        const key = customKeyGenerator(
            buildRequest({ ip: '203.0.113.7', user: { id: 42 } })
        );

        expect(key).toBe('user:42');
    });

    test('the same account is one bucket wherever it connects from', () => {
        const fromOffice = customKeyGenerator(
            buildRequest({ ip: '203.0.113.7', user: { id: 42 } })
        );
        const fromPhone = customKeyGenerator(
            buildRequest({ ip: '198.51.100.4', user: { id: 42 } })
        );

        expect(fromOffice).toBe(fromPhone);
    });

    test('an unauthenticated request is counted against the client address', () => {
        const key = customKeyGenerator(buildRequest({ ip: '203.0.113.7' }));

        expect(key).toBe('ip:203.0.113.7');
    });

    test('two addresses behind one NAT do not share an authenticated budget', () => {
        const alice = customKeyGenerator(
            buildRequest({ ip: '203.0.113.7', user: { id: 1 } })
        );
        const bob = customKeyGenerator(
            buildRequest({ ip: '203.0.113.7', user: { id: 2 } })
        );

        expect(alice).not.toBe(bob);
    });

    test('a forwarded header does not let the caller choose its own bucket', () => {
        // Express resolves req.ip according to `trust proxy`. Reading
        // X-Forwarded-For directly instead would hand the caller a fresh
        // counter on every request just by changing the header.
        const first = customKeyGenerator(buildRequest({
            ip: '203.0.113.7',
            headers: { 'x-forwarded-for': '9.9.9.9' }
        }));
        const second = customKeyGenerator(buildRequest({
            ip: '203.0.113.7',
            headers: { 'x-forwarded-for': '8.8.8.8, 7.7.7.7' }
        }));

        expect(first).toBe('ip:203.0.113.7');
        expect(second).toBe(first);
    });

    test('a caller-supplied user id in the body does not mint a new bucket', () => {
        const first = customKeyGenerator(
            buildRequest({ ip: '203.0.113.7', body: { userId: 'a' } })
        );
        const second = customKeyGenerator(
            buildRequest({ ip: '203.0.113.7', body: { userId: 'b' } })
        );

        expect(first).toBe(second);
        expect(first).toBe('ip:203.0.113.7');
    });

    test('IPv6 clients are bucketed by prefix, not by individual address', () => {
        // A single IPv6 client is normally handed a whole subnet, so keying on
        // the exact address is an unlimited supply of fresh quotas.
        const first = customKeyGenerator(
            buildRequest({ ip: '2001:db8:abcd:0012:0000:0000:0000:0001' })
        );
        const second = customKeyGenerator(
            buildRequest({ ip: '2001:db8:abcd:0012:ffff:ffff:ffff:ffff' })
        );

        expect(first).toBe(second);
        expect(first).not.toContain('ffff:ffff:ffff:ffff');
    });

    test('falls back to the socket address, then to a fixed key', () => {
        expect(customKeyGenerator(buildRequest({ remoteAddress: '203.0.113.7' })))
            .toBe('ip:203.0.113.7');
        expect(customKeyGenerator(buildRequest({}))).toBe('ip:unknown');
    });
});

describe('trust proxy resolution', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('defaults to a single trusted hop when unset', () => {
        expect(resolveTrustProxy(undefined)).toBe(DEFAULT_TRUSTED_HOPS);
        expect(resolveTrustProxy('')).toBe(DEFAULT_TRUSTED_HOPS);
    });

    test('accepts a hop count for deployments behind more than one proxy', () => {
        expect(resolveTrustProxy('2')).toBe(2);
    });

    test('accepts a direct deployment that trusts no forwarded header at all', () => {
        expect(resolveTrustProxy('false')).toBe(false);
        expect(resolveTrustProxy('off')).toBe(false);
    });

    test('passes an address or subnet list through to Express', () => {
        expect(resolveTrustProxy('10.0.0.0/8, loopback')).toBe('10.0.0.0/8, loopback');
    });

    test('warns when asked to trust the whole forwarded chain', () => {
        expect(resolveTrustProxy('true')).toBe(true);
        expect(logger.warn).toHaveBeenCalledTimes(1);
        expect(logger.warn.mock.calls[0][0]).toMatch(/X-Forwarded-For/);
    });
});
