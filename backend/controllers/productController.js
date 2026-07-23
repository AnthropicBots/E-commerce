const db = require("../config/db");

// helper functions
const {
    safeNumber,
    safeInteger,
    safeUUID,
    sanitizeString,
    buildPaginationMeta,
    safeArray
} = require("../utils/helpers");

const MAX_PRODUCT_LIMIT = 50;
const NORMALIZED_CATEGORY_SQL =
    "LOWER(REPLACE(REPLACE(category, '-', ''), ' ', ''))";

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
    newest: "id DESC",
    oldest: "id ASC",
    "price-low-high": "price ASC, id DESC",
    "price-high-low": "price DESC, id DESC",
    popularity: "num_reviews DESC, id DESC",
    "highest-rated": "rating DESC, id DESC",
    "alphabetical-az": "name ASC, id DESC"
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

        const filterConditions = [];
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
                "featured = 1"
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
                    conditions.push("name LIKE ?");
                    params.push(likeSearch);
                }
            }

            if (minPrice !== null) {
                conditions.push("price >= ?");
                params.push(minPrice);
            }

            if (maxPrice !== null) {
                conditions.push("price <= ?");
                params.push(maxPrice);
            }

            const whereClause = conditions.length
                ? `WHERE ${conditions.join(" AND ")}`
                : "";

            const countQuery = `
                SELECT COUNT(*) AS total
                FROM products
                ${whereClause}
            `;

            const productQuery = `
                SELECT
                    id,
                    name,
                    description,
                    price,
                    image,
                    category,
                    stock,
                    featured,
                    rating,
                    num_reviews
                FROM products
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

        let queryResult;
        if (shouldUseFulltext) {
            try {
                queryResult = await runProductQuery(true);
            } catch (error) {
                if (isFulltextUnavailable(error)) {
                    console.warn(
                        `FULLTEXT search unavailable (${error.code}); falling back to LIKE`
                    );
                    queryResult = await runProductQuery(false);
                } else {
                    throw error;
                }
            }
        } else {
            queryResult = await runProductQuery(false);
        }

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

    const query = `
        SELECT
            id,
            name,
            description,
            price,
            image,
            category,
            stock,
            featured,
            rating,
            num_reviews
        FROM products
        WHERE id = ?
    `;

    try {
        const [results] = await db.query(query, [id]);

        if (results.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Product not found"
            });
        }

        res.status(200).json({
            success: true,
            product: results[0]
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

    const query = `
        INSERT INTO products
        (name, description, price, image, category, stock, featured)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `;

    try {
    // Prevent duplicate product names (case-insensitive)
        const [existingProducts] = await db.query(
            `
        SELECT id
        FROM products
        WHERE LOWER(TRIM(name)) = LOWER(TRIM(?))
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
        
        const [result] = await db.query(
            query,
            [
                normalizedName,
                description || "",
                safeNumber(price),
                sanitizeString(image),
                sanitizeString(category),
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

        res.status(201).json({
            success: true,
            message: "Product created successfully",
            productId: result.insertId
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

    const query = `
        UPDATE products
        SET
            name = ?,
            description = ?,
            price = ?,
            image = ?,
            category = ?,
            stock = ?,
            featured = ?
        WHERE id = ?
    `;

    try {
        const [result] = await db.query(
            query,
            [
                sanitizeString(name),
                description || "",
                safeNumber(price),
                sanitizeString(image),
                sanitizeString(category),
                Math.max(
                    0,
                    safeInteger(stock)
                ),
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

// Delete product
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

    const query = "DELETE FROM products WHERE id = ?";

    try {
        const [result] = await db.query(query, [id]);

        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                message: "Product not found"
            });
        }

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


module.exports = {
    getProducts,
    getSingleProduct,
    createProduct,
    updateProduct,
    deleteProduct,
    getProductSuggestions
};
