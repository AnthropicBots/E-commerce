const db = require("../config/db");
const productService = require("../services/productService");
const stockCounter = require("../services/stockCounterService");

// helper functions
const {
    safeNumber,
    safeInteger,
    safeUUID,
    sanitizeString,
    buildPaginationMeta,
    safeArray,
    generateUUID
} = require("../utils/helpers");

const MAX_PRODUCT_LIMIT = 50;
const NORMALIZED_CATEGORY_SQL =
    "LOWER(REPLACE(REPLACE(c.name, '-', ''), ' ', ''))";

async function getOrCreateCategoryId(categoryName, connection = db) {
    if (!categoryName || typeof categoryName !== 'string') return null;
    const trimmed = categoryName.trim();
    if (!trimmed) return null;

    // Search case-insensitively
    const [rows] = await connection.query(
        "SELECT id FROM categories WHERE LOWER(TRIM(name)) = LOWER(?) LIMIT 1",
        [trimmed]
    );

    if (rows.length > 0) {
        return rows[0].id;
    }

    // Otherwise, insert it
    const slug = trimmed
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");

    try {
        const [result] = await connection.query(
            "INSERT INTO categories (name, slug, level, is_active) VALUES (?, ?, 0, 1)",
            [trimmed, slug]
        );
        // Category CRUD → invalidate nested menu cache (#1264)
        productService.onCategoryMutation({ rebuildMptt: true }).catch(() => {});
        return result.insertId;
    } catch (err) {
        // If duplicate slug (concurrency safety), fetch it again
        if (err.code === 'ER_DUP_ENTRY') {
            const [rows] = await connection.query(
                "SELECT id FROM categories WHERE LOWER(TRIM(name)) = LOWER(?) LIMIT 1",
                [trimmed]
            );
            if (rows.length > 0) {
                return rows[0].id;
            }
        }
        throw err;
    }
}

const FULLTEXT_SEARCH_COLUMNS = "name, description, short_description, meta_keywords";

const FULLTEXT_UNAVAILABLE_CODES = new Set([
    "ER_FT_MATCHING_KEY_NOT_FOUND",
    "ER_BAD_FIELD_ERROR"
]);

// Whitelisted sort keys → ORDER BY clause. Keys mirror the frontend shop
// sort control so the same value round-trips through the API. A stable
// `id DESC` tie-breaker keeps pagination free of overlaps/gaps when the
// primary sort column has duplicate values.
const SORT_CLAUSES = {
    newest: "p.id DESC",
    oldest: "p.id ASC",
    "price-low-high": "p.price ASC, p.id DESC",
    "price-high-low": "p.price DESC, p.id DESC",
    popularity: "p.num_reviews DESC, p.id DESC",
    "highest-rated": "p.rating DESC, p.id DESC",
    "alphabetical-az": "p.name ASC, p.id DESC"
};
const DEFAULT_SORT_CLAUSE = SORT_CLAUSES.newest;
const TOYS_CATEGORY_VALUES = [
    "Toys",
    "Educational Toys",
    "Building Blocks",
    "Dolls",
    "RC Toys",
    "Outdoor Toys"
];
const STATIONERY_CATEGORY_VALUES = [
    "Stationery",
    "Notebooks",
    "Pens",
    "Pencils",
    "School Bags",
    "Office Supplies",
    "Art Supplies"
];

function parsePaginationValue(value, defaultValue, fieldName) {
    if (value === undefined || value === null || value === "") {
        return defaultValue;
    }

    const normalizedValue = String(value).trim();
    const parsedValue = Number(normalizedValue);

    if (!Number.isInteger(parsedValue) || parsedValue < 1) {
        throw new Error(`Invalid ${fieldName}`);
    }

    return parsedValue;
}

function escapeLikeTerm(value) {
    return value.replace(/[%_\\]/g, "\\$&");
}

function toBooleanModeQuery(value) {
    return value
        .split(/\s+/)
        .map((token) => token.replace(/[+\-<>()~*"@]/g, ""))
        .filter(Boolean)
        .map((token) => `+${token}*`)
        .join(" ");
}

function isFulltextUnavailable(error) {
    return Boolean(error) && FULLTEXT_UNAVAILABLE_CODES.has(error.code);
}

// ---------- Get all products ----------
const getProducts = async (req, res) => {
    try {
        const page = parsePaginationValue(req.query.page, 1, "page");
        const requestedLimit = parsePaginationValue(req.query.limit, 10, "limit");
        const limit = Math.min(requestedLimit, MAX_PRODUCT_LIMIT);
        const offset = (page - 1) * limit;

        const rawSearch = req.query.search
            ? sanitizeString(req.query.search)
            : "";
        const likeSearch = rawSearch
            ? `%${escapeLikeTerm(rawSearch)}%`
            : null;
        const booleanSearch = rawSearch
            ? toBooleanModeQuery(rawSearch)
            : "";

        const rawMinPrice =
            req.query.minPrice ?? req.query.min;
        const rawMaxPrice =
            req.query.maxPrice ?? req.query.max;
        const minPrice =
            rawMinPrice !== undefined && rawMinPrice !== ""
                ? safeNumber(rawMinPrice, null)
                : null;
        const maxPrice =
            rawMaxPrice !== undefined && rawMaxPrice !== ""
                ? safeNumber(rawMaxPrice, null)
                : null;

        if (minPrice !== null && (minPrice < 0 || !Number.isFinite(minPrice))) {
            return res.status(400).json({
                success: false,
                message: "Invalid minimum price"
            });
        }

        if (maxPrice !== null && (maxPrice < 0 || !Number.isFinite(maxPrice))) {
            return res.status(400).json({
                success: false,
                message: "Invalid maximum price"
            });
        }

        if (minPrice !== null && maxPrice !== null && minPrice > maxPrice) {
            return res.status(400).json({
                success: false,
                message: "Minimum price cannot be greater than maximum price"
            });
        }

        // Resolve sort against the whitelist; unknown/empty falls back to newest.
        const orderByClause =
            SORT_CLAUSES[sanitizeString(req.query.sort)] || DEFAULT_SORT_CLAUSE;

        const filterConditions = ["p.deleted_at IS NULL"];
        const filterParams = [];

        // category filter (case/format-insensitive)
        if (req.query.category) {
            const sanitizedCategory = sanitizeString(
                req.query.category
            );
            const isToysCategory =
                sanitizedCategory
                    .toLowerCase()
                    .replace(/[-\s]+/g, "") === "toys";
            const isStationeryCategory =
                sanitizedCategory
                    .toLowerCase()
                    .replace(/[-\s]+/g, "") === "stationery";

            if (isToysCategory || isStationeryCategory) {
                const categoryValues = isToysCategory
                    ? TOYS_CATEGORY_VALUES
                    : STATIONERY_CATEGORY_VALUES;

                filterConditions.push(
                    `${NORMALIZED_CATEGORY_SQL} IN (${categoryValues.map(
                        () => "LOWER(REPLACE(REPLACE(?, '-', ''), ' ', ''))"
                    ).join(", ")})`
                );
                filterParams.push(...categoryValues);
            } else {
                filterConditions.push(
                    `${NORMALIZED_CATEGORY_SQL} = LOWER(REPLACE(REPLACE(?, '-', ''), ' ', ''))`
                );
                filterParams.push(sanitizedCategory);
            }
        }

        // featured filter
        if (
            req.query.featured === "true"
        ) {
            filterConditions.push(
                "p.featured = 1"
            );
        }

        const runProductQuery = async (useFulltext) => {
            const conditions = [...filterConditions];
            const params = [...filterParams];

            if (rawSearch) {
                if (useFulltext) {
                    conditions.push(
                        `MATCH(${FULLTEXT_SEARCH_COLUMNS}) AGAINST (? IN BOOLEAN MODE)`
                    );
                    params.push(booleanSearch);
                } else {
                    conditions.push("p.name LIKE ?");
                    params.push(likeSearch);
                }
            }

            if (minPrice !== null) {
                conditions.push("p.price >= ?");
                params.push(minPrice);
            }

            if (maxPrice !== null) {
                conditions.push("p.price <= ?");
                params.push(maxPrice);
            }

            const whereClause = conditions.length
                ? `WHERE ${conditions.join(" AND ")}`
                : "";

            const countQuery = `
                SELECT COUNT(*) AS total
                FROM products p
                LEFT JOIN categories c ON p.category_id = c.id
                ${whereClause}
            `;

            const productQuery = `
                SELECT
                    p.id,
                    p.name,
                    p.description,
                    p.price,
                    p.image,
                    c.name AS category,
                    p.stock,
                    p.featured,
                    p.rating,
                    p.num_reviews
                FROM products p
                LEFT JOIN categories c ON p.category_id = c.id
                ${whereClause}
                ORDER BY ${orderByClause}
                LIMIT ?
                OFFSET ?
            `;

            const [countResults] = await db.query(countQuery, params);
            const total = Number(countResults?.[0]?.total || 0);

            const [results] = await db.query(productQuery, [
                ...params,
                limit,
                offset
            ]);

            return { total, results };
        };

        const shouldUseFulltext = Boolean(rawSearch) && booleanSearch.length > 0;

        const queryResult = await productService.withProductCache(
            {
                page,
                limit,
                search: rawSearch,
                category: req.query.category || null,
                featured: req.query.featured || null,
                minPrice,
                maxPrice,
                sort: sanitizeString(req.query.sort) || 'newest'
            },
            async () => {
                if (shouldUseFulltext) {
                    try {
                        return await runProductQuery(true);
                    } catch (error) {
                        if (isFulltextUnavailable(error)) {
                            console.warn(
                                `FULLTEXT search unavailable (${error.code}); falling back to LIKE`
                            );
                            return runProductQuery(false);
                        }
                        throw error;
                    }
                }
                return runProductQuery(false);
            },
            { tags: ['products', 'product-list'] }
        );

        const { total, results } = queryResult;

        return res.status(200)
            .json({

                success: true,

                page,

                limit,

                total,

                ...buildPaginationMeta(
                    total,
                    page,
                    limit
                ),

                count:
                    safeArray(results)
                        .length,

                products:
                    safeArray(results)
            });

    } catch (error) {
        if (error.message === "Invalid page" || error.message === "Invalid limit") {
            return res.status(400).json({
                success: false,
                message: error.message
            });
        }

        console.error(
            "GET PRODUCTS ERROR:"
        );
        console.error(
            error
        );
        console.error(
            "STACK:"
        );
        console.error(
            error.stack
        );

        return res.status(500)
            .json({
                success: false,
                message: "Failed to fetch products"
            });
    }
};

// ---------- Get single product ----------
const getSingleProduct = async (req, res) => {
    const id =
        safeUUID(
            req.params.id
        );

    if (!id) {
        return res.status(400)
            .json({
                success: false,
                message:
                    "Invalid product ID"
            });
    }

    try {
        // Stampede-safe cache (XFetch + singleflight) — #1262
        const product = await productService.withProductCache(
            `detail:${id}`,
            async () => {
                const query = `
                    SELECT
                        p.id,
                        p.name,
                        p.description,
                        p.price,
                        p.image,
                        c.name AS category,
                        p.stock,
                        p.featured,
                        p.rating,
                        p.num_reviews
                    FROM products p
                    LEFT JOIN categories c ON p.category_id = c.id
                    WHERE p.id = ? AND p.deleted_at IS NULL
                `;
                const [results] = await db.query(query, [id]);
                return results[0] || null;
            },
            { tags: [`product:${id}`, 'products'] }
        );

        if (!product) {
            return res.status(404).json({
                success: false,
                message: "Product not found"
            });
        }

        res.status(200).json({
            success: true,
            product
        });
    } catch (error) {
        console.error(error);

        return res.status(500).json({
            success: false,
            message: "Server error"
        });
    }
};

// ---------- Create product ----------
const createProduct = async (req, res) => {
    const {
        name,
        description,
        price,
        image,
        category,
        stock,
        featured
    } = req.body;

    // basic validation
    if (!name || price === undefined) {
        return res.status(400).json({
            success: false,
            message: "Name and price are required"
        });
    }

    const normalizedName = sanitizeString(name).trim();

    if (
        safeNumber(price) <= 0
    ) {
        return res.status(400).json({
            success: false,
            message: "Price must be greater than zero"
        });
    }

    try {
        // Prevent duplicate product names (case-insensitive)
        const [existingProducts] = await db.query(
            `
        SELECT id
        FROM products
        WHERE LOWER(TRIM(name)) = LOWER(TRIM(?)) AND deleted_at IS NULL
        LIMIT 1
    `,
            [normalizedName]
        );

        if (safeArray(existingProducts).length) {
            return res.status(409).json({
                success: false,
                message: "A product with this name already exists."
            });
        }

        const categoryId = await getOrCreateCategoryId(category, db);
        const productId = generateUUID();

        const query = `
            INSERT INTO products
            (id, name, description, price, image, category_id, stock, featured)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `;
        
        await db.query(
            query,
            [
                productId,
                normalizedName,
                description || "",
                safeNumber(price),
                sanitizeString(image),
                categoryId,
                Math.max(
                    0,
                    safeInteger(stock)
                ),
                featured === true
                    || featured === 1
                    || featured === "1"
                    ? 1
                    : 0
            ]
        );

        await productService.invalidateProductCaches(productId);

        res.status(201).json({
            success: true,
            message: "Product created successfully",
            productId: productId
        });
    } catch (error) {
        console.error(error);

        return res.status(500).json({
            success: false,
            message: "Server error"
        });
    }
};

// ---------- Update product ----------
const updateProduct = async (req, res) => {
    const id =
        safeUUID(
            req.params.id
        );

    const {
        name,
        description,
        price,
        image,
        category,
        stock,
        featured
    } = req.body;

    if (!id) {
        return res.status(400)
            .json({
                success: false,
                message:
                    "Invalid product ID"
            });
    }

    // basic validation
    if (!name || price === undefined) {
        return res.status(400).json({
            success: false,
            message: "Name and price are required"
        });
    }

    if (
        safeNumber(price) <= 0
    ) {
        return res.status(400).json({
            success: false,
            message: "Invalid product price"
        });
    }

    try {
        const categoryId = category !== undefined ? await getOrCreateCategoryId(category, db) : undefined;

        // For a product with variants, `products.stock` is a roll-up of the
        // variants a shopper can pick, not a figure of its own. Refuse an edit
        // to it rather than accept a number and quietly discard it at the next
        // sale -- the quantity has to be set on the variant that holds it. A
        // submission that already agrees with the roll-up is not an edit and
        // passes, so an administrator renaming a product does not have to fight
        // the stock field.
        const rollup = await stockCounter.getVariantRollup(db, id);
        const hasVariants = rollup.variantCount > 0;

        if (hasVariants && stock !== undefined && Math.max(0, safeInteger(stock)) !== rollup.stock) {
            return res.status(400).json({
                success: false,
                message:
                    "This product's stock is held on its variants. Update the variant quantities instead."
            });
        }

        // Recomputed by the statement rather than written from the figure read
        // a moment ago, so a sale landing in between is not undone here.
        const stockAssignment = hasVariants
            ? `stock = COALESCE((
                    SELECT SUM(v.stock) FROM product_variants v
                    WHERE v.product_id = products.id
                      AND v.is_active = 1
                      AND v.deleted_at IS NULL
                ), stock)`
            : "stock = ?";

        const query = `
            UPDATE products
            SET
                name = ?,
                description = ?,
                price = ?,
                image = ?,
                category_id = COALESCE(?, category_id),
                ${stockAssignment},
                featured = ?
            WHERE id = ? AND deleted_at IS NULL
        `;

        const [result] = await db.query(
            query,
            [
                sanitizeString(name),
                description || "",
                safeNumber(price),
                sanitizeString(image),
                categoryId,
                ...(hasVariants ? [] : [Math.max(0, safeInteger(stock))]),
                featured === true
                    || featured === 1
                    || featured === "1"
                    ? 1
                    : 0,
                id
            ]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                message: "Product not found"
            });
        }

        await productService.invalidateProductCaches(id);

        res.status(200).json({
            success: true,
            message: "Product updated successfully"
        });
    } catch (error) {
        console.error(error);

        return res.status(500).json({
            success: false,
            message: "Server error"
        });
    }
};

// ---------- Delete product ----------
//
// A soft delete. It used to be `DELETE FROM products WHERE id = ?`, which is
// not a delete of one row -- fourteen tables cascade off `products(id)` and two
// more are set to NULL (#1457):
//
//   CASCADE     reviews, wishlist_items, cart_items, product_variants,
//               inventory_transactions, inventory_alerts, inventory_locks,
//               user_interactions, recently_viewed, product_views,
//               stock_alert_subscriptions, product_questions (+ answers,
//               votes), price_drop_baselines, price_drop_notification_log
//
//   SET NULL    order_items.product_id, refund_requests.product_id
//
// So withdrawing one product from sale erased every review written about it,
// removed it from every customer's wishlist, dropped it out of carts that were
// open at that moment, threw away the stock ledger, and cut the link between
// historical orders and the catalogue -- which is what reorder, "review your
// purchase", returns and per-product sales reporting are all built on.
// `order_items` denormalises name and price so invoices still render, but
// `product_id` is the only way back to the product and it is gone.
//
// None of it recoverable, from one admin click, with no confirmation beyond the
// role check on the route.
//
// The schema was always built for the other thing: `products.deleted_at`
// exists, has its own index, is part of `idx_active_products`, and every read
// path in the codebase already filters on it. The only statement that would
// ever set it was this one, and it threw the row away instead. This is not
// "add soft deletes" -- it is finishing the one that is already there.
const deleteProduct = async (req, res) => {
    const id =
        safeUUID(
            req.params.id
        );

    if (!id) {
        return res.status(400)
            .json({
                success: false,
                message:
                    "Invalid product ID"
            });
    }

    // `AND deleted_at IS NULL` so deleting an already-deleted product is a 404
    // rather than a second cheerful success that moves `deleted_at` forward and
    // loses when it actually happened.
    //
    // `status` moves to 'archived' in the same statement, so the two visibility
    // columns cannot disagree. #1461 adds ARCHIVED_PRODUCT_STATUS in
    // constants/productVisibility.js; whichever of the two lands second should
    // swap this literal for it.
    const query = `
        UPDATE products
           SET deleted_at = NOW(),
               status = 'archived'
         WHERE id = ? AND deleted_at IS NULL
    `;

    try {
        const [result] = await db.query(query, [id]);

        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                message: "Product not found"
            });
        }

        // Two things genuinely should go, because they are live state rather
        // than history and keeping them would be worse than losing them:
        //
        //   inventory_locks  -- a hold on stock for a product nobody can buy.
        //                       Left alone it sits there until its own expiry,
        //                       reserving stock against a withdrawn product.
        //
        //   cart_items       -- a line a shopper cannot check out. Leaving it
        //                       means a basket that fails at payment with no
        //                       explanation; removing it at least fails early.
        //
        // Everything else -- reviews, orders, wishlists, Q&A, the stock ledger,
        // the interaction history -- is a record of something that happened and
        // stays. Failures here are logged rather than surfaced: the product is
        // already withdrawn, which is what the caller asked for, and reporting
        // a 500 would invite a retry that cannot un-withdraw it.
        await releaseLiveStateForProduct(id);

        await productService.invalidateProductCaches(id);

        res.status(200).json({
            success: true,
            message: "Product deleted successfully"
        });
    } catch (error) {
        console.error(error);

        return res.status(500).json({
            success: false,
            message: "Server error"
        });
    }
};

/**
 * Drop the live state pointing at a product that has just been withdrawn.
 *
 * Deliberately not a transaction with the delete itself. The withdrawal is the
 * operation the caller asked for and it has already succeeded; if clearing a
 * cart line fails, rolling the withdrawal back would leave a product on sale
 * that an admin has decided should not be, which is the worse of the two
 * outcomes. Both statements are idempotent, so a retry costs nothing.
 *
 * @param {string} id Product id, already validated.
 * @returns {Promise<void>}
 */
async function releaseLiveStateForProduct(id) {
    for (const [description, statement] of [
        ["inventory locks", "DELETE FROM inventory_locks WHERE product_id = ?"],
        ["cart lines", "DELETE FROM cart_items WHERE product_id = ?"]
    ]) {
        try {
            await db.query(statement, [id]);
        } catch (error) {
            console.error(
                `Failed to release ${description} for withdrawn product ${id}:`,
                error
            );
        }
    }
}

// ---------- Restore a withdrawn product ----------
//
// The counterpart to the soft delete. Without it "soft" is a claim nobody can
// check: the row is still there, but no caller can bring it back, so from the
// outside it is the same as the hard delete it replaced.
//
// It comes back as a `draft`, not as `active`. An admin restoring a product is
// undoing a mistake, and the next thing they want is to look at it before
// customers do -- silently putting it back on sale is a second surprise on top
// of the first. Publishing is a separate, deliberate act (`PUT` with
// `status: "active"`, see #1461).
//
// The cart lines and inventory locks dropped on the way out are not restored.
// They were live state belonging to sessions that have moved on; recreating
// them would put lines back into baskets whose owners never asked for them.
const restoreProduct = async (req, res) => {
    const id =
        safeUUID(
            req.params.id
        );

    if (!id) {
        return res.status(400)
            .json({
                success: false,
                message:
                    "Invalid product ID"
            });
    }

    // `AND deleted_at IS NOT NULL` so restoring a product that was never
    // deleted is a 404 rather than a silent no-op that reports success --
    // and, more importantly, so it cannot quietly reset a live product's
    // status to draft.
    const query = `
        UPDATE products
           SET deleted_at = NULL,
               status = 'draft'
         WHERE id = ? AND deleted_at IS NOT NULL
    `;

    try {
        const [result] = await db.query(query, [id]);

        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                message: "No deleted product with that ID"
            });
        }

        await productService.invalidateProductCaches(id);

        res.status(200).json({
            success: true,
            message:
                "Product restored as a draft. Set its status to active to put it back on sale.",
            status: "draft"
        });
    } catch (error) {
        console.error(error);

        return res.status(500).json({
            success: false,
            message: "Server error"
        });
    }
};

// ---------- Get product suggestions for autocomplete (Issue #165) ----------
const getProductSuggestions = async (req, res) => {
    const keyword = req.query.q;
    if (!keyword || keyword.trim() === '') {
        return res.json([]);
    }
    // Sanitize: trim, limit length, escape special LIKE characters
    const sanitized = keyword.trim().slice(0, 100).replace(/[%_\\]/g, String.raw`\$&`);
    const searchTerm = `%${sanitized}%`;
    const query = `SELECT id, name FROM products WHERE name LIKE ? LIMIT 10`;
    try {
        const [results] = await db.query(query, [searchTerm]);
        res.json(results);
    } catch (err) {
        console.error("Suggestions error:", err);
        res.status(500).json({ success: false, message: "Database error" });
    }
};

/**
 * Nested category navigation tree — single recursive CTE + Redis cache (#1264).
 * Query: ?rootId=&maxDepth=5
 */
const getCategoryTree = async (req, res) => {
    try {
        const maxDepth = safeInteger(req.query.maxDepth, 5);
        const rootId = req.query.rootId != null && req.query.rootId !== ''
            ? safeInteger(req.query.rootId, null)
            : null;

        const result = await productService.getCategoryTree({ rootId, maxDepth });

        return res.status(200).json({
            success: true,
            message: "Category tree fetched successfully",
            cached: result.cached,
            maxDepth: result.maxDepth,
            rootId: result.rootId,
            tree: result.tree
        });
    } catch (error) {
        console.error("Category tree error:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch category tree"
        });
    }
};

/**
 * Manual cache bust for category menus (admin / after bulk imports).
 */
const invalidateCategoryTreeCache = async (req, res) => {
    try {
        const result = await productService.onCategoryMutation({ rebuildMptt: true });
        return res.status(200).json({
            success: true,
            message: "Category tree cache invalidated",
            ...result
        });
    } catch (error) {
        console.error("Category tree invalidation error:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to invalidate category tree cache"
        });
    }
};


module.exports = {
    getProducts,
    getSingleProduct,
    createProduct,
    updateProduct,
    deleteProduct,
    restoreProduct,
    getProductSuggestions,
    getCategoryTree,
    invalidateCategoryTreeCache
};
