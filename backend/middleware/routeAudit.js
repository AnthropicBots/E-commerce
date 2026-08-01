// backend/middleware/routeAudit.js
//
// Deny by default, checked rather than assumed.
//
// Authorization that lives in middleware only works if the middleware is
// actually attached, and "someone forgot the guard" is silent: the route
// returns 200 and looks healthy. This walks the router stacks and names every
// route that is neither on the public allowlist nor behind a policy-bearing
// middleware, so the omission shows up as a failure instead of as traffic.
//
// The check is structural, not behavioural: it inspects the handler chain of
// each registered route. It issues no requests, opens no sockets and needs no
// database, so it can run during bootstrap or inside a unit test without any
// chance of hanging.

const { isPolicyMiddleware } = require('../config/policy');
const { AUDITED_MOUNTS, isPublicRoute } = require('../config/routePolicy');

/**
 * Join a mount prefix and a route path into the path a client would call.
 *
 * @param {string} basePath
 * @param {string} routePath
 * @returns {string}
 */
function joinPaths(basePath, routePath) {
    const base = (basePath || '').replace(/\/+$/, '');
    const leaf = routePath === '/' ? '' : routePath || '';
    return `${base}${leaf}` || '/';
}

/**
 * Every route registered on a router, with the guards that apply to it.
 *
 * Router-level middleware (`router.use(authMiddleware)`) protects the routes
 * declared after it, so the stack is read in order and those guards accumulate
 * -- reading a route layer in isolation would report a router that guards
 * everything once at the top as entirely unprotected.
 *
 * @param {object} router an Express Router or app
 * @param {string} [basePath='']
 * @returns {Array<{method: string, path: string, handlers: string[], isProtected: boolean}>}
 */
function collectRoutes(router, basePath = '') {
    const stack = router?.stack || router?.router?.stack || router?._router?.stack;

    if (!Array.isArray(stack)) {
        return [];
    }

    const routes = [];
    const inheritedGuards = [];

    for (const layer of stack) {
        if (!layer.route) {
            if (typeof layer.handle === 'function' && isPolicyMiddleware(layer.handle)) {
                inheritedGuards.push(layer.handle);
            }
            continue;
        }

        const routeGuards = (layer.route.stack || [])
            .map((routeLayer) => routeLayer.handle)
            .filter((handle) => typeof handle === 'function');

        const guards = [...inheritedGuards, ...routeGuards];
        const methods = Object.keys(layer.route.methods || {})
            .filter((method) => layer.route.methods[method]);

        for (const method of methods) {
            routes.push({
                // `router.all()` records itself under the internal `_all` key.
                method: method === '_all' ? 'ALL' : method.toUpperCase(),
                path: joinPaths(basePath, layer.route.path),
                handlers: guards.map((guard) => guard.name || '<anonymous>'),
                isProtected: guards.some(isPolicyMiddleware)
            });
        }
    }

    return routes;
}

/**
 * @param {Array<{basePath: string, router: object}>} mounts
 * @returns {Array} every route across the given mounts
 */
function collectMountedRoutes(mounts) {
    return (mounts || []).flatMap(({ basePath, router }) => collectRoutes(router, basePath));
}

/**
 * Routes that declare no policy and are not on the public allowlist.
 *
 * @param {Array<{basePath: string, router: object}>} mounts
 * @returns {Array<{method: string, path: string}>}
 */
function findUnprotectedRoutes(mounts) {
    return collectMountedRoutes(mounts)
        .filter((route) => !route.isProtected && !isPublicRoute(route.method, route.path))
        .map(({ method, path }) => ({ method, path }));
}

/**
 * Load the routers named in the audit registry.
 *
 * Separated from the audit so a test can drive `findUnprotectedRoutes` with
 * routers it builds itself; requiring the real ones pulls in services and a
 * connection pool, which belongs in bootstrap and nowhere else.
 *
 * @returns {Array<{basePath: string, router: object}>}
 */
function loadAuditedMounts() {
    return AUDITED_MOUNTS.map(({ basePath, modulePath }) => ({
        basePath,
        router: require(modulePath)
    }));
}

/**
 * Throw unless every audited route declares a policy.
 *
 * Reports the whole list rather than the first offender: fixing them one
 * bootstrap failure at a time is a poor use of anyone's afternoon.
 *
 * @param {Array<{basePath: string, router: object}>} [mounts]
 * @throws {Error} listing every unprotected route
 */
function assertRoutesProtected(mounts = loadAuditedMounts()) {
    const unprotected = findUnprotectedRoutes(mounts);

    if (unprotected.length === 0) {
        return;
    }

    const listing = unprotected
        .map(({ method, path }) => `  ${method} ${path}`)
        .join('\n');

    throw new Error(
        'Routes declare no authorization policy and are not on the public ' +
        `allowlist in config/routePolicy.js:\n${listing}`
    );
}

/**
 * Bootstrap hook.
 *
 * Off unless ROUTE_POLICY_AUDIT is set, so an existing deployment does not
 * start failing on an audit it has never run. `enforce` refuses to start;
 * `warn` logs and carries on, which is the setting to run for a release or two
 * before turning enforcement on.
 *
 * @param {object} [options]
 * @param {string} [options.mode=process.env.ROUTE_POLICY_AUDIT]
 * @param {Array} [options.mounts]
 * @returns {Array<{method: string, path: string}>} the routes that failed
 */
function runStartupAudit({ mode = process.env.ROUTE_POLICY_AUDIT, mounts } = {}) {
    if (mode !== 'enforce' && mode !== 'warn') {
        return [];
    }

    const resolved = mounts || loadAuditedMounts();

    if (mode === 'enforce') {
        assertRoutesProtected(resolved);
        return [];
    }

    const unprotected = findUnprotectedRoutes(resolved);

    for (const { method, path } of unprotected) {
        console.warn(`[route-policy] no policy declared for ${method} ${path}`);
    }

    return unprotected;
}

module.exports = {
    collectRoutes,
    collectMountedRoutes,
    findUnprotectedRoutes,
    loadAuditedMounts,
    assertRoutesProtected,
    runStartupAudit
};
