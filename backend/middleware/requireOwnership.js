// backend/middleware/requireOwnership.js
//
// "Does the caller own this thing?" declared at the route, not remembered in
// the handler.
//
// Ownership used to be whatever each handler happened to do: the invoice
// endpoint compared ids and answered 403, the cancel endpoint compared ids and
// answered 404, and the order-summary endpoint compared nothing at all, so any
// signed-in account could read any order's totals by guessing an id. Declaring
// the rule next to the route makes the omission visible in review instead of
// invisible in a controller three hundred lines long.
//
// ON 403 VS 404
//
// A resource that exists but belongs to somebody else answers 404, not 403.
// A 403 confirms the id is real, which turns a sequential id space into an
// enumeration oracle: an attacker learns how many orders the platform has
// processed, or which review ids are live, without ever seeing one. 404 is
// indistinguishable from "no such id", so it leaks nothing. The one case that
// still answers 401 is an unauthenticated caller, because there the client
// needs to know that logging in would help.

const db = require('../config/db');
const { PERMISSIONS, hasPermission, isAdminRole } = require('../config/policy');

// Table and column names are interpolated into SQL, so they are constrained to
// plain identifiers. They come from route wiring rather than from a request,
// but a typo that silently became injectable would be a poor trade for the
// convenience of a helper.
const SQL_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * The caller's account id.
 *
 * authMiddleware attaches the decoded token, which carries `id` on some paths
 * and `userId` on others, and rbacMiddleware later swaps in a full User model.
 * Reaching for one shape would silently yield `undefined`, and `undefined`
 * compares unequal to every owner id -- an ownership check that always fails
 * looks a lot like an ownership check that always passes, depending on which
 * side of the comparison you read first.
 *
 * @param {object} req
 * @returns {string|number|null}
 */
function callerId(req) {
    return req.user?.id ?? req.user?.userId ?? null;
}

/**
 * Ids arrive as CHAR(36) UUIDs from MySQL and as either strings or numbers
 * from JWT claims, so compare their string forms rather than trusting `===`.
 *
 * @param {*} a
 * @param {*} b
 * @returns {boolean}
 */
function sameId(a, b) {
    if (a === null || a === undefined || b === null || b === undefined) {
        return false;
    }
    return String(a) === String(b);
}

/**
 * Build a loader that reads a resource's owning account id from one table.
 *
 * @param {object} spec
 * @param {string} spec.table       table holding the resource
 * @param {string} [spec.column]    column holding the owning account id
 * @param {string} [spec.idColumn]  primary key column
 * @param {string} [spec.param]     route parameter holding the resource id
 * @returns {Function} loader suitable for requireOwnership
 */
function ownerFromTable({ table, column = 'user_id', idColumn = 'id', param = 'id' }) {
    for (const identifier of [table, column, idColumn]) {
        if (!SQL_IDENTIFIER.test(identifier)) {
            throw new Error(`Invalid SQL identifier: ${identifier}`);
        }
    }

    return async function loadOwnerId(req) {
        const resourceId = req.params?.[param];
        if (resourceId === undefined || resourceId === null || resourceId === '') {
            return null;
        }

        const [rows] = await db.query(
            `SELECT \`${column}\` AS ownerId FROM \`${table}\` WHERE \`${idColumn}\` = ? LIMIT 1`,
            [resourceId]
        );

        if (!Array.isArray(rows) || rows.length === 0) {
            return null;
        }

        return rows[0].ownerId;
    };
}

/**
 * Gate a route on the caller owning the resource named in the URL.
 *
 * @param {Function} loadOwnerId
 *        `(req) => ownerId | null`. Return null (or undefined) when no such
 *        resource exists; the middleware answers 404 either way, so a handler
 *        downstream never has to distinguish "missing" from "not yours".
 * @param {object} [options]
 * @param {string} [options.resourceName='Resource']  used in the 404 message
 * @param {boolean} [options.allowPrivileged=true]
 *        whether an elevated role may act on a resource it does not own.
 *        Set false for resources where the platform deliberately gives staff
 *        no back door, such as the saved address book.
 * @param {string} [options.privilegedPermission]
 *        require this specific permission for the bypass instead of accepting
 *        any admin role
 * @returns {Function} express middleware
 */
function requireOwnership(loadOwnerId, options = {}) {
    if (typeof loadOwnerId !== 'function') {
        throw new Error('requireOwnership requires a loader function');
    }

    const {
        resourceName = 'Resource',
        allowPrivileged = true,
        privilegedPermission = null
    } = options;

    if (privilegedPermission && !Object.values(PERMISSIONS).includes(privilegedPermission)) {
        throw new Error(`Unknown permission: ${privilegedPermission}`);
    }

    return async function ownershipGuard(req, res, next) {
        const userId = callerId(req);

        if (!req.user || userId === null) {
            return res.status(401).json({
                success: false,
                message: 'Authentication required'
            });
        }

        if (allowPrivileged) {
            const isPrivileged = privilegedPermission
                ? hasPermission(req.user, privilegedPermission)
                : isAdminRole(req.user.role);

            if (isPrivileged) {
                return next();
            }
        }

        try {
            const ownerId = await loadOwnerId(req);

            if (!sameId(ownerId, userId)) {
                return res.status(404).json({
                    success: false,
                    message: `${resourceName} not found`
                });
            }

            req.resourceOwnerId = ownerId;
            return next();
        } catch (error) {
            console.error(`Ownership check failed for ${resourceName}:`, error);

            return res.status(500).json({
                success: false,
                message: 'Failed to verify access to this resource'
            });
        }
    };
}

module.exports = requireOwnership;
module.exports.requireOwnership = requireOwnership;
module.exports.ownerFromTable = ownerFromTable;
module.exports.callerId = callerId;
