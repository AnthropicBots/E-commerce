// backend/tests/emailLogsSchema.test.js
//
// `email_logs` exists in the schema, and the service and the table agree about
// its shape (#1699).
//
// The service has read from and written to `email_logs` since #1668. No
// migration created it. Both failures were caught and thrown away -- the INSERT
// behind a bare `.catch(() => {})`, the SELECT behind a `catch` that silently
// fell through to a 100-entry in-process array -- so every write since then has
// been discarded and the admin log view has been serving a buffer that empties
// on restart and differs per instance.
//
// Nothing could have caught it. check:syntax parses, check:boot mounts,
// check:modules requires; none of them runs a migration or touches MySQL, and
// the suite that shipped with the feature asserted on the fallback buffer,
// which works fine with no table at all.
//
// So the check is static: read the SQL the service issues, read the migration
// that owns the table, and assert the two describe the same columns. That is
// the drift a running database would have told us about, made visible without
// one.

'use strict';

const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.join(__dirname, '..', '..', 'migrations');
const SERVICE_PATH = path.join(__dirname, '..', 'services', 'emailService.js');

const service = fs.readFileSync(SERVICE_PATH, 'utf8');

const migrationFiles = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort();

const allMigrationSql = migrationFiles
    .map((name) => fs.readFileSync(path.join(MIGRATIONS_DIR, name), 'utf8'))
    .join('\n');

/** Strip `--` comments so a table named in prose is not read as a definition. */
const withoutComments = (sql) => sql.replace(/--[^\n]*/g, '');

/** The body of `CREATE TABLE [IF NOT EXISTS] <name> ( ... )`. */
function createTableBody(sql, table) {
    const pattern = new RegExp(
        `CREATE TABLE(?:\\s+IF NOT EXISTS)?\\s+\`?${table}\`?\\s*\\(`,
        'i'
    );
    const match = pattern.exec(sql);
    if (!match) return null;

    let depth = 0;
    const start = match.index + match[0].length - 1;

    for (let i = start; i < sql.length; i += 1) {
        if (sql[i] === '(') depth += 1;
        else if (sql[i] === ')') {
            depth -= 1;
            if (depth === 0) return sql.slice(start + 1, i);
        }
    }

    return null;
}

const emailLogsBody = createTableBody(withoutComments(allMigrationSql), 'email_logs');

describe('email_logs has an owning migration', () => {
    test('some migration creates the table', () => {
        expect(emailLogsBody).not.toBeNull();
    });

    test('exactly one migration creates it', () => {
        // migrations/README.md: "A table has exactly one owning migration."
        // A second CREATE TABLE IF NOT EXISTS is skipped silently, which is how
        // the schema comes to depend on apply order.
        const owners = migrationFiles.filter((name) => {
            const sql = withoutComments(
                fs.readFileSync(path.join(MIGRATIONS_DIR, name), 'utf8')
            );
            return /CREATE TABLE(?:\s+IF NOT EXISTS)?\s+`?email_logs`?/i.test(sql);
        });

        expect(owners).toHaveLength(1);
    });

    test('its filename follows the NNNN_name.sql convention', () => {
        const owner = migrationFiles.find((name) => {
            const sql = withoutComments(
                fs.readFileSync(path.join(MIGRATIONS_DIR, name), 'utf8')
            );
            return /CREATE TABLE(?:\s+IF NOT EXISTS)?\s+`?email_logs`?/i.test(sql);
        });

        // The runner ignores anything that does not match, and reports it
        // rather than applying it.
        expect(owner).toMatch(/^\d{4,}_[A-Za-z0-9][A-Za-z0-9._-]*\.sql$/);
    });
});

describe('the table matches what emailService writes', () => {
    // recordEmailLog: INSERT INTO email_logs (recipient, subject, order_id,
    //                 status, channel, error) VALUES (?, ?, ?, ?, ?, ?)
    const insert = service.match(
        /INSERT INTO email_logs\s*\(([^)]*)\)\s*\n?\s*VALUES\s*\(([^)]*)\)/i
    );

    test('the service still issues the insert this pins', () => {
        expect(insert).not.toBeNull();
    });

    const insertColumns = (insert ? insert[1] : '')
        .split(',')
        .map((column) => column.trim())
        .filter(Boolean);

    test.each(insertColumns)('the table declares %s', (column) => {
        expect(emailLogsBody).toMatch(new RegExp(`^\\s*\`?${column}\`?\\s`, 'im'));
    });

    test('every inserted column has a placeholder', () => {
        const placeholders = (insert[2].match(/\?/g) || []).length;

        expect(placeholders).toBe(insertColumns.length);
    });

    test('order_id is nullable', () => {
        // recordEmailLog passes null whenever the caller has no order.
        expect(emailLogsBody).toMatch(/order_id\s+CHAR\(36\)\s+NULL/i);
    });

    test('order_id carries no cascading foreign key', () => {
        // A log entry has to outlive the thing it describes. An order erased
        // under a data-deletion request must not take the record of what was
        // mailed about it along with it.
        expect(emailLogsBody).not.toMatch(/order_id[\s\S]*?ON DELETE CASCADE/i);
    });

    test('error is wide enough for what a transport throws', () => {
        // SMTP failures are routinely longer than 255 characters.
        expect(emailLogsBody).toMatch(/\berror\s+TEXT\b/i);
    });
});

describe('the table matches what emailService reads', () => {
    const select = service.match(/SELECT\s+([\s\S]*?)\s+FROM email_logs/i);

    test('the service still issues the select this pins', () => {
        expect(select).not.toBeNull();
    });

    // `order_id AS orderId` -> the column is order_id.
    const selectColumns = (select ? select[1] : '')
        .split(',')
        .map((entry) => entry.trim().split(/\s+AS\s+/i)[0].trim())
        .filter(Boolean);

    test.each(selectColumns)('the table declares %s', (column) => {
        expect(emailLogsBody).toMatch(new RegExp(`^\\s*\`?${column}\`?\\s`, 'im'));
    });

    test('sent_at defaults, because nothing inserts it', () => {
        // getEmailLogs orders on sent_at; recordEmailLog never writes it.
        // Without a default every row sorts as NULL and "recent" means nothing.
        expect(emailLogsBody).toMatch(/sent_at\s+TIMESTAMP[^,]*DEFAULT CURRENT_TIMESTAMP/i);
        expect(service).not.toMatch(/INSERT INTO email_logs[\s\S]{0,200}sent_at/i);
    });

    test('the ordering column is indexed', () => {
        // `ORDER BY sent_at DESC LIMIT ?` is a filesort over the whole table
        // otherwise, and this table only grows.
        expect(emailLogsBody).toMatch(/INDEX\s+\w+\s*\(\s*sent_at\s*\)/i);
    });

    test('id is a key the select can return', () => {
        expect(emailLogsBody).toMatch(/\bid\s+BIGINT[^,]*PRIMARY KEY/i);
    });
});

describe('a persistence failure is reported, not swallowed', () => {
    test('the insert is no longer behind a bare catch', () => {
        // `.catch(() => {})` with a comment claiming the table is "created
        // dynamically if needed" is what hid this for months.
        expect(service).not.toMatch(/INSERT INTO email_logs[\s\S]{0,400}catch\(\s*\(\s*\)\s*=>\s*\{\s*\}\s*\)/);
    });

    test('the write path logs the failure', () => {
        expect(service).toMatch(/Could not persist email log/);
    });

    test('the read path says when it is serving the memory buffer', () => {
        // The buffer is capped, per-process and empty after a restart. Reaching
        // it is worth saying out loud rather than presenting as the audit log.
        expect(service).toMatch(/email_logs unreadable/);
    });

    test('an empty table is no longer treated as a failure', () => {
        // Falling through to the buffer on `rows.length === 0` made a working
        // database look like a broken one the moment it had nothing to show.
        expect(service).not.toMatch(/if \(rows && rows\.length > 0\)/);
    });
});
