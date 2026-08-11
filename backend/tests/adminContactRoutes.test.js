// backend/tests/adminContactRoutes.test.js
//
// The admin surface over the support queue (#1495).
//
// The service tests cover what the queue returns. These cover the thing that
// was actually missing: that there is somewhere to ask from, that it is behind
// the admin guard, and that "/summary" is not swallowed by "/:id".
//
// The gating assertions are not ceremony. `contact_messages` holds names, email
// addresses, free-text complaints, IP addresses and user agents for people who
// may not even have an account -- the form is open to anyone. A route over that
// table that answers a signed-in shopper is a data breach, so it is asserted
// rather than assumed.

let mockUser = { id: '55555555-5555-4555-8555-555555555555', role: 'admin' };

jest.mock('../middleware/authMiddleware', () => {
    const stub = (req, res, next) => {
        if (!mockUser) {
            return res
                .status(401)
                .json({ success: false, message: 'Authentication required' });
        }
        req.user = mockUser;
        next();
    };
    stub.optionalAuth = (req, res, next) => {
        if (mockUser) req.user = mockUser;
        next();
    };
    return stub;
});

// `adminMiddleware` re-reads the user from the database before it looks at the
// role, so the stub answers the users lookup from `mockUser`.
jest.mock('../config/db', () => ({
    query: jest.fn(async (sql, params) => {
        if (/FROM users/i.test(sql) && mockUser && params?.[0] === mockUser.id) {
            return [
                [
                    {
                        id: mockUser.id,
                        email: `${mockUser.role}@example.test`,
                        name: mockUser.role,
                        role: mockUser.role,
                        is_active: 1,
                        is_verified: 1
                    }
                ]
            ];
        }
        return [[]];
    }),
    getConnection: jest.fn()
}));

jest.mock('../services/contactService', () => {
    class ContactError extends Error {
        constructor(message, status = 400, code = 'CONTACT_ERROR') {
            super(message);
            this.status = status;
            this.code = code;
        }
    }

    return {
        ContactError,
        STATUSES: ['new', 'in_progress', 'resolved', 'spam'],
        listMessages: jest.fn(),
        countByStatus: jest.fn(),
        getMessage: jest.fn(),
        updateStatus: jest.fn()
    };
});

// The admin limiter is real rate limiting with real counters; it would make
// these tests order-dependent for no benefit, and it is not what is under test.
jest.mock('../middleware/authLimiter', () => ({
    adminLimiter: (req, res, next) => next(),
    authLimiter: (req, res, next) => next(),
    contactFormLimiter: (req, res, next) => next()
}));

const express = require('express');
const request = require('supertest');

const contactService = require('../services/contactService');
const { ContactError } = require('../services/contactService');
const adminRoutes = require('../routes/adminRoutes');

const app = express();
app.use(express.json());
app.use('/api/admin', adminRoutes);

const ADMIN = { id: '55555555-5555-4555-8555-555555555555', role: 'admin' };
const SHOPPER = { id: '66666666-6666-4666-8666-666666666666', role: 'user' };

const MESSAGE = {
    id: 3,
    name: 'Asha Menon',
    email: 'asha@example.com',
    subject: 'Order never arrived',
    status: 'new',
    createdAt: '2026-06-01T09:00:00.000Z'
};

beforeEach(() => {
    jest.clearAllMocks();
    mockUser = ADMIN;
});

describe('GET /api/admin/contact-messages', () => {
    test('returns the queue', async () => {
        contactService.listMessages.mockResolvedValue({
            messages: [MESSAGE],
            pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
            counts: { new: 1, in_progress: 0, resolved: 0, spam: 0 }
        });

        const res = await request(app).get('/api/admin/contact-messages');

        expect(res.status).toBe(200);
        expect(res.body.data.messages).toHaveLength(1);
    });

    test('passes the filters through', async () => {
        contactService.listMessages.mockResolvedValue({
            messages: [],
            pagination: {},
            counts: {}
        });

        await request(app).get(
            '/api/admin/contact-messages?status=new&search=refund&email=a%40b.c&page=2&limit=10'
        );

        expect(contactService.listMessages).toHaveBeenCalledWith({
            status: 'new',
            search: 'refund',
            email: 'a@b.c',
            page: '2',
            limit: '10'
        });
    });

    test('an unrecognised status filter comes back as a 400, not a 500', async () => {
        // The service refuses it before the query, with the list of what is
        // accepted, rather than letting the column reject it in strict mode
        // with a message nobody can act on.
        contactService.listMessages.mockRejectedValue(
            new ContactError('status must be one of: …', 400, 'INVALID_STATUS')
        );

        const res = await request(app).get('/api/admin/contact-messages?status=pending');

        expect(res.status).toBe(400);
        expect(res.body.code).toBe('INVALID_STATUS');
    });

    test('is refused to a signed-in shopper', async () => {
        mockUser = SHOPPER;

        const res = await request(app).get('/api/admin/contact-messages');

        expect(res.status).toBe(403);
        expect(contactService.listMessages).not.toHaveBeenCalled();
    });

    test('is refused to an anonymous caller', async () => {
        mockUser = null;

        const res = await request(app).get('/api/admin/contact-messages');

        expect(res.status).toBe(401);
        expect(contactService.listMessages).not.toHaveBeenCalled();
    });

    test('uses the documented envelope', async () => {
        contactService.listMessages.mockResolvedValue({
            messages: [],
            pagination: {},
            counts: {}
        });

        const res = await request(app).get('/api/admin/contact-messages');

        expect(res.body).toEqual({
            success: true,
            message: expect.any(String),
            data: { messages: [], pagination: {}, counts: {} }
        });
    });
});

describe('GET /api/admin/contact-messages/summary', () => {
    test('is not captured by /:id', async () => {
        contactService.countByStatus.mockResolvedValue({
            new: 4,
            in_progress: 1,
            resolved: 9,
            spam: 2
        });

        const res = await request(app).get('/api/admin/contact-messages/summary');

        expect(res.status).toBe(200);
        expect(res.body.data.counts.new).toBe(4);
        // If declaration order slipped, this would have gone to getMessage
        // with id = "summary" and answered 400.
        expect(contactService.getMessage).not.toHaveBeenCalled();
    });

    test('is admin only', async () => {
        mockUser = SHOPPER;

        const res = await request(app).get('/api/admin/contact-messages/summary');

        expect(res.status).toBe(403);
    });
});

describe('GET /api/admin/contact-messages/:id', () => {
    test('returns one message', async () => {
        contactService.getMessage.mockResolvedValue({ ...MESSAGE, senderHistory: [] });

        const res = await request(app).get('/api/admin/contact-messages/3');

        expect(res.status).toBe(200);
        expect(res.body.data.message.id).toBe(3);
        expect(contactService.getMessage).toHaveBeenCalledWith('3');
    });

    test('a service error carries its own status', async () => {
        contactService.getMessage.mockRejectedValue(
            new ContactError('Message not found', 404, 'MESSAGE_NOT_FOUND')
        );

        const res = await request(app).get('/api/admin/contact-messages/999');

        expect(res.status).toBe(404);
        expect(res.body.code).toBe('MESSAGE_NOT_FOUND');
    });

    test('an unexpected failure does not leak its detail', async () => {
        jest.spyOn(console, 'error').mockImplementation(() => {});
        contactService.getMessage.mockRejectedValue(
            new Error("ER_NO_SUCH_TABLE: 'ecommerce.contact_messages'")
        );

        const res = await request(app).get('/api/admin/contact-messages/3');

        expect(res.status).toBe(500);
        expect(res.body.message).not.toMatch(/ER_NO_SUCH_TABLE/);

        console.error.mockRestore();
    });

    test('is admin only', async () => {
        mockUser = SHOPPER;

        const res = await request(app).get('/api/admin/contact-messages/3');

        expect(res.status).toBe(403);
    });
});

describe('PATCH /api/admin/contact-messages/:id/status', () => {
    test('records the transition against the acting admin', async () => {
        contactService.updateStatus.mockResolvedValue({
            ...MESSAGE,
            status: 'resolved'
        });

        const res = await request(app)
            .patch('/api/admin/contact-messages/3/status')
            .send({ status: 'resolved' });

        expect(res.status).toBe(200);
        expect(res.body.message).toBe('Message marked resolved');
        expect(contactService.updateStatus).toHaveBeenCalledWith('3', 'resolved', ADMIN.id);
    });

    test('a rejected status comes back as the service decided', async () => {
        contactService.updateStatus.mockRejectedValue(
            new ContactError('status must be one of: …', 400, 'INVALID_STATUS')
        );

        const res = await request(app)
            .patch('/api/admin/contact-messages/3/status')
            .send({ status: 'pending' });

        expect(res.status).toBe(400);
        expect(res.body.code).toBe('INVALID_STATUS');
    });

    test('is refused to a signed-in shopper', async () => {
        mockUser = SHOPPER;

        const res = await request(app)
            .patch('/api/admin/contact-messages/3/status')
            .send({ status: 'spam' });

        expect(res.status).toBe(403);
        expect(contactService.updateStatus).not.toHaveBeenCalled();
    });
});

describe('the table is no longer write-only', () => {
    test('contactService exposes reads beside the writer', () => {
        const real = jest.requireActual('../services/contactService');

        for (const name of ['listMessages', 'getMessage', 'updateStatus', 'countByStatus']) {
            expect(typeof real[name]).toBe('function');
        }
    });

    test('something in the repository SELECTs from contact_messages', () => {
        // Before this change the only occurrences of the table name in
        // backend/ were one comment, one INSERT and one filename in a test.
        const fs = require('fs');
        const path = require('path');

        const source = fs.readFileSync(
            path.join(__dirname, '..', 'services', 'contactService.js'),
            'utf8'
        );

        expect(source).toMatch(/SELECT[\s\S]*?FROM contact_messages/i);
        expect(source).toMatch(/UPDATE contact_messages/i);
    });
});
