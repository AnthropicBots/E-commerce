// backend/tests/address.test.js
//
// Saved address book (#1347).
//
// The database is mocked at the module boundary, as every healthy suite in this
// repo does. What is worth testing here is not SQL but the invariants that make
// an address book behave sanely, each of which spans more than one row:
//
//   * the first address saved becomes the default;
//   * promoting a default demotes the previous one, atomically;
//   * deleting the default promotes a survivor rather than leaving none;
//   * an address belonging to somebody else is *not found*, never forbidden.

jest.mock('../config/db', () => ({
    query: jest.fn(),
    getConnection: jest.fn()
}));

const db = require('../config/db');
const addressService = require('../services/addressService');
const { AddressError, formatAddressLine } = require('../services/addressService');
const {
    validateAddress,
    normalizePlaceName,
    normalizePostalCode,
    normalizePhone
} = require('../validators/addressValidator');

const USER = 'user-123';
const OTHER_USER = 'user-999';

/** A valid create payload. */
function validPayload(overrides = {}) {
    return {
        label: 'Home',
        recipientName: 'Asha Menon',
        recipientPhone: '+919876543210',
        addressLine1: '12 Marine Drive',
        addressLine2: 'Flat 4B',
        city: 'Mumbai',
        state: 'Maharashtra',
        postalCode: '400020',
        country: 'India',
        ...overrides
    };
}

/** A stored row as MySQL would hand it back. */
function storedRow(overrides = {}) {
    return {
        id: 'addr-1',
        user_id: USER,
        label: 'Home',
        recipient_name: 'Asha Menon',
        recipient_phone: '+919876543210',
        address_line1: '12 Marine Drive',
        address_line2: 'Flat 4B',
        landmark: null,
        city: 'Mumbai',
        state: 'Maharashtra',
        postal_code: '400020',
        country: 'India',
        is_default: 1,
        last_used_at: null,
        created_at: '2026-01-01 00:00:00',
        updated_at: '2026-01-01 00:00:00',
        ...overrides
    };
}

/**
 * A fake pooled connection that records the statements it ran, so tests can
 * assert on ordering (demote before promote) rather than only on outcomes.
 */
function fakeConnection() {
    const statements = [];

    const connection = {
        statements,
        beginTransaction: jest.fn().mockResolvedValue(undefined),
        commit: jest.fn().mockResolvedValue(undefined),
        rollback: jest.fn().mockResolvedValue(undefined),
        release: jest.fn(),
        query: jest.fn(async (sql, params) => {
            statements.push({ sql, params });

            if (/COUNT\(\*\)/i.test(sql)) {
                return [[{ total: connection.__count ?? 0 }]];
            }
            if (/FOR UPDATE/i.test(sql)) {
                return [connection.__locked ? [connection.__locked] : []];
            }
            if (/ORDER BY last_used_at IS NULL/i.test(sql)) {
                return [connection.__survivors || []];
            }
            return [{ affectedRows: 1 }];
        })
    };

    return connection;
}

/** Statements matching a pattern, in the order they ran. */
function matching(connection, pattern) {
    return connection.statements.filter((s) => pattern.test(s.sql));
}

beforeEach(() => {
    jest.clearAllMocks();
    db.query.mockResolvedValue([[]]);
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

describe('validateAddress', () => {
    it('accepts a complete address', () => {
        const result = validateAddress(validPayload());

        expect(result.valid).toBe(true);
        expect(result.errors).toEqual([]);
    });

    it.each([
        ['recipientName'],
        ['recipientPhone'],
        ['addressLine1'],
        ['city'],
        ['state'],
        ['postalCode']
    ])('rejects a missing %s and names the field', (field) => {
        const payload = validPayload();
        delete payload[field];

        const result = validateAddress(payload);

        expect(result.valid).toBe(false);
        expect(result.errors.join(' ')).toContain(field);
    });

    it('reports every problem at once rather than the first', () => {
        const result = validateAddress({ recipientName: '', city: '' });

        expect(result.errors.length).toBeGreaterThan(2);
    });

    it('defaults label to Home and country to India on a create', () => {
        const payload = validPayload();
        delete payload.label;
        delete payload.country;

        const { value } = validateAddress(payload);

        expect(value.label).toBe('Home');
        expect(value.country).toBe('India');
    });

    it('rejects a postal code that is not one', () => {
        const result = validateAddress(validPayload({ postalCode: '!!' }));

        expect(result.valid).toBe(false);
        expect(result.errors.join(' ')).toContain('postalCode');
    });

    it('rejects a phone number that is too short', () => {
        const result = validateAddress(validPayload({ recipientPhone: '123' }));

        expect(result.valid).toBe(false);
        expect(result.errors.join(' ')).toContain('recipientPhone');
    });

    // Length is a valid name; punctuation is not.
    it('rejects a recipient name with no letters in it', () => {
        const result = validateAddress(validPayload({ recipientName: '---' }));

        expect(result.valid).toBe(false);
        expect(result.errors.join(' ')).toContain('recipientName');
    });

    it('rejects a value longer than its column', () => {
        const result = validateAddress(validPayload({ city: 'x'.repeat(101) }));

        expect(result.valid).toBe(false);
        expect(result.errors.join(' ')).toContain('city');
    });

    it('rejects a non-boolean isDefault', () => {
        const result = validateAddress(validPayload({ isDefault: 'yes' }));

        expect(result.valid).toBe(false);
        expect(result.errors.join(' ')).toContain('isDefault');
    });

    describe('partial mode', () => {
        it('allows an absent required field', () => {
            const result = validateAddress({ label: 'Work' }, { partial: true });

            expect(result.valid).toBe(true);
            expect(result.value).toEqual({ label: 'Work' });
        });

        // Absent means "leave it alone". Explicitly empty means "blank a NOT
        // NULL column", which is a different request and is refused.
        it('still rejects an explicitly emptied required field', () => {
            const result = validateAddress({ city: '   ' }, { partial: true });

            expect(result.valid).toBe(false);
            expect(result.errors.join(' ')).toContain('city');
        });

        it('does not invent defaults', () => {
            const { value } = validateAddress({ label: 'Work' }, { partial: true });

            expect(value.country).toBeUndefined();
        });
    });
});

describe('normalisation', () => {
    it('title-cases place names so one city is not stored two ways', () => {
        expect(normalizePlaceName('mumbai')).toBe('Mumbai');
        expect(normalizePlaceName('NEW DELHI')).toBe('New Delhi');
        expect(normalizePlaceName('port-au-prince')).toBe('Port-Au-Prince');
        expect(normalizePlaceName("o'fallon")).toBe("O'Fallon");
    });

    it('uppercases postal codes and collapses spacing', () => {
        expect(normalizePostalCode('  sw1a  1aa ')).toBe('SW1A 1AA');
    });

    it('strips display separators from phone numbers but keeps the plus', () => {
        expect(normalizePhone('+91 98765-43210')).toBe('+919876543210');
    });

    it('collapses whitespace inside pasted address lines', () => {
        const { value } = validateAddress(
            validPayload({ addressLine1: '12   Marine\n Drive ' })
        );

        expect(value.addressLine1).toBe('12 Marine Drive');
    });
});

describe('formatAddressLine', () => {
    it('joins the parts that are present', () => {
        expect(
            formatAddressLine({
                addressLine1: '12 Marine Drive',
                addressLine2: 'Flat 4B',
                city: 'Mumbai',
                state: 'Maharashtra',
                postalCode: '400020',
                country: 'India'
            })
        ).toBe('12 Marine Drive, Flat 4B, Mumbai, Maharashtra, 400020, India');
    });

    // Otherwise an address with no line 2 renders as "12 Main St, , Mumbai".
    it('drops empty parts rather than rendering blanks', () => {
        expect(
            formatAddressLine({
                addressLine1: '12 Marine Drive',
                addressLine2: null,
                city: 'Mumbai',
                state: 'Maharashtra',
                postalCode: '400020',
                country: 'India'
            })
        ).toBe('12 Marine Drive, Mumbai, Maharashtra, 400020, India');
    });
});

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

describe('listAddresses', () => {
    it('scopes the query to the caller and excludes deleted rows', async () => {
        db.query.mockResolvedValueOnce([[storedRow()]]);

        const addresses = await addressService.listAddresses(USER);

        expect(addresses).toHaveLength(1);
        expect(db.query).toHaveBeenCalledWith(
            expect.stringContaining('deleted_at IS NULL'),
            [USER]
        );
    });

    it('orders the default first', async () => {
        db.query.mockResolvedValueOnce([[]]);

        await addressService.listAddresses(USER);

        const [sql] = db.query.mock.calls[0];
        expect(sql).toMatch(/ORDER BY is_default DESC/);
    });

    // TINYINT out of MySQL: `if (address.is_default)` would be true for "0".
    it('converts is_default to a real boolean', async () => {
        db.query.mockResolvedValueOnce([[storedRow({ is_default: 0 })]]);

        const [address] = await addressService.listAddresses(USER);

        expect(address.isDefault).toBe(false);
    });

    it('does not leak internal columns', async () => {
        db.query.mockResolvedValueOnce([[storedRow()]]);

        const [address] = await addressService.listAddresses(USER);

        expect(address).not.toHaveProperty('deleted_at');
        expect(address).not.toHaveProperty('default_marker');
        expect(address).not.toHaveProperty('user_id');
    });

    it('rejects an unauthenticated caller', async () => {
        await expect(addressService.listAddresses(null)).rejects.toThrow(AddressError);
    });
});

describe('getAddress', () => {
    it('returns the address when the caller owns it', async () => {
        db.query.mockResolvedValueOnce([[storedRow()]]);

        const address = await addressService.getAddress(USER, 'addr-1');

        expect(address.id).toBe('addr-1');
    });

    // An address id is a handle to where somebody lives. A 403 would confirm
    // the id exists, which is the thing worth not confirming.
    it('reports another user\'s address as absent', async () => {
        db.query.mockResolvedValueOnce([[]]);

        const address = await addressService.getAddress(OTHER_USER, 'addr-1');

        expect(address).toBeNull();
        expect(db.query).toHaveBeenCalledWith(expect.any(String), ['addr-1', OTHER_USER]);
    });
});

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

describe('createAddress', () => {
    it('makes the first address the default even when not asked', async () => {
        const connection = fakeConnection();
        connection.__count = 0;
        db.getConnection.mockResolvedValue(connection);
        db.query.mockResolvedValue([[storedRow()]]);

        await addressService.createAddress(USER, validPayload({ isDefault: false }));

        const [insert] = matching(connection, /INSERT INTO user_addresses/);
        expect(insert.params[insert.params.length - 1]).toBe(1);
    });

    it('does not make a later address the default unless asked', async () => {
        const connection = fakeConnection();
        connection.__count = 2;
        db.getConnection.mockResolvedValue(connection);
        db.query.mockResolvedValue([[storedRow({ is_default: 0 })]]);

        await addressService.createAddress(USER, validPayload());

        const [insert] = matching(connection, /INSERT INTO user_addresses/);
        expect(insert.params[insert.params.length - 1]).toBe(0);
    });

    it('demotes the previous default before inserting a new one', async () => {
        const connection = fakeConnection();
        connection.__count = 2;
        db.getConnection.mockResolvedValue(connection);
        db.query.mockResolvedValue([[storedRow()]]);

        await addressService.createAddress(USER, validPayload({ isDefault: true }));

        const demoteIndex = connection.statements.findIndex((s) => /SET is_default = 0/.test(s.sql));
        const insertIndex = connection.statements.findIndex((s) => /INSERT INTO/.test(s.sql));

        expect(demoteIndex).toBeGreaterThan(-1);
        expect(demoteIndex).toBeLessThan(insertIndex);
        expect(connection.commit).toHaveBeenCalledTimes(1);
    });

    it('refuses to exceed the per-user cap', async () => {
        const connection = fakeConnection();
        connection.__count = 20;
        db.getConnection.mockResolvedValue(connection);

        await expect(
            addressService.createAddress(USER, validPayload())
        ).rejects.toMatchObject({ status: 409, code: 'ADDRESS_LIMIT_REACHED' });

        expect(matching(connection, /INSERT INTO/)).toHaveLength(0);
        expect(connection.rollback).toHaveBeenCalledTimes(1);
    });

    it('rolls back and releases the connection when the insert fails', async () => {
        const connection = fakeConnection();
        connection.__count = 0;
        connection.query.mockImplementationOnce(async () => [[{ total: 0 }]]);
        connection.query.mockImplementationOnce(async () => {
            throw new Error('deadlock');
        });
        db.getConnection.mockResolvedValue(connection);

        await expect(addressService.createAddress(USER, validPayload())).rejects.toThrow(
            'deadlock'
        );

        expect(connection.commit).not.toHaveBeenCalled();
        expect(connection.rollback).toHaveBeenCalledTimes(1);
        expect(connection.release).toHaveBeenCalledTimes(1);
    });
});

// ---------------------------------------------------------------------------
// Update and default promotion
// ---------------------------------------------------------------------------

describe('updateAddress', () => {
    it('writes only the fields that were sent', async () => {
        const connection = fakeConnection();
        connection.__locked = { id: 'addr-1', user_id: USER, is_default: 0 };
        db.getConnection.mockResolvedValue(connection);
        db.query.mockResolvedValue([[storedRow()]]);

        await addressService.updateAddress(USER, 'addr-1', { label: 'Work' });

        const [update] = matching(connection, /UPDATE user_addresses\s+SET/);
        expect(update.sql).toContain('label = ?');
        expect(update.sql).not.toContain('recipient_name = ?');
    });

    it('reports an unknown id as not found', async () => {
        const connection = fakeConnection();
        connection.__locked = null;
        db.getConnection.mockResolvedValue(connection);

        await expect(
            addressService.updateAddress(USER, 'nope', { label: 'Work' })
        ).rejects.toMatchObject({ status: 404, code: 'ADDRESS_NOT_FOUND' });
    });

    // Clearing the only default would leave the account with addresses but
    // nothing to prefill checkout with.
    it('refuses to clear the default flag directly', async () => {
        const connection = fakeConnection();
        connection.__locked = { id: 'addr-1', user_id: USER, is_default: 1 };
        db.getConnection.mockResolvedValue(connection);

        await expect(
            addressService.updateAddress(USER, 'addr-1', { isDefault: false })
        ).rejects.toMatchObject({ status: 409, code: 'DEFAULT_REQUIRED' });
    });

    it('is a no-op when nothing was sent', async () => {
        const connection = fakeConnection();
        connection.__locked = { id: 'addr-1', user_id: USER, is_default: 0 };
        db.getConnection.mockResolvedValue(connection);
        db.query.mockResolvedValue([[storedRow()]]);

        await addressService.updateAddress(USER, 'addr-1', {});

        expect(matching(connection, /UPDATE user_addresses\s+SET/)).toHaveLength(0);
    });
});

describe('setDefaultAddress', () => {
    it('locks the row, demotes the old default, then promotes', async () => {
        const connection = fakeConnection();
        connection.__locked = { id: 'addr-2', user_id: USER, is_default: 0 };
        db.getConnection.mockResolvedValue(connection);
        db.query.mockResolvedValue([[storedRow({ id: 'addr-2' })]]);

        await addressService.setDefaultAddress(USER, 'addr-2');

        const order = connection.statements.map((s) => s.sql);
        const lock = order.findIndex((sql) => /FOR UPDATE/.test(sql));
        const demote = order.findIndex((sql) => /SET is_default = 0/.test(sql));
        const promote = order.findIndex((sql) => /SET is_default = 1/.test(sql));

        expect(lock).toBeLessThan(demote);
        expect(demote).toBeLessThan(promote);
        expect(connection.commit).toHaveBeenCalledTimes(1);
    });

    // Two concurrent promotions would otherwise both read is_default = 0 and
    // race the unique index.
    it('takes a row lock', async () => {
        const connection = fakeConnection();
        connection.__locked = { id: 'addr-2', user_id: USER, is_default: 0 };
        db.getConnection.mockResolvedValue(connection);
        db.query.mockResolvedValue([[storedRow()]]);

        await addressService.setDefaultAddress(USER, 'addr-2');

        expect(matching(connection, /FOR UPDATE/)).toHaveLength(1);
    });

    it('reports a foreign address as not found', async () => {
        const connection = fakeConnection();
        connection.__locked = null;
        db.getConnection.mockResolvedValue(connection);

        await expect(
            addressService.setDefaultAddress(OTHER_USER, 'addr-1')
        ).rejects.toMatchObject({ status: 404 });
    });
});

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

describe('deleteAddress', () => {
    it('soft-deletes rather than removing the row', async () => {
        const connection = fakeConnection();
        connection.__locked = { id: 'addr-1', user_id: USER, is_default: 0 };
        db.getConnection.mockResolvedValue(connection);

        await addressService.deleteAddress(USER, 'addr-1');

        expect(matching(connection, /DELETE FROM/)).toHaveLength(0);
        expect(matching(connection, /SET deleted_at = NOW\(\)/)).toHaveLength(1);
    });

    it('promotes the most recently used survivor when the default is removed', async () => {
        const connection = fakeConnection();
        connection.__locked = { id: 'addr-1', user_id: USER, is_default: 1 };
        connection.__survivors = [{ id: 'addr-2' }];
        db.getConnection.mockResolvedValue(connection);
        db.query.mockResolvedValue([[storedRow({ id: 'addr-2' })]]);

        const result = await addressService.deleteAddress(USER, 'addr-1');

        expect(result.newDefaultId).toBe('addr-2');
        expect(matching(connection, /SET is_default = 1/)).toHaveLength(1);
    });

    it('leaves no default when the deleted address was the last one', async () => {
        const connection = fakeConnection();
        connection.__locked = { id: 'addr-1', user_id: USER, is_default: 1 };
        connection.__survivors = [];
        db.getConnection.mockResolvedValue(connection);

        const result = await addressService.deleteAddress(USER, 'addr-1');

        expect(result.newDefaultId).toBeNull();
        expect(result.newDefault).toBeNull();
    });

    it('does not promote anything when a non-default is removed', async () => {
        const connection = fakeConnection();
        connection.__locked = { id: 'addr-2', user_id: USER, is_default: 0 };
        db.getConnection.mockResolvedValue(connection);

        const result = await addressService.deleteAddress(USER, 'addr-2');

        expect(result.newDefaultId).toBeNull();
        expect(matching(connection, /SET is_default = 1/)).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// Checkout integration
// ---------------------------------------------------------------------------

describe('resolveForOrder', () => {
    it('flattens a saved address into the shape the order row expects', async () => {
        db.query.mockResolvedValueOnce([[storedRow()]]);

        const resolved = await addressService.resolveForOrder(USER, 'addr-1');

        expect(resolved.addressId).toBe('addr-1');
        expect(resolved.customer).toEqual({
            name: 'Asha Menon',
            phone: '+919876543210'
        });
        expect(resolved.address).toEqual({
            city: 'Mumbai',
            state: 'Maharashtra',
            zip: '400020',
            fullAddress: '12 Marine Drive, Flat 4B, Mumbai, Maharashtra, 400020, India'
        });
    });

    // Otherwise an order could be placed against a stranger's address by
    // guessing an id.
    it('returns null for an address the caller does not own', async () => {
        db.query.mockResolvedValueOnce([[]]);

        await expect(addressService.resolveForOrder(OTHER_USER, 'addr-1')).resolves.toBeNull();
    });
});

describe('markAddressUsed', () => {
    it('stamps last_used_at', async () => {
        db.query.mockResolvedValueOnce([{ affectedRows: 1 }]);

        await expect(addressService.markAddressUsed(USER, 'addr-1')).resolves.toBe(true);
        expect(db.query).toHaveBeenCalledWith(
            expect.stringContaining('last_used_at = NOW()'),
            ['addr-1', USER]
        );
    });

    // A placed order must not fail because a timestamp could not be written.
    it('swallows a failure rather than surfacing it to checkout', async () => {
        db.query.mockRejectedValueOnce(new Error('write failed'));

        await expect(addressService.markAddressUsed(USER, 'addr-1')).resolves.toBe(false);
    });

    it('is a no-op without an address', async () => {
        await expect(addressService.markAddressUsed(USER, null)).resolves.toBe(false);
        expect(db.query).not.toHaveBeenCalled();
    });
});
