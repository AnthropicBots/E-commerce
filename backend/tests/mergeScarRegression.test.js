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
// Frontend scripts are classic <script> files, not modules, so the only way to
// exercise one from Jest is to compile it into a sandbox with the globals the
// page would have supplied.
const vm = require('vm');

const BACKEND_DIR = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(BACKEND_DIR, '..');

function read(relativePath) {
    return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8').replace(/\r\n/g, '\n');
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
    // `{ data, timestamp }`. Every reader expects the second, and since #1610
    // it also carries `complete` -- whether the list is the user's whole
    // history or merely part of it.
    it('writes and reads one cache shape', () => {
        service.writeCache('user-1', [{ id: 'p1' }], { complete: true });

        const raw = service.cache.get(service.getCacheKey('user-1'));
        expect(Array.isArray(raw)).toBe(false);
        expect(raw).toHaveProperty('data');
        expect(raw).toHaveProperty('timestamp');
        expect(raw).toHaveProperty('complete', true);

        // The rows are normalised on the way in, so the round trip is by id
        // rather than by identity -- one row shape whichever path wrote it.
        expect(service.readCache('user-1').map((row) => row.id)).toEqual(['p1']);
    });

    it('defaults a cache entry to incomplete', () => {
        // "Non-empty" is not "complete". Treating the two as the same is what
        // let one product view hide the rest of the list for five minutes.
        service.writeCache('user-3', [{ id: 'p1' }]);

        expect(service.readCacheEntry('user-3').complete).toBe(false);
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

    // #1444. The same function was broken a second time: an `<img …>` fragment
    // was left at statement position -- outside any template literal -- and the
    // stock bindings the return template reads went missing with it. The
    // fragment is a SyntaxError; the missing bindings would have been a
    // ReferenceError on the first card had it ever run.
    it('has no HTML fragment outside a template literal', () => {
        // The card renders one image, and it belongs inside the return
        // template. A second `<img` in this function is the orphan again.
        expect(countMatches(source, /<img\b/g)).toBe(1);

        const cardTemplate = source.indexOf('return `\n        <div class="pro ');
        expect(cardTemplate).toBeGreaterThan(-1);
        expect(source.indexOf('<img')).toBeGreaterThan(cardTemplate);
    });

    it('declares the stock bindings its card template reads', () => {
        expect(source).toMatch(/^\s+const stock = Number\(product\.stock\) \|\| 0;$/m);
        expect(source).toMatch(/^\s+const outOfStock = isOutOfStock\(stock\);$/m);
        expect(source).toMatch(/^\s+const outOfStockClass = outOfStock \? "out-of-stock" : "";$/m);
    });

    // The class shop.js puts on its own cards, and the one
    // styles/product-card.css dims. A card marked with anything else looks
    // in-stock however empty the shelf is.
    it('marks sold-out cards with the class the stylesheet targets', () => {
        const css = read('frontend/styles/product-card.css');
        expect(css).toMatch(/\.pro\.out-of-stock\b/);
    });

    // Evaluating the file proves what a regex cannot: that every binding the
    // template reads actually resolves. The module is a classic <script>, so it
    // is run in a sandbox with the globals index.html would have provided.
    it('renders a card without reaching for an undeclared binding', () => {
        const sandbox = {
            document: { getElementById: () => null },
            window: {},
            console,
            formatPrice: (value) => `₹${value}`,
            defaultImage: (value) => value || '',
            escapeHTML: (value) => String(value == null ? '' : value),
            handleImageError: () => {},
            AppUtils: undefined
        };
        sandbox.globalThis = sandbox;

        vm.createContext(sandbox);
        new vm.Script(source, { filename: 'product-cards-home.js' }).runInContext(sandbox);

        const inStock = sandbox.createProductCard(
            { id: 'p1', name: 'Tee', price: 19.99, stock: 12, image: '/t.jpg' },
            new Set()
        );
        expect(inStock).toContain('data-id="p1"');
        expect(inStock).toContain('In Stock');
        expect(inStock).not.toContain('class="pro out-of-stock');

        const soldOut = sandbox.createProductCard(
            { id: 'p2', name: 'Cap', price: 9.99, stock: 0, image: '/c.jpg' },
            new Set()
        );
        expect(soldOut).toContain('pro out-of-stock');
        expect(soldOut).toContain('Sold Out');
        expect(soldOut).toContain('disabled');
    });
});

describe('frontend/scripts/shop.js', () => {
    const source = read('frontend/scripts/shop.js');

    // Two merges have now damaged this file.
    //
    // #1444 left the DOMContentLoaded listener unclosed, so the body of
    // `clearAllFilters` ran straight on from it and the file did not parse.
    // The cases here pinned that repair by asserting `clearAllFilters` was
    // declared once and that `setupClearFilters` bound the two together.
    //
    // #1582 then found the other merge, 341fb57, which took one side of the
    // file whole and dropped fourteen declarations from the other while every
    // call site survived -- so the page parsed, threw on `setupProductObserver`
    // before it reached the network, never called /api/products, and rendered
    // an empty grid on every visit.
    //
    // Repairing that removed `clearAllFilters` and `setupClearFilters`
    // outright. They were a second, broken copy of a button
    // `setupFilterControls` already wires correctly: they read `.filter-btn`
    // elements this page does not have, wrote `sortSelect.value = 'default'`
    // which is not one of the select's options, and were bound to
    // `getElementById('clear-filters-btn')` -- that is the button's *class*;
    // its id is `clear-filters` -- so none of it ever ran.
    //
    // The cases below pin the decision that replaced them. The scar they guard
    // against is the same one either way: a merge that keeps one side of this
    // file and silently drops the other.

    it('parses', () => {
        expect(() => new vm.Script(source, { filename: 'shop.js' })).not.toThrow();
    });

    it('has exactly one DOMContentLoaded initialiser', () => {
        // There were two, registered a few lines apart, each bootstrapping the
        // page and each calling fetchProducts().
        expect(
            countMatches(source, /addEventListener\(\s*\n?\s*["']DOMContentLoaded["']/g)
        ).toBe(1);
    });

    it('closes that listener rather than running on into what follows', () => {
        // The #1444 scar itself: `}` then `);` closes the arrow function and the
        // call it is an argument to. Dropping the `);` merged the listener into
        // the next declaration.
        //
        // Matched by shape rather than by a literal with the indentation baked
        // in. #1644 wrapped this file in an IIFE, which moved every line one
        // level right and broke an assertion that was pinning the whitespace
        // instead of the structure (#1655).
        const listener = source.search(
            /document\.addEventListener\(\s*["']DOMContentLoaded["']/
        );
        expect(listener).toBeGreaterThan(-1);

        expect(source.slice(listener)).toMatch(/\n\s*\}\n\s*\);/);
    });

    it('declares no function twice', () => {
        // `setupSearch` was declared twice, ~250 lines apart. Declarations
        // hoist, so the second silently replaced the first and the first became
        // unreachable -- no error, no warning.
        //
        // The leading `\s*` is load-bearing. Anchored at `^function` this
        // matched nothing once #1644 indented the file inside an IIFE, so the
        // check passed by finding no declarations at all rather than by finding
        // no duplicates (#1655).
        const counts = new Map();

        for (const match of source.matchAll(/^\s*function\s+([A-Za-z_$][\w$]*)/gm)) {
            counts.set(match[1], (counts.get(match[1]) || 0) + 1);
        }

        expect(counts.size).toBeGreaterThan(10);

        expect([...counts.entries()].filter(([, n]) => n > 1).map(([name]) => name)).toEqual([]);
    });

    it('declares the functions its own code calls', () => {
        // The 341fb57 scar. Every one of these was called and not declared.
        for (const name of [
            'initializeFilterControls',
            'refreshFilterControls',
            'readFiltersFromControls',
            'applyFilters',
            'updatePriceControls',
            'renderCategoryFilters',
            'applyUrlCategoryFilters',
            'getUrlCategoryFilters',
            'showSearchSuggestions',
            'renderScrollStatus',
            'observeSentinel',
            'setupProductObserver',
            'getReviewCount',
            'getRatingLabel'
        ]) {
            // `\\s*` rather than an anchor: what matters is that the
            // declaration is in the file, not what column it starts in.
            expect(source).toMatch(new RegExp(`^\\s*function ${name}\\(`, 'm'));
        }
    });

    it('resolves the clear-filters button and sort select by the ids the page uses', () => {
        const html = read('frontend/shop.html');

        expect(html).toMatch(/id="clear-filters"/);
        expect(html).toMatch(/id="product-sort"/);

        // Whitespace-tolerant on both sides of the argument: this file now
        // wraps the call across three lines, which a single-line pattern misses
        // even though the id it asks for is exactly right (#1655).
        const resolvesById = (id) =>
            new RegExp(`getElementById\\(\\s*["']${id}["']\\s*\\)`);

        expect(source).not.toMatch(resolvesById('clear-filters-btn'));
        expect(source).not.toMatch(resolvesById('sort-select'));
        expect(source).toMatch(resolvesById('clear-filters'));
        expect(source).toMatch(resolvesById('product-sort'));
    });

    it('has one owner for the clear-filters click', () => {
        // `setupFilterControls` binds `elements.clearFilters`. The duplicate
        // that bound `clearFiltersBtn` is gone, and so is the legacy
        // `.filter-btn` state it reset.
        expect(source).toMatch(/elements\.clearFilters\?\.addEventListener\(/);
        expect(source).not.toMatch(/^function clearAllFilters\(\)/m);
        expect(source).not.toMatch(/^function setupClearFilters\(\)/m);

        for (const name of ['currentCategory', 'currentSearch', 'showAllHoodies']) {
            expect(source).not.toMatch(new RegExp(`^let ${name} = `, 'm'));
        }
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
