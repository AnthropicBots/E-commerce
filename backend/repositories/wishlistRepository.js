// backend/repositories/wishlistRepository.js
const BaseRepository = require('./baseRepository');

// The table this repository actually addresses.
//
// It was `wishlist`, and there is no such table -- the schema creates
// `wishlist_items` (0001_baseline_schema.sql:797). Every method interpolates
// `this.tableName`, so all seven of them plus everything inherited from
// BaseRepository failed with ER_NO_SUCH_TABLE (#1567).
const TABLE = 'wishlist_items';

// Entries a read is allowed to see. `wishlist_items.deleted_at` exists and no
// read consulted it, so a removed entry came back from findByUser, getCount and
// isInWishlist alike.
const LIVE = 'deleted_at IS NULL';

/** The same predicate, where the table carries an alias. */
const liveOn = (alias) => `${alias}.deleted_at IS NULL`;

/**
 * Normalise a variant argument to the value the column stores.
 *
 * `wishlist_items.variant_id` is a nullable INT with a foreign key onto
 * `product_variants(id)`, so "no variant" has to be NULL -- a sentinel like 0
 * would fail the constraint.
 *
 * @param {any} variantId
 * @returns {number|null}
 */
const toVariantId = (variantId) => {
    if (variantId === undefined || variantId === null || variantId === '') {
        return null;
    }

    const parsed = Number.parseInt(variantId, 10);

    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

class WishlistRepository extends BaseRepository {
    constructor() {
        // Soft-delete declared, so BaseRepository.delete() stamps the row
        // rather than removing it -- consistent with what remove() and clear()
        // now do, and with the deleted_at column the table already carries.
        super(TABLE, 'id', { softDeleteColumn: 'deleted_at' });
    }

    /**
     * Get wishlist by user.
     *
     * `products` has `image VARCHAR(500)` (0001_baseline_schema.sql:161), not
     * `image_url` -- that column belongs to `categories`, which is the likely
     * origin of the mix-up. Selecting it threw ER_BAD_FIELD_ERROR behind the
     * missing-table error (#1567).
     *
     * The product predicate sits in the JOIN rather than the WHERE: a product
     * withdrawn after it was saved should leave the wishlist entry in place
     * with null product columns, so the page can say it is no longer
     * available, rather than making the entry vanish.
     *
     * @param {string} userId
     * @returns {Promise<object[]>}
     */
    async findByUser(userId) {
        const [rows] = await this.db.query(
            `SELECT w.*, p.name, p.price, p.image, p.stock
             FROM ${this.tableName} w
             LEFT JOIN products p
                    ON w.product_id = p.id
                   AND ${liveOn('p')}
             WHERE w.user_id = ? AND ${liveOn('w')}
             ORDER BY w.created_at DESC`,
            [userId]
        );

        return rows;
    }

    /**
     * Add to wishlist.
     *
     * The table's uniqueness rule is
     * `UNIQUE KEY user_product_unique (user_id, product_id, variant_id)`, so a
     * saved item is identified by all three. This used to take no variant and
     * check only `user_id`/`product_id`, which collapsed "the same shirt in two
     * sizes" -- a pair of rows the schema explicitly allows -- into one.
     *
     * Matching uses `<=>` rather than `=` because the variant is NULL for a
     * product with no variants, and `NULL = NULL` is NULL, not true.
     *
     * A previously removed entry is revived rather than re-inserted: the unique
     * key does not exclude soft-deleted rows, so inserting over one would fail.
     *
     * @param {string} userId
     * @param {string} productId
     * @param {number|null} [variantId]
     * @returns {Promise<object|null>} the saved row
     */
    async add(userId, productId, variantId = null) {
        const variant = toVariantId(variantId);

        const [existing] = await this.db.query(
            `SELECT * FROM ${this.tableName}
              WHERE user_id = ? AND product_id = ? AND variant_id <=> ?`,
            [userId, productId, variant]
        );

        const row = existing[0];

        if (row) {
            if (row.deleted_at === null || row.deleted_at === undefined) {
                return row;
            }

            await this.db.query(
                `UPDATE ${this.tableName}
                    SET deleted_at = NULL, deleted_by = NULL, updated_at = NOW()
                  WHERE id = ?`,
                [row.id]
            );

            this.cache.delete(row.id);

            return this.findById(row.id, { useCache: false });
        }

        const [result] = await this.db.query(
            `INSERT INTO ${this.tableName} (user_id, product_id, variant_id, created_at)
             VALUES (?, ?, ?, NOW())`,
            [userId, productId, variant]
        );

        // `wishlist_items.id` is INT AUTO_INCREMENT, so insertId is meaningful
        // here. It is not on the sibling repositories, whose tables are keyed
        // on CHAR(36) UUIDs and always report insertId 0.
        return this.findById(result.insertId, { useCache: false });
    }

    /**
     * Remove from wishlist.
     *
     * Stamps `deleted_at` rather than deleting the row, matching the column the
     * table carries and the `softDeleteColumn` this repository declares. An
     * entry already removed is not re-stamped, so the timestamp keeps recording
     * when the removal actually happened.
     *
     * @param {string} userId
     * @param {string} productId
     * @param {number|null} [variantId]
     * @returns {Promise<boolean>} whether a row changed
     */
    async remove(userId, productId, variantId = null) {
        const [result] = await this.db.query(
            `UPDATE ${this.tableName}
                SET deleted_at = NOW()
              WHERE user_id = ? AND product_id = ? AND variant_id <=> ?
                AND ${LIVE}`,
            [userId, productId, toVariantId(variantId)]
        );

        return result.affectedRows > 0;
    }

    /**
     * Check if in wishlist
     *
     * @param {string} userId
     * @param {string} productId
     * @param {number|null} [variantId]
     * @returns {Promise<boolean>}
     */
    async isInWishlist(userId, productId, variantId = null) {
        const [rows] = await this.db.query(
            `SELECT 1 FROM ${this.tableName}
              WHERE user_id = ? AND product_id = ? AND variant_id <=> ?
                AND ${LIVE}
              LIMIT 1`,
            [userId, productId, toVariantId(variantId)]
        );

        return rows.length > 0;
    }

    /**
     * Clear user wishlist.
     *
     * @param {string} userId
     * @returns {Promise<number>} how many entries were removed
     */
    async clear(userId) {
        const [result] = await this.db.query(
            `UPDATE ${this.tableName}
                SET deleted_at = NOW()
              WHERE user_id = ? AND ${LIVE}`,
            [userId]
        );

        return result.affectedRows;
    }

    /**
     * Get wishlist count
     */
    async getCount(userId) {
        const [rows] = await this.db.query(
            `SELECT COUNT(*) as count FROM ${this.tableName}
              WHERE user_id = ? AND ${LIVE}`,
            [userId]
        );

        return rows[0]?.count || 0;
    }

    /**
     * Get products in wishlist with details.
     *
     * An inner join here, unlike `findByUser`: this method is asked for the
     * products, so an entry whose product has been withdrawn has nothing to
     * contribute and a row of nulls would be worse than its absence.
     *
     * @param {string} userId
     * @returns {Promise<object[]>}
     */
    async getProductsWithDetails(userId) {
        const [rows] = await this.db.query(
            `SELECT
                w.id as wishlist_id,
                w.variant_id as variant_id,
                w.created_at as added_at,
                p.*
             FROM ${this.tableName} w
             INNER JOIN products p ON w.product_id = p.id
             WHERE w.user_id = ? AND ${liveOn('w')} AND ${liveOn('p')}
             ORDER BY w.created_at DESC`,
            [userId]
        );

        return rows;
    }
}

module.exports = new WishlistRepository();
