// backend/tests/socketAuth.test.js
//
// Realtime authentication (#1363). The handshake used to verify tokens itself,
// against `JWT_SECRET || 'secret'`, and never looked at the connection again.
// These cover the contract it answers to now: the shared verifier, a real
// expiry, and a revocation that reaches a connection already open.
//
// Socket.IO, Redis and the chat service are mocked at the module boundary, so
// nothing here opens a socket, a connection or a transaction.

jest.mock('socket.io', () => {
    const broadcasts = [];

    // Stands in for a BroadcastOperator. `except()` returns a new one, exactly
    // as Socket.IO does, so the operator that is finally acted on is the last
    // one recorded.
    const makeOperator = (room, excluded = []) => {
        const operator = {
            room,
            excluded,
            emit: jest.fn(),
            except: jest.fn((other) => makeOperator(room, [...excluded, other])),
            disconnectSockets: jest.fn()
        };
        broadcasts.push(operator);
        return operator;
    };

    const io = {
        broadcasts,
        adapter: jest.fn(),
        use: jest.fn(),
        on: jest.fn(),
        emit: jest.fn(),
        in: jest.fn((room) => makeOperator(room)),
        sockets: { sockets: new Map() }
    };

    return { Server: jest.fn(() => io), __io: io };
});

jest.mock('@socket.io/redis-adapter', () => ({
    createAdapter: jest.fn(() => jest.fn())
}));

jest.mock('../config/redis', () => {
    const client = {
        setex: jest.fn().mockResolvedValue('OK'),
        get: jest.fn().mockResolvedValue(null),
        del: jest.fn().mockResolvedValue(1),
        on: jest.fn()
    };
    client.duplicate = jest.fn(() => client);
    return client;
});

jest.mock('../services/chat.service', () => ({}));

jest.mock('../utils/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
}));

const jwt = require('jsonwebtoken');

const { issueAccessToken } = require('../utils/tokens');
const { publishSessionRevoked } = require('../utils/sessionRevocationBus');
const {
    authenticateSocket,
    disconnectRevokedSessions,
    initSocket,
    setupAuthenticatedSession
} = require('../utils/socketManager');

const { __io: io } = require('socket.io');

// ============================================
// FACTORIES
// ============================================

let socketCounter = 0;

const createSocket = (token) => {
    socketCounter += 1;
    const socket = {
        id: `socket-${socketCounter}`,
        handshake: { auth: { token } },
        rooms: new Set(),
        handlers: new Map(),
        join: jest.fn((room) => socket.rooms.add(room)),
        leave: jest.fn((room) => socket.rooms.delete(room)),
        on: jest.fn((event, handler) => socket.handlers.set(event, handler)),
        emit: jest.fn(),
        disconnect: jest.fn(),
        removeAllListeners: jest.fn()
    };
    return socket;
};

/** Sign with the current secret but a lifetime of our choosing. */
const signToken = (claims, expiresIn) =>
    jwt.sign(claims, process.env.JWT_SECRET, { expiresIn });

/** Admit a socket and put it through the post-connection setup. */
const connect = (token) => {
    const socket = createSocket(token);
    const next = jest.fn();

    authenticateSocket(socket, next);
    expect(next).toHaveBeenCalledWith();

    setupAuthenticatedSession(socket);
    return socket;
};

const rejectionFor = (token) => {
    const next = jest.fn();
    authenticateSocket(createSocket(token), next);

    expect(next).toHaveBeenCalledTimes(1);
    const [error] = next.mock.calls[0];
    expect(error).toBeInstanceOf(Error);
    return error.message;
};

// Every admitted connection schedules a disconnect for when its token runs out.
// Fake timers keep those out of the real event loop, so no suite finishes with a
// pending 15-minute timeout holding the worker open.
beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

// ============================================
// HANDSHAKE
// ============================================

describe('socket handshake authentication', () => {
    it('refuses every connection when the access-token secret is absent', () => {
        const secret = process.env.JWT_SECRET;
        const token = signToken({ id: 42, role: 'customer' }, '15m');
        delete process.env.JWT_SECRET;

        try {
            expect(rejectionFor(token)).toBe('Authentication unavailable');
        } finally {
            process.env.JWT_SECRET = secret;
        }
    });

    it('refuses a token signed with the former hardcoded fallback secret', () => {
        const forged = jwt.sign({ id: 42, role: 'customer' }, 'secret', { expiresIn: '15m' });

        expect(rejectionFor(forged)).toBe('Authentication failed');
    });

    it('refuses a connection that presents no token at all', () => {
        expect(rejectionFor(undefined)).toBe('Authentication required');
    });

    it('accepts a token issued through the shared contract', () => {
        const socket = createSocket(
            issueAccessToken({ id: 42, email: 'shopper@example.com', role: 'customer' })
        );
        const next = jest.fn();

        authenticateSocket(socket, next);

        expect(next).toHaveBeenCalledWith();
        expect(socket.userId).toBe(42);
        expect(socket.userRole).toBe('customer');
        expect(socket._listenerRegistry).toBeDefined();
    });

    it('reads the subject from the legacy claim, as the HTTP middleware does', () => {
        const socket = createSocket(signToken({ userId: 7, role: 'admin' }, '15m'));
        const next = jest.fn();

        authenticateSocket(socket, next);

        expect(next).toHaveBeenCalledWith();
        expect(socket.userId).toBe(7);
    });

    it('refuses a token that identifies nobody', () => {
        expect(rejectionFor(signToken({ role: 'admin' }, '15m'))).toBe('Authentication failed');
    });

    it('refuses a token that never expires', () => {
        const everlasting = jwt.sign({ id: 42, role: 'customer' }, process.env.JWT_SECRET);

        expect(rejectionFor(everlasting)).toBe('Authentication failed');
    });

    it('places the connection in rooms a revocation can find it by', () => {
        const socket = connect(signToken({ id: 42, role: 'customer', sid: 's-1', fid: 'f-1' }, '15m'));

        expect(socket.join).toHaveBeenCalledWith('auth:user:42');
        expect(socket.join).toHaveBeenCalledWith('auth:session:s-1');
        expect(socket.join).toHaveBeenCalledWith('auth:family:f-1');
    });
});

// ============================================
// EXPIRY AND RENEWAL
// ============================================

describe('token expiry on a live connection', () => {
    it('disconnects the connection when its token runs out', () => {
        const socket = connect(signToken({ id: 42, role: 'customer' }, 30));

        jest.advanceTimersByTime(29_000);
        expect(socket.disconnect).not.toHaveBeenCalled();

        jest.advanceTimersByTime(2_000);

        expect(socket.emit).toHaveBeenCalledWith(
            'token_expired',
            expect.objectContaining({ reason: 'token_expired' })
        );
        expect(socket.disconnect).toHaveBeenCalledWith(true);
    });

    it('pushes the disconnect back when a fresh token is presented', () => {
        const socket = connect(signToken({ id: 42, role: 'customer' }, 60));
        const reauthenticate = socket.handlers.get('reauthenticate');
        const ack = jest.fn();

        jest.advanceTimersByTime(30_000);
        reauthenticate({ token: signToken({ id: 42, role: 'customer' }, 120) }, ack);

        expect(ack).toHaveBeenCalledWith(expect.objectContaining({ success: true }));

        // Past the first token's expiry, still connected on the second.
        jest.advanceTimersByTime(40_000);
        expect(socket.disconnect).not.toHaveBeenCalled();

        jest.advanceTimersByTime(100_000);
        expect(socket.disconnect).toHaveBeenCalledWith(true);
    });

    it('disconnects when re-authentication presents a token it cannot verify', () => {
        const socket = connect(signToken({ id: 42, role: 'customer' }, 60));
        const reauthenticate = socket.handlers.get('reauthenticate');
        const ack = jest.fn();

        reauthenticate({ token: jwt.sign({ id: 42 }, 'secret', { expiresIn: '15m' }) }, ack);

        expect(ack).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
        expect(socket.disconnect).toHaveBeenCalledWith(true);
    });

    it('disconnects when re-authentication presents another account\'s token', () => {
        const socket = connect(signToken({ id: 42, role: 'customer' }, 60));
        const reauthenticate = socket.handlers.get('reauthenticate');
        const ack = jest.fn();

        reauthenticate({ token: signToken({ id: 99, role: 'customer' }, 120) }, ack);

        expect(ack).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
        expect(socket.disconnect).toHaveBeenCalledWith(true);
    });
});

// ============================================
// REVOCATION
// ============================================

describe('session revocation without a realtime layer', () => {
    it('does nothing rather than throwing in a process that serves only HTTP', () => {
        expect(disconnectRevokedSessions({ sessionId: 's-1', reason: 'user_revoked' })).toBe(false);
        expect(io.in).not.toHaveBeenCalled();
    });
});

describe('session revocation reaching live connections', () => {
    beforeAll(() => {
        initSocket({}, ['http://localhost']);
    });

    beforeEach(() => {
        io.in.mockClear();
        io.broadcasts.length = 0;
    });

    const lastTarget = () => io.broadcasts[io.broadcasts.length - 1];

    it('closes the connections of one ended session', () => {
        expect(disconnectRevokedSessions({ sessionId: 's-1', reason: 'user_revoked' })).toBe(true);

        expect(io.in).toHaveBeenCalledWith('auth:session:s-1');
        expect(lastTarget().emit).toHaveBeenCalledWith(
            'session_revoked',
            expect.objectContaining({ reason: 'user_revoked' })
        );
        expect(lastTarget().disconnectSockets).toHaveBeenCalledWith(true);
    });

    it('prefers the narrowest identifier it is given', () => {
        disconnectRevokedSessions({ sessionId: 's-1', familyId: 'f-1', userId: 42 });

        expect(io.in).toHaveBeenCalledTimes(1);
        expect(io.in).toHaveBeenCalledWith('auth:session:s-1');
    });

    it('closes the connections descended from one sign-in', () => {
        disconnectRevokedSessions({ familyId: 'f-1', reason: 'token_reuse_detected' });

        expect(io.in).toHaveBeenCalledWith('auth:family:f-1');
        expect(lastTarget().disconnectSockets).toHaveBeenCalledWith(true);
    });

    it('spares the current session when signing out everywhere else', () => {
        disconnectRevokedSessions({ userId: 42, exceptSessionId: 'keep-me', reason: 'user_revoked' });

        expect(io.in).toHaveBeenCalledWith('auth:user:42');
        expect(lastTarget().excluded).toEqual(['auth:session:keep-me']);
        expect(lastTarget().disconnectSockets).toHaveBeenCalledWith(true);
    });

    it('acts on a revocation announced by the service layer', () => {
        publishSessionRevoked({ familyId: 'f-9', reason: 'password_changed' });

        expect(io.in).toHaveBeenCalledWith('auth:family:f-9');
        expect(lastTarget().disconnectSockets).toHaveBeenCalledWith(true);
    });

    it('ignores a revocation that names nothing', () => {
        expect(disconnectRevokedSessions({ reason: 'logout' })).toBe(false);
        expect(io.in).not.toHaveBeenCalled();
    });
});
