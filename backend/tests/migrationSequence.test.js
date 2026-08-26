// backend/tests/migrationSequence.test.js
//
// The migrations directory is loadable, and every statement in it is MySQL
// (#1700).
//
// Three migrations landed on `main` all claiming version 0049. The runner
// throws while building the file list -- before it compares anything against
// `schema_migrations` -- so the failure is total: `npm run migrate` and even
// `npm run migrate:status` refuse the whole directory, not just the three
// files. `coupons`, `fraud_monitoring_queue` and the products full-text index
// were unreachable, and so was anything added after them.
//
// Nothing in CI runs the migration runner, so `main` stayed green while the
// schema pipeline was fully blocked. migrations/README.md names this exact
// hazard -- "a collision takes the whole sequence down and not just the two
// files involved" -- and the three still merged, because each looked fine in
// isolation and in review. A rule a human has to remember at merge time is a
// rule that gets forgotten; this is the same rule, checked.
//
// The dialect half is the second thing that file taught us. MySQL and MariaDB
// diverge on `ALTER TABLE ... IF NOT EXISTS`, and the version that only MariaDB
// accepts fails at deploy time on a fresh database rather than in review.

'use strict';

const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.join(__dirname, '..', '..', 'migrations');

// The pattern backend/scripts/migrate.js matches filenames against. Anything
// that does not match is ignored and reported rather than applied.
const MIGRATION_FILENAME = /^(\d{4,})_([A-Za-z0-9][A-Za-z0-9._-]*)\.sql$/;

const sqlFiles = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.toLowerCase().endsWith('.sql'))
    .sort();

const read = (name) => fs.readFileSync(path.join(MIGRATIONS_DIR, name), 'utf8');

/** Strip `--` and `/* *​/` comments, so prose is not read as SQL. */
const stripComments = (sql) =>
    sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');

describe('the runner can load the directory', () => {
    test('there are migrations to check', () => {
        expect(sqlFiles.length).toBeGreaterThan(0);
    });

    test('every .sql file matches the runner filename pattern', () => {
        const unmatched = sqlFiles.filter((name) => !MIGRATION_FILENAME.test(name));

        expect(unmatched).toEqual([]);
    });

    test('no two migrations claim the same version', () => {
        // This is the assertion the three 0049s would have failed. The runner
        // throws a MigrationError here and applies nothing at all.
        const byVersion = new Map();
        const collisions = [];

        for (const name of sqlFiles) {
            const [, version] = MIGRATION_FILENAME.exec(name) || [];
            if (!version) continue;

            if (byVersion.has(version)) {
                collisions.push(`${version}: ${byVersion.get(version)} and ${name}`);
            }
            byVersion.set(version, name);
        }

        expect(collisions).toEqual([]);
    });

    test('the baseline is still the lowest version', () => {
        // 0001_baseline_schema.sql declares stored procedures and is not safe
        // to re-run; the runner has a --baseline path for adopting it. A file
        // numbered below it would be applied before it, against no schema.
        const [, first] = MIGRATION_FILENAME.exec(sqlFiles[0]) || [];

        expect(first).toBe('0001');
        expect(sqlFiles[0]).toMatch(/baseline/i);
    });
});

describe('every statement is MySQL', () => {
    // MariaDB accepts `ALTER TABLE ... ADD/DROP COLUMN IF [NOT] EXISTS`. MySQL
    // 8.0 does not, and answers ERROR 1064. This project runs MySQL: mysql2,
    // utf8mb4_unicode_ci, ENGINE=InnoDB throughout.
    //
    // The failure mode is worse than a plain syntax error. The statement sits
    // at the end of a migration that has already created a table, so the
    // migration aborts partway through with the table present and the version
    // unrecorded -- and the next run then hits the "never edit an applied
    // migration" checksum rule on the way past.
    const MARIADB_ONLY = [
        [/ALTER\s+TABLE[\s\S]{0,200}?ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS/i, 'ADD COLUMN IF NOT EXISTS'],
        [/ALTER\s+TABLE[\s\S]{0,200}?DROP\s+COLUMN\s+IF\s+EXISTS/i, 'DROP COLUMN IF EXISTS'],
        [/ALTER\s+TABLE[\s\S]{0,200}?ADD\s+INDEX\s+IF\s+NOT\s+EXISTS/i, 'ADD INDEX IF NOT EXISTS'],
        [/CREATE\s+OR\s+REPLACE\s+TABLE/i, 'CREATE OR REPLACE TABLE'],
    ];

    test.each(sqlFiles)('%s uses no MariaDB-only syntax', (name) => {
        const sql = stripComments(read(name));

        const found = MARIADB_ONLY
            .filter(([pattern]) => pattern.test(sql))
            .map(([, label]) => label);

        expect(found).toEqual([]);
    });

    test('the coupons migration amends the baseline rather than re-creating it', () => {
        // `coupons` is owned by 0001_baseline_schema.sql. A second CREATE TABLE
        // IF NOT EXISTS here is skipped silently, so the migration records
        // itself as applied having changed nothing -- which is how the coupon
        // columns came to be missing from every database.
        const sql = stripComments(read('0049_coupons_schema.sql'));

        expect(sql).not.toMatch(/CREATE TABLE(?:\s+IF NOT EXISTS)?\s+`?coupons`?/i);
        expect(sql).toMatch(/ALTER TABLE\s+`?coupons`?/i);
    });

    test('it adds the columns couponService reads', () => {
        const sql = stripComments(read('0049_coupons_schema.sql'));

        // validateCoupon reads expires_at first, falling back to end_date. The
        // baseline's end_date is NOT NULL, so without this a coupon with no
        // expiry cannot be expressed.
        expect(sql).toMatch(/ADD COLUMN\s+expires_at\s+DATETIME\s+NULL/i);

        // 'percent' is accepted as a synonym for 'percentage' by both
        // validateCoupon and pricing.service.js, and submitted by the admin
        // form, so the enum has to hold it.
        expect(sql).toMatch(/MODIFY COLUMN\s+type\s+ENUM\([^)]*'percent'[^)]*\)/i);
    });

    test('it keeps every enum member the baseline declared', () => {
        // Dropping a member rewrites every row using it to ''.
        const sql = stripComments(read('0049_coupons_schema.sql'));
        const modified = sql.match(/MODIFY COLUMN\s+type\s+ENUM\(([^)]*)\)/i);

        expect(modified).not.toBeNull();

        for (const member of ['percentage', 'fixed', 'free_shipping']) {
            expect(modified[1]).toContain(`'${member}'`);
        }
    });
});

describe('the renumbered migrations are intact', () => {
    // Renumbering is safe here precisely because the collision meant none of
    // the three could ever have been applied: the runner refused the directory
    // before it read `schema_migrations`. Environments are migrated to 0048.
    test.each([
        ['0049_coupons_schema.sql', 'coupons'],
        ['0050_product_search_fulltext.sql', 'products'],
        ['0051_fraud_monitoring_queue.sql', 'fraud_monitoring_queue'],
    ])('%s still targets %s', (name, table) => {
        expect(sqlFiles).toContain(name);
        expect(read(name)).toMatch(new RegExp(`\\b${table}\\b`));
    });

    test('nothing is left at a duplicated 0049', () => {
        const at49 = sqlFiles.filter((name) => name.startsWith('0049'));

        expect(at49).toEqual(['0049_coupons_schema.sql']);
    });

    test('the tables the services need all have an owning migration', () => {
        // The three files were blocked together, so the three features were
        // broken together. This is the list that has to survive the renumber.
        const allSql = stripComments(sqlFiles.map(read).join('\n'));

        for (const table of ['coupons', 'fraud_monitoring_queue']) {
            expect(allSql).toMatch(
                new RegExp(`CREATE TABLE(?:\\s+IF NOT EXISTS)?\\s+\`?${table}\`?`, 'i')
            );
        }

        expect(allSql).toMatch(/FULLTEXT\s+INDEX\s+\w+\s*\(\s*name\s*\)/i);
    });
});

describe('the convention the README states', () => {
    const readme = fs.readFileSync(path.join(MIGRATIONS_DIR, 'README.md'), 'utf8');

    test('README still documents the four-digit prefix rule', () => {
        // If the convention ever changes, this test is the thing that should
        // be updated first -- it is what the assertions above encode.
        expect(readme).toMatch(/NNNN_short_name\.sql/);
    });

    test('no table is created by more than one migration', () => {
        // "A table has exactly one owning migration. Later files amend it with
        // ALTER TABLE. A second CREATE TABLE IF NOT EXISTS for a table that
        // already exists is skipped silently, which is how the schema came to
        // depend on apply order in the first place."
        const owners = new Map();
        const duplicated = [];

        for (const name of sqlFiles) {
            const sql = stripComments(read(name));
            const pattern = /CREATE TABLE(?:\s+IF NOT EXISTS)?\s+`?([A-Za-z0-9_]+)`?/gi;
            let match;

            while ((match = pattern.exec(sql)) !== null) {
                const table = match[1].toLowerCase();
                if (owners.has(table) && owners.get(table) !== name) {
                    duplicated.push(`${table}: ${owners.get(table)} and ${name}`);
                }
                owners.set(table, name);
            }
        }

        expect(duplicated).toEqual([]);
    });
});
