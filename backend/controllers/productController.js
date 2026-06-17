const db = require("../config/db");

// helper functions
const {
    safeNumber,
    safeInteger,
    sanitizeString,
    getPagination,
    buildPaginationMeta,
    safeArray
} = require("../utils/helpers");

// get all products
const getProducts = async (req, res) => {

    try {

        const {
            page,
            limit,
            offset
        } = getPagination(
            req.query.page,
            req.query.limit,
            50
        );

        const search =
            req.query.search
                ? `%${sanitizeString(
                    req.query.search
                )}%`
                : null;

        let baseQuery = `
            FROM products
        `;

        const conditions = [];
        const params = [];

        // category filter (case/format-insensitive)
        if (req.query.category) {

            // normalize by removing hyphens/spaces and comparing lowercase
            conditions.push(
                "LOWER(REPLACE(REPLACE(category, '-', ''), ' ', '')) = LOWER(REPLACE(REPLACE(?, '-', ''), ' ', ''))"
            );

            params.push(
                sanitizeString(
                    req.query.category
                )
            );
        }

        // featured filter
        if (
            req.query.featured === "true"
        ) {

            conditions.push(
                "featured = 1"
            );
        }

        // search filter
        if (search) {

            conditions.push(
                "name LIKE ?"
            );

            params.push(search);
        }

        // build where clause
        if (conditions.length) {

            baseQuery += `
                WHERE ${conditions.join(" AND ")}
            `;
        }

        // count query
        const countQuery = `
            SELECT COUNT(*) AS total
            ${baseQuery}
        `;

        // product query
        const productQuery = `
            SELECT
                id,
                name,
                description,
                price,
                image,
                category,
                stock,
                featured
            ${baseQuery}
            ORDER BY id DESC
            LIMIT ?
            OFFSET ?
        `;

        // get total count
        const [
            countResults
        ] = await db.query(
            countQuery,
            params
        );

        const total =
            Number(
                countResults?.[0]?.total || 0
            );

        // fetch products
        const [
            results
        ] = await db.query(
            productQuery,
            [
                ...params,
                limit,
                offset
            ]
        );

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
                message:
                    error.message || "Failed to fetch products"
            });
    }
};

// get single product
const getSingleProduct = async (req, res) => {
    const id =
        safeInteger(
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
            featured
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

// create product
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

    if (
        safeNumber(price) <= 0
    ) {
        return res.status(400).json({
            success: false,
            message: "Invalid product price"
        });
    }

    const query = `
        INSERT INTO products
        (name, description, price, image, category, stock, featured)
        VALUES (?, ?, ?, ?, ?, ?, ?)
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

// update product
const updateProduct = async (req, res) => {
    const id =
        safeInteger(
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

// delete product
const deleteProduct = async (req, res) => {
    const id =
        safeInteger(
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

module.exports = {
    getProducts,
    getSingleProduct,
    createProduct,
    updateProduct,
    deleteProduct
};