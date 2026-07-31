// backend/tests/orderStatusHistory.test.js
//
// Order status history (#1351).
//
// The properties worth pinning are the ones whose absence made this a bug:
//
//   * the history row is written on the caller's connection, inside the
//     caller's transaction -- a history that can be missing rows because a
//     separate write failed is not a history;
//   * the timestamp columns that were already in the schema get written;
//   * a customer does not see internal notes, the actor, or the IP;
//   * the progress ladder is derived, so an order that skipped a step still
//     renders correctly.

jest.mock('../config/db', () => ({
    query: jest.fn(),
    getConnection: jest.fn()
}));

const db = require('../config/db');
const service = require('../services/orderStatusHistoryService');
const {
    SOURCES,
    STATUS_TIMESTAMPS,
    PROGRESS_STEPS,
    CUSTOMER_LABELS
} = require('../services/orderStatusHistoryService');

const ORDER = 'order-1';
const ADMIN = 'user-admin';

/** A connection that records what it ran. */
function fakeConnection() {
    const statements = [];

    return {
        statements,
        query: jest.fn(async (sql, params) => {
            statements.push({ sql, params });
            return [{ affectedRows: 1 }];
        })
    };
}

function ran(connection, pattern) {
    return connection.statements.filter((s) => pattern.test(s.sql));
}

function logRow(overrides = {}) {
    return {
        id: 1,
        order_id: ORDER,
        from_status: 'pending',
        to_status: 'shipped',
        changed_by: ADMIN,
        changed_by_name: 'Admin',
        actor_name: 'Priya',
        source: 'admin',
        reason: 'Handed to courier',
        metadata: '{"tracking":"AWB1"}',
        ip_address: '203.0.113.4',
        user_agent: 'Mozilla/5.0',
        created_at: '2026-02-01 10:00:00',
        ...overrides
    };
}

beforeEach(() => {
    jest.clearAllMocks();
    db.query.mockResolvedValue([[]]);
});

// ---------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------

describe('recordTransition', () => {
    // The whole point: same connection, therefore same transaction, therefore
    // the history and the status cannot disagree.
    it('writes on the connection it is given, not on the pool', async () => {
        const connection = fakeConnection();

        await service.recordTransition(connection, {
            orderId: ORDER,
            fromStatus: 'pending',
            toStatus: 'shipped'
        });

        expect(ran(connection, /INSERT INTO order_status_logs/)).toHaveLength(1);
        expect(db.query).not.toHaveBeenCalled();
    });

    it('records the actor, the source and the reason', async () => {
        const connection = fakeConnection();

        await service.recordTransition(connection, {
            orderId: ORDER,
            fromStatus: 'pending',
            toStatus: 'cancelled',
            source: 'customer',
            changedBy: 'user-7',
            changedByName: 'Asha',
            reason: 'Ordered the wrong size'
        });

        const [insert] = ran(connection, /INSERT INTO order_status_logs/);

        expect(insert.params).toEqual(
            expect.arrayContaining(['user-7', 'Asha', 'customer', 'Ordered the wrong size'])
        );
    });

    // A timeline of "shipped -> shipped" buries the transitions that matter,
    // and hides duplicate-write bugs rather than exposing them.
    it('skips a transition that changes nothing', async () => {
        const connection = fakeConnection();

        const result = await service.recordTransition(connection, {
            orderId: ORDER,
            fromStatus: 'shipped',
            toStatus: 'shipped'
        });

        expect(result).toEqual({ recorded: false, skipped: 'no_change' });
        expect(connection.query).not.toHaveBeenCalled();
    });

    it('records the first entry, which has no previous status', async () => {
        const connection = fakeConnection();

        const result = await service.recordTransition(connection, {
            orderId: ORDER,
            fromStatus: null,
            toStatus: 'pending'
        });

        expect(result.recorded).toBe(true);
    });

    // A history write must never be the thing that fails a status change.
    it('reports a malformed entry rather than throwing', async () => {
        const connection = fakeConnection();

        const result = await service.recordTransition(connection, { toStatus: 'shipped' });

        expect(result).toEqual({ recorded: false, skipped: 'missing_fields' });
        expect(connection.query).not.toHaveBeenCalled();
    });

    it('coerces an unrecognised source instead of storing it', async () => {
        const connection = fakeConnection();

        await service.recordTransition(connection, {
            orderId: ORDER,
            toStatus: 'shipped',
            source: "'; DROP TABLE orders; --"
        });

        const [insert] = ran(connection, /INSERT INTO order_status_logs/);
        expect(insert.params).toContain('system');
    });

    it('serialises metadata as JSON', async () => {
        const connection = fakeConnection();

        await service.recordTransition(connection, {
            orderId: ORDER,
            toStatus: 'shipped',
            metadata: { tracking: 'AWB1' }
        });

        const [insert] = ran(connection, /INSERT INTO order_status_logs/);
        expect(insert.params).toContain('{"tracking":"AWB1"}');
    });
});

// ---------------------------------------------------------------------------
// Timestamp columns
// ---------------------------------------------------------------------------

describe('status timestamps', () => {
    // These columns were in the schema from the start; only cancelled_at was
    // ever written, and only on the refund path.
    it.each(Object.entries(STATUS_TIMESTAMPS))(
        'stamps %s onto %s',
        async (status, column) => {
            const connection = fakeConnection();

            await service.recordTransition(connection, {
                orderId: ORDER,
                fromStatus: 'pending',
                toStatus: status
            });

            const [update] = ran(connection, /UPDATE orders SET/);
            expect(update.sql).toContain(column);
        }
    );

    it('leaves the original timestamp alone if a status is re-entered', async () => {
        const connection = fakeConnection();

        await service.recordTransition(connection, {
            orderId: ORDER,
            fromStatus: 'processing',
            toStatus: 'shipped'
        });

        const [update] = ran(connection, /UPDATE orders SET/);
        // COALESCE, so the first time an order shipped stays the ship date.
        expect(update.sql).toMatch(/COALESCE\(shipped_at, NOW\(\)\)/);
    });

    it('does not stamp anything for a status with no column', async () => {
        const connection = fakeConnection();

        await service.recordTransition(connection, {
            orderId: ORDER,
            fromStatus: 'pending',
            toStatus: 'processing'
        });

        expect(ran(connection, /UPDATE orders SET/)).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

describe('getHistory', () => {
    it('returns entries oldest first', async () => {
        db.query.mockResolvedValueOnce([[logRow()]]);

        await service.getHistory(ORDER);

        expect(db.query.mock.calls[0][0]).toMatch(/ORDER BY l\.created_at ASC/);
    });

    it('gives each entry a customer-readable title', async () => {
        db.query.mockResolvedValueOnce([[logRow({ to_status: 'shipped' })]]);

        const [entry] = await service.getHistory(ORDER);

        expect(entry.title).toBe(CUSTOMER_LABELS.shipped.title);
        expect(entry.description).toBeTruthy();
    });

    // A customer has no business knowing which staff account touched their
    // order, and the IP is support data.
    it('hides the actor, metadata and IP from a customer', async () => {
        db.query.mockResolvedValueOnce([[logRow()]]);

        const [entry] = await service.getHistory(ORDER);

        expect(entry.changedByName).toBeUndefined();
        expect(entry.ipAddress).toBeUndefined();
        expect(entry.metadata).toBeUndefined();
    });

    it('shows all of it to an admin', async () => {
        db.query.mockResolvedValueOnce([[logRow()]]);

        const [entry] = await service.getHistory(ORDER, { includeInternal: true });

        expect(entry.changedByName).toBe('Priya');
        expect(entry.ipAddress).toBe('203.0.113.4');
        expect(entry.metadata).toEqual({ tracking: 'AWB1' });
    });

    // An internal note about a fraud hold is not for the customer, but their
    // own stated cancellation reason is.
    it('hides an admin reason from the customer but shows their own', async () => {
        db.query.mockResolvedValueOnce([
            [
                logRow({ source: 'admin', reason: 'Suspected fraud' }),
                logRow({ id: 2, source: 'customer', reason: 'Changed my mind' })
            ]
        ]);

        const [adminEntry, customerEntry] = await service.getHistory(ORDER);

        expect(adminEntry.reason).toBeNull();
        expect(customerEntry.reason).toBe('Changed my mind');
    });

    it('survives a malformed metadata column', async () => {
        db.query.mockResolvedValueOnce([[logRow({ metadata: '{not json' })]]);

        const [entry] = await service.getHistory(ORDER, { includeInternal: true });

        expect(entry.metadata).toBeNull();
    });
});

describe('getTimeline', () => {
    it('marks the steps already reached as complete', async () => {
        db.query.mockResolvedValueOnce([
            [
                logRow({ id: 1, from_status: null, to_status: 'pending' }),
                logRow({ id: 2, from_status: 'pending', to_status: 'processing' })
            ]
        ]);

        const timeline = await service.getTimeline({ id: ORDER, status: 'processing' });

        const byStatus = Object.fromEntries(timeline.steps.map((s) => [s.status, s]));

        expect(byStatus.pending.complete).toBe(true);
        expect(byStatus.processing.current).toBe(true);
        expect(byStatus.delivered.complete).toBe(false);
    });

    // Couriers routinely report `delivered` with no intervening
    // `out_for_delivery` event. The order did ship, whatever the log says.
    it('treats earlier steps as complete when a step was skipped', async () => {
        db.query.mockResolvedValueOnce([
            [logRow({ id: 1, from_status: 'processing', to_status: 'delivered' })]
        ]);

        const timeline = await service.getTimeline({ id: ORDER, status: 'delivered' });

        const shipped = timeline.steps.find((s) => s.status === 'shipped');
        expect(shipped.complete).toBe(true);
    });

    // Cancelled is not a step toward delivery, and rendering it on the same
    // ladder would suggest a cancelled order is partway to arriving.
    it('renders no progress ladder for a cancelled order', async () => {
        db.query.mockResolvedValueOnce([
            [logRow({ id: 1, from_status: 'pending', to_status: 'cancelled' })]
        ]);

        const timeline = await service.getTimeline({ id: ORDER, status: 'cancelled' });

        expect(timeline.isCancelled).toBe(true);
        expect(timeline.steps).toEqual([]);
        expect(timeline.history).toHaveLength(1);
    });

    it('covers the happy path in order', async () => {
        db.query.mockResolvedValueOnce([[]]);

        const timeline = await service.getTimeline({ id: ORDER, status: 'pending' });

        expect(timeline.steps.map((s) => s.status)).toEqual(PROGRESS_STEPS);
    });
});

describe('getLastTransitionTo', () => {
    it('answers "when did this ship" without walking the history', async () => {
        db.query.mockResolvedValueOnce([[{ created_at: '2026-02-01 10:00:00' }]]);

        await expect(service.getLastTransitionTo(ORDER, 'shipped')).resolves.toBe(
            '2026-02-01 10:00:00'
        );
    });

    it('returns null when the order never reached that status', async () => {
        db.query.mockResolvedValueOnce([[]]);

        await expect(service.getLastTransitionTo(ORDER, 'delivered')).resolves.toBeNull();
    });
});

describe('getFulfilmentStats', () => {
    it('reports averages over the window', async () => {
        db.query.mockResolvedValueOnce([
            [{ total: 10, cancelled: 1, avg_hours_to_ship: 12.5, avg_hours_to_deliver: 48 }]
        ]);

        await expect(service.getFulfilmentStats({})).resolves.toEqual({
            total: 10,
            cancelled: 1,
            avgHoursToShip: 12.5,
            avgHoursToDeliver: 48
        });
    });

    // "No orders shipped in this window" and "orders shipped instantly" are
    // different answers; rounding the first to 0 reports the second.
    it('reports null, not zero, when nothing shipped', async () => {
        db.query.mockResolvedValueOnce([
            [{ total: 0, cancelled: 0, avg_hours_to_ship: null, avg_hours_to_deliver: null }]
        ]);

        const stats = await service.getFulfilmentStats({});

        expect(stats.avgHoursToShip).toBeNull();
        expect(stats.avgHoursToDeliver).toBeNull();
        expect(stats.total).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// Request metadata
// ---------------------------------------------------------------------------

describe('request extraction', () => {
    it('prefers the first entry of X-Forwarded-For', () => {
        expect(
            service.extractIp({
                headers: { 'x-forwarded-for': '203.0.113.4, 10.0.0.1' },
                ip: '10.0.0.1'
            })
        ).toBe('203.0.113.4');
    });

    it('falls back to the socket address', () => {
        expect(service.extractIp({ headers: {}, ip: '198.51.100.9' })).toBe('198.51.100.9');
    });

    // The header is attacker-controlled; an oversized value would otherwise
    // fail the INSERT and therefore the whole status change.
    it('truncates an oversized header to the column width', () => {
        const ip = service.extractIp({ headers: { 'x-forwarded-for': 'a'.repeat(500) } });

        expect(ip).toHaveLength(45);
    });

    it('copes with no request at all, as automated changes have none', () => {
        expect(service.extractIp(null)).toBeNull();
        expect(service.extractUserAgent(null)).toBeNull();
    });
});

describe('constants', () => {
    it('names every source the application uses', () => {
        expect(SOURCES).toEqual(
            expect.arrayContaining(['admin', 'customer', 'courier', 'system', 'payment'])
        );
    });

    it('has a customer-facing label for every progress step', () => {
        for (const step of PROGRESS_STEPS) {
            expect(CUSTOMER_LABELS[step]).toBeDefined();
            expect(CUSTOMER_LABELS[step].title).toBeTruthy();
        }
    });
});
