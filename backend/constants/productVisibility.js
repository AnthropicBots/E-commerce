// backend/constants/productVisibility.js
//
// One definition of "a shopper may see this product" (#1456).
//
// `products` carries two independent visibility columns:
//
//   deleted_at  DATETIME                                        -- soft delete
//   status      ENUM('draft','active','inactive','archived')    -- lifecycle
//                                                DEFAULT 'draft'
//
// Before this module, every public query filtered on `deleted_at` and nothing
// read `status` at all -- so drafts were on the shop page, and an admin setting
// a product to `inactive` to take it off sale had no effect. The autocomplete
// query filtered on neither, so soft-deleted products appeared in the dropdown
// and linked to a detail page that 404s.
//
// Both halves of that came from the condition being retyped at each call site.
// It lives here now so a new query gets it by importing rather than by
// remembering, and so there is one place to change if the rules ever move.
//
// The lifecycle, for reference:
//
//   draft     -- being prepared, never been on sale. Not public.
//   active    -- on sale. The only public state.
//   inactive  -- deliberately withdrawn, expected back. Not public.
//   archived  -- retired, or soft-deleted (see deleteProduct). Not public.

'use strict';

/** Every value the `products.status` column will accept. */
const PRODUCT_STATUSES = Object.freeze([
    'draft',
    'active',
    'inactive',
    'archived'
]);

/**
 * The statuses a shopper may see.
 *
 * A list rather than a single string because "published" is a concept that
 * tends to grow a second member (scheduled, clearance, ...), and every caller
 * below already handles a list.
 */
const PUBLIC_PRODUCT_STATUSES = Object.freeze(['active']);

/**
 * What `createProduct` writes when the caller does not say.
 *
 * `active`, not the column's `draft`, and that difference is deliberate. The
 * create endpoint is admin-only and its callers have always expected the
 * product to be on sale afterwards -- it looked that way because nothing read
 * `status`. Defaulting to `draft` here would keep the column honest and silently
 * change what the endpoint does, which is a bigger surprise than this one.
 * Pass `status: 'draft'` explicitly to stage a product instead.
 */
const DEFAULT_PRODUCT_STATUS = 'active';

/** The status a product is moved to when it is withdrawn from sale. */
const ARCHIVED_PRODUCT_STATUS = 'archived';

/**
 * Is this a value the column will accept?
 *
 * @param {unknown} status
 * @returns {boolean}
 */
const isValidProductStatus = (status) =>
    typeof status === 'string'
    && PRODUCT_STATUSES.includes(status.trim().toLowerCase());

/**
 * Coerce caller input to a storable status.
 *
 * Returns `null` for anything the enum does not cover, so a caller can tell
 * "not supplied" from "supplied but wrong" and answer 400 rather than writing a
 * value MySQL would reject in strict mode (or silently truncate outside it).
 *
 * @param {unknown} status
 * @returns {string|null}
 */
const normalizeProductStatus = (status) => {
    if (status === undefined || status === null || status === '') {
        return null;
    }
    if (!isValidProductStatus(status)) {
        return null;
    }
    return String(status).trim().toLowerCase();
};

/**
 * The WHERE fragment restricting a query to what shoppers may see.
 *
 * Returns parameters rather than interpolating the statuses, so the fragment
 * stays safe if `PUBLIC_PRODUCT_STATUSES` ever becomes configurable, and so it
 * reads the same as every other condition around it.
 *
 * @param {string} [alias='p'] Table alias used for `products` in the query.
 * @returns {{sql: string, params: string[]}}
 */
const publicProductCondition = (alias = 'p') => {
    const prefix = alias ? `${alias}.` : '';
    const placeholders = PUBLIC_PRODUCT_STATUSES.map(() => '?').join(', ');

    return {
        sql: `${prefix}deleted_at IS NULL AND ${prefix}status IN (${placeholders})`,
        params: [...PUBLIC_PRODUCT_STATUSES]
    };
};

module.exports = {
    PRODUCT_STATUSES,
    PUBLIC_PRODUCT_STATUSES,
    DEFAULT_PRODUCT_STATUS,
    ARCHIVED_PRODUCT_STATUS,
    isValidProductStatus,
    normalizeProductStatus,
    publicProductCondition
};
