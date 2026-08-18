// backend/tests/helpers/migrationSchema.js
//
// What the database actually looks like, read from migrations/ (#1581).
//
// A whole family of bugs in this repository has the same shape: a query names a
// column that is not there, nothing catches it, and the endpoint 500s for
// everyone until somebody happens to call it.
//
//   #1538  admin.service reads is_email_verified; the column is is_verified
//   #1539  recommendationService reads products.category; it is category_id
//   #1529  the money metrics summed orders.total_amount; it is orders.total
//   #1581  coupon effectiveness read coupons.discount_type/discount_value/
//          usage_count; those are promo_codes columns, and coupons calls them
//          type/value/used_count
//
// Every one of them parses, boots and imports cleanly, so the syntax, boot and
// module gates all pass. The suites mock config/db, so nothing in the test run
// touches a real schema either -- which is precisely why the mismatch survives
// to production.
//
// This reads the migration sequence, which is the definition of the schema
// (AGENTS.md: "Schema comes from the ordered sequence in migrations/"), and
// gives a test the column set for a table. A test can then assert that the
// columns a query names are columns that exist, without needing a database.
//
// Scope, deliberately: this is a lexical reader, not a SQL engine. It handles
// CREATE TABLE and the ADD COLUMN forms this repository uses, which covers the
// sequence as it stands. It does not model DROP COLUMN, CHANGE or RENAME -- if
// one lands, extend it here rather than working around it in a test, because a
// dropped column that this helper still reports is a false pass.

'use strict';

const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.join(__dirname, '..', '..', '..', 'migrations');

// The type keywords a column definition can start with. Matching on these is
// what separates `code VARCHAR(50) NOT NULL` from `INDEX idx_code (code)` and
// `CONSTRAINT chk_value CHECK (...)`, which are not columns.
const TYPES = [
    'CHAR', 'VARCHAR', 'TINYTEXT', 'TEXT', 'MEDIUMTEXT', 'LONGTEXT',
    'TINYINT', 'SMALLINT', 'MEDIUMINT', 'INT', 'INTEGER', 'BIGINT',
    'DECIMAL', 'NUMERIC', 'FLOAT', 'DOUBLE',
    'DATE', 'DATETIME', 'TIMESTAMP', 'TIME', 'YEAR',
    'JSON', 'ENUM', 'SET', 'BOOLEAN', 'BOOL',
    'BLOB', 'TINYBLOB', 'MEDIUMBLOB', 'LONGBLOB', 'BINARY', 'VARBINARY',
].join('|');

const COLUMN_DEFINITION = new RegExp(`^\`?([a-z_][a-z0-9_]*)\`?\\s+(?:${TYPES})\\b`, 'i');

const CREATE_TABLE = /CREATE TABLE(?:\s+IF NOT EXISTS)?\s+`?(\w+)`?\s*\(([\s\S]*?)\n\s*\)\s*(?:ENGINE|;)/gi;
const ALTER_TABLE = /ALTER TABLE\s+`?(\w+)`?([\s\S]*?);/gi;
const ADD_COLUMN = new RegExp(
    `ADD\\s+(?:COLUMN\\s+)?(?:IF NOT EXISTS\\s+)?\`?([a-z_][a-z0-9_]*)\`?\\s+(?:${TYPES})\\b`,
    'gi'
);

let cached = null;

/**
 * Split a CREATE TABLE body into its top-level entries.
 *
 * Splitting on newlines is not enough -- an ENUM lists its members on one line
 * and a CHECK constraint can span several -- so this tracks parenthesis depth
 * and breaks only on commas outside them.
 *
 * @param {string} body
 * @returns {string[]}
 */
function splitDefinitions(body) {
    const entries = [];
    let depth = 0;
    let current = '';

    for (const character of body) {
        if (character === '(') depth += 1;
        if (character === ')') depth -= 1;

        if (character === ',' && depth === 0) {
            entries.push(current);
            current = '';
            continue;
        }

        current += character;
    }

    entries.push(current);

    return entries;
}

/**
 * Strip comments so a column name inside one is not read as a definition.
 *
 * @param {string} sql
 * @returns {string}
 */
function stripComments(sql) {
    return sql
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*--.*$/gm, '');
}

/**
 * Every table in the migration sequence, with its columns.
 *
 * Migrations are applied in filename order and later ones add to earlier ones,
 * so they are read in that order and the column sets accumulate.
 *
 * @returns {Map<string, Set<string>>} Table name (lowercased) to column names.
 */
function readSchema() {
    if (cached) return cached;

    const schema = new Map();

    const columnsFor = (table) => {
        const key = table.toLowerCase();
        if (!schema.has(key)) schema.set(key, new Set());
        return schema.get(key);
    };

    const files = fs
        .readdirSync(MIGRATIONS_DIR)
        .filter((name) => name.endsWith('.sql'))
        .sort();

    for (const name of files) {
        const sql = stripComments(
            fs.readFileSync(path.join(MIGRATIONS_DIR, name), 'utf8')
        );

        for (const match of sql.matchAll(CREATE_TABLE)) {
            const columns = columnsFor(match[1]);

            for (const entry of splitDefinitions(match[2])) {
                const definition = COLUMN_DEFINITION.exec(entry.trim());
                if (definition) columns.add(definition[1].toLowerCase());
            }
        }

        for (const match of sql.matchAll(ALTER_TABLE)) {
            const columns = columnsFor(match[1]);

            for (const added of match[2].matchAll(ADD_COLUMN)) {
                columns.add(added[1].toLowerCase());
            }
        }
    }

    cached = schema;
    return schema;
}

/**
 * The columns of one table.
 *
 * Throws rather than returning an empty set for a table that is not in the
 * sequence: "this table has no columns" and "you misspelled the table" should
 * not look the same to a test.
 *
 * @param {string} table
 * @returns {Set<string>}
 */
function columnsOf(table) {
    const schema = readSchema();
    const key = String(table).toLowerCase();

    if (!schema.has(key)) {
        throw new Error(
            `No CREATE TABLE for "${table}" in migrations/. `
            + `Known tables: ${[...schema.keys()].sort().join(', ')}`
        );
    }

    return schema.get(key);
}

/**
 * Does this table define this column?
 *
 * @param {string} table
 * @param {string} column
 * @returns {boolean}
 */
function hasColumn(table, column) {
    return columnsOf(table).has(String(column).toLowerCase());
}

/**
 * Every `alias.column` a statement reads, given what the aliases stand for.
 *
 * The caller supplies the alias map because resolving `FROM`/`JOIN` properly
 * means parsing SQL, and getting that subtly wrong would make the assertion
 * quieter than no assertion at all. Stating the map in the test also documents
 * which table the query is expected to be reading.
 *
 * @param {string} sql
 * @param {Object<string, string>} aliases - e.g. `{ c: 'promo_codes', o: 'orders' }`
 * @returns {Array<{alias: string, table: string, column: string}>}
 */
function qualifiedReads(sql, aliases) {
    const known = new Map(
        Object.entries(aliases).map(([alias, table]) => [alias.toLowerCase(), table])
    );

    const reads = [];
    const seen = new Set();

    for (const match of String(sql).matchAll(/\b([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)\b/gi)) {
        const alias = match[1].toLowerCase();
        const column = match[2].toLowerCase();

        if (!known.has(alias)) continue;

        const key = `${alias}.${column}`;
        if (seen.has(key)) continue;
        seen.add(key);

        reads.push({ alias, table: known.get(alias), column });
    }

    return reads;
}

/**
 * Every `alias.column` in a statement that the schema does not define.
 *
 * @param {string} sql
 * @param {Object<string, string>} aliases
 * @returns {string[]} e.g. `['c.discount_type is not a column of coupons']`
 */
function unknownColumns(sql, aliases) {
    return qualifiedReads(sql, aliases)
        .filter(({ table, column }) => !hasColumn(table, column))
        .map(({ alias, table, column }) => `${alias}.${column} is not a column of ${table}`);
}

module.exports = {
    MIGRATIONS_DIR,
    readSchema,
    columnsOf,
    hasColumn,
    qualifiedReads,
    unknownColumns,
};
