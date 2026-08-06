// backend/tests/helpers/redisMock.js
//
// A stand-in for `config/redis` that never opens a socket. Addresses #1444.
//
// `config/redis` sets `lazyConnect` under Jest so the module graph can be
// loaded without a server, but `services/refreshTokenService.js` then calls
// `redis.connect()` at module scope -- which is exactly the thing lazyConnect
// was deferring. Any suite that reaches authMiddleware (and so
// refreshTokenService) therefore ended up talking to a Redis that is not
// there, and got one of two failures depending on how complete its own mock
// was:
//
//   TypeError: redis.connect is not a function      -- partial mock, suite
//                                                      failed to run at all
//   MaxRetriesPerRequestError: ... limit (which is 3) -- no mock, ioredis
//                                                      exhausted its retries
//                                                      mid-request
//
// Both are environment noise rather than anything about the code under test,
// and both are avoided by giving the double the whole surface the app uses,
// including the connection lifecycle.
//
// Commands resolve rather than reject. A suite that wants to see failure
// handling should override the specific command it cares about -- a double
// that fails everything cannot tell "handles a Redis outage" from "never
// reached Redis".

'use strict';

/**
 * Build a fresh ioredis-shaped double.
 *
 * Every command is an independent `jest.fn()` so a suite can override one
 * without disturbing the rest, and a fresh instance per call keeps call counts
 * from leaking between suites.
 *
 * @returns {object}
 */
function createRedisMock() {
    const client = {
        // Connection lifecycle. `connect` resolving is what stops
        // refreshTokenService's module-scope call from starting a real one.
        connect: jest.fn().mockResolvedValue(undefined),
        quit: jest.fn().mockResolvedValue('OK'),
        disconnect: jest.fn(),
        status: 'ready',

        // Event emitter surface. The app registers 'connect', 'error' and
        // 'ready' handlers; returning `this` keeps the chaining ioredis allows.
        on: jest.fn(function on() { return this; }),
        once: jest.fn(function once() { return this; }),
        off: jest.fn(function off() { return this; }),
        removeListener: jest.fn(function removeListener() { return this; }),
        emit: jest.fn(),

        // Commands, in the shapes the callers expect back.
        get: jest.fn().mockResolvedValue(null),
        set: jest.fn().mockResolvedValue('OK'),
        setex: jest.fn().mockResolvedValue('OK'),
        del: jest.fn().mockResolvedValue(0),
        exists: jest.fn().mockResolvedValue(0),
        incr: jest.fn().mockResolvedValue(1),
        expire: jest.fn().mockResolvedValue(1),
        ttl: jest.fn().mockResolvedValue(-2),
        keys: jest.fn().mockResolvedValue([]),
        scan: jest.fn().mockResolvedValue(['0', []]),
        eval: jest.fn().mockResolvedValue(null),
        evalsha: jest.fn().mockResolvedValue(null),
        hget: jest.fn().mockResolvedValue(null),
        hset: jest.fn().mockResolvedValue(1),
        hgetall: jest.fn().mockResolvedValue({}),
        sadd: jest.fn().mockResolvedValue(1),
        srem: jest.fn().mockResolvedValue(1),
        smembers: jest.fn().mockResolvedValue([]),
        sismember: jest.fn().mockResolvedValue(0),
        ping: jest.fn().mockResolvedValue('PONG'),
        defineCommand: jest.fn(),
        // Pub/sub. The pattern variants are what @socket.io/redis-adapter
        // reaches for on the subscriber connection; without them the adapter
        // logs "psubscribe is not a function" and falls back, which is noise
        // in the output of a suite that is not testing the adapter.
        subscribe: jest.fn().mockResolvedValue(1),
        unsubscribe: jest.fn().mockResolvedValue(1),
        publish: jest.fn().mockResolvedValue(0),
        psubscribe: jest.fn().mockResolvedValue(1),
        punsubscribe: jest.fn().mockResolvedValue(1),

        // utils/socketManager.js takes two of these for the socket.io Redis
        // adapter. A subscriber connection cannot also issue commands, which is
        // why the real client is duplicated rather than shared -- the double
        // mirrors that by handing back a fresh instance.
        duplicate: jest.fn(() => createRedisMock()),

        // Pipelines and transactions. `exec` returns the [err, result] tuples
        // ioredis produces, so a caller destructuring them gets what it expects.
        pipeline: jest.fn(() => createChain()),
        multi: jest.fn(() => createChain())
    };

    /**
     * A chainable pipeline/multi whose `exec` resolves to an empty result set.
     *
     * @returns {object}
     */
    function createChain() {
        const chain = {
            exec: jest.fn().mockResolvedValue([])
        };

        for (const command of ['get', 'set', 'setex', 'del', 'incr', 'expire', 'eval']) {
            chain[command] = jest.fn(() => chain);
        }

        return chain;
    }

    // config/redis exports the client itself and hangs the options off it.
    client.REDIS_OPTIONS = { host: '127.0.0.1', port: 6379, lazyConnect: true };

    return client;
}

module.exports = { createRedisMock };
