// backend/tests/frontendApiPaths.test.js
//
// Every path the frontend asks for must be a path the API serves (#1445).
//
// Five requests reached production asking for endpoints that were never
// mounted, and every one of them failed quietly:
//
//   /promo/validate                  the router is mounted at /promos, so no
//                                    coupon anyone typed could ever apply
//   /contact                         nothing served it; the form said
//                                    "Message submitted successfully!" anyway
//   /interactions                    nothing served it; failure swallowed by
//                                    design in product.js
//   /api/recommendations…            CONFIG.API_BASE already ends in /api, so
//   /api/wishlist                    these resolved to /api/api/…
//
// None of them threw. `apiRequest` resolves with `{ success: false }` on a
// non-2xx rather than rejecting, so a 404 looks exactly like a server that
// declined -- which is why a one-letter difference between "promo" and
// "promos" survived review and production.
//
// This test reads the paths out of the frontend and checks each prefix against
// what the backend actually mounts. It is static on purpose: no server, no
// database, no network, so it is deterministic and runs in milliseconds.

const fs = require('fs');
const path = require('path');

const BACKEND_DIR = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(BACKEND_DIR, '..');
const FRONTEND_SCRIPTS = path.join(REPO_ROOT, 'frontend', 'scripts');

/**
 * Every top-level segment the API mounts under /api.
 *
 * Read from the source rather than listed here, so a router mounted tomorrow
 * counts without anyone updating this file.
 *
 * @returns {Set<string>}
 */
function collectMountedPrefixes() {
    const prefixes = new Set();

    const indexSource = fs.readFileSync(
        path.join(BACKEND_DIR, 'routes', 'index.js'),
        'utf8'
    );

    for (const match of indexSource.matchAll(/(?:router\.use\(\s*["'`]\/|["'`]\/api\/)([^/"'`]+)/g)) {
        prefixes.add(match[1]);
    }

    const serverSource = fs.readFileSync(
        path.join(BACKEND_DIR, 'server.js'),
        'utf8'
    );

    for (const match of serverSource.matchAll(/app\.use\(\s*["'`]\/api\/([^/"'`]+)/g)) {
        prefixes.add(match[1]);
    }

    return prefixes;
}

/**
 * Every literal path the frontend passes to apiRequest.
 *
 * Only string and template literals that start with "/" are collected --
 * a path assembled from a variable cannot be checked statically, and pretending
 * otherwise would make this test lie about its coverage.
 *
 * @returns {Array<{file: string, requestPath: string}>}
 */
function collectRequestedPaths() {
    const found = [];

    for (const name of fs.readdirSync(FRONTEND_SCRIPTS)) {
        if (!name.endsWith('.js')) continue;

        const source = fs.readFileSync(path.join(FRONTEND_SCRIPTS, name), 'utf8');

        for (const match of source.matchAll(/apiRequest\(\s*(["'`])(\/[^"'`]*)\1/g)) {
            found.push({ file: `frontend/scripts/${name}`, requestPath: match[2] });
        }
    }

    return found;
}

const MOUNTED = collectMountedPrefixes();
const REQUESTED = collectRequestedPaths();

describe('frontend API paths', () => {
    test('the collectors found something to check', () => {
        // Both regexes are load-bearing: if either silently stopped matching,
        // every assertion below would pass over an empty list.
        expect(MOUNTED.size).toBeGreaterThan(10);
        expect(REQUESTED.length).toBeGreaterThan(10);
    });

    test('routes/index.js mounts the promo router under the plural name', () => {
        // The specific thing the coupon path got wrong. Pinned so a rename on
        // one side alone fails here rather than at a shopper's checkout.
        expect(MOUNTED.has('promos')).toBe(true);
    });

    test.each(['contact', 'interactions'])('/%s is mounted', (prefix) => {
        expect(MOUNTED.has(prefix)).toBe(true);
    });

    test('no caller prefixes its path with /api', () => {
        // CONFIG.API_BASE already ends in /api. A leading /api here means the
        // request goes to /api/api/… and 404s.
        const doubled = REQUESTED.filter((entry) =>
            /^\/api(\/|$)/.test(entry.requestPath)
        );

        expect(doubled).toEqual([]);
    });

    test('every requested path resolves to a mounted router', () => {
        const unmounted = REQUESTED.filter((entry) => {
            const prefix = entry.requestPath.split('?')[0].split('/')[1];

            // Interpolated first segment -- `/${something}/…`. Not checkable.
            if (!prefix || prefix.includes('${')) return false;

            return !MOUNTED.has(prefix);
        }).map((entry) => `${entry.file}: ${entry.requestPath}`);

        expect(unmounted).toEqual([]);
    });
});

describe('interactionService type list', () => {
    const interactionService = require('../services/interactionService');

    // The enum and this list have to agree or the insert fails at the column.
    // Migration 0042 added 'share' because product.js has been sending it.
    test('matches the interaction_type enum in the migrations', () => {
        const migration = fs.readFileSync(
            path.join(
                REPO_ROOT,
                'migrations',
                '0042_contact_messages_and_share_interactions.sql'
            ),
            'utf8'
        );

        const enumMatch = /interaction_type\s+ENUM\(([^)]+)\)/.exec(migration);
        expect(enumMatch).not.toBeNull();

        const declared = enumMatch[1]
            .split(',')
            .map((value) => value.trim().replace(/^'|'$/g, ''));

        expect(interactionService.INTERACTION_TYPES).toEqual(declared);
    });

    test('accepts share and rejects anything not in the enum', () => {
        expect(interactionService.isSupportedType('share')).toBe(true);
        expect(interactionService.isSupportedType('view')).toBe(true);
        expect(interactionService.isSupportedType('like')).toBe(false);
        expect(interactionService.isSupportedType(undefined)).toBe(false);
    });
});

describe('contactService validation', () => {
    const contactService = require('../services/contactService');

    const VALID = {
        name: 'Asha Menon',
        email: 'asha@example.com',
        subject: 'Order never arrived',
        message: 'My order was marked delivered but nothing turned up.'
    };

    test('accepts a complete submission and normalises the email', () => {
        const result = contactService.validateSubmission({
            ...VALID,
            email: '  Asha@Example.COM  '
        });

        expect(result.valid).toBe(true);
        expect(result.value.email).toBe('asha@example.com');
    });

    test.each([
        ['a missing name', { name: '' }],
        ['a missing subject', { subject: '   ' }],
        ['a missing message', { message: '' }],
        ['an address that is not an email', { email: 'asha@' }],
        ['a message under the floor', { message: 'too short' }]
    ])('rejects %s', (_label, override) => {
        const result = contactService.validateSubmission({ ...VALID, ...override });

        expect(result.valid).toBe(false);
        expect(typeof result.message).toBe('string');
    });

    test('rejects a message past the ceiling', () => {
        const result = contactService.validateSubmission({
            ...VALID,
            message: 'x'.repeat(contactService.MAX_MESSAGE_LENGTH + 1)
        });

        expect(result.valid).toBe(false);
    });

    // A modern TLD. The contact form's own regex was /\.[a-z]{2,3}$/, which
    // turned these away before the request was even attempted.
    test.each([
        'someone@example.store',
        'someone@example.online',
        'someone@example.co.uk'
    ])('accepts %s', (email) => {
        expect(contactService.validateSubmission({ ...VALID, email }).valid).toBe(true);
    });
});
