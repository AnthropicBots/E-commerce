// Every column a view selects must exist on the table it selects from.
//
// MySQL resolves a view's SELECT at CREATE VIEW time, so a view over a column
// that does not exist is not a lazy failure on first read -- it is
// ER_BAD_FIELD_ERROR while the migration is being applied. And because
// applyMigration() runs a file's statements in one loop and rethrows on the
// first failure, a single bad view stops the whole sequence: nothing after it
// applies, ever, on any fresh database.
//
// That is what 0014 did. `velocity_monitoring` grouped `users` by `ip_address`,
// a column no migration has ever declared, so migrations 0015 through 0048
// could not be applied at all (#1673).
//
// Nothing in the repo could see it. The suite has no database, `check:syntax`
// only parses JavaScript, and the runner is the only thing that reads these
// files -- at which point it is too late. So the schema is resolved here,
// statically, from the migrations themselves.

const fs = require("fs");
const path = require("path");

const MIGRATIONS_DIR = path.join(__dirname, "..", "..", "migrations");

const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort();

// ---------------------------------------------------------------------------
// A very small SQL reader
//
// Deliberately narrow. It is not a parser -- it understands enough of the
// dialect this repo writes to resolve single-table views, and it skips anything
// it cannot be confident about rather than guessing and reporting noise.
// ---------------------------------------------------------------------------

const COLUMN_TYPES =
    "CHAR|VARCHAR|INT|BIGINT|TINYINT|SMALLINT|MEDIUMINT|TEXT|LONGTEXT|" +
    "MEDIUMTEXT|DATETIME|TIMESTAMP|DATE|TIME|DECIMAL|FLOAT|DOUBLE|JSON|" +
    "ENUM|BOOLEAN|BLOB|BINARY";

const NOT_A_COLUMN = /^(PRIMARY|UNIQUE|INDEX|KEY|CONSTRAINT|FOREIGN|FULLTEXT|SPATIAL)$/i;

/** Strip comments and string literals so neither can look like a column. */
const stripNoise = (sql) =>
    sql
        .replace(/--[^\n]*/g, " ")
        .replace(/\/\*[\s\S]*?\*\//g, " ")
        .replace(/'(?:[^'\\]|\\.)*'/g, " '' ")
        .replace(/"(?:[^"\\]|\\.)*"/g, ' "" ');

/** Words that are SQL, not column names. */
const SQL_WORDS = new Set(
    `select from where group by having order asc desc as and or not null is in
     between like case when then else end distinct all union join left right
     inner outer on limit offset with interval hour day week month year minute
     second count sum avg min max round abs coalesce ifnull nullif if concat
     cast convert date now curdate curtime date_sub date_add datediff
     timestampdiff timestampadd date_format json_object json_arrayagg
     json_object_agg group_concat unix_timestamp sec_to_time lower upper trim
     substring length replace greatest least std stddev variance over partition
     row_number rank dense_rank exists any some char_length signed unsigned
     integer decimal true false`
        .split(/\s+/)
        .filter(Boolean)
);

/**
 * Accumulate the schema across the whole sequence, in order, the way the runner
 * would apply it.
 */
const buildSchema = () => {
    const tables = new Map(); // name -> Set(columns)
    const views = new Set();
    const viewDefinitions = [];

    for (const filename of files) {
        const sql = stripNoise(fs.readFileSync(path.join(MIGRATIONS_DIR, filename), "utf8"));

        for (const match of sql.matchAll(
            /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?`?(\w+)`?\s*\(([\s\S]*?)\n\)\s*ENGINE/gi
        )) {
            const name = match[1].toLowerCase();
            if (!tables.has(name)) tables.set(name, new Set());

            for (const line of match[2].split("\n")) {
                const column = line.match(
                    new RegExp(`^\\s*\`?(\\w+)\`?\\s+(?:${COLUMN_TYPES})\\b`, "i")
                );
                if (column && !NOT_A_COLUMN.test(column[1])) {
                    tables.get(name).add(column[1].toLowerCase());
                }
            }
        }

        for (const match of sql.matchAll(/ALTER\s+TABLE\s+`?(\w+)`?([\s\S]*?);/gi)) {
            const name = match[1].toLowerCase();
            if (!tables.has(name)) tables.set(name, new Set());

            for (const added of match[2].matchAll(
                new RegExp(`ADD\\s+(?:COLUMN\\s+)?\`?(\\w+)\`?\\s+(?:${COLUMN_TYPES})\\b`, "gi")
            )) {
                if (!NOT_A_COLUMN.test(added[1])) {
                    tables.get(name).add(added[1].toLowerCase());
                }
            }

            for (const renamed of match[2].matchAll(
                /(?:CHANGE|RENAME)\s+COLUMN\s+`?\w+`?\s+(?:TO\s+)?`?(\w+)`?/gi
            )) {
                tables.get(name).add(renamed[1].toLowerCase());
            }

            for (const dropped of match[2].matchAll(/DROP\s+COLUMN\s+`?(\w+)`?/gi)) {
                tables.get(name).delete(dropped[1].toLowerCase());
            }
        }

        for (const renamed of sql.matchAll(
            /RENAME\s+TABLE\s+`?(\w+)`?\s+TO\s+`?(\w+)`?/gi
        )) {
            const from = renamed[1].toLowerCase();
            const to = renamed[2].toLowerCase();
            tables.set(to, tables.get(from) || new Set());
            tables.delete(from);
        }

        for (const view of sql.matchAll(
            /CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+`?(\w+)`?\s+AS\s*([\s\S]*?);/gi
        )) {
            views.add(view[1].toLowerCase());
            viewDefinitions.push({
                filename,
                name: view[1].toLowerCase(),
                body: view[2],
                // Snapshot the schema as it stands at this point in the
                // sequence -- a view cannot read a column added after it.
                tables: new Map([...tables].map(([t, c]) => [t, new Set(c)])),
                views: new Set(views)
            });
        }
    }

    return { tables, views, viewDefinitions };
};

const { tables, viewDefinitions } = buildSchema();

/**
 * The single table a view reads, or null if it reads anything more complicated
 * than that -- a join, a subquery or another view. Those are out of scope: this
 * test exists to catch a column that exists nowhere, not to typecheck SQL.
 */
const soleSourceOf = (definition) => {
    const sources = [...definition.body.matchAll(/\b(?:FROM|JOIN)\s+`?(\w+)`?/gi)].map(
        (match) => match[1].toLowerCase()
    );

    if (sources.length !== 1) return null;
    if (/\bSELECT\b[\s\S]*\bSELECT\b/i.test(definition.body)) return null;
    if (definition.views.has(sources[0])) return null;
    if (!definition.tables.has(sources[0])) return null;

    return sources[0];
};

/** Identifiers in a view body that are meant to be columns of its source. */
const columnsReferencedBy = (definition, source) => {
    const aliases = new Set(
        [...definition.body.matchAll(/\bAS\s+`?(\w+)`?/gi)].map((m) => m[1].toLowerCase())
    );

    const referenced = new Set();

    for (const token of definition.body.matchAll(/`?\b([a-z_][a-z0-9_]*)\b`?/gi)) {
        const name = token[1].toLowerCase();

        if (SQL_WORDS.has(name)) continue;
        if (aliases.has(name)) continue;
        if (name === source || name === definition.name) continue;
        if (/^\d/.test(name)) continue;

        referenced.add(name);
    }

    return referenced;
};

// ---------------------------------------------------------------------------

describe("the migration sequence parses into a schema", () => {
    test("there are migrations to check", () => {
        expect(files.length).toBeGreaterThan(40);
    });

    test("the baseline declares the users table", () => {
        expect(tables.has("users")).toBe(true);
        expect(tables.get("users").size).toBeGreaterThan(20);
    });

    test("at least one view is checkable", () => {
        const checkable = viewDefinitions.filter((view) => soleSourceOf(view));

        expect(checkable.length).toBeGreaterThan(0);
    });
});

describe("every single-table view reads columns that exist", () => {
    const checkable = viewDefinitions.filter((view) => soleSourceOf(view));

    test.each(checkable.map((view) => [view.filename, view.name, view]))(
        "%s: %s",
        (_filename, _name, view) => {
            const source = soleSourceOf(view);
            const available = view.tables.get(source);

            const missing = [...columnsReferencedBy(view, source)].filter(
                (column) => !available.has(column)
            );

            expect(missing).toEqual([]);
        }
    );
});

describe("the column 0014 was missing", () => {
    test("users has signup_ip", () => {
        // The column velocity_monitoring groups by. Without it, CREATE VIEW
        // fails and migrations 0015-0048 never apply.
        expect(tables.get("users").has("signup_ip")).toBe(true);
    });

    test("users still has no ip_address, and the view no longer asks for one", () => {
        expect(tables.get("users").has("ip_address")).toBe(false);

        const view = viewDefinitions.find((v) => v.name === "velocity_monitoring");

        expect(view).toBeDefined();
        expect(view.body).toMatch(/signup_ip/);
        expect(view.body).not.toMatch(/FROM\s+users[\s\S]*GROUP BY\s+ip_address/i);
    });

    test("the column is declared before the view that reads it", () => {
        const sql = fs.readFileSync(
            path.join(MIGRATIONS_DIR, "0014_synthetic_identity_fraud.sql"),
            "utf8"
        );

        expect(sql.indexOf("ADD COLUMN signup_ip")).toBeGreaterThan(-1);
        expect(sql.indexOf("ADD COLUMN signup_ip")).toBeLessThan(
            sql.indexOf("CREATE VIEW velocity_monitoring")
        );
    });

    test("accounts with no recorded address are excluded from the view", () => {
        // Every row predating the column is NULL, and MySQL groups NULLs
        // together -- counting them would collapse the existing user table into
        // one bucket and report it as the highest-velocity address on the
        // system.
        const view = viewDefinitions.find((v) => v.name === "velocity_monitoring");

        expect(view.body).toMatch(/signup_ip\s+IS\s+NOT\s+NULL/i);
    });
});

describe("the sequence is still well formed", () => {
    test("no two migrations claim the same version", () => {
        const versions = files.map((name) => name.slice(0, 4));

        expect(new Set(versions).size).toBe(versions.length);
    });

    test("every file matches NNNN_name.sql", () => {
        for (const name of files) {
            expect(name).toMatch(/^\d{4}_[a-z0-9_]+\.sql$/);
        }
    });
});
