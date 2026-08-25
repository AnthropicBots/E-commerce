// backend/tests/serverBootstrap.test.js
//
// Bootstrap smoke test for #1230. Requiring ../server executes the whole
// startup path (env validation, route wiring, service init, socket setup),
// so this catches the "unparsable/unwired/misspelled route" class of
// regressions that only surface at process start.
//
// NODE_ENV=test is set BEFORE requiring the app: config/db.js skips its
// background initializeDatabase() when NODE_ENV==='test', and config/
// envValidator.js validates the required vars below (and process.exit(1)s if
// any are missing) at require time. All required vars are stubbed here so the
// module loads offline without a live MySQL.
//
// Requiring ../server has bootstrap side effects that keep the event loop
// alive, chiefly server.listen(). It used to also arm a daily setInterval
// renewal cron at module scope, outside the `NODE_ENV !== "test"` guard the
// other background jobs sit behind and with no unref; that is scheduled in
// bootstrap() with the rest now and is a no-op under test (#1494). The tests
// all run supertest against the exported `app` (no live listener needed), so
// they complete on their own -- but the remaining leaked handles mean this
// suite must still run with jest's `--forceExit` to let the process
// terminate.
process.env.NODE_ENV = 'test';
process.env.DB_HOST = process.env.DB_HOST || 'localhost';
process.env.DB_PORT = process.env.DB_PORT || '3306';
process.env.DB_USER = process.env.DB_USER || 'test';
process.env.DB_PASSWORD = process.env.DB_PASSWORD || 'test';
process.env.DB_NAME = process.env.DB_NAME || 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret_at_least_32_characters_long';
process.env.PORT = process.env.PORT || '5099';
process.env.FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5500';

// Requiring ../server builds the whole module graph, and part of that graph
// reaches for Redis: services/refreshTokenService.js calls redis.connect() at
// module scope, which defeats the lazyConnect config/redis sets under Jest.
// With no server listening, ioredis exhausted its retries part-way through a
// request and the probe below failed with MaxRetriesPerRequestError instead of
// an HTTP status -- an environment failure wearing the costume of a routing
// one (#1444).
//
// This suite is about wiring: does requiring the server produce an app with
// these routers mounted. Whether Redis is up is not part of that question, so
// it is taken out of the picture.
jest.mock('../config/redis', () => {
    const { createRedisMock } = require('./helpers/redisMock');
    return createRedisMock();
});

const fs = require('fs');
const path = require('path');
const request = require('supertest');

const BACKEND_DIR = path.resolve(__dirname, '..');
const SERVER_PATH = path.join(BACKEND_DIR, 'server.js');

// The app under test, assigned by the first case below and shared by the rest.
let app;

// Transport-level errors are not routing failures.
//
// Requiring ../server binds a listener and kicks off several async service
// initialisations that keep touching the (absent) database in the background.
// Supertest raises a fresh ephemeral server per request, and occasionally one
// of those background rejections lands between the connect and the response,
// which surfaces as `ECONNRESET` / "socket hang up" rather than an HTTP status.
// That made this suite fail roughly four runs in five (#1341) -- a flaky check
// is worse than no check, because contributors learn to re-run it.
//
// Retrying distinguishes the two cases: a route that is genuinely missing
// returns 404 deterministically on every attempt, while a dropped connection
// does not recur. The assertion still requires a real HTTP response, so a
// genuinely unmounted router still fails.
async function getWithRetry(route, attempts = 3) {
    let lastError;

    for (let i = 0; i < attempts; i++) {
        try {
            return await request(app).get(route);
        } catch (error) {
            lastError = error;
        }
    }

    throw lastError;
}

describe('server bootstrap', () => {
    test('loads the app without throwing', () => {
        expect(() => {
            app = require('../server');
        }).not.toThrow();
        expect(app).toBeDefined();
        expect(typeof app).toBe('function');
    });

    test('GET / returns 200', async () => {
        const res = await getWithRetry('/');
        expect(res.status).toBe(200);
    });

    test('GET /health returns 200', async () => {
        const res = await getWithRetry('/health');
        expect(res.status).toBe(200);
    });

    // Each entry is an endpoint the router actually defines.
    //
    // This previously probed the mount points themselves -- `/api/copywriter`
    // and `/api/notifications` -- but neither router declares a `GET /`, so
    // both returned 404 whether or not they were wired up. The assertion could
    // not tell "router missing" from "router mounted, no index route", which is
    // the very thing it exists to check. Probing a route that does exist can:
    // unauthenticated requests get 401 from authMiddleware, and a 401 is only
    // reachable if the router is mounted.
    test.each([
        ['/api/experiments', 'experimentRoutes'],
        ['/api/copywriter/analytics', 'copywriterRoutes'],
        ['/api/notifications/types', 'notificationBrokerRoutes']
    ])('%s is served by a mounted router (not 404)', async (route) => {
        const res = await getWithRetry(route);
        expect(res.status).not.toBe(404);
    });
});

describe('route require guard', () => {
    // Every `require('./routes/...')` in server.js must resolve on disk.
    // A misspelled or missing route file (the #1230 notification-broker
    test('every ./routes/* require resolves', () => {
        const serverSource = fs.readFileSync(SERVER_PATH, 'utf8');
        const indexSource = fs.readFileSync(path.join(BACKEND_DIR, 'routes', 'index.js'), 'utf8');
        const source = serverSource + '\n' + indexSource;
        const routeRequire = /require\(\s*['"](\.\/routes\/[^'"]+)['"]\s*\)/g;

        const routePaths = new Set();
        let match;
        while ((match = routeRequire.exec(source)) !== null) {
            routePaths.add(match[1]);
        }

        expect(routePaths.size).toBeGreaterThan(0);

        const unresolved = [];
        for (const relPath of routePaths) {
            try {
                require.resolve(path.resolve(BACKEND_DIR, relPath));
            } catch (err) {
                unresolved.push(relPath);
            }
        }

        expect(unresolved).toEqual([]);
    });
});
