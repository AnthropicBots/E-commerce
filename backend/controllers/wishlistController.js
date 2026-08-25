// backend/controllers/wishlistController.js

const promisePool = require("../config/db");
const { safeNumber, safeArray, safeInteger, safeUUID } = require("../utils/helpers");
const logger = require("../utils/logger");
const crypto = require('crypto');

// ==================== CONFIGURATION ====================
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const PAGE_SIZE = 10;
const SHARE_TOKEN_LENGTH = 32;

// Ceiling on how many entries the in-process cache below may hold. A cap
// rather than a working limit: one entry per user per page per page size, in a
// Map nothing else bounds, is a slow leak keyed by request parameters.
const MAX_CACHE_ENTRIES = 1000;

/**
 * A product a shopper may still be shown.
 *
 * `products` carries both flags and they mean different things: `is_active = 0`
 * is a product withdrawn from sale, `deleted_at` is the soft delete the rest of
 * the catalogue reads honour (#1457). A wishlist that ignores them keeps
 * offering something the shop has taken down, at a price and a stock figure
 * that stopped being maintained the day it was withdrawn.
 *
 * Written once and applied by every read below, because the reason it was
 * missing from six of them is that each one had to remember it separately.
 */
const LIVE_PRODUCT = "p.status = 'active' AND p.deleted_at IS NULL";

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

    // An entry is only ever read again by the same user asking for the same
    // page, so an entry for a page nobody revisits is never touched again --
    // and nothing removed it. `getFromCache` treats an expired entry as a miss
    // and leaves it in the Map, so the Map only ever grew.
    pruneCache();

    cache.set(key, {
        data,
        timestamp: Date.now()
    });
}

/**
 * Drop expired entries, and the oldest ones if the cap is still exceeded.
 *
 * Called on write rather than on a timer: a timer keeps the event loop alive
 * and has to be cleaned up in tests, and entries only appear on a write.
 */
function pruneCache() {
    const now = Date.now();

    for (const [key, entry] of cache) {
        if (now - entry.timestamp >= CACHE_TTL) {
            cache.delete(key);
        }
    }

    if (cache.size < MAX_CACHE_ENTRIES) {
        return;
    }

    // Map iterates in insertion order, so the front is the oldest.
    const excess = cache.size - MAX_CACHE_ENTRIES + 1;
    let dropped = 0;

    for (const key of cache.keys()) {
        if (dropped >= excess) break;
        cache.delete(key);
        dropped += 1;
    }
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

// ==================== CSV ====================

/**
 * Characters that make a spreadsheet treat a cell as a formula rather than as
 * text. A leading tab or carriage return counts because both are stripped
 * before the first meaningful character is looked at.
 */
const CSV_FORMULA_PREFIXES = ['=', '+', '-', '@', '\t', '\r'];

/**
 * Neutralise a value that a spreadsheet would otherwise execute.
 *
 * Product names and descriptions come from whoever listed the product, and the
 * export is a file a shopper opens locally. `=HYPERLINK(...)` in a product
 * name is a working attack on the person who exported their own wishlist.
 * Prefixing with an apostrophe is the standard escape and is not displayed.
 *
 * @param {any} value
 * @returns {any}
 */
function csvSafeValue(value) {
    if (typeof value !== 'string') return value;

    return CSV_FORMULA_PREFIXES.includes(value[0]) ? `'${value}` : value;
}

/**
 * @param {Object} row
 * @returns {Object} the same row with every string value made safe
 */
function csvSafeRow(row) {
    const safe = {};

    for (const [key, value] of Object.entries(row || {})) {
        safe[key] = csvSafeValue(value);
    }

    return safe;
}

// ==================== VALIDATION ====================
function validateProductId(productId) {
    const id = safeUUID(productId);
    if (!id) {
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

            // Counted over the same join and the same filter as the list
            // below. Counting the rows in `wishlist_items` while listing the
            // rows that join to a live product gives a total that is larger
            // than what can be shown, so the last page of a wishlist holding
            // withdrawn products came back empty with `hasNextPage` true.
            const [countResult] = await promisePool.query(`
                SELECT COUNT(*) as total
                FROM wishlist_items w
                JOIN products p ON w.product_id = p.id
                WHERE w.user_id = ? AND ${LIVE_PRODUCT}
            `, [userId]);
            const total = countResult[0]?.total || 0;

            // Get paginated wishlist items with product details
            //
            // `p.num_reviews AS review_count`, not `p.review_count`. There is
            // no `review_count` column on `products` -- the count of reviews
            // lives in `num_reviews`, which is what `reviewController`
            // maintains -- so this query failed on every request with
            // `ER_BAD_FIELD_ERROR: Unknown column 'p.review_count'`. The alias
            // keeps the field clients already read.
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
                    p.num_reviews AS review_count,
                    w.created_at as added_at
                FROM wishlist_items w
                JOIN products p ON w.product_id = p.id
                WHERE w.user_id = ? AND ${LIVE_PRODUCT}
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

    // Check if product is in user's wishlist (Issue #777)
    checkWishlistStatus: async (req, res) => {
        try {
            const userId = req.user.id;
            const productId = safeUUID(req.params.productId);

            if (!productId) {
                return res.status(400).json({
                    success: false,
                    message: "Valid product ID is required"
                });
            }


            const [rows] = await promisePool.query(
                "SELECT id FROM wishlist_items WHERE user_id = ? AND product_id = ?",
                [userId, productId]
            );

            return res.status(200).json({
                success: true,
                inWishlist: rows.length > 0
            });

        } catch (error) {
            console.error("CHECK WISHLIST STATUS ERROR:", error);
            return res.status(500).json({
                success: false,
                message: "Failed to check wishlist status"
            });
        }
    },

    // Add to wishlist
    addToWishlist: async (req, res) => {
        try {
            const userId = req.user.id;
            const productId = safeUUID(req.body.productId);

            // Validate product ID
            const validation = validateProductId(productId);
            if (!validation.valid) {
                return res.status(400).json({
                    success: false,
                    message: validation.error
                });
            }

            const [products] = await promisePool.query(
                `SELECT p.id, p.name, p.price, p.stock FROM products p
                 WHERE p.id = ? AND ${LIVE_PRODUCT}`,
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

            await promisePool.query(`
                INSERT INTO wishlist_items (user_id, product_id, created_at)
                VALUES (?, ?, NOW())
            `, [userId, validation.id]);

            // Invalidate cache
            invalidateCache(userId);

            logger.info(`Product ${validation.id} added to wishlist by user ${userId}`);

            return res.status(201).json({
                success: true,
                message: "Added to wishlist",
                action: "added"
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
            const productId = safeUUID(req.params.productId || req.body.productId);

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
                action: "removed"
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

            // routes/wishlistRoutes.js `validateBatchProducts` has already
            // rejected non-arrays, malformed UUIDs, duplicates and oversized
            // batches, and left the normalised ids on the request. The fallback
            // below keeps this handler safe if it is ever mounted without that
            // middleware: the previous version called `productIds.map()` before
            // any array check, so a body without `productIds` threw a
            // TypeError and surfaced as a 500 instead of a 400.
            let uniqueProductIds = req.validatedProductIds;

            if (!Array.isArray(uniqueProductIds)) {
                const { productIds } = req.body;

                if (!Array.isArray(productIds)) {
                    return res.status(400).json({
                        success: false,
                        message: 'Products array is required'
                    });
                }

                uniqueProductIds = [...new Set(productIds.map((id) => safeUUID(id)))];

                const validation = validateBatchOperation(uniqueProductIds);
                if (!validation.valid) {
                    return res.status(400).json({
                        success: false,
                        message: validation.error
                    });
                }
            }

            await connection.beginTransaction();

            const added = [];
            const alreadyExist = [];
            const notFound = [];

            for (const productId of uniqueProductIds) {
                // Check if product exists and is active
                const [product] = await connection.query(
                    `SELECT p.id FROM products p WHERE p.id = ? AND ${LIVE_PRODUCT}`,
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

            // Use the ids normalised by `validateBatchProducts`. The previous
            // version validated `req.body.productIds` but then looped over the
            // same raw array, so unsanitised values reached the DELETE.
            let productIds = req.validatedProductIds;

            if (!Array.isArray(productIds)) {
                const raw = req.body.productIds;

                const validation = validateBatchOperation(raw);
                if (!validation.valid) {
                    return res.status(400).json({
                        success: false,
                        message: validation.error
                    });
                }

                productIds = raw.map((id) => safeUUID(id));
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

            // The badge in the header and the list on the page are the same
            // claim, so they are counted the same way.
            const [result] = await promisePool.query(`
                SELECT COUNT(*) as count
                FROM wishlist_items w
                JOIN products p ON w.product_id = p.id
                WHERE w.user_id = ? AND ${LIVE_PRODUCT}
            `, [userId]);
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
            const productId = safeUUID(req.params.productId);

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

                const productId = safeUUID(
                    item.productId != null ? item.productId : item.id
                );

                if (!productId) continue;

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
                    `SELECT p.id FROM products p
                     WHERE p.id IN (${ids.map(() => "?").join(",")}) AND ${LIVE_PRODUCT}`,
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
                 WHERE w.user_id = ? AND ${LIVE_PRODUCT}`,
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
                 WHERE w.user_id = ? AND ${LIVE_PRODUCT}
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

            // Named columns, not `w.*`.
            //
            // `wishlist_items` holds `user_id`, so `w.*` published the account
            // id of whoever made the link to anybody holding it -- and the
            // link is public by design, shared into a chat or a mail thread
            // and forwarded on from there. Nothing about the owner is anyone
            // else's business; the products are what was shared.
            const [items] = await promisePool.query(
                `SELECT p.id AS product_id, p.name, p.price, p.image, p.brand,
                        p.description, p.category_id, p.stock,
                        w.created_at AS added_at
                 FROM wishlist_items w
                 JOIN products p ON w.product_id = p.id
                 WHERE w.user_id = ? AND ${LIVE_PRODUCT}
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
                 WHERE w.user_id = ? AND ${LIVE_PRODUCT}
                 ORDER BY w.created_at DESC`,
                [userId]
            );

            if (format === 'csv') {
                try {
                    const { Parser } = require('json2csv');
                    const fields = ['product_id', 'name', 'price', 'brand', 'description', 'added_date'];
                    const json2csvParser = new Parser({ fields });
                    // Escaped before the file is written, because a product
                    // name is seller-supplied text and a spreadsheet reads a
                    // cell starting with `=` as a formula rather than as a
                    // name. Quoting alone does not stop that -- Excel strips
                    // the quotes and evaluates what is inside.
                    const csv = json2csvParser.parse(items.map(csvSafeRow));

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

// ==================== ADMIN HANDLERS ====================
//
// Fixes #1295. These two handlers were previously attached to `exports`
// (`exports.getAdminUserWishlist = ...`) while the bottom of the file did
// `module.exports = wishlistController`. Assigning to `exports.x` mutates the
// original exports object; reassigning `module.exports` then discards it, so
// both handlers resolved to `undefined` at the require site and
// `routes/wishlistRoutes.js` mounted them anyway:
//
//     TypeError: Route.get() requires a callback function but got a [object Undefined]
//
// They are now defined on the same object that is actually exported.

// 1. Get any user's wishlist (Admin)
wishlistController.getAdminUserWishlist = async (req, res) => {
    try {
        const userId = safeUUID(req.params.userId);
        if (!userId) {
            return res.status(400).json({
                success: false,
                message: "Valid user ID is required",
            });
        }

        const [rows] = await promisePool.query(
            `
            SELECT 
                p.id, 
                p.name, 
                p.price, 
                p.image, 
                p.brand, 
                p.stock,
                w.created_at as added_at,
                u.name as user_name,
                u.email as user_email
            FROM wishlist_items w
            JOIN products p ON w.product_id = p.id
            JOIN users u ON w.user_id = u.id
            WHERE w.user_id = ?
            ORDER BY w.created_at DESC
        `,
            [userId],
        );

        return res.status(200).json({
            success: true,
            data: rows,
        });
    } catch (error) {
        console.error("ADMIN GET WISHLIST ERROR:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch user wishlist",
        });
    }
};

// 2. Get wishlist stats (Admin)
wishlistController.getWishlistStats = async (req, res) => {
    try {
        // Get total wishlist items across all users
        const [totalItems] = await promisePool.query(
            "SELECT COUNT(*) as total FROM wishlist_items",
        );

        // Get unique users with wishlist
        const [uniqueUsers] = await promisePool.query(
            "SELECT COUNT(DISTINCT user_id) as users FROM wishlist_items",
        );

        // Get most wishlisted products
        const [topProducts] = await promisePool.query(`
            SELECT p.id, p.name, COUNT(*) as wishlist_count
            FROM wishlist_items w
            JOIN products p ON w.product_id = p.id
            GROUP BY p.id
            ORDER BY wishlist_count DESC
            LIMIT 10
        `);

        // Get recent activity
        const [recentActivity] = await promisePool.query(`
            SELECT w.*, p.name as product_name, u.name as user_name
            FROM wishlist_items w
            JOIN products p ON w.product_id = p.id
            JOIN users u ON w.user_id = u.id
            ORDER BY w.created_at DESC
            LIMIT 20
        `);

        return res.status(200).json({
            success: true,
            data: {
                totalItems: totalItems[0]?.total || 0,
                uniqueUsers: uniqueUsers[0]?.users || 0,
                topProducts: topProducts,
                recentActivity: recentActivity,
            },
        });
    } catch (error) {
        console.error("WISHLIST STATS ERROR:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch wishlist stats",
        });
    }
};

module.exports = wishlistController;