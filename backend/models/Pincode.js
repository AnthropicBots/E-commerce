const db = require("../config/db");
const NodeCache = require('node-cache');

const cache = new NodeCache({
    stdTTL: 86400,
    checkperiod: 3600
});

const PINCODE_REGEX = /^\d{6}$/;

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

    getCacheKey: (pincode) => {
        return `pincode_${pincode}`;
    },

    findByCode: async (pincode) => {
        try {
            const validPincode = Pincode.validatePincode(pincode);
            const cacheKey = Pincode.getCacheKey(validPincode);

            const cached = cache.get(cacheKey);
            if (cached !== undefined) {
                return cached;
            }

            const [rows] = await db.query(
                `SELECT pincode, city, state, country, eta_days, is_active, 
                        delivery_charges, cod_available, created_at, updated_at
                 FROM serviceable_pincodes 
                 WHERE pincode = ? AND is_active = TRUE`,
                [validPincode]
            );

            cache.set(cacheKey, rows);
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
                `SELECT pincode, city, state, country, eta_days, is_active, 
                        delivery_charges, cod_available, created_at, updated_at
                 FROM serviceable_pincodes 
                 WHERE pincode IN (${placeholders}) AND is_active = TRUE`,
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

            const searchTerm = `%${query.trim()}%`;
            const [rows] = await db.query(
                `SELECT pincode, city, state, country, eta_days, is_active,
                        delivery_charges, cod_available
                 FROM serviceable_pincodes 
                 WHERE (pincode LIKE ? OR city LIKE ? OR state LIKE ?) 
                 AND is_active = TRUE
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
            let query = 'SELECT COUNT(*) as total FROM serviceable_pincodes WHERE 1=1';
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

    create: async (data) => {
        try {
            const validPincode = Pincode.validatePincode(data.pincode);

            if (!data.city || !data.state) {
                throw new Error('City and state are required');
            }

            const [result] = await db.query(
                `INSERT INTO serviceable_pincodes 
                 (pincode, city, state, country, eta_days, delivery_charges, cod_available, is_active)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    validPincode,
                    data.city,
                    data.state,
                    data.country || 'India',
                    data.eta_days || 3,
                    data.delivery_charges || 0,
                    data.cod_available !== false ? 1 : 0,
                    data.is_active !== false ? 1 : 0
                ]
            );

            const cacheKey = Pincode.getCacheKey(validPincode);
            cache.del(cacheKey);

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

    update: async (pincode, data) => {
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

            params.push(validPincode);

            const [result] = await db.query(
                `UPDATE serviceable_pincodes 
                 SET ${updates.join(', ')}, updated_at = NOW()
                 WHERE pincode = ?`,
                params
            );

            const cacheKey = Pincode.getCacheKey(validPincode);
            cache.del(cacheKey);

            return result.affectedRows > 0;

        } catch (error) {
            console.error('Pincode.update error:', error.message);
            throw error;
        }
    },

    delete: async (pincode) => {
        try {
            const validPincode = Pincode.validatePincode(pincode);

            const [result] = await db.query(
                'DELETE FROM serviceable_pincodes WHERE pincode = ?',
                [validPincode]
            );

            const cacheKey = Pincode.getCacheKey(validPincode);
            cache.del(cacheKey);

            return result.affectedRows > 0;

        } catch (error) {
            console.error('Pincode.delete error:', error.message);
            throw error;
        }
    },

    getCities: async (state = null) => {
        try {
            let query = 'SELECT DISTINCT city FROM serviceable_pincodes WHERE is_active = TRUE';
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
                'SELECT DISTINCT state FROM serviceable_pincodes WHERE is_active = TRUE ORDER BY state'
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
                'SELECT eta_days FROM serviceable_pincodes WHERE pincode = ? AND is_active = TRUE',
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
                'SELECT COUNT(*) as count FROM serviceable_pincodes WHERE pincode = ? AND is_active = TRUE',
                [validPincode]
            );

            return rows[0]?.count > 0;

        } catch (error) {
            console.error('Pincode.isDeliverable error:', error.message);
            return false;
        }
    },

    clearCache: () => {
        cache.flushAll();
        console.log('Pincode cache cleared');
        return true;
    },

    getCacheStats: () => {
        return {
            keys: cache.keys(),
            size: cache.keys().length,
            hits: cache.getStats?.().hits || 0,
            misses: cache.getStats?.().misses || 0
        };
    }
};

module.exports = Pincode;