// backend/tests/requireOwnership.test.js
//
// The middleware is driven with an injected loader throughout, so nothing here
// reaches MySQL. config/db is mocked because requiring the module pulls in the
// pool for the `ownerFromTable` convenience loader.

jest.mock('../config/db', () => ({
    query: jest.fn()
}));

const db = require('../config/db');
const { requireOwnership, ownerFromTable, callerId } = require('../middleware/requireOwnership');
const { isPolicyMiddleware, PERMISSIONS } = require('../config/policy');

const OWNER_ID = 'e0f1a2b3-c4d5-4e6f-8a9b-0c1d2e3f4a5b';
const STRANGER_ID = '11112222-3333-4444-5555-666677778888';

const createMockResponse = () => ({
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis()
});

const invoke = async (middleware, req) => {
    const res = createMockResponse();
    const next = jest.fn();
    await middleware(req, res, next);
    return { res, next };
};

const ownedBy = (ownerId) => jest.fn().mockResolvedValue(ownerId);

describe('requireOwnership', () => {
    afterEach(() => {
        jest.clearAllMocks();
    });

    test('rejects a factory built without a loader', () => {
        expect(() => requireOwnership()).toThrow(/loader/);
        expect(() => requireOwnership('orders')).toThrow(/loader/);
    });

    test('rejects a bypass permission that does not exist', () => {
        expect(() => requireOwnership(ownedBy(OWNER_ID), {
            privilegedPermission: 'orders:read:everything'
        })).toThrow(/Unknown permission/);
    });

    test('lets the owner through', async () => {
        const guard = requireOwnership(ownedBy(OWNER_ID));
        const { res, next } = await invoke(guard, {
            user: { id: OWNER_ID, role: 'customer' },
            params: { id: '7' }
        });

        expect(next).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalled();
    });

    test('accepts the token shape that carries userId instead of id', async () => {
        const guard = requireOwnership(ownedBy(OWNER_ID));
        const { next } = await invoke(guard, {
            user: { userId: OWNER_ID, role: 'customer' },
            params: { id: '7' }
        });

        expect(next).toHaveBeenCalled();
        expect(callerId({ user: { userId: OWNER_ID } })).toBe(OWNER_ID);
    });

    test('compares ids across the string/number divide', async () => {
        const guard = requireOwnership(ownedBy(41));
        const { next } = await invoke(guard, {
            user: { id: '41', role: 'customer' },
            params: { id: '7' }
        });

        expect(next).toHaveBeenCalled();
    });

    // 404 rather than 403: a 403 would confirm the id exists, which turns the
    // endpoint into an enumeration oracle for other accounts' resources.
    test('answers 404, not 403, for a resource owned by somebody else', async () => {
        const guard = requireOwnership(ownedBy(STRANGER_ID), { resourceName: 'Order' });
        const { res, next } = await invoke(guard, {
            user: { id: OWNER_ID, role: 'customer' },
            params: { id: '7' }
        });

        expect(res.status).toHaveBeenCalledWith(404);
        expect(res.json).toHaveBeenCalledWith({ success: false, message: 'Order not found' });
        expect(next).not.toHaveBeenCalled();
    });

    test('answers the same 404 when the resource does not exist', async () => {
        const guard = requireOwnership(ownedBy(null), { resourceName: 'Order' });
        const { res } = await invoke(guard, {
            user: { id: OWNER_ID, role: 'customer' },
            params: { id: '7' }
        });

        expect(res.status).toHaveBeenCalledWith(404);
        expect(res.json).toHaveBeenCalledWith({ success: false, message: 'Order not found' });
    });

    test('answers 401 when nobody is authenticated', async () => {
        const loader = ownedBy(OWNER_ID);
        const { res, next } = await invoke(requireOwnership(loader), { params: { id: '7' } });

        expect(res.status).toHaveBeenCalledWith(401);
        expect(loader).not.toHaveBeenCalled();
        expect(next).not.toHaveBeenCalled();
    });

    test('answers 500 when the loader fails', async () => {
        const loader = jest.fn().mockRejectedValue(new Error('connection lost'));
        jest.spyOn(console, 'error').mockImplementation(() => {});

        const { res, next } = await invoke(requireOwnership(loader), {
            user: { id: OWNER_ID, role: 'customer' },
            params: { id: '7' }
        });

        expect(res.status).toHaveBeenCalledWith(500);
        expect(next).not.toHaveBeenCalled();

        console.error.mockRestore();
    });

    describe('privileged bypass', () => {
        test('an admin reaches a resource it does not own', async () => {
            const loader = ownedBy(STRANGER_ID);
            const { next } = await invoke(requireOwnership(loader), {
                user: { id: OWNER_ID, role: 'admin' },
                params: { id: '7' }
            });

            expect(next).toHaveBeenCalled();
            expect(loader).not.toHaveBeenCalled();
        });

        test('a superadmin reaches it too', async () => {
            const { next } = await invoke(requireOwnership(ownedBy(STRANGER_ID)), {
                user: { id: OWNER_ID, role: 'superadmin' },
                params: { id: '7' }
            });

            expect(next).toHaveBeenCalled();
        });

        test('support does not, absent an explicit permission', async () => {
            const { res } = await invoke(requireOwnership(ownedBy(STRANGER_ID)), {
                user: { id: OWNER_ID, role: 'support' },
                params: { id: '7' }
            });

            expect(res.status).toHaveBeenCalledWith(404);
        });

        test('a named permission can widen the bypass', async () => {
            const guard = requireOwnership(ownedBy(STRANGER_ID), {
                privilegedPermission: PERMISSIONS.ORDER_READ_ANY
            });
            const { next } = await invoke(guard, {
                user: { id: OWNER_ID, role: 'support' },
                params: { id: '7' }
            });

            expect(next).toHaveBeenCalled();
        });

        test('allowPrivileged false closes it to everyone', async () => {
            const guard = requireOwnership(ownedBy(STRANGER_ID), { allowPrivileged: false });
            const { res } = await invoke(guard, {
                user: { id: OWNER_ID, role: 'superadmin' },
                params: { id: '7' }
            });

            expect(res.status).toHaveBeenCalledWith(404);
        });
    });

    test('is recognisable to the route audit', () => {
        expect(isPolicyMiddleware(requireOwnership(ownedBy(OWNER_ID)))).toBe(true);
    });
});

describe('ownerFromTable', () => {
    afterEach(() => {
        jest.clearAllMocks();
    });

    test('refuses identifiers that are not plain SQL names', () => {
        expect(() => ownerFromTable({ table: 'orders; DROP TABLE users' })).toThrow(/Invalid SQL identifier/);
        expect(() => ownerFromTable({ table: 'orders', column: 'user_id) --' })).toThrow(/Invalid SQL identifier/);
    });

    test('reads the owner from the configured column', async () => {
        db.query.mockResolvedValue([[{ ownerId: OWNER_ID }]]);

        const load = ownerFromTable({ table: 'orders' });
        const ownerId = await load({ params: { id: '7' } });

        expect(ownerId).toBe(OWNER_ID);
        expect(db.query).toHaveBeenCalledWith(expect.stringContaining('orders'), ['7']);
    });

    test('reads the id from the named route parameter', async () => {
        db.query.mockResolvedValue([[{ ownerId: OWNER_ID }]]);

        const load = ownerFromTable({ table: 'reviews', param: 'reviewId' });
        await load({ params: { id: 'product-1', reviewId: '9' } });

        expect(db.query).toHaveBeenCalledWith(expect.any(String), ['9']);
    });

    test('returns null for a missing row or a missing parameter', async () => {
        const load = ownerFromTable({ table: 'orders' });

        db.query.mockResolvedValue([[]]);
        await expect(load({ params: { id: '7' } })).resolves.toBeNull();

        await expect(load({ params: {} })).resolves.toBeNull();
    });
});
