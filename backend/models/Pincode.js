// backend/models/Pincode.js
//
// Delivery serviceability (#1496).
//
// Two things were wrong at this layer and both were invisible from outside.
//
// `serviceable_pincodes` carries `deleted_at`, `deleted_by` and an index on
// `deleted_at` (migrations/0001_baseline_schema.sql:888-912). Not one query
// read any of them. Every read filtered on `is_active = TRUE` and nothing
// else, so a soft-deleted pincode still answered "yes, we deliver here", still
// resolved a city and state for a shipping quote, and still turned up in
// search. Withdrawal had no effect on any read path.
//
// And `delete` was a hard DELETE against a table built for soft deletion, so
// `deleted_by` and `deleted_at` had no writer at all and the audit trail those
// columns exist for did not exist.
//
// The cache also lives in services/pincodeCache.js now rather than here; see
// that file for why there were two of them and why that could not work.

const db = require("../config/db");
const pincodeCache = require("../services/pincodeCache");

const PINCODE_REGEX = /^\d{6}$/;

/**
 * The predicate every read shares.
 *
 * Written out once, so a query added later cannot quietly omit the soft-delete
 * check -- which is how the omission survived across nine separate reads.
 */
const LIVE = "is_active = TRUE AND deleted_at IS NULL";

/** The columns a caller gets. `deleted_at` is not among them by design. */
const COLUMNS = `pincode, city, state, country, eta_days, is_active,
                 delivery_charges, cod_available, created_at, updated_at`;

const Pincode = {
    validatePincode: (pincode) => {
        if (!pincode || typeof pincode !== 'string') {
            throw new Error('Pincode is required and must be a string');
        }
        const trimmed = pincode.trim();
        if (!PINCODE_REGEX.test(trimmed)) {
            throw new Error('Invalid pincode format. Must be 6 digits');
        }
        return trimmed;
    },

    validatePincodes: (pincodes) => {
        if (!pincodes || !Array.isArray(pincodes) || pincodes.length === 0) {
            throw new Error('Pincodes array is required');
        }
        if (pincodes.length > 100) {
            throw new Error('Maximum 100 pincodes allowed per request');
        }
        return pincodes.map(p => Pincode.validatePincode(p));
    },

    findByCode: async (pincode) => {
        try {
            const validPincode = Pincode.validatePincode(pincode);

            const cached = pincodeCache.get(pincodeCache.NAMESPACE_ROWS, validPincode);
            if (cached !== undefined) {
                return cached;
            }

            const [rows] = await db.query(
                `SELECT ${COLUMNS}
                 FROM serviceable_pincodes
                 WHERE pincode = ? AND ${LIVE}`,
                [validPincode]
            );

            pincodeCache.set(pincodeCache.NAMESPACE_ROWS, validPincode, rows);
            return rows;

        } catch (error) {
            console.error('Pincode.findByCode error:', error.message);
            throw error;
        }
    },

    findByCodes: async (pincodes) => {
        try {
            const validPincodes = Pincode.validatePincodes(pincodes);
            const uniquePincodes = [...new Set(validPincodes)];

            const placeholders = uniquePincodes.map(() => '?').join(',');
            const [rows] = await db.query(
                `SELECT ${COLUMNS}
                 FROM serviceable_pincodes
                 WHERE pincode IN (${placeholders}) AND ${LIVE}`,
                uniquePincodes
            );

            const result = {};
            uniquePincodes.forEach(pincode => {
                const found = rows.find(row => row.pincode === pincode);
                result[pincode] = found || null;
            });

            return result;

        } catch (error) {
            console.error('Pincode.findByCodes error:', error.message);
            throw error;
        }
    },

    search: async (query, limit = 10) => {
        try {
            if (!query || typeof query !== 'string' || query.trim().length < 2) {
                throw new Error('Search query must be at least 2 characters');
            }

            // LIKE metacharacters in the term are escaped: a search for "100%"
            // should find "100%", not scan and return everything.
            const searchTerm = `%${Pincode.escapeLike(query.trim())}%`;

            const [rows] = await db.query(
                `SELECT pincode, city, state, country, eta_days, is_active,
                        delivery_charges, cod_available
                 FROM serviceable_pincodes
                 WHERE (pincode LIKE ? ESCAPE '\\\\'
                        OR city LIKE ? ESCAPE '\\\\'
                        OR state LIKE ? ESCAPE '\\\\')
                 AND ${LIVE}
                 LIMIT ?`,
                [searchTerm, searchTerm, searchTerm, Math.min(limit, 50)]
            );

            return rows;

        } catch (error) {
            console.error('Pincode.search error:', error.message);
            throw error;
        }
    },

    count: async (filter = {}) => {
        try {
            // Withdrawn rows are excluded here too. A count that includes them
            // disagrees with every list that does not.
            let query = 'SELECT COUNT(*) as total FROM serviceable_pincodes WHERE deleted_at IS NULL';
            const params = [];

            if (filter.is_active !== undefined) {
                query += ' AND is_active = ?';
                params.push(filter.is_active);
            }

            if (filter.city) {
                query += ' AND city = ?';
                params.push(filter.city);
            }

            if (filter.state) {
                query += ' AND state = ?';
                params.push(filter.state);
            }

            const [rows] = await db.query(query, params);
            return rows[0]?.total || 0;

        } catch (error) {
            console.error('Pincode.count error:', error.message);
            throw error;
        }
    },

    create: async (data, actorId = null) => {
        try {
            const validPincode = Pincode.validatePincode(data.pincode);

            if (!data.city || !data.state) {
                throw new Error('City and state are required');
            }

            // A pincode withdrawn earlier and added again is the same row --
            // `pincode` is UNIQUE, so a plain INSERT would fail against a
            // soft-deleted one and the operator would have no way to tell why.
            const [result] = await db.query(
                `INSERT INTO serviceable_pincodes
                 (pincode, city, state, country, eta_days, delivery_charges,
                  cod_available, is_active, created_by)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE
                     city = VALUES(city),
                     state = VALUES(state),
                     country = VALUES(country),
                     eta_days = VALUES(eta_days),
                     delivery_charges = VALUES(delivery_charges),
                     cod_available = VALUES(cod_available),
                     is_active = VALUES(is_active),
                     updated_by = VALUES(created_by),
                     deleted_at = NULL,
                     deleted_by = NULL`,
                [
                    validPincode,
                    data.city,
                    data.state,
                    data.country || 'India',
                    data.eta_days || 3,
                    data.delivery_charges || 0,
                    data.cod_available !== false ? 1 : 0,
                    data.is_active !== false ? 1 : 0,
                    actorId
                ]
            );

            pincodeCache.invalidate(validPincode);

            return {
                id: result.insertId,
                pincode: validPincode,
                ...data
            };

        } catch (error) {
            console.error('Pincode.create error:', error.message);
            throw error;
        }
    },

    update: async (pincode, data, actorId = null) => {
        try {
            const validPincode = Pincode.validatePincode(pincode);

            const updates = [];
            const params = [];

            if (data.city !== undefined) {
                updates.push('city = ?');
                params.push(data.city);
            }
            if (data.state !== undefined) {
                updates.push('state = ?');
                params.push(data.state);
            }
            if (data.country !== undefined) {
                updates.push('country = ?');
                params.push(data.country);
            }
            if (data.eta_days !== undefined) {
                updates.push('eta_days = ?');
                params.push(data.eta_days);
            }
            if (data.delivery_charges !== undefined) {
                updates.push('delivery_charges = ?');
                params.push(data.delivery_charges);
            }
            if (data.cod_available !== undefined) {
                updates.push('cod_available = ?');
                params.push(data.cod_available ? 1 : 0);
            }
            if (data.is_active !== undefined) {
                updates.push('is_active = ?');
                params.push(data.is_active ? 1 : 0);
            }

            if (updates.length === 0) {
                throw new Error('No fields to update');
            }

            updates.push('updated_by = ?');
            params.push(actorId);

            params.push(validPincode);

            const [result] = await db.query(
                `UPDATE serviceable_pincodes
                 SET ${updates.join(', ')}, updated_at = NOW()
                 WHERE pincode = ? AND deleted_at IS NULL`,
                params
            );

            pincodeCache.invalidate(validPincode);

            return result.affectedRows > 0;

        } catch (error) {
            console.error('Pincode.update error:', error.message);
            throw error;
        }
    },

    /**
     * Withdraw a pincode.
     *
     * A soft delete, which is what the table was built for. This used to issue
     * `DELETE FROM serviceable_pincodes`, destroying the row and with it any
     * record that the store had ever served that area -- while `deleted_at`
     * and `deleted_by` sat unused two columns over.
     *
     * @param {string} pincode
     * @param {string|null} actorId - recorded in deleted_by
     * @returns {Promise<boolean>}
     */
    delete: async (pincode, actorId = null) => {
        try {
            const validPincode = Pincode.validatePincode(pincode);

            const [result] = await db.query(
                `UPDATE serviceable_pincodes
                 SET deleted_at = NOW(), deleted_by = ?, is_active = 0
                 WHERE pincode = ? AND deleted_at IS NULL`,
                [actorId, validPincode]
            );

            pincodeCache.invalidate(validPincode);

            return result.affectedRows > 0;

        } catch (error) {
            console.error('Pincode.delete error:', error.message);
            throw error;
        }
    },

    /**
     * Undo a withdrawal.
     *
     * A soft delete nobody can reverse is, from outside, the hard delete it
     * replaced -- the same argument #1457 made for products.
     *
     * @param {string} pincode
     * @param {string|null} actorId
     * @returns {Promise<boolean>}
     */
    restore: async (pincode, actorId = null) => {
        try {
            const validPincode = Pincode.validatePincode(pincode);

            const [result] = await db.query(
                `UPDATE serviceable_pincodes
                 SET deleted_at = NULL, deleted_by = NULL, is_active = 1, updated_by = ?
                 WHERE pincode = ? AND deleted_at IS NOT NULL`,
                [actorId, validPincode]
            );

            pincodeCache.invalidate(validPincode);

            return result.affectedRows > 0;

        } catch (error) {
            console.error('Pincode.restore error:', error.message);
            throw error;
        }
    },

    getCities: async (state = null) => {
        try {
            let query = `SELECT DISTINCT city FROM serviceable_pincodes WHERE ${LIVE}`;
            const params = [];

            if (state) {
                query += ' AND state = ?';
                params.push(state);
            }

            query += ' ORDER BY city';

            const [rows] = await db.query(query, params);
            return rows.map(row => row.city);

        } catch (error) {
            console.error('Pincode.getCities error:', error.message);
            throw error;
        }
    },

    getStates: async () => {
        try {
            const [rows] = await db.query(
                `SELECT DISTINCT state FROM serviceable_pincodes WHERE ${LIVE} ORDER BY state`
            );
            return rows.map(row => row.state);

        } catch (error) {
            console.error('Pincode.getStates error:', error.message);
            throw error;
        }
    },

    getDeliveryEta: async (pincode) => {
        try {
            const validPincode = Pincode.validatePincode(pincode);
            const [rows] = await db.query(
                `SELECT eta_days FROM serviceable_pincodes WHERE pincode = ? AND ${LIVE}`,
                [validPincode]
            );

            return rows[0]?.eta_days || null;

        } catch (error) {
            console.error('Pincode.getDeliveryEta error:', error.message);
            throw error;
        }
    },

    isDeliverable: async (pincode) => {
        try {
            const validPincode = Pincode.validatePincode(pincode);
            const [rows] = await db.query(
                `SELECT COUNT(*) as count FROM serviceable_pincodes WHERE pincode = ? AND ${LIVE}`,
                [validPincode]
            );

            return rows[0]?.count > 0;

        } catch (error) {
            console.error('Pincode.isDeliverable error:', error.message);
            return false;
        }
    },

    /**
     * Escape the LIKE metacharacters in a user-supplied search term.
     *
     * @param {string} value
     * @returns {string}
     */
    escapeLike: (value) => String(value).replace(/[\\%_]/g, (character) => `\\${character}`),

    clearCache: () => {
        const cleared = pincodeCache.flush();
        console.log(`Pincode cache cleared: ${cleared} entries removed`);
        return cleared;
    },

    getCacheStats: () => pincodeCache.stats(),

    // Exported so the controller and the tests can name the same thing the
    // model does, rather than each keeping a copy.
    LIVE_CONDITION: LIVE,
    PINCODE_REGEX
};

module.exports = Pincode;
