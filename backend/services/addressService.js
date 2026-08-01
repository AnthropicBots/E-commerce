// backend/services/addressService.js
//
// Saved address book (#1347).
//
// Every rule that makes an address book behave sanely lives here rather than in
// the controller, because each one spans more than one row and therefore needs
// a transaction:
//
//   * the first address a user saves becomes their default;
//   * promoting a new default demotes the old one atomically;
//   * deleting the default promotes the most recently used survivor, so an
//     account is never left with addresses but no default;
//   * delete is soft, because `orders.address_id` references these rows.
//
// Ownership is enforced on reads as well as writes. An address id is a handle
// to where somebody lives, so a row belonging to another user is reported as
// *not found* rather than *forbidden* -- a 403 confirms the id exists, which is
// exactly the thing worth not confirming.

const crypto = require('crypto');
const db = require('../config/db');
const { safeArray, sanitizeString } = require('../utils/helpers');

// A cap, not a limit anyone will hit. It exists so the table cannot be used as
// free storage by a script.
const MAX_ADDRESSES_PER_USER = Number(process.env.MAX_ADDRESSES_PER_USER) || 20;

/** Columns returned to clients. `deleted_at`/`default_marker` stay internal. */
const PUBLIC_COLUMNS = `
    id, user_id, label, recipient_name, recipient_phone,
    address_line1, address_line2, landmark,
    city, state, postal_code, country,
    is_default, last_used_at, created_at, updated_at
`;

/**
 * Error carrying the HTTP status the controller should use.
 *
 * Without this the controller has to pattern-match on message text to decide
 * between 400, 404 and 409, which is how "not found" ends up returned as a 500.
 */
class AddressError extends Error {
    constructor(message, status = 400, code = 'ADDRESS_ERROR') {
        super(message);
        this.name = 'AddressError';
        this.status = status;
        this.code = code;
    }
}

/**
 * Shape a database row for the API.
 *
 * `is_default` is a TINYINT on the way out of MySQL; clients get a boolean, so
 * `if (address.is_default)` cannot be accidentally true for the string "0".
 */
function toPublicAddress(row) {
    if (!row) return null;

    return {
        id: row.id,
        label: row.label,
        recipientName: row.recipient_name,
        recipientPhone: row.recipient_phone,
        addressLine1: row.address_line1,
        addressLine2: row.address_line2 || null,
        landmark: row.landmark || null,
        city: row.city,
        state: row.state,
        postalCode: row.postal_code,
        country: row.country,
        isDefault: Boolean(row.is_default),
        lastUsedAt: row.last_used_at || null,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}

/**
 * Single-line rendering, for order snapshots and for the checkout picker.
 *
 * Empty parts are dropped rather than rendered as blanks, so an address with no
 * line 2 does not come out as "12 Main St, , Mumbai".
 */
function formatAddressLine(address) {
    return [
        address.addressLine1 || address.address_line1,
        address.addressLine2 || address.address_line2,
        address.landmark,
        address.city,
        address.state,
        address.postalCode || address.postal_code,
        address.country
    ]
        .map((part) => sanitizeString(part || ''))
        .filter(Boolean)
        .join(', ');
}

class AddressService {
    /**
     * Every live address for a user, default first, then most recently used.
     *
     * @param {string} userId
     * @returns {Promise<Array>}
     */
    async listAddresses(userId) {
        if (!userId) throw new AddressError('User is required', 401, 'UNAUTHENTICATED');

        const [rows] = await db.query(
            `SELECT ${PUBLIC_COLUMNS}
               FROM user_addresses
              WHERE user_id = ? AND deleted_at IS NULL
              ORDER BY is_default DESC, last_used_at IS NULL, last_used_at DESC, created_at DESC`,
            [userId]
        );

        return safeArray(rows).map(toPublicAddress);
    }

    /**
     * One address, scoped to its owner.
     *
     * @returns {Promise<object|null>} null when absent *or* owned by someone else
     */
    async getAddress(userId, addressId) {
        if (!userId) throw new AddressError('User is required', 401, 'UNAUTHENTICATED');
        if (!addressId) return null;

        const [rows] = await db.query(
            `SELECT ${PUBLIC_COLUMNS}
               FROM user_addresses
              WHERE id = ? AND user_id = ? AND deleted_at IS NULL
              LIMIT 1`,
            [addressId, userId]
        );

        return toPublicAddress(safeArray(rows)[0]);
    }

    /**
     * The user's default address, or null if they have none saved.
     */
    async getDefaultAddress(userId) {
        if (!userId) return null;

        const [rows] = await db.query(
            `SELECT ${PUBLIC_COLUMNS}
               FROM user_addresses
              WHERE user_id = ? AND is_default = 1 AND deleted_at IS NULL
              LIMIT 1`,
            [userId]
        );

        return toPublicAddress(safeArray(rows)[0]);
    }

    /**
     * How many live addresses a user has.
     */
    async countAddresses(userId, connection = db) {
        const [rows] = await connection.query(
            'SELECT COUNT(*) AS total FROM user_addresses WHERE user_id = ? AND deleted_at IS NULL',
            [userId]
        );
        return safeArray(rows)[0]?.total || 0;
    }

    /**
     * Save a new address.
     *
     * Runs in a transaction because making this address the default has to
     * demote the previous one, and the two writes must not be separable -- the
     * database's one-default-per-user index would reject the second write and
     * leave the first committed.
     *
     * @param {string} userId
     * @param {object} payload already validated by the route's validator
     * @returns {Promise<object>}
     */
    async createAddress(userId, payload) {
        if (!userId) throw new AddressError('User is required', 401, 'UNAUTHENTICATED');

        const connection = await db.getConnection();

        try {
            await connection.beginTransaction();

            const existingCount = await this.countAddresses(userId, connection);

            if (existingCount >= MAX_ADDRESSES_PER_USER) {
                throw new AddressError(
                    `You can save at most ${MAX_ADDRESSES_PER_USER} addresses. Delete one first.`,
                    409,
                    'ADDRESS_LIMIT_REACHED'
                );
            }

            // The first address is the default whether or not the caller asked
            // for it. An account with addresses but no default has nothing to
            // prefill checkout with, which defeats the point.
            const shouldBeDefault = payload.isDefault === true || existingCount === 0;

            if (shouldBeDefault) {
                await this.demoteCurrentDefault(userId, connection);
            }

            const id = crypto.randomUUID();

            await connection.query(
                `INSERT INTO user_addresses (
                    id, user_id, label, recipient_name, recipient_phone,
                    address_line1, address_line2, landmark,
                    city, state, postal_code, country, is_default
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    id,
                    userId,
                    payload.label,
                    payload.recipientName,
                    payload.recipientPhone,
                    payload.addressLine1,
                    payload.addressLine2 || null,
                    payload.landmark || null,
                    payload.city,
                    payload.state,
                    payload.postalCode,
                    payload.country,
                    shouldBeDefault ? 1 : 0
                ]
            );

            await connection.commit();

            return this.getAddress(userId, id);
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    /**
     * Update an address in place.
     *
     * Only the fields present in `payload` are written, so a client sending
     * `{ label: 'Work' }` does not blank out the recipient. An unknown or
     * foreign id is a 404.
     */
    async updateAddress(userId, addressId, payload) {
        if (!userId) throw new AddressError('User is required', 401, 'UNAUTHENTICATED');

        const connection = await db.getConnection();

        try {
            await connection.beginTransaction();

            const existing = await this.lockAddress(userId, addressId, connection);

            const FIELD_COLUMNS = {
                label: 'label',
                recipientName: 'recipient_name',
                recipientPhone: 'recipient_phone',
                addressLine1: 'address_line1',
                addressLine2: 'address_line2',
                landmark: 'landmark',
                city: 'city',
                state: 'state',
                postalCode: 'postal_code',
                country: 'country'
            };

            const assignments = [];
            const values = [];

            for (const [field, column] of Object.entries(FIELD_COLUMNS)) {
                if (payload[field] !== undefined) {
                    assignments.push(`${column} = ?`);
                    values.push(payload[field] === '' ? null : payload[field]);
                }
            }

            // Promotion is handled separately from the column writes: it needs
            // the demotion of the previous default in the same transaction.
            const promoting = payload.isDefault === true && !existing.is_default;

            if (promoting) {
                await this.demoteCurrentDefault(userId, connection);
                assignments.push('is_default = 1');
            }

            // Demoting the only default directly would leave the account with
            // none. Setting a *different* address as default is the way to move
            // it, which is what the endpoint below is for.
            if (payload.isDefault === false && existing.is_default) {
                throw new AddressError(
                    'Set another address as the default instead of clearing this one.',
                    409,
                    'DEFAULT_REQUIRED'
                );
            }

            if (assignments.length === 0) {
                await connection.rollback();
                return this.getAddress(userId, addressId);
            }

            values.push(addressId, userId);

            await connection.query(
                `UPDATE user_addresses
                    SET ${assignments.join(', ')}
                  WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
                values
            );

            await connection.commit();

            return this.getAddress(userId, addressId);
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    /**
     * Make an address the user's default.
     */
    async setDefaultAddress(userId, addressId) {
        if (!userId) throw new AddressError('User is required', 401, 'UNAUTHENTICATED');

        const connection = await db.getConnection();

        try {
            await connection.beginTransaction();

            await this.lockAddress(userId, addressId, connection);
            await this.demoteCurrentDefault(userId, connection);

            await connection.query(
                `UPDATE user_addresses
                    SET is_default = 1
                  WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
                [addressId, userId]
            );

            await connection.commit();

            return this.getAddress(userId, addressId);
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    /**
     * Soft-delete an address.
     *
     * If it was the default, the most recently used survivor is promoted, so
     * the account never ends up with addresses and no default. Returns the new
     * default (or null) so the client can update without a refetch.
     */
    async deleteAddress(userId, addressId) {
        if (!userId) throw new AddressError('User is required', 401, 'UNAUTHENTICATED');

        const connection = await db.getConnection();

        try {
            await connection.beginTransaction();

            const existing = await this.lockAddress(userId, addressId, connection);

            await connection.query(
                `UPDATE user_addresses
                    SET deleted_at = NOW(), deleted_by = ?, is_default = 0
                  WHERE id = ? AND user_id = ?`,
                [userId, addressId, userId]
            );

            let promoted = null;

            if (existing.is_default) {
                // Most recently used first, falling back to most recently
                // added. Promoting an arbitrary survivor would silently start
                // shipping to an address the shopper has not used in a year.
                const [candidates] = await connection.query(
                    `SELECT id
                       FROM user_addresses
                      WHERE user_id = ? AND deleted_at IS NULL
                      ORDER BY last_used_at IS NULL, last_used_at DESC, created_at DESC
                      LIMIT 1`,
                    [userId]
                );

                const next = safeArray(candidates)[0];

                if (next) {
                    await connection.query(
                        'UPDATE user_addresses SET is_default = 1 WHERE id = ? AND user_id = ?',
                        [next.id, userId]
                    );
                    promoted = next.id;
                }
            }

            await connection.commit();

            return {
                deletedId: addressId,
                newDefaultId: promoted,
                newDefault: promoted ? await this.getAddress(userId, promoted) : null
            };
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    /**
     * Stamp an address as used, called when an order ships to it.
     *
     * Failure is swallowed: this is ordering metadata for the address list, and
     * a checkout must not fail because a timestamp could not be written.
     */
    async markAddressUsed(userId, addressId) {
        if (!userId || !addressId) return false;

        try {
            const [result] = await db.query(
                `UPDATE user_addresses
                    SET last_used_at = NOW()
                  WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
                [addressId, userId]
            );

            return (result?.affectedRows || 0) > 0;
        } catch (error) {
            console.error('Mark address used error:', error.message);
            return false;
        }
    }

    /**
     * Resolve a saved address into the flat shape `orderController` writes onto
     * the order row.
     *
     * The order keeps a snapshot rather than only a reference, so editing or
     * deleting the address later cannot rewrite where a past order was shipped.
     *
     * @returns {Promise<{customer: object, address: object, addressId: string}|null>}
     */
    async resolveForOrder(userId, addressId) {
        const address = await this.getAddress(userId, addressId);
        if (!address) return null;

        return {
            addressId: address.id,
            customer: {
                name: address.recipientName,
                phone: address.recipientPhone
            },
            address: {
                city: address.city,
                state: address.state,
                zip: address.postalCode,
                fullAddress: formatAddressLine(address)
            }
        };
    }

    // ----------------------------------------------------------------
    // Internals
    // ----------------------------------------------------------------

    /**
     * Select an address FOR UPDATE, scoped to its owner.
     *
     * The row lock matters: two concurrent "make this my default" requests
     * would otherwise both read `is_default = 0`, both demote, and both
     * promote, and one of them would lose to the unique index after the other
     * had already committed.
     *
     * @throws {AddressError} 404 when the row is absent or owned by someone else
     */
    async lockAddress(userId, addressId, connection) {
        const [rows] = await connection.query(
            `SELECT id, user_id, is_default
               FROM user_addresses
              WHERE id = ? AND user_id = ? AND deleted_at IS NULL
              FOR UPDATE`,
            [addressId, userId]
        );

        const address = safeArray(rows)[0];

        if (!address) {
            throw new AddressError('Address not found', 404, 'ADDRESS_NOT_FOUND');
        }

        return address;
    }

    /**
     * Clear whichever address currently holds the default flag.
     *
     * Always called before setting a new one, inside the same transaction, so
     * the one-default-per-user index is never transiently violated.
     */
    async demoteCurrentDefault(userId, connection) {
        await connection.query(
            `UPDATE user_addresses
                SET is_default = 0
              WHERE user_id = ? AND is_default = 1 AND deleted_at IS NULL`,
            [userId]
        );
    }
}

const addressService = new AddressService();

module.exports = addressService;
module.exports.AddressService = AddressService;
module.exports.AddressError = AddressError;
module.exports.toPublicAddress = toPublicAddress;
module.exports.formatAddressLine = formatAddressLine;
module.exports.MAX_ADDRESSES_PER_USER = MAX_ADDRESSES_PER_USER;
