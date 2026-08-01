#!/usr/bin/env node
//
// Applies the ordered migration sequence in `migrations/` and records what it
// applied, so a fresh database and an established one converge on the same
// schema instead of depending on which file somebody happened to pipe into
// mysql first.
//
// Usage (from `backend/`):
//   npm run migrate           apply everything pending
//   npm run migrate:status    list applied and pending, change nothing
//   npm run migrate:baseline  record the baseline as applied without running it
//
// Guarantees:
//   - migrations run in version order, one at a time, on one connection
//   - a migration already recorded is never re-run
//   - editing an already-applied migration is refused, not silently ignored
//   - a second process cannot apply concurrently (MySQL advisory lock)

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const promisePool = require("../config/db");
const logger = require("../utils/logger");
const { splitSqlStatements } = require("../utils/sqlStatements");

const MIGRATIONS_DIR = path.resolve(__dirname, "..", "..", "migrations");

// Four or more leading digits, so the sequence sorts lexicographically for as
// long as anyone will plausibly keep adding to it.
const MIGRATION_FILENAME = /^(\d{4,})_([A-Za-z0-9][A-Za-z0-9._-]*)\.sql$/;

// The baseline adopts the schema established installations already have, so it
// is the one migration that may legitimately be recorded without running.
const BASELINE_VERSION = "0001";

// Advisory locks are scoped to the connection that took them, so the lock has
// to be held on the same connection that applies the migrations.
const ADVISORY_LOCK_NAME = "ecommerce_schema_migrations";
const ADVISORY_LOCK_TIMEOUT_SECONDS = 30;

const KNOWN_FLAGS = new Set(["--dry-run", "--status", "--baseline", "--mark-applied"]);

const BOOKKEEPING_TABLE_DDL = `
    CREATE TABLE IF NOT EXISTS schema_migrations (
        version VARCHAR(32) NOT NULL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        checksum CHAR(64) NOT NULL,
        applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        execution_ms INT NOT NULL DEFAULT 0,

        INDEX idx_schema_migrations_applied_at (applied_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

class MigrationError extends Error {}

function checksumOf(sql) {
    return crypto.createHash("sha256").update(sql, "utf8").digest("hex");
}

// Reads the sequence off disk. Files that do not follow the naming convention
// are reported rather than guessed at: a migration nobody can order is a
// migration nobody can apply reproducibly.
function loadMigrations() {
    if (!fs.existsSync(MIGRATIONS_DIR)) {
        throw new MigrationError(`Migrations directory not found: ${MIGRATIONS_DIR}`);
    }

    const migrations = [];
    const ignored = [];
    const versions = new Map();

    for (const filename of fs.readdirSync(MIGRATIONS_DIR).sort()) {
        if (!filename.toLowerCase().endsWith(".sql")) continue;

        const match = MIGRATION_FILENAME.exec(filename);
        if (!match) {
            ignored.push(filename);
            continue;
        }

        const [, version, name] = match;
        if (versions.has(version)) {
            throw new MigrationError(
                `Duplicate migration version ${version}: ${versions.get(version)} and ${filename}. ` +
                `Renumber one of them so the order is unambiguous.`
            );
        }
        versions.set(version, filename);

        const filePath = path.join(MIGRATIONS_DIR, filename);
        const sql = fs.readFileSync(filePath, "utf8");

        migrations.push({
            version,
            name,
            filename,
            path: filePath,
            sql,
            checksum: checksumOf(sql)
        });
    }

    migrations.sort((a, b) => (a.version < b.version ? -1 : a.version > b.version ? 1 : 0));

    return { migrations, ignored };
}

async function readAppliedMigrations(connection) {
    const [rows] = await connection.query(
        "SELECT version, name, checksum, applied_at, execution_ms FROM schema_migrations"
    );
    return new Map(rows.map((row) => [row.version, row]));
}

// Drift means the recorded history no longer describes the SQL on disk, so the
// database's real shape is unknown. Every mismatch is reported, not just the
// first, so the fix can be planned in one pass.
function assertNoDrift(migrations, applied) {
    const drifted = migrations.filter((migration) => {
        const record = applied.get(migration.version);
        return record && record.checksum !== migration.checksum;
    });

    if (drifted.length === 0) return;

    const details = drifted
        .map((migration) => `  ${migration.filename} (recorded ${applied.get(migration.version).checksum.slice(0, 12)}, on disk ${migration.checksum.slice(0, 12)})`)
        .join("\n");

    throw new MigrationError(
        `Applied migrations were edited after they ran:\n${details}\n\n` +
        `An applied migration is immutable. Revert the edit and add a new migration ` +
        `with the change, or -- if the edit is known to be cosmetic and the database ` +
        `already matches -- update schema_migrations.checksum for those versions by hand.`
    );
}

async function withAdvisoryLock(connection, fn) {
    const [rows] = await connection.query("SELECT GET_LOCK(?, ?) AS acquired", [
        ADVISORY_LOCK_NAME,
        ADVISORY_LOCK_TIMEOUT_SECONDS
    ]);

    if (rows[0]?.acquired !== 1) {
        throw new MigrationError(
            `Could not acquire the migration lock within ${ADVISORY_LOCK_TIMEOUT_SECONDS}s. ` +
            `Another process is applying migrations; wait for it to finish and retry.`
        );
    }

    try {
        return await fn();
    } finally {
        await connection.query("SELECT RELEASE_LOCK(?)", [ADVISORY_LOCK_NAME]);
    }
}

// MySQL commits implicitly on DDL, so the transaction cannot roll a half-applied
// CREATE/ALTER back. It still keeps the bookkeeping row and any DML in the
// migration consistent with each other, and it guarantees the migration is
// either recorded or reported as failed -- never applied and forgotten.
async function applyMigration(connection, migration) {
    const statements = splitSqlStatements(migration.sql);

    if (statements.length === 0) {
        throw new MigrationError(`${migration.filename} contains no statements.`);
    }

    const startedAt = Date.now();

    await connection.beginTransaction();
    try {
        for (const statement of statements) {
            await connection.query(statement);
        }

        await connection.query(
            "INSERT INTO schema_migrations (version, name, checksum, execution_ms) VALUES (?, ?, ?, ?)",
            [migration.version, migration.name, migration.checksum, Date.now() - startedAt]
        );

        await connection.commit();
    } catch (error) {
        await connection.rollback();
        throw new MigrationError(
            `${migration.filename} failed after ${Date.now() - startedAt}ms: ${error.message}`
        );
    }

    return Date.now() - startedAt;
}

async function markApplied(connection, migration) {
    await connection.query(
        "INSERT INTO schema_migrations (version, name, checksum, execution_ms) VALUES (?, ?, ?, 0)",
        [migration.version, migration.name, migration.checksum]
    );
}

function reportPlan({ migrations, applied, ignored }) {
    for (const filename of ignored) {
        logger.warn(`Ignoring ${filename}: not named <version>_<name>.sql, so it is not part of the sequence.`);
    }

    for (const migration of migrations) {
        const record = applied.get(migration.version);
        if (record) {
            logger.info(`applied  ${migration.filename} (${record.applied_at})`);
        } else {
            logger.info(`pending  ${migration.filename}`);
        }
    }

    const pending = migrations.filter((migration) => !applied.has(migration.version));
    logger.info(`${applied.size} applied, ${pending.length} pending.`);

    return pending;
}

async function run({ isDryRun, shouldMarkBaseline }) {
    const { migrations, ignored } = loadMigrations();

    if (migrations.length === 0) {
        throw new MigrationError(`No migrations found in ${MIGRATIONS_DIR}.`);
    }

    const connection = await promisePool.getConnection();

    try {
        await connection.query(BOOKKEEPING_TABLE_DDL);

        return await withAdvisoryLock(connection, async () => {
            const applied = await readAppliedMigrations(connection);

            assertNoDrift(migrations, applied);

            const pending = reportPlan({ migrations, applied, ignored });

            if (isDryRun) {
                logger.info("Dry run: nothing was applied.");
                return;
            }

            if (shouldMarkBaseline) {
                const baseline = migrations.find((migration) => migration.version === BASELINE_VERSION);
                if (!baseline) {
                    throw new MigrationError(`No migration with version ${BASELINE_VERSION} to adopt as baseline.`);
                }
                if (applied.has(BASELINE_VERSION)) {
                    logger.info(`Baseline ${baseline.filename} is already recorded.`);
                } else {
                    await markApplied(connection, baseline);
                    logger.info(`Recorded ${baseline.filename} as applied without running it.`);
                }
                return;
            }

            for (const migration of pending) {
                logger.info(`Applying ${migration.filename}...`);
                const durationMs = await applyMigration(connection, migration);
                logger.info(`Applied ${migration.filename} in ${durationMs}ms.`);
            }

            if (pending.length === 0) {
                logger.info("Database is up to date.");
            }
        });
    } finally {
        connection.release();
    }
}

function parseArgs(argv) {
    const flags = new Set(argv);
    const unknown = argv.filter((arg) => !KNOWN_FLAGS.has(arg));

    if (unknown.length > 0) {
        throw new MigrationError(`Unknown option(s): ${unknown.join(", ")}. Known options: ${[...KNOWN_FLAGS].join(", ")}`);
    }

    return {
        isDryRun: flags.has("--dry-run") || flags.has("--status"),
        shouldMarkBaseline: flags.has("--baseline") || flags.has("--mark-applied")
    };
}

async function main() {
    let exitCode = 0;

    try {
        await run(parseArgs(process.argv.slice(2)));
    } catch (error) {
        logger.error(`Migration run failed: ${error.message}`);
        if (!(error instanceof MigrationError)) {
            logger.error(error.stack);
        }
        exitCode = 1;
    }

    // The db module keeps a pool and reconnect timers alive, so the process is
    // ended deliberately rather than waiting for the event loop to drain.
    try {
        await promisePool.end();
    } catch (error) {
        logger.warn(`Error closing the connection pool: ${error.message}`);
    }

    process.exit(exitCode);
}

if (require.main === module) {
    main();
}

module.exports = { run, loadMigrations, assertNoDrift, MigrationError, MIGRATIONS_DIR };
