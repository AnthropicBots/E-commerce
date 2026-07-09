// backend/controllers/wishlistController.js

const promisePool = require("../config/db");
const { safeNumber, safeArray, safeInteger } = require("../utils/helpers");
const logger = require("../utils/logger");
const crypto = require('crypto');

// ==================== CONFIGURATION ====================
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const PAGE_SIZE = 10;
const SHARE_TOKEN_LENGTH = 32;

// ==================== CACHE ====================
const cache = new Map();

function getCacheKey(userId, page, limit) {
    return `wishlist:${userId}:page:${page}:limit:${limit}`;
}

function getFromCache(userId, page, limit) {
    const key = getCacheKey(userId, page, limit);
    const cached = cache.get(key);

    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        return cached.data;
    }

    return null;
}

function setCache(userId, page, limit, data) {
    const key = getCacheKey(userId, page, limit);

    cache.set(key, {
        data,
        timestamp: Date.now()
    });
}

function invalidateCache(userId) {
    // Delete all cache keys that match this user's prefix
    const prefix = `wishlist:${userId}:`;
    for (const key of cache.keys()) {
        if (key.startsWith(prefix)) {
            cache.delete(key);
        }
    }
    logger.debug(`Cache invalidated for user: ${userId}`);
}

// ==================== VALIDATION ====================
function validateProductId(productId) {
    const id = safeInteger(productId);
    if (!id || id <= 0) {
        return { valid: false, error: 'Invalid product ID' };
    }
    return { valid: true, id };
}

function validateBatchOperation(products) {
    if (!Array.isArray(products) || products.length === 0) {
        return { valid: false, error: 'Products array is required' };
    }
    if (products.length > 50) {
        return { valid: false, error: 'Maximum 50 products per batch operation' };
    }
    for (const id of products) {
        const validation = validateProductId(id);
        if (!validation.valid) {
            return { valid: false, error: `Invalid product ID: ${id}` };
        }
    }
    return { valid: true };
}

const wishlistController = {
    // ==================== GET WISHLIST WITH PAGINATION ====================
    getUserWishlist: async (req, res) => {
        try {
            const userId = req.user.id;
            const page = Math.max(1, parseInt(req.query.page) || 1);
            const limit = Math.min(50, parseInt(req.query.limit) || PAGE_SIZE);
            const offset = (page - 1) * limit;

            // Check cache first
            const cachedData = getFromCache(userId, page, limit);
            if (cachedData) {
                logger.debug(`Cache hit for wishlist: ${userId}`);
                return res.status(200).json({
                    success: true,
                    data: cachedData,
                    cached: true
                });
            }

            // Get total count
            const [countResult] = await promisePool.query(
                'SELECT COUNT(*) as total FROM wishlist_items WHERE user_id = ?',
                [userId]
            );
            const total = countResult[0]?.total || 0;

            // Get paginated wishlist items with product details
            const [rows] = await promisePool.query(`
                SELECT 
                    p.id, 
                    p.name, 
                    p.price, 
                    p.image, 
                    p.brand, 
                    p.stock,
                    p.description,
                    p.category_id,
                    p.rating,
                    p.review_count,
                    w.created_at as added_at
                FROM wishlist_items w
                JOIN products p ON w.product_id = p.id
                WHERE w.user_id = ?
                ORDER BY w.created_at DESC
                LIMIT ? OFFSET ?
            `, [userId, limit, offset]);

            const wishlistData = {
                items: safeArray(rows),
                total: total,
                page: page,
                limit: limit,
                totalPages: Math.ceil(total / limit),
                hasNextPage: page * limit < total,
                hasPrevPage: page > 1
            };

            // Cache the data
            setCache(userId, page, limit, wishlistData);

            return res.status(200).json({
                success: true,
                data: wishlistData,
                cached: false
            });

        } catch (error) {
            logger.error(`GET WISHLIST ERROR: ${error.message}`);
            return res.status(500).json({
                success: false,
                message: "Failed to fetch wishlist"
            });
        }
    },

    // ==================== ADD TO WISHLIST ====================
    addToWishlist: async (req, res) => {
        try {
            const userId = req.user.id;
            const productId = safeNumber(req.body.productId);

            // Validate product ID
            const validation = validateProductId(productId);
            if (!validation.valid) {
                return res.status(400).json({
                    success: false,
                    message: validation.error
                });
            }

            // Check if product exists and is active
            const [products] = await promisePool.query(
                "SELECT id, name, price, stock FROM products WHERE id = ? AND is_active = 1",
                [validation.id]
            );

            if (!products.length) {
                return res.status(404).json({
                    success: false,
                    message: "Product not found or inactive"
                });
            }

            // Check if already in wishlist
            const [existing] = await promisePool.query(
                "SELECT id FROM wishlist_items WHERE user_id = ? AND product_id = ?",
                [userId, validation.id]
            );

            if (existing.length) {
                return res.status(409).json({
                    success: false,
                    message: "Product already in wishlist",
                    alreadyExists: true
                });
            }

            // Add to wishlist
            await promisePool.query(`
                INSERT INTO wishlist_items (user_id, product_id, created_at)
                VALUES (?, ?, NOW())
            `, [userId, validation.id]);

            // Invalidate cache
            invalidateCache(userId);

            logger.info(`Product ${validation.id} added to wishlist by user ${userId}`);

            return res.status(201).json({
                success: true,
                message: "Added to wishlist ❤️",
                productId: validation.id
            });

        } catch (error) {
            logger.error(`ADD TO WISHLIST ERROR: ${error.message}`);
            return res.status(500).json({
                success: false,
                message: "Failed to add to wishlist"
            });
        }
    },

    // ==================== REMOVE FROM WISHLIST ====================
    removeFromWishlist: async (req, res) => {
        try {
            const userId = req.user.id;
            const productId = safeNumber(req.params.productId || req.body.productId);

            // Validate product ID
            const validation = validateProductId(productId);
            if (!validation.valid) {
                return res.status(400).json({
                    success: false,
                    message: validation.error
                });
            }

            const [result] = await promisePool.query(`
                DELETE FROM wishlist_items 
                WHERE user_id = ? AND product_id = ?
            `, [userId, validation.id]);

            if (result.affectedRows === 0) {
                return res.status(404).json({
                    success: false,
                    message: "Item not found in wishlist"
                });
            }

            // Invalidate cache
            invalidateCache(userId);

            logger.info(`Product ${validation.id} removed from wishlist by user ${userId}`);

            return res.status(200).json({
                success: true,
                message: "Removed from wishlist",
                productId: validation.id
            });

        } catch (error) {
            logger.error(`REMOVE FROM WISHLIST ERROR: ${error.message}`);
            return res.status(500).json({
                success: false,
                message: "Failed to remove from wishlist"
            });
        }
    },

    // ==================== BATCH ADD TO WISHLIST ====================
    batchAddToWishlist: async (req, res) => {
        const connection = await promisePool.getConnection();

        try {
            const userId = req.user.id;
            const { productIds } = req.body;
            const uniqueProductIds = [...new Set(productIds.map((id) => safeNumber(id)))];

            // Validate batch
            const validation = validateBatchOperation(uniqueProductIds);
            if (!validation.valid) {
                return res.status(400).json({
                    success: false,
                    message: validation.error
                });
            }

            await connection.beginTransaction();

            const added = [];
            const alreadyExist = [];
            const notFound = [];

            for (const productId of uniqueProductIds) {
                // Check if product exists and is active
                const [product] = await connection.query(
                    'SELECT id FROM products WHERE id = ? AND is_active = 1',
                    [productId]
                );

                if (!product.length) {
                    notFound.push(productId);
                    continue;
                }

                // Check if already in wishlist
                const [existing] = await connection.query(
                    'SELECT id FROM wishlist_items WHERE user_id = ? AND product_id = ?',
                    [userId, productId]
                );

                if (existing.length) {
                    alreadyExist.push(productId);
                    continue;
                }

                // Add to wishlist
                await connection.query(
                    'INSERT INTO wishlist_items (user_id, product_id, created_at) VALUES (?, ?, NOW())',
                    [userId, productId]
                );

                added.push(productId);
            }

            await connection.commit();

            // Invalidate cache
            invalidateCache(userId);

            logger.info(
                `Batch add: ${added.length} added, ${alreadyExist.length} existing, ${notFound.length} not found`
            );

            return res.status(200).json({
                success: true,
                message: `Added ${added.length} products to wishlist`,
                data: {
                    added,
                    alreadyExist,
                    notFound,
                    totalProcessed: uniqueProductIds.length
                }
            });

        } catch (error) {
            await connection.rollback();
            logger.error(`BATCH ADD TO WISHLIST ERROR: ${error.message}`);

            return res.status(500).json({
                success: false,
                message: "Failed to add products to wishlist"
            });
        } finally {
            connection.release();
        }
    },

    // ==================== BATCH REMOVE FROM WISHLIST ====================
    batchRemoveFromWishlist: async (req, res) => {
        const connection = await promisePool.getConnection();
        try {
            const userId = req.user.id;
            const { productIds } = req.body;

            const validation = validateBatchOperation(productIds);
            if (!validation.valid) {
                return res.status(400).json({
                    success: false,
                    message: validation.error
                });
            }

            await connection.beginTransaction();

            const removed = [];
            const notFound = [];

            for (const productId of productIds) {
                const [result] = await connection.query(
                    'DELETE FROM wishlist_items WHERE user_id = ? AND product_id = ?',
                    [userId, productId]
                );
                if (result.affectedRows > 0) {
                    removed.push(productId);
                } else {
                    notFound.push(productId);
                }
            }

            await connection.commit();

            // Invalidate cache
            invalidateCache(userId);

            logger.info(`Batch remove: ${removed.length} removed, ${notFound.length} not found`);

            return res.status(200).json({
                success: true,
                message: `Removed ${removed.length} products from wishlist`,
                data: {
                    removed: removed,
                    notFound: notFound,
                    totalProcessed: productIds.length
                }
            });

        } catch (error) {
            await connection.rollback();
            logger.error(`BATCH REMOVE FROM WISHLIST ERROR: ${error.message}`);
            return res.status(500).json({
                success: false,
                message: "Failed to remove products from wishlist"
            });
        } finally {
            connection.release();
        }
    },

    // ==================== GET WISHLIST COUNT ====================
    getWishlistCount: async (req, res) => {
        try {
            const userId = req.user.id;

            const [result] = await promisePool.query(
                'SELECT COUNT(*) as count FROM wishlist_items WHERE user_id = ?',
                [userId]
            );
            const count = result[0]?.count || 0;

            return res.status(200).json({
                success: true,
                count: count
            });

        } catch (error) {
            logger.error(`GET WISHLIST COUNT ERROR: ${error.message}`);
            return res.status(500).json({
                success: false,
                message: "Failed to get wishlist count"
            });
        }
    },

    // ==================== CHECK IF PRODUCT IN WISHLIST ====================
    checkWishlist: async (req, res) => {
        try {
            const userId = req.user.id;
            const productId = safeNumber(req.params.productId);

            const validation = validateProductId(productId);
            if (!validation.valid) {
                return res.status(400).json({
                    success: false,
                    message: validation.error
                });
            }

            const [result] = await promisePool.query(
                'SELECT id FROM wishlist_items WHERE user_id = ? AND product_id = ?',
                [userId, validation.id]
            );

            return res.status(200).json({
                success: true,
                inWishlist: result.length > 0,
                productId: validation.id
            });

        } catch (error) {
            logger.error(`CHECK WISHLIST ERROR: ${error.message}`);
            return res.status(500).json({
                success: false,
                message: "Failed to check wishlist"
            });
        }
    },

    // ==================== SYNC WISHLIST ====================
    syncWishlist: async (req, res) => {
        const connection = await promisePool.getConnection();

        try {
            const userId = req.user.id;
            const items = Array.isArray(req.body.items)
                ? req.body.items
                : [];

            // Normalize to a unique set of product ids
            const productIds = new Set();

            for (const item of items) {
                if (!item) continue;

                const productId = safeNumber(
                    item.productId != null ? item.productId : item.id
                );

                if (!productId || productId < 1) continue;

                productIds.add(productId);
            }

            await connection.beginTransaction();

            // Clear existing wishlist
            await connection.query(
                "DELETE FROM wishlist_items WHERE user_id = ?",
                [userId]
            );

            if (productIds.size) {
                const ids = [...productIds];

                // Keep only products that still exist and are active
                const [products] = await connection.query(
                    `SELECT id FROM products WHERE id IN (${ids.map(() => "?").join(",")}) AND is_active = 1`,
                    ids
                );

                const validIds = products.map((p) => p.id);

                if (validIds.length) {
                    const placeholders = validIds
                        .map(() => "(?, ?)")
                        .join(",");

                    const values = [];
                    validIds.forEach((productId) => {
                        values.push(userId, productId);
                    });

                    await connection.query(
                        `INSERT INTO wishlist_items (user_id, product_id, created_at) VALUES ${placeholders}`,
                        values
                    );
                }
            }

            await connection.commit();

            // Invalidate cache
            invalidateCache(userId);

            logger.info(`Wishlist synced for user ${userId}`);

            return res.status(200).json({
                success: true,
                message: "Wishlist synced"
            });

        } catch (error) {
            await connection.rollback();
            logger.error(`SYNC WISHLIST ERROR: ${error.message}`);
            return res.status(500).json({
                success: false,
                message: "Failed to sync wishlist"
            });
        } finally {
            connection.release();
        }
    },

    // ==================== CLEAR WISHLIST ====================
    clearWishlist: async (req, res) => {
        try {
            const userId = req.user.id;

            const [result] = await promisePool.query(
                'DELETE FROM wishlist_items WHERE user_id = ?',
                [userId]
            );

            // Invalidate cache
            invalidateCache(userId);

            logger.info(`Wishlist cleared for user ${userId}`);

            return res.status(200).json({
                success: true,
                message: "Wishlist cleared successfully",
                removedCount: result.affectedRows
            });

        } catch (error) {
            logger.error(`CLEAR WISHLIST ERROR: ${error.message}`);
            return res.status(500).json({
                success: false,
                message: "Failed to clear wishlist"
            });
        }
    },

    // ==================== GET WISHLIST ANALYTICS ====================
    getWishlistAnalytics: async (req, res) => {
        try {
            const userId = req.user.id;

            const analytics = {
                totalItems: 0,
                mostRecent: null,
                oldest: null,
                categories: [],
                priceRange: {
                    min: 0,
                    max: 0,
                    average: 0
                },
                recentActivity: []
            };

            // Get total and price stats
            const [stats] = await promisePool.query(
                `SELECT COUNT(*) as total, 
                        MIN(p.price) as min_price, 
                        MAX(p.price) as max_price, 
                        AVG(p.price) as avg_price
                 FROM wishlist_items w
                 JOIN products p ON w.product_id = p.id
                 WHERE w.user_id = ?`,
                [userId]
            );

            if (stats.length) {
                analytics.totalItems = stats[0]?.total || 0;
                analytics.priceRange = {
                    min: parseFloat(stats[0]?.min_price || 0),
                    max: parseFloat(stats[0]?.max_price || 0),
                    average: parseFloat(stats[0]?.avg_price || 0)
                };
            }

            // Get category distribution
            const [categories] = await promisePool.query(
                `SELECT c.name, COUNT(*) as count
                 FROM wishlist_items w
                 JOIN products p ON w.product_id = p.id
                 JOIN categories c ON p.category_id = c.id
                 WHERE w.user_id = ?
                 GROUP BY c.id
                 ORDER BY count DESC`,
                [userId]
            );
            analytics.categories = safeArray(categories);

            // Get recent activity (last 30 days)
            const [recent] = await promisePool.query(
                `SELECT product_id, created_at 
                 FROM wishlist_items 
                 WHERE user_id = ? AND created_at > DATE_SUB(NOW(), INTERVAL 30 DAY)
                 ORDER BY created_at DESC
                 LIMIT 10`,
                [userId]
            );
            analytics.recentActivity = safeArray(recent);

            return res.status(200).json({
                success: true,
                data: analytics
            });

        } catch (error) {
            logger.error(`GET WISHLIST ANALYTICS ERROR: ${error.message}`);
            return res.status(500).json({
                success: false,
                message: "Failed to get wishlist analytics"
            });
        }
    },

    // ==================== GENERATE SHARE LINK ====================
    generateShareLink: async (req, res) => {
        try {
            const userId = req.user.id;

            // Generate unique token
            const token = crypto.randomBytes(SHARE_TOKEN_LENGTH).toString('hex');
            const expiresAt = new Date();
            expiresAt.setDate(expiresAt.getDate() + 7); // 7 days expiry

            // Save share token
            await promisePool.query(
                `INSERT INTO wishlist_shares (user_id, share_token, expires_at, created_at)
                 VALUES (?, ?, ?, NOW())
                 ON DUPLICATE KEY UPDATE share_token = VALUES(share_token), expires_at = VALUES(expires_at)`,
                [userId, token, expiresAt]
            );

            const shareUrl = `${process.env.BASE_URL || 'http://localhost:3000'}/share/wishlist/${token}`;

            logger.info(`Share link generated for user ${userId}`);

            return res.status(200).json({
                success: true,
                shareUrl: shareUrl,
                token: token,
                expiresAt: expiresAt
            });

        } catch (error) {
            logger.error(`GENERATE SHARE LINK ERROR: ${error.message}`);
            return res.status(500).json({
                success: false,
                message: "Failed to generate share link"
            });
        }
    },

    // ==================== GET SHARED WISHLIST ====================
    getSharedWishlist: async (req, res) => {
        try {
            const { token } = req.params;

            if (!token) {
                return res.status(400).json({
                    success: false,
                    message: 'Share token is required'
                });
            }

            // Validate token
            const [share] = await promisePool.query(
                'SELECT user_id, expires_at FROM wishlist_shares WHERE share_token = ? AND expires_at > NOW()',
                [token]
            );

            if (!share.length) {
                return res.status(404).json({
                    success: false,
                    message: 'Invalid or expired share link'
                });
            }

            const userId = share[0].user_id;

            // Get wishlist items
            const [items] = await promisePool.query(
                `SELECT w.*, p.name, p.price, p.image, p.brand, p.description, p.category_id
                 FROM wishlist_items w
                 JOIN products p ON w.product_id = p.id
                 WHERE w.user_id = ?
                 ORDER BY w.created_at DESC`,
                [userId]
            );

            return res.status(200).json({
                success: true,
                data: {
                    items: safeArray(items),
                    total: items.length
                }
            });

        } catch (error) {
            logger.error(`GET SHARED WISHLIST ERROR: ${error.message}`);
            return res.status(500).json({
                success: false,
                message: "Failed to get shared wishlist"
            });
        }
    },

    // ==================== EXPORT WISHLIST ====================
    exportWishlist: async (req, res) => {
        try {
            const userId = req.user.id;
            const format = req.query.format || 'json';

            // Get all wishlist items
            const [items] = await promisePool.query(
                `SELECT w.product_id, p.name, p.price, p.image, p.brand, 
                        p.description, p.category_id, w.created_at as added_date
                 FROM wishlist_items w
                 JOIN products p ON w.product_id = p.id
                 WHERE w.user_id = ?
                 ORDER BY w.created_at DESC`,
                [userId]
            );

            if (!items.length) {
                return res.status(404).json({
                    success: false,
                    message: 'Wishlist is empty'
                });
            }

            if (format === 'csv') {
                try {
                    const { Parser } = require('json2csv');
                    const fields = ['product_id', 'name', 'price', 'brand', 'description', 'added_date'];
                    const json2csvParser = new Parser({ fields });
                    const csv = json2csvParser.parse(items);

                    res.setHeader('Content-Type', 'text/csv');
                    res.setHeader('Content-Disposition', `attachment; filename=wishlist_${Date.now()}.csv`);
                    return res.status(200).send(csv);
                } catch (csvError) {
                    logger.error(`CSV EXPORT ERROR: ${csvError.message}`);
                    return res.status(500).json({
                        success: false,
                        message: "Failed to export CSV"
                    });
                }
            }

            // Export as JSON
            return res.status(200).json({
                success: true,
                data: {
                    items: safeArray(items),
                    total: items.length,
                    exportedAt: new Date().toISOString()
                }
            });

        } catch (error) {
            logger.error(`EXPORT WISHLIST ERROR: ${error.message}`);
            return res.status(500).json({
                success: false,
                message: "Failed to export wishlist"
            });
        }
    },

    // ==================== CLEAR CACHE ====================
    clearWishlistCache: async (req, res) => {
        try {
            const userId = req.user.id;
            invalidateCache(userId);

            return res.status(200).json({
                success: true,
                message: 'Wishlist cache cleared'
            });
        } catch (error) {
            logger.error(`CLEAR CACHE ERROR: ${error.message}`);
            return res.status(500).json({
                success: false,
                message: 'Failed to clear cache'
            });
        }
    }
};

module.exports = wishlistController;