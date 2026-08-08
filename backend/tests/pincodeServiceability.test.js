// backend/tests/pincodeServiceability.test.js
//
// Delivery serviceability (#1496).
//
// Three things are pinned here and they are all things that were invisible
// from outside:
//
//   * `deleted_at` was read by nothing. A withdrawn pincode still said the
//     store delivered to it, in the product-page checker and in the shipping
//     quote, and there was an index on the column nobody used. Those
//     assertions are on the SQL, because a mocked `db.query` accepts any
//     string and a missing WHERE clause is exactly what has to be caught.
//   * there were two caches under one key scheme and no operation that
//     cleared both. That is a behavioural test: write through the model, read
//     through the controller's path, and check the answer moved.
//   * `clearPincodeCache` waved anonymous callers through its own admin check.

jest.mock('../config/db', () => ({
    query: jest.fn(),
    getConnection: jest.fn()
}));

const db = require('../config/db');
const Pincode = require('../models/Pincode');
const pincodeCache = require('../services/pincodeCache');
const pincodeController = require('../controllers/pincodeController');

const ROW = (overrides = {}) => ({
    pincode: '110001',
    city: 'New Delhi',
    state: 'Delhi',
    country: 'India',
    eta_days: 2,
    is_active: 1,
    delivery_charges: 49,
    cod_available: 1,
    created_at: '2026-01-01 00:00:00',
    updated_at: '2026-01-01 00:00:00',
    ...overrides
});

beforeEach(() => {
    jest.clearAllMocks();
    pincodeCache.flush();
    db.query.mockResolvedValue([[]]);
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    console.log.mockRestore();
    console.error.mockRestore();
});

// ---------------------------------------------------------------------------
// The soft delete nothing read
// ---------------------------------------------------------------------------

describe('deleted_at', () => {
    const READS = [
        ['findByCode', () => Pincode.findByCode('110001')],
        ['findByCodes', () => Pincode.findByCodes(['110001'])],
        ['search', () => Pincode.search('Delhi')],
        ['getCities', () => Pincode.getCities()],
        ['getStates', () => Pincode.getStates()],
        ['getDeliveryEta', () => Pincode.getDeliveryEta('110001')],
        ['isDeliverable', () => Pincode.isDeliverable('110001')],
        ['count', () => Pincode.count()]
    ];

    test.each(READS)('%s excludes withdrawn rows', async (_name, run) => {
        await run();

        const [sql] = db.query.mock.calls[0];

        expect(sql).toMatch(/deleted_at IS NULL/);
    });

    test('every read filtered on is_active alone before this change', () => {
        // The index on deleted_at has existed since the baseline schema and
        // not one query used it, so withdrawal had no effect on any read path.
        const fs = require('fs');
        const path = require('path');

        // Comments are stripped: the header of this file quotes the table name
        // while explaining the bug, and so does the doc comment on `delete`.
        const source = fs
            .readFileSync(path.join(__dirname, '..', 'models', 'Pincode.js'), 'utf8')
            .split('\n')
            .map((line) => (/^\s*(\/\/|\/\*|\*)/.test(line) ? '' : line))
            .join('\n');

        // Every place the model reads the table, with the 400 characters that
        // follow -- enough to reach the WHERE clause of the longest query in
        // the file, which is `search` with its three LIKE branches.
        const reads = [...source.matchAll(/FROM serviceable_pincodes/g)].map(
            (match) => ({
                line: source.slice(0, match.index).split('\n').length,
                tail: source.slice(match.index, match.index + 400)
            })
        );

        expect(reads.length).toBeGreaterThan(5);

        // `${LIVE}` is the shared predicate, written out once at the top of
        // the model so a query added later cannot quietly omit the check --
        // which is how the omission survived across eight separate reads.
        const unguarded = reads
            .filter(
                ({ tail }) =>
                    !/deleted_at IS (?:NOT )?NULL/.test(tail) && !/\$\{LIVE\}/.test(tail)
            )
            .map(({ line, tail }) => `Pincode.js:${line}: ${tail.split('\n')[0]}`);

        expect(unguarded).toEqual([]);
    });
});

describe('delete', () => {
    test('withdraws the row instead of destroying it', async () => {
        db.query.mockResolvedValue([{ affectedRows: 1 }]);

        await Pincode.delete('110001', 'admin-1');

        const [sql, params] = db.query.mock.calls[0];

        // It used to be `DELETE FROM serviceable_pincodes`, against a table
        // with deleted_at, deleted_by and an index on the former.
        expect(sql).not.toMatch(/^\s*DELETE FROM/i);
        expect(sql).toMatch(/SET deleted_at = NOW\(\), deleted_by = \?/);
        expect(params[0]).toBe('admin-1');
    });

    test('is idempotent', async () => {
        db.query.mockResolvedValue([{ affectedRows: 0 }]);

        const result = await Pincode.delete('110001', 'admin-1');

        expect(result).toBe(false);
        expect(db.query.mock.calls[0][0]).toMatch(/deleted_at IS NULL/);
    });

    test('can be undone', async () => {
        db.query.mockResolvedValue([{ affectedRows: 1 }]);

        await Pincode.restore('110001', 'admin-1');

        const [sql] = db.query.mock.calls[0];

        // A soft delete nobody can reverse is, from outside, the hard delete
        // it replaced -- the argument #1457 made for products.
        expect(sql).toMatch(/deleted_at = NULL/);
        expect(sql).toMatch(/deleted_at IS NOT NULL/);
    });
});

// ---------------------------------------------------------------------------
// One cache
// ---------------------------------------------------------------------------

describe('the cache', () => {
    function fakeRes() {
        return {
            statusCode: null,
            body: null,
            status(code) {
                this.statusCode = code;
                return this;
            },
            json(payload) {
                this.body = payload;
                return this;
            }
        };
    }

    test('a write through the model changes what the checker answers', async () => {
        // This is the defect. The model cleared its own cache and the
        // controller kept serving a different copy under an equivalent key for
        // up to 24 hours, so correcting a pincode changed what the shipping
        // quote said and not what the product page said.
        db.query.mockResolvedValue([[ROW({ eta_days: 2 })]]);

        const first = fakeRes();
        await pincodeController.checkPincode({ params: { pincode: '110001' } }, first);
        expect(first.body.eta_days).toBe(2);

        db.query.mockResolvedValue([{ affectedRows: 1 }]);
        await Pincode.update('110001', { eta_days: 9 }, 'admin-1');

        db.query.mockResolvedValue([[ROW({ eta_days: 9 })]]);
        const second = fakeRes();
        await pincodeController.checkPincode({ params: { pincode: '110001' } }, second);

        expect(second.body.eta_days).toBe(9);
        expect(second.body.cached).toBe(false);
    });

    test('withdrawing a pincode stops the checker offering it', async () => {
        db.query.mockResolvedValue([[ROW()]]);

        const before = fakeRes();
        await pincodeController.checkPincode({ params: { pincode: '110001' } }, before);
        expect(before.body.deliverable).toBe(true);

        db.query.mockResolvedValue([{ affectedRows: 1 }]);
        await Pincode.delete('110001', 'admin-1');

        db.query.mockResolvedValue([[]]);
        const after = fakeRes();
        await pincodeController.checkPincode({ params: { pincode: '110001' } }, after);

        expect(after.body.deliverable).toBe(false);
    });

    test('invalidation reaches every namespace for that pincode', () => {
        pincodeCache.set(pincodeCache.NAMESPACE_ROWS, '110001', [ROW()]);
        pincodeCache.set(pincodeCache.NAMESPACE_VERDICT, '110001', { deliverable: true });
        pincodeCache.set(pincodeCache.NAMESPACE_VERDICT, '400001', { deliverable: true });

        pincodeCache.invalidate('110001');

        expect(pincodeCache.get(pincodeCache.NAMESPACE_ROWS, '110001')).toBeUndefined();
        expect(pincodeCache.get(pincodeCache.NAMESPACE_VERDICT, '110001')).toBeUndefined();
        // And leaves other pincodes alone.
        expect(pincodeCache.get(pincodeCache.NAMESPACE_VERDICT, '400001')).toBeDefined();
    });

    test('the raw row and the verdict do not collide', () => {
        // Two caches under one `pincode_<code>` key was the original arrangement
        // and the shapes were different, so whichever wrote last decided what
        // the other one read.
        pincodeCache.set(pincodeCache.NAMESPACE_ROWS, '110001', [ROW()]);
        pincodeCache.set(pincodeCache.NAMESPACE_VERDICT, '110001', { deliverable: false });

        expect(pincodeCache.get(pincodeCache.NAMESPACE_ROWS, '110001')).toHaveLength(1);
        expect(pincodeCache.get(pincodeCache.NAMESPACE_VERDICT, '110001').deliverable).toBe(false);
    });

    test('there is only one NodeCache left', () => {
        const fs = require('fs');
        const path = require('path');

        const files = ['models/Pincode.js', 'controllers/pincodeController.js'];

        for (const relative of files) {
            const source = fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');

            expect(source).not.toMatch(/new NodeCache\(/);
        }
    });
});

// ---------------------------------------------------------------------------
// The answer
// ---------------------------------------------------------------------------

describe('toVerdict', () => {
    test('returns the delivery charge and COD availability', async () => {
        // Both are on the row and neither was returned. For someone about to
        // pay cash on delivery, whether cash on delivery is available is the
        // question they came to ask.
        const verdict = pincodeController.toVerdict(ROW());

        expect(verdict.delivery_charges).toBe(49);
        expect(verdict.cod_available).toBe(true);
        expect(verdict.message).toMatch(/Cash on delivery is available/);
    });

    test('says nothing about COD when it is not available', () => {
        const verdict = pincodeController.toVerdict(ROW({ cod_available: 0 }));

        expect(verdict.cod_available).toBe(false);
        expect(verdict.message).not.toMatch(/Cash on delivery/);
    });

    test('answers not-deliverable for a pincode with no row', () => {
        const verdict = pincodeController.toVerdict(undefined);

        expect(verdict.deliverable).toBe(false);
        expect(verdict.eta_days).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// The configurable regex
// ---------------------------------------------------------------------------

describe('PINCODE_REGEX', () => {
    const original = process.env.PINCODE_REGEX;

    afterEach(() => {
        jest.resetModules();
        if (original === undefined) {
            delete process.env.PINCODE_REGEX;
        } else {
            process.env.PINCODE_REGEX = original;
        }
    });

    test('a configured pattern is compiled, not used as a string', () => {
        // `process.env` values are strings, and a string has no `.test`.
        // Setting the variable that exists to configure this used to turn
        // every request into "PINCODE_REGEX.test is not a function".
        jest.resetModules();
        process.env.PINCODE_REGEX = '^\\d{5}$';

        const reloaded = require('../controllers/pincodeController');

        expect(reloaded.PINCODE_REGEX).toBeInstanceOf(RegExp);
        expect(reloaded.validatePincode('12345').valid).toBe(true);
        expect(reloaded.validatePincode('123456').valid).toBe(false);
    });

    test('an unparseable pattern falls back rather than taking the endpoint down', () => {
        jest.resetModules();
        process.env.PINCODE_REGEX = '^[0-9'; // unterminated character class

        const reloaded = require('../controllers/pincodeController');

        expect(reloaded.PINCODE_REGEX).toBeInstanceOf(RegExp);
        expect(reloaded.validatePincode('110001').valid).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

describe('search', () => {
    test('escapes LIKE metacharacters in the term', async () => {
        await Pincode.search('100%');

        const [, params] = db.query.mock.calls[0];

        expect(params[0]).toBe('%100\\%%');
    });

    test('refuses a term that is too short', async () => {
        await expect(Pincode.search('a')).rejects.toThrow(/at least 2 characters/);
        expect(db.query).not.toHaveBeenCalled();
    });
});
