// backend/tests/configPersistence.test.js
//
// Configuration changes reach the database (#1583).
//
// `POST /api/config` returned 500 on every call. `persistConfig` listed five
// columns, gave `updated_at` a `NOW()` and the other four a `?`, and bound
// three values:
//
//     INSERT INTO app_config
//       (config_key, config_value, version, updated_by, updated_at)
//     VALUES (?, ?, ?, ?, NOW())
//     ...
//     [key, JSON.stringify(value), user || 'system']
//
// mysql2 rejects that with "Incorrect arguments to mysqld_stmt_execute" before
// the statement leaves the process. The `version` placeholder was the mistake:
// `app_config.version` is `INT DEFAULT 1` and the ON DUPLICATE branch already
// increments it, so the insert branch wants the default and nothing in the
// codebase computes a version to pass.
//
// The 500 was not the worst of it. `set()` mutates `this.config` before it
// calls `persistConfig`, so the process went on serving a value it had failed
// to store -- the change looked like it worked until the next restart, at which
// point it silently reverted, and `config_history` recorded changes that never
// landed in `app_config`.
//
// Nothing caught this: the file parses, the module imports, and every suite
// mocks config/db, so the statement had never been executed by anything. The
// last describe here is the general form -- it counts both sides of every
// statically countable statement in the backend.

// configService reads `require('../config/db').promise`, so the mock has to
// carry the same handle the module actually calls -- one jest.fn behind both.
jest.mock('../config/db', () => {
    const query = jest.fn();
    return { query, promise: { query }, getConnection: jest.fn() };
});

const db = require('../config/db');
const { ConfigService } = require('../services/configService');

const { mismatchedStatements, countArguments, countPlaceholders, countableCalls } =
    require('./helpers/sqlPlaceholders');

/** The statement issued, whitespace collapsed. */
const statement = (index = 0) =>
    String(db.query.mock.calls[index][0]).replace(/\s+/g, ' ').trim();

const paramsOf = (index = 0) => db.query.mock.calls[index][1];

// A fresh instance per test. The module exports a singleton, and `set()`
// refuses a key that already exists unless `override` is passed -- so a shared
// instance would make each case depend on the ones before it.
let configService;

beforeEach(() => {
    db.query.mockClear();
    db.query.mockResolvedValue([{ affectedRows: 1 }]);
    configService = new ConfigService();
});

// ---------------------------------------------------------------------------
// The statement
// ---------------------------------------------------------------------------

describe('persisting a configuration value', () => {
    test('binds a value for every placeholder', async () => {
        // The whole bug in one assertion.
        await configService.persistConfig('features.newCheckout', true, 'admin-1');

        expect(countPlaceholders(statement())).toBe(paramsOf().length);
    });

    test('binds three values into three placeholders', async () => {
        await configService.persistConfig('features.newCheckout', true, 'admin-1');

        expect(countPlaceholders(statement())).toBe(3);
        expect(paramsOf()).toHaveLength(3);
    });

    test('does not list version among the inserted columns', async () => {
        await configService.persistConfig('a.b', 1, 'admin-1');

        expect(statement()).not.toMatch(/config_value, version/);
        expect(statement()).toMatch(/\(config_key, config_value, updated_by, updated_at\)/);
    });

    test('still increments version on the duplicate-key branch', async () => {
        // Dropping it from the insert must not drop it from the update: the
        // column exists so a change can be counted.
        await configService.persistConfig('a.b', 1, 'admin-1');

        expect(statement()).toMatch(/ON DUPLICATE KEY UPDATE[\s\S]*version = version \+ 1/);
    });

    test('binds the key, the serialised value and the user, in that order', async () => {
        await configService.persistConfig('features.newCheckout', { on: true }, 'admin-1');

        expect(paramsOf()).toEqual([
            'features.newCheckout',
            JSON.stringify({ on: true }),
            'admin-1',
        ]);
    });

    test('attributes an unattributed change to system rather than binding null', async () => {
        await configService.persistConfig('a.b', 1, null);

        expect(paramsOf()[2]).toBe('system');
    });

    test('serialises the value rather than binding an object', async () => {
        // config_value is JSON NOT NULL; an object would be bound as
        // "[object Object]".
        await configService.persistConfig('a.b', { nested: { x: 1 } }, 'admin-1');

        expect(paramsOf()[1]).toBe('{"nested":{"x":1}}');
        expect(JSON.parse(paramsOf()[1])).toEqual({ nested: { x: 1 } });
    });

    test('a false value is persisted, not skipped', async () => {
        // Turning a flag off is a change like any other, and `false` is easy to
        // lose to a truthiness guard.
        await configService.persistConfig('features.newCheckout', false, 'admin-1');

        expect(paramsOf()[1]).toBe('false');
    });

    test('a database failure propagates rather than being swallowed', async () => {
        db.query.mockRejectedValueOnce(new Error('ER_NO_SUCH_TABLE'));

        await expect(configService.persistConfig('a.b', 1, 'admin-1'))
            .rejects.toThrow('ER_NO_SUCH_TABLE');
    });
});

// ---------------------------------------------------------------------------
// The path that reaches it
// ---------------------------------------------------------------------------

describe('set()', () => {
    test('persists by default', async () => {
        await configService.set('test.persistDefault', 1, { override: true, user: 'admin-1' });

        const inserts = db.query.mock.calls.filter(([sql]) => /INSERT INTO app_config/.test(sql));
        expect(inserts).toHaveLength(1);
    });

    test('does not write when persistence is turned off', async () => {
        await configService.set('test.noPersist', 1, {
            override: true,
            user: 'admin-1',
            persist: false,
        });

        const inserts = db.query.mock.calls.filter(([sql]) => /INSERT INTO app_config/.test(sql));
        expect(inserts).toHaveLength(0);
    });

    test('the value it stored is the value it serves', async () => {
        await configService.set('test.roundTrip', { mode: 'fast' }, {
            override: true,
            user: 'admin-1',
        });

        expect(configService.get('test.roundTrip')).toEqual({ mode: 'fast' });
        expect(paramsOf(db.query.mock.calls.length - 1)[1]).toBe('{"mode":"fast"}');
    });
});

// ---------------------------------------------------------------------------
// The general rule
// ---------------------------------------------------------------------------

describe('every statement in the backend', () => {
    test('binds as many values as it has placeholders', () => {
        // Scoped to statements where both sides can be counted with certainty:
        // no `${...}` in the SQL, no spread in the argument list. Anything else
        // is skipped rather than guessed at.
        expect(mismatchedStatements()).toEqual([]);
    });

    test('there are enough of them for that to mean something', () => {
        // A guard on the guard. If the extraction ever stops matching, the case
        // above passes over an empty set and the next mismatch ships.
        const fs = require('fs');
        const { backendSources } = require('./helpers/sqlPlaceholders');

        const counted = backendSources().reduce(
            (total, file) => total + countableCalls(fs.readFileSync(file, 'utf8'), file).length,
            0
        );

        expect(counted).toBeGreaterThan(400);
    });
});

// ---------------------------------------------------------------------------
// The counter itself
// ---------------------------------------------------------------------------

describe('counting arguments', () => {
    test('counts a flat list', () => {
        expect(countArguments('a, b, c')).toBe(3);
    });

    test('ignores commas inside a nested call', () => {
        expect(countArguments('a, JSON.stringify(x, null, 2), b')).toBe(3);
    });

    test('ignores commas inside a string', () => {
        expect(countArguments(`a, 'one, two', b`)).toBe(3);
    });

    test('ignores commas inside a line comment', () => {
        // This is what made an earlier draft report a false mismatch in
        // contactService: a comment reading "TEXT column, but a header is
        // attacker-controlled" sat between two arguments.
        expect(countArguments('a,\n// a note, with a comma\nb')).toBe(2);
    });

    test('ignores a trailing comma', () => {
        expect(countArguments('a, b,')).toBe(2);
    });

    test('counts an empty list as zero', () => {
        expect(countArguments('  ')).toBe(0);
    });

    test('refuses to count a spread', () => {
        expect(countArguments('a, ...rest')).toBeNull();
    });

    test('survives an index expression, which a lazy regex does not', () => {
        // `.find((s) => s[0] === 'x')[1]` closes a bracket in the middle of an
        // argument. Matching the array with /\[([\s\S]*?)\]/ truncates there.
        const list = `a, JSON.stringify(states.find((s) => s[0] === 'x')[1]), b`;

        expect(countArguments(list)).toBe(3);
    });
});

describe('counting placeholders', () => {
    test('counts each ?', () => {
        expect(countPlaceholders('VALUES (?, ?, ?)')).toBe(3);
    });

    test('does not count a NOW() column', () => {
        expect(countPlaceholders('VALUES (?, ?, NOW())')).toBe(2);
    });

    test('reports the original defect', () => {
        const broken = `INSERT INTO app_config
             (config_key, config_value, version, updated_by, updated_at)
             VALUES (?, ?, ?, ?, NOW())`;

        expect(countPlaceholders(broken)).toBe(4);
        expect(countArguments(`key, JSON.stringify(value), user || 'system'`)).toBe(3);
    });
});
