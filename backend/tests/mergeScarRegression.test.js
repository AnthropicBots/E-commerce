// backend/tests/mergeScarRegression.test.js
//
// One assertion per defect fixed in #1341.
//
// The parse gate (tests/syntaxGate.test.js) proves these six files *compile*.
// It cannot prove the right side of each conflict survived. Every case below
// pins a specific decision, so a future merge that re-introduces the losing
// side fails here with a message naming what went wrong rather than a generic
// "undefined is not a function" three layers away.

const fs = require('fs');
const path = require('path');

const BACKEND_DIR = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(BACKEND_DIR, '..');

function read(relativePath) {
    return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

/** Count non-overlapping matches of a global regex. */
function countMatches(source, regex) {
    return (source.match(regex) || []).length;
}

describe('backend/server.js', () => {
    const source = read('backend/server.js');

    it('declares dotenv exactly once', () => {
        expect(countMatches(source, /^const dotenv = require\(/gm)).toBe(1);
    });

    // The identity middleware pair was pasted sixteen lines above
    // `const app = express()`. That parses, and then throws
    // `ReferenceError: Cannot access 'app' before initialization` at require.
    it('does not use `app` before it is created', () => {
        const appCreation = source.indexOf('const app = express()');
        expect(appCreation).toBeGreaterThan(-1);

        const firstUse = source.search(/^app\.(use|get|post|listen)\(/m);
        expect(firstUse).toBeGreaterThan(appCreation);
    });

    it('mounts the identity router and its middleware', () => {
        expect(source).toMatch(/app\.use\(verifyIdentityClaims\)/);
        expect(source).toMatch(/app\.use\(['"]\/api\/identity['"], identityRoutes\)/);
    });
});

describe('backend/routes/healthRoutes.js', () => {
    const source = read('backend/routes/healthRoutes.js');

    // The file ended `module.exports = router;+` followed by a second, clean
    // export. `router;+\n\nmodule.exports` parses as `router + module.exports =
    // router` -- "Invalid left-hand side in assignment".
    it('exports the router exactly once, with no stray operator', () => {
        expect(countMatches(source, /^module\.exports = router;$/gm)).toBe(1);
        expect(source).not.toMatch(/module\.exports = router;\+/);
    });
});

describe('backend/services/agentBehaviourBaselineService.js', () => {
    const source = read('backend/services/agentBehaviourBaselineService.js');
    const service = require('../services/agentBehaviourBaselineService');

    it('exports the singleton exactly once', () => {
        expect(
            countMatches(source, /^module\.exports = new AgentBehavioralBaselineService\(\);$/gm)
        ).toBe(1);
    });

    it('has no top-level code after the export', () => {
        const exportIndex = source.lastIndexOf('module.exports = new AgentBehavioralBaselineService();');
        const tail = source.slice(exportIndex);

        // Only the class re-export and comments may follow.
        expect(tail).not.toMatch(/^\s+return\s/m);
    });

    it('loads and exposes the service', () => {
        expect(typeof service.getStatus).toBe('function');
        expect(typeof service.getStatistics).toBe('function');
    });

    // The graceful catch body had been stranded outside the class. Statistics
    // are advisory, so a failure must degrade rather than propagate.
    it('returns an empty-but-shaped result when statistics cannot be read', async () => {
        const stats = await service.getStatistics();

        expect(stats).toHaveProperty('anomalies');
        expect(stats).toHaveProperty('alerts');
        expect(stats).toHaveProperty('timestamp');
    });
});

describe('backend/services/capabilityDiscoveryService.js', () => {
    const source = read('backend/services/capabilityDiscoveryService.js');
    const { capabilityDiscoveryService } = require('../services/capabilityDiscoveryService');

    // Three methods had both their pre-transaction and connection-aware
    // signatures kept, back to back.
    it.each([
        ['registerCapability'],
        ['storeService'],
        ['storeCapability']
    ])('declares %s exactly once', (method) => {
        expect(countMatches(source, new RegExp(`^\\s+async ${method}\\(`, 'gm'))).toBe(1);
    });

    it('keeps the connection-aware signatures', () => {
        expect(source).toMatch(/async registerCapability\(serviceId, capabilityData, connection = null\)/);
        expect(source).toMatch(/async storeService\(service, connection = db\)/);
        expect(source).toMatch(/async storeCapability\(capability, connection = db\)/);
    });

    // The export object literal was closed twice -- `};\n\n};` -- which is an
    // "Unexpected token '}'" at the very last line of the file.
    it('closes its export object exactly once', () => {
        const exportIndex = source.indexOf('module.exports = {');
        expect(exportIndex).toBeGreaterThan(-1);
        expect(countMatches(source.slice(exportIndex), /^};$/gm)).toBe(1);
    });

    it('loads and exposes the service', () => {
        expect(typeof capabilityDiscoveryService.registerCapability).toBe('function');
    });
});

describe('backend/services/recentlyViewedService.js', () => {
    const source = read('backend/services/recentlyViewedService.js');
    const service = require('../services/recentlyViewedService');

    it('defines each method exactly once', () => {
        for (const method of [
            'addViewed',
            'getRecentlyViewed',
            'clearRecentlyViewed',
            'removeFromViewed',
            'getCount'
        ]) {
            expect(countMatches(source, new RegExp(`^\\s+async ${method}\\(`, 'gm'))).toBe(1);
        }
    });

    it('exports the singleton exactly once, at the end of the file', () => {
        expect(countMatches(source, /^module\.exports = recentlyViewedService;$/gm)).toBe(1);
        expect(source).not.toMatch(/^module\.exports = new RecentlyViewedService\(\);$/m);
    });

    // Two cache shapes were written to the same key: a bare array and
    // `{ data, timestamp }`. Every reader expects the second.
    it('writes and reads one cache shape', () => {
        service.writeCache('user-1', [{ id: 'p1' }]);

        const raw = service.cache.get(service.getCacheKey('user-1'));
        expect(Array.isArray(raw)).toBe(false);
        expect(raw).toHaveProperty('data');
        expect(raw).toHaveProperty('timestamp');

        expect(service.readCache('user-1')).toEqual([{ id: 'p1' }]);
    });

    it('treats an expired cache entry as a miss', () => {
        service.cache.set(service.getCacheKey('user-2'), {
            data: [{ id: 'p1' }],
            timestamp: Date.now() - (service.cacheTTL + 1000)
        });

        expect(service.readCache('user-2')).toBeNull();
    });

    // products has `image`, `category_id`, `rating` and `num_reviews` -- not
    // `image_url`, `category` or `avg_rating`. The surviving queries used the
    // latter and would have failed with ER_BAD_FIELD_ERROR.
    it('queries only columns that exist on products', () => {
        expect(source).not.toMatch(/p\.image_url/);
        expect(source).not.toMatch(/p\.avg_rating/);
        expect(source).not.toMatch(/p\.category\b(?!_id)/);
    });
});

describe('frontend/scripts/product-cards-home.js', () => {
    const source = read('frontend/scripts/product-cards-home.js');

    it('does not redeclare the wishlistIds parameter inside the function body', () => {
        expect(source).not.toMatch(/^\s+const wishlistIds = wishlistSet/m);
    });

    it('resolves the wishlist through the shared helper', () => {
        expect(source).toMatch(/const isWishlisted = isProductWishlisted\(product\.id, wishlistIds\)/);
    });
});

describe('shared infrastructure', () => {
    // Six modules each constructed their own Redis client at module scope.
    it('has exactly one Redis client construction in the backend', () => {
        const withOwnClient = [];

        for (const dir of ['services', 'controllers', 'middleware', 'utils', 'config']) {
            const dirPath = path.join(BACKEND_DIR, dir);
            if (!fs.existsSync(dirPath)) continue;

            for (const file of fs.readdirSync(dirPath)) {
                if (!file.endsWith('.js')) continue;
                const contents = fs.readFileSync(path.join(dirPath, file), 'utf8');
                if (/^const redis = new Redis\(/m.test(contents)) {
                    withOwnClient.push(`${dir}/${file}`);
                }
            }
        }

        expect(withOwnClient).toEqual(['config/redis.js']);
    });

    // A library module that kills the process on import leaves its host no way
    // to log, drain or report -- and is unrecoverable inside a Jest worker.
    it('config/db.js reports missing configuration by throwing, not exiting', () => {
        const source = read('backend/config/db.js');

        // Comments are stripped: the explanation of *why* this changed names
        // `process.exit(1)` in prose, and matching that would be a false
        // positive.
        const code = source
            .slice(0, source.indexOf('const useSSL'))
            .replace(/^\s*\/\/.*$/gm, '');

        expect(code).not.toMatch(/process\.exit\(/);
        expect(code).toMatch(/throw new Error\(/);
    });

    // Prometheus metric names may not contain dots, but every call site uses
    // them, so each helper threw `Invalid metric name` on first use.
    it('config/metrics.js normalises dotted metric names', () => {
        const metrics = require('../config/metrics');

        expect(metrics.normalizeMetricName('audit.session_started')).toBe(
            'audit_audit_session_started'
        );
        expect(metrics.normalizeMetricName('db_operation.retry')).toMatch(
            /^[a-zA-Z_:][a-zA-Z0-9_:]*$/
        );
    });

    it('config/metrics.js never lets instrumentation throw at the caller', () => {
        const metrics = require('../config/metrics');

        expect(() => metrics.increment('audit.session_started')).not.toThrow();
        expect(() => metrics.gauge('cache.size', 5)).not.toThrow();
        expect(() => metrics.histogram('db_operation.duration', 12)).not.toThrow();
    });

    // #1157 exported a bag of functions; #1268 replaced it with a class and
    // exported only the instance, silently breaking every existing call site.
    it('courierWebhookService keeps both its flat and class export shapes', () => {
        const courier = require('../services/courierWebhookService');

        expect(typeof courier.courierWebhookService).toBe('object');
        expect(typeof courier.CourierWebhookService).toBe('function');
        expect(typeof courier.ingestWebhook).toBe('function');
        expect(typeof courier.processPendingWebhooks).toBe('function');
        expect(typeof courier.normalizeEvent).toBe('function');
        expect(typeof courier.mapCourierStatus).toBe('function');
    });

    // Every distinct webhook event added a Map entry that was never removed.
    it('courierWebhookService bounds its dedupe cache', () => {
        const { courierWebhookService } = require('../services/courierWebhookService');

        expect(typeof courierWebhookService.rememberProcessed).toBe('function');
        expect(typeof courierWebhookService.clearProcessedCache).toBe('function');

        courierWebhookService.clearProcessedCache();
        expect(courierWebhookService.processedCache.size).toBe(0);
    });

    // Required by utils/socketManager.js but absent from package.json, so a
    // clean `npm ci` produced a server that could not start.
    it('declares every package the backend requires at boot', () => {
        const pkg = JSON.parse(read('backend/package.json'));

        // Bracket access, not toHaveProperty: these names contain dots, which
        // toHaveProperty reads as a key path.
        expect(pkg.dependencies['@socket.io/redis-adapter']).toBeDefined();
        expect(pkg.dependencies['socket.io']).toBeDefined();
    });
});

describe('backend/routes/performanceRoutes.js', () => {
    const source = read('backend/routes/performanceRoutes.js');

    // Two generations of this router had been merged by keeping both sides,
    // with the seam falling inside a handler -- an unclosed object literal, an
    // unclosed catch, and a `const` where a property was expected (#1355).
    // server.js requires this router, so it took the boot gate down too.
    it('parses', () => {
        expect(() => new (require('vm').Script)(source)).not.toThrow();
    });

    it('loads and exports a router', () => {
        const router = require('../routes/performanceRoutes');

        expect(typeof router).toBe('function');
        expect(typeof router.use).toBe('function');
    });

    // Five routes appeared twice. Duplicates are not merely redundant: the
    // second registration shadows the first for every request, so a fixed
    // handler can be silently overridden by the stale copy sitting below it.
    it.each([
        ['post', '/track'],
        ['get', '/dashboard/:agentId'],
        ['post', '/feedback'],
        ['get', '/stats'],
        ['get', '/comparison']
    ])('declares %s %s exactly once', (method, path) => {
        const pattern = new RegExp(
            `router\\.${method}\\(\\s*'${path.replace(/[/:]/g, '\\$&')}'`,
            'g'
        );

        expect((source.match(pattern) || []).length).toBe(1);
    });

    // The dropped half required '../services/agentPerformanceMonitorService'.
    // No such module exists -- the file on disk is
    // `agentPerfomanceMonitorService.js`, missing the `r` -- so that require
    // threw MODULE_NOT_FOUND and every handler in that half would have called
    // a method on `undefined`.
    it('does not require the module that is not there', () => {
        // Comments are stripped: the header explains *why* that half was
        // dropped and names the module in prose, which would otherwise be a
        // false positive.
        const code = source.replace(/^\s*\/\/.*$/gm, '');

        expect(code).not.toMatch(/agentPerformanceMonitorService/);
        expect(code).not.toMatch(/agentPerformanceMonitor\./);
    });

    it('requires only a module that resolves', () => {
        const requires = [...source.matchAll(/require\('(\.\.[^']+)'\)/g)].map((m) => m[1]);

        expect(requires.length).toBeGreaterThan(0);

        const unresolved = requires.filter((relative) => {
            try {
                require.resolve(path.resolve(BACKEND_DIR, 'routes', relative));
                return false;
            } catch (error) {
                return true;
            }
        });

        expect(unresolved).toEqual([]);
    });

    // Every method the surviving routes call must exist on the service they
    // call it on, or the route is a 500 waiting for its first request.
    it('calls only methods the service implements', () => {
        const service = require('../services/agentPerformanceService');

        for (const method of [
            'trackPerformance',
            'getPerformanceDashboard',
            'getAgentAlerts',
            'resolveAlert',
            'submitFeedback',
            'getModelComparison',
            'getStatistics'
        ]) {
            expect(typeof service[method]).toBe('function');
        }
    });
});
