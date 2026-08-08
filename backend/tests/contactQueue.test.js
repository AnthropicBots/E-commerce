// backend/tests/contactQueue.test.js
//
// The support queue (#1495).
//
// `POST /api/contact` has been writing to `contact_messages` since #1445 and
// nothing has ever read the table -- no SELECT anywhere in the repository, no
// admin route, no screen. The customer got "Thanks, your message has reached
// us and we'll reply by email" and the row went somewhere nobody could look.
//
// So these tests are about the reads: what the queue returns, in what order,
// and what a status transition writes. The one that matters most is the last
// describe: `status`, `responded_at` and `responded_by` have existed since
// migration 0042 with no writer, and closing a message is the only thing that
// can fill them.

jest.mock('../config/db', () => ({
    query: jest.fn(),
    getConnection: jest.fn()
}));

const db = require('../config/db');
const contactService = require('../services/contactService');
const { ContactError } = require('../services/contactService');

const ADMIN = '55555555-5555-4555-8555-555555555555';

function messageRow(overrides = {}) {
    return {
        id: 3,
        user_id: null,
        name: 'Asha Menon',
        email: 'asha@example.com',
        subject: 'Order never arrived',
        message: 'My order was marked delivered but nothing turned up.',
        status: 'new',
        ip_address: '203.0.113.7',
        user_agent: 'Mozilla/5.0',
        responded_at: null,
        responded_by: null,
        created_at: '2026-06-01 09:00:00',
        updated_at: '2026-06-01 09:00:00',
        account_name: null,
        responder_name: null,
        ...overrides
    };
}

beforeEach(() => {
    jest.clearAllMocks();
    db.query.mockResolvedValue([[]]);
});

// ---------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------

describe('listMessages', () => {
    function mockList({ rows = [messageRow()], total = 1, counts = [] } = {}) {
        db.query
            .mockResolvedValueOnce([rows])
            .mockResolvedValueOnce([[{ total }]])
            .mockResolvedValueOnce([counts]);
    }

    test('returns the queue with paging and per-status counts', async () => {
        mockList({
            counts: [
                { status: 'new', total: 4 },
                { status: 'resolved', total: 9 }
            ],
            total: 13
        });

        const result = await contactService.listMessages();

        expect(result.messages).toHaveLength(1);
        expect(result.pagination).toEqual({
            page: 1,
            limit: 20,
            total: 13,
            totalPages: 1
        });
        // The number a support screen leads with. It cannot be derived from a
        // paginated list, which is why it is returned alongside one.
        expect(result.counts).toEqual({
            new: 4,
            in_progress: 0,
            resolved: 9,
            spam: 0
        });
    });

    test('orders oldest first', async () => {
        mockList();

        await contactService.listMessages();

        const [sql] = db.query.mock.calls[0];

        // A queue read newest-first buries the complaint that has been waiting
        // longest, which is the one that matters. The index in migration 0042
        // is on (status, created_at) for exactly this read.
        expect(sql).toMatch(/ORDER BY cm\.created_at ASC/);
    });

    test('filters by status', async () => {
        mockList();

        await contactService.listMessages({ status: 'new' });

        const [sql, params] = db.query.mock.calls[0];

        expect(sql).toMatch(/WHERE status = \?/);
        expect(params[0]).toBe('new');
    });

    test('refuses a status outside the enum', async () => {
        await expect(
            contactService.listMessages({ status: 'pending' })
        ).rejects.toMatchObject({ code: 'INVALID_STATUS' });

        expect(db.query).not.toHaveBeenCalled();
    });

    test('escapes LIKE metacharacters in the search term', async () => {
        mockList();

        await contactService.listMessages({ search: '100%_off' });

        const [, params] = db.query.mock.calls[0];

        // Unescaped, "100%" matches every row in the table.
        expect(params[0]).toBe('%100\\%\\_off%');
    });

    test('caps the page size', async () => {
        mockList();

        const result = await contactService.listMessages({ limit: 5000 });

        expect(result.pagination.limit).toBe(contactService.MAX_PAGE_SIZE);
    });

    test('treats junk paging as the defaults rather than failing', async () => {
        mockList();

        const result = await contactService.listMessages({ page: 'abc', limit: -3 });

        expect(result.pagination.page).toBe(1);
        expect(result.pagination.limit).toBe(1);
    });

    test('does not put the IP or user agent on the list', async () => {
        mockList();

        const result = await contactService.listMessages();

        // They are kept for abuse investigation and belong on a detail view,
        // not scattered across a screen somebody leaves open.
        expect(result.messages[0].ipAddress).toBeUndefined();
        expect(result.messages[0].userAgent).toBeUndefined();
    });

    test('reports the sender as the email even when the account is gone', async () => {
        // `user_id` is nullable and deliberately not cascaded: a message must
        // outlive the account that sent it, "or a shopper closing their
        // account erases the complaint that made them close it" (0042).
        mockList({ rows: [messageRow({ user_id: null })] });

        const result = await contactService.listMessages();

        expect(result.messages[0].account).toBeNull();
        expect(result.messages[0].email).toBe('asha@example.com');
    });
});

// ---------------------------------------------------------------------------
// The detail
// ---------------------------------------------------------------------------

describe('getMessage', () => {
    test('returns the message with the sender\'s other messages', async () => {
        db.query
            .mockResolvedValueOnce([[messageRow()]])
            .mockResolvedValueOnce([
                [{ id: 1, subject: 'Where is my refund', status: 'resolved', created_at: 'x' }]
            ]);

        const result = await contactService.getMessage(3);

        expect(result.id).toBe(3);
        expect(result.senderHistory).toHaveLength(1);

        // idx_contact_messages_email exists for this question and nothing
        // else was asking it.
        const [historySql, historyParams] = db.query.mock.calls[1];
        expect(historySql).toMatch(/WHERE email = \? AND id <> \?/);
        expect(historyParams).toEqual(['asha@example.com', 3]);
    });

    test('includes the abuse-handling fields', async () => {
        db.query
            .mockResolvedValueOnce([[messageRow()]])
            .mockResolvedValueOnce([[]]);

        const result = await contactService.getMessage(3);

        expect(result.ipAddress).toBe('203.0.113.7');
        expect(result.userAgent).toBe('Mozilla/5.0');
    });

    test('404s on a message that is not there', async () => {
        db.query.mockResolvedValueOnce([[]]);

        await expect(contactService.getMessage(999)).rejects.toMatchObject({
            status: 404,
            code: 'MESSAGE_NOT_FOUND'
        });
    });

    test('rejects an unusable id before querying', async () => {
        await expect(contactService.getMessage('abc')).rejects.toBeInstanceOf(ContactError);
        expect(db.query).not.toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// The transition
// ---------------------------------------------------------------------------

describe('updateStatus', () => {
    // Existence check, UPDATE, then the getMessage read-back and its history.
    function mockUpdate(row = messageRow({ status: 'resolved' })) {
        db.query
            .mockResolvedValueOnce([[{ id: row.id }]])
            .mockResolvedValueOnce([{ affectedRows: 1 }])
            .mockResolvedValueOnce([[row]])
            .mockResolvedValueOnce([[]]);
    }

    /** The UPDATE, which is the second statement now. */
    const updateCall = () => db.query.mock.calls[1];

    test('stamps responded_at and responded_by when a message is closed', async () => {
        mockUpdate();

        await contactService.updateStatus(3, 'resolved', ADMIN);

        const [sql, params] = updateCall();

        // These two columns have existed since migration 0042 with no writer
        // at all. This transition is the only thing that can fill them.
        expect(sql).toMatch(/responded_at = COALESCE\(responded_at, NOW\(\)\)/);
        expect(sql).toMatch(/responded_by = \?/);
        expect(params).toEqual(['resolved', ADMIN, 3]);
    });

    test('marking spam counts as closing it', async () => {
        mockUpdate(messageRow({ status: 'spam' }));

        await contactService.updateStatus(3, 'spam', ADMIN);

        const [sql] = updateCall();

        expect(sql).toMatch(/responded_by = \?/);
    });

    test('keeps the original responded_at when a closed message is closed again', async () => {
        mockUpdate();

        await contactService.updateStatus(3, 'resolved', ADMIN);

        // COALESCE, not NOW(): the first answer is when it was answered.
        expect(updateCall()[0]).toMatch(/COALESCE\(responded_at, NOW\(\)\)/);
    });

    test('re-opening clears the responder', async () => {
        mockUpdate(messageRow({ status: 'in_progress' }));

        await contactService.updateStatus(3, 'in_progress', ADMIN);

        const [sql, params] = updateCall();

        // A message that is in progress again has not been answered, and a
        // stale responder on it would say it had.
        expect(sql).toMatch(/responded_at = NULL/);
        expect(sql).toMatch(/responded_by = NULL/);
        expect(params).toEqual(['in_progress', 3]);
    });

    test.each(['pending', 'closed', 'RESOLVED_MAYBE', ''])(
        'refuses the status %p',
        async (status) => {
            await expect(
                contactService.updateStatus(3, status, ADMIN)
            ).rejects.toMatchObject({ code: 'INVALID_STATUS' });

            expect(db.query).not.toHaveBeenCalled();
        }
    );

    test('accepts a status in the wrong case', async () => {
        mockUpdate();

        await contactService.updateStatus(3, 'RESOLVED', ADMIN);

        expect(updateCall()[1][0]).toBe('resolved');
    });

    test('refuses without an acting admin', async () => {
        await expect(
            contactService.updateStatus(3, 'resolved', null)
        ).rejects.toMatchObject({ status: 401 });
    });

    test('404s when there is no such message', async () => {
        db.query.mockResolvedValueOnce([[]]);

        await expect(
            contactService.updateStatus(999, 'resolved', ADMIN)
        ).rejects.toMatchObject({ status: 404 });

        // And does not attempt the UPDATE.
        expect(db.query).toHaveBeenCalledTimes(1);
    });

    test('setting the status it already holds is not a 404', async () => {
        // Existence is established by reading the row, not by the UPDATE's
        // affectedRows. mysql2 is not connected with CLIENT_FOUND_ROWS, so
        // affectedRows counts rows *changed* -- re-resolving an already
        // resolved thread changes nothing and reports 0, which read as "no
        // such message" for a message the caller is looking straight at.
        // Support does that by reflex, so it is not a corner case.
        db.query
            .mockResolvedValueOnce([[{ id: 3 }]])
            .mockResolvedValueOnce([{ affectedRows: 0 }])
            .mockResolvedValueOnce([[messageRow({ status: 'resolved' })]])
            .mockResolvedValueOnce([[]]);

        const result = await contactService.updateStatus(3, 'resolved', ADMIN);

        expect(result.status).toBe('resolved');
    });
});

// ---------------------------------------------------------------------------
// The writer is unchanged
// ---------------------------------------------------------------------------

describe('recordMessage', () => {
    test('still inserts exactly what it did before', async () => {
        db.query.mockResolvedValueOnce([{ insertId: 7 }]);

        const id = await contactService.recordMessage(
            {
                name: 'Asha',
                email: 'asha@example.com',
                subject: 'Hello',
                message: 'A message long enough to pass validation.'
            },
            { userId: null, ipAddress: '203.0.113.7', userAgent: 'x' }
        );

        expect(id).toBe(7);
        expect(db.query.mock.calls[0][0]).toMatch(/INSERT INTO contact_messages/);
    });
});
