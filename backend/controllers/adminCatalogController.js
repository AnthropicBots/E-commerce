// backend/controllers/adminCatalogController.js
//
// The catalogue and order surface the admin dashboard actually calls (#1697).
//
// `frontend/scripts/admin.js` was repointed at `/api/admin/verify`,
// `/api/admin/products` and `/api/admin/orders` in #1666, and none of them were
// mounted. `verifyAdminAccess()` is the first thing that runs on admin.html, so
// its 404 sent every admin straight back to signin.html and nothing else on the
// page ever got a chance to fail.
//
// Why these live here rather than reusing the public `/api/products` and
// `/api/orders` routes:
//
//   - The public product list is restricted to `PUBLIC_PRODUCT_STATUSES` (see
//     constants/productVisibility.js). An admin managing the catalogue has to
//     see drafts, inactive and archived products -- they are precisely the rows
//     that need attention -- so the admin list deliberately does not apply that
//     filter.
//   - The public order list is scoped to `req.user.id`. An admin needs the
//     whole queue.
//
// Writes are not duplicated: the router delegates product create/update/delete
// to the existing productController, which already owns validation, slugging
// and soft-delete semantics.

'use strict';

const db = require('../config/db');
const logger = require('../utils/logger');
const {
    safeArray,
    safeNumber,
    sanitizeString,
    getPagination,
    buildPaginationMeta
} = require('../utils/helpers');
const { PRODUCT_STATUSES } = require('../constants/productVisibility');

/**
 * Statuses an admin may move an order to.
 *
 * Mirrors the list `order.service.js#updateOrderStatusService` enforces. It is
 * restated rather than imported because that module pulls in the whole pricing
 * and shipping stack, and this controller only needs six strings; the guard
 * test pins the two lists together so they cannot drift.
 */
const ORDER_STATUSES = Object.freeze([
    'pending',
    'confirmed',
    'processing',
    'shipped',
    'delivered',
    'cancelled'
]);

/** Terminal states: an order here is not moved again by the dashboard. */
const TERMINAL_ORDER_STATUSES = Object.freeze(['delivered', 'cancelled']);

/** Largest page an admin list will return, whatever `?limit=` says. */
const MAX_PAGE_SIZE = 100;

/**
 * GET /api/admin/verify
 *
 * Confirms the caller holds an admin role and hands back the identity the
 * dashboard renders. There is no work to do here beyond echoing `req.user`:
 * `authMiddleware` has already resolved the session and `adminMiddleware` has
 * already rejected anyone outside `ADMIN_ROLES`, so reaching this function is
 * itself the answer. Kept as its own endpoint anyway so the client has one
 * cheap call to make before drawing a page it may not be allowed to see.
 */
const verifyAdmin = async (req, res) => {
    const user = req.user || {};

    logger.info('Admin access verified', {
        adminId: user.id,
        role: user.role,
        ip: req.ip
    });

    return res.status(200).json({
        success: true,
        user: {
            id: user.id,
            name: user.name || null,
            email: user.email || null,
            role: user.role
        }
    });
};

/**
 * GET /api/admin/products?page=&limit=&search=&status=
 *
 * The catalogue as an operator sees it: every lifecycle state, newest first.
 *
 * Soft-deleted rows are excluded by default because the dashboard's delete
 * button archives rather than drops, and a list that keeps showing what you
 * just deleted reads as a failed delete. `?includeDeleted=true` brings them
 * back for the restore flow.
 */
const listProducts = async (req, res) => {
    try {
        const { page, limit, offset } = getPagination(
            req.query.page,
            req.query.limit,
            MAX_PAGE_SIZE
        );

        const search = sanitizeString(req.query.search || '').trim();
        const status = sanitizeString(req.query.status || '').trim().toLowerCase();
        const includeDeleted = String(req.query.includeDeleted) === 'true';

        const conditions = [];
        const params = [];

        if (!includeDeleted) {
            conditions.push('deleted_at IS NULL');
        }

        if (status && PRODUCT_STATUSES.includes(status)) {
            conditions.push('status = ?');
            params.push(status);
        }

        if (search) {
            // Escaped for LIKE, not just for SQL: a search for "50%" must not
            // become a wildcard. The backslash is MySQL's default LIKE escape.
            const term = `%${search.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
            conditions.push('(name LIKE ? OR sku LIKE ? OR brand LIKE ?)');
            params.push(term, term, term);
        }

        const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

        const [countRows] = await db.query(
            `SELECT COUNT(*) AS total FROM products ${where}`,
            params
        );
        const total = safeNumber(safeArray(countRows)[0]?.total, 0);

        const [rows] = await db.query(
            `SELECT id, name, sku, brand, price, compare_price, stock,
                    low_stock_threshold, image, category_id, status, is_active,
                    featured, rating, num_reviews, deleted_at, created_at, updated_at
               FROM products
               ${where}
              ORDER BY created_at DESC, id DESC
              LIMIT ? OFFSET ?`,
            [...params, limit, offset]
        );

        const products = safeArray(rows);

        return res.status(200).json({
            success: true,
            // admin.js reads `productsRes.products`; `data` matches the shape
            // every other admin route answers with. Both, so neither breaks.
            products,
            data: { products },
            pagination: buildPaginationMeta(total, page, limit)
        });
    } catch (error) {
        logger.error('Admin product list error:', {
            error: error.message,
            adminId: req.user?.id
        });

        return res.status(500).json({
            success: false,
            message: 'Failed to fetch products'
        });
    }
};

/**
 * GET /api/admin/orders?page=&limit=&status=&search=
 *
 * The whole order queue, newest first, with the item count the dashboard shows
 * without a second round trip per row.
 */
const listOrders = async (req, res) => {
    try {
        const { page, limit, offset } = getPagination(
            req.query.page,
            req.query.limit,
            MAX_PAGE_SIZE
        );

        const status = sanitizeString(req.query.status || '').trim().toLowerCase();
        const search = sanitizeString(req.query.search || '').trim();

        const conditions = [];
        const params = [];

        if (status && ORDER_STATUSES.includes(status)) {
            conditions.push('o.status = ?');
            params.push(status);
        }

        if (search) {
            const term = `%${search.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
            conditions.push(
                '(o.order_number LIKE ? OR o.customer_name LIKE ? OR o.customer_email LIKE ?)'
            );
            params.push(term, term, term);
        }

        const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

        const [countRows] = await db.query(
            `SELECT COUNT(*) AS total FROM orders o ${where}`,
            params
        );
        const total = safeNumber(safeArray(countRows)[0]?.total, 0);

        const [rows] = await db.query(
            `SELECT o.id, o.order_number, o.user_id, o.customer_name, o.customer_email,
                    o.customer_phone, o.city, o.state, o.zip, o.payment_method,
                    o.status, o.subtotal, o.discount_amount, o.tax, o.shipping_cost,
                    o.total, o.created_at, o.updated_at,
                    COUNT(oi.id) AS item_count
               FROM orders o
               LEFT JOIN order_items oi ON oi.order_id = o.id
               ${where}
              GROUP BY o.id
              ORDER BY o.created_at DESC, o.id DESC
              LIMIT ? OFFSET ?`,
            [...params, limit, offset]
        );

        const orders = safeArray(rows);

        return res.status(200).json({
            success: true,
            orders,
            data: { orders },
            pagination: buildPaginationMeta(total, page, limit)
        });
    } catch (error) {
        logger.error('Admin order list error:', {
            error: error.message,
            adminId: req.user?.id
        });

        return res.status(500).json({
            success: false,
            message: 'Failed to fetch orders'
        });
    }
};

/**
 * PATCH /api/admin/orders/:id/status
 *
 * Body: `{ status }`.
 *
 * The transitions refused here are the same ones
 * `order.service.js#updateOrderStatusService` refuses, for the same reason: a
 * delivered order that is quietly moved back to "processing" loses the fact
 * that it was delivered, and a cancelled order that is moved at all
 * contradicts a refund that may already have been issued. Cancelling a
 * delivered order stays allowed -- that is a return, and it is a real thing an
 * operator does.
 */
const updateOrderStatus = async (req, res) => {
    const orderId = sanitizeString(req.params.id || '').trim();
    const status = sanitizeString(req.body?.status || '').trim().toLowerCase();

    if (!orderId) {
        return res.status(400).json({
            success: false,
            message: 'Order id is required'
        });
    }

    if (!ORDER_STATUSES.includes(status)) {
        return res.status(400).json({
            success: false,
            message: `Invalid status. Allowed: ${ORDER_STATUSES.join(', ')}`
        });
    }

    try {
        const [rows] = await db.query(
            'SELECT id, status FROM orders WHERE id = ? LIMIT 1',
            [orderId]
        );
        const order = safeArray(rows)[0];

        if (!order) {
            return res.status(404).json({
                success: false,
                message: 'Order not found'
            });
        }

        const current = String(order.status || '').toLowerCase();

        if (current === status) {
            // Not an error, and not a write either. Answering 200 keeps the
            // dropdown from bouncing back on a no-op change event.
            return res.status(200).json({
                success: true,
                message: `Order is already ${status}`,
                data: { orderId, oldStatus: current, newStatus: status }
            });
        }

        if (current === 'cancelled') {
            return res.status(409).json({
                success: false,
                message: 'Cannot change the status of a cancelled order'
            });
        }

        if (current === 'delivered' && status !== 'cancelled') {
            return res.status(409).json({
                success: false,
                message: 'A delivered order can only be moved to cancelled'
            });
        }

        await db.query(
            'UPDATE orders SET status = ?, updated_at = NOW() WHERE id = ?',
            [status, orderId]
        );

        // The audit row is best-effort on purpose. `order_status_logs` is not
        // in every environment's schema yet, and losing the log entry is worth
        // less than refusing a status change the operator has already made.
        try {
            await db.query(
                `INSERT INTO order_status_logs (order_id, old_status, new_status, updated_by, created_at)
                 VALUES (?, ?, ?, ?, NOW())`,
                [orderId, current, status, req.user?.id || null]
            );
        } catch (logError) {
            logger.warn('Order status log write failed', {
                orderId,
                error: logError.message
            });
        }

        logger.info('Admin updated order status', {
            orderId,
            from: current,
            to: status,
            adminId: req.user?.id
        });

        return res.status(200).json({
            success: true,
            message: 'Order status updated',
            data: {
                orderId,
                oldStatus: current,
                newStatus: status
            }
        });
    } catch (error) {
        logger.error('Admin order status update error:', {
            error: error.message,
            orderId,
            adminId: req.user?.id
        });

        return res.status(500).json({
            success: false,
            message: 'Failed to update order status'
        });
    }
};

module.exports = {
    ORDER_STATUSES,
    TERMINAL_ORDER_STATUSES,
    MAX_PAGE_SIZE,
    verifyAdmin,
    listProducts,
    listOrders,
    updateOrderStatus
};
