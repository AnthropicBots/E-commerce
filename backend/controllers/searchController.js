const db = require("../config/db");
const { sanitizeString } = require("../utils/helpers");
const { publicProductCondition } = require("../constants/productVisibility");

/**
 * GET /api/search?q=
 * Returns top 5 matching products ordered by relevance.
 */
const searchProducts = async (req, res) => {
    try {
        const rawQuery = req.query.q || "";
        const queryStr = sanitizeString(rawQuery).trim().slice(0, 100);

        if (!queryStr) {
            return res.status(200).json({
                success: true,
                message: "Search query is empty",
                data: []
            });
        }

        const visible = publicProductCondition("products");
        const terms = queryStr.split(/\s+/).filter(Boolean);
        const formattedTerms = terms.map((t) => `+${t.replace(/[+\-><()~*\"@]/g, "")}*`).join(" ");
        const likeExact = `${queryStr}%`;
        const likeContains = `%${queryStr.replace(/[%_\\]/g, String.raw`\$&`)}%`;

        const sql = `
            SELECT id, name, price, compare_price, image, category_id, rating, stock,
                   (
                       CASE WHEN name LIKE ? THEN 100 ELSE 0 END +
                       CASE WHEN name LIKE ? THEN 50 ELSE 0 END +
                       MATCH(name) AGAINST(? IN BOOLEAN MODE)
                   ) AS relevance
            FROM products
            WHERE (MATCH(name) AGAINST(? IN BOOLEAN MODE) OR name LIKE ?)
              AND ${visible.sql}
            ORDER BY relevance DESC, name ASC
            LIMIT 5
        `;

        const params = [likeExact, likeContains, formattedTerms, formattedTerms, likeContains, ...visible.params];

        let rows = [];
        try {
            const [queryResult] = await db.query(sql, params);
            rows = queryResult || [];
        } catch (dbErr) {
            try {
                const fallbackSql = `
                    SELECT id, name, price, compare_price, image, category_id, rating, stock,
                           (CASE WHEN name LIKE ? THEN 100 ELSE 50 END) AS relevance
                    FROM products
                    WHERE name LIKE ? AND ${visible.sql}
                    ORDER BY relevance DESC, name ASC
                    LIMIT 5
                `;
                const [fallbackResult] = await db.query(fallbackSql, [likeExact, likeContains, ...visible.params]);
                rows = fallbackResult || [];
            } catch (fallbackErr) {
                rows = [];
            }
        }

        return res.status(200).json({
            success: true,
            message: "Search results fetched successfully",
            data: rows || []
        });
    } catch (error) {
        console.error("Search API Error:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to perform search query",
            data: []
        });
    }
};

module.exports = {
    searchProducts
};
