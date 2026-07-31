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
// alive: server.listen() and a daily setInterval renewal cron. The tests all
// run supertest against the exported `app` (no live listener needed), so they
// complete on their own -- but the leaked handles mean this suite must run
// with jest's `--forceExit` to let the process terminate.
process.env.NODE_ENV = 'test';
process.env.DB_HOST = process.env.DB_HOST || 'localhost';
process.env.DB_PORT = process.env.DB_PORT || '3306';
process.env.DB_USER = process.env.DB_USER || 'test';
process.env.DB_PASSWORD = process.env.DB_PASSWORD || 'test';
process.env.DB_NAME = process.env.DB_NAME || 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret_at_least_32_characters_long';
process.env.PORT = process.env.PORT || '5099';
process.env.FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5500';

const fs = require('fs');
const path = require('path');
const request = require('supertest');

const BACKEND_DIR = path.resolve(__dirname, '..');
const SERVER_PATH = path.join(BACKEND_DIR, 'server.js');

describe('server bootstrap', () => {
    let app;

    test('loads the app without throwing', () => {
        expect(() => {
            app = require('../server');
        }).not.toThrow();
        expect(app).toBeDefined();
        expect(typeof app).toBe('function');
    });

    test('GET / returns 200', async () => {
        const res = await request(app).get('/');
        expect(res.status).toBe(200);
    });

    test('GET /health returns 200', async () => {
        const res = await request(app).get('/health');
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
        const res = await request(app).get(route);
        expect(res.status).not.toBe(404);
    });
});

describe('route require guard', () => {
    // Every `require('./routes/...')` in server.js must resolve on disk.
    // A misspelled or missing route file (the #1230 notification-broker
    // filename typo) would otherwise only blow up at process start, not in CI.
    test('every ./routes/* require in server.js resolves', () => {
        const source = fs.readFileSync(SERVER_PATH, 'utf8');
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
