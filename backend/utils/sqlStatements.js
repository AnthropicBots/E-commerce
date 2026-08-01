// Splits a .sql script into the individual statements mysql2 can execute.
//
// The driver speaks the MySQL wire protocol, not the mysql command-line client:
// it will not split a script on `;` and it does not understand `DELIMITER`,
// which is a client-side directive rather than server SQL. Every schema file in
// this project uses `DELIMITER` around its stored procedures and triggers, so
// splitting has to happen here and it has to understand the directive.
//
// Anything that merely looks like a terminator has to be skipped: `;` inside a
// string literal, a backquoted identifier, or a comment is not a statement
// boundary. Comment text is kept in the statement it precedes -- the server
// ignores it, and dropping it would silently discard MySQL's executable
// `/*! ... */` comments.

const DEFAULT_DELIMITER = ";";

// `DELIMITER` is only honoured at the start of a line and only before any SQL
// has accumulated, which is how the mysql client treats it in practice.
const DELIMITER_DIRECTIVE = /^DELIMITER[ \t]+(\S+)[ \t]*/i;

function indexOfLineEnd(sql, from) {
    const newline = sql.indexOf("\n", from);
    return newline === -1 ? sql.length : newline;
}

// Returns the index just past the closing quote. A quote is escaped either by a
// backslash or by doubling it, and an unterminated literal runs to end of input
// rather than throwing: a malformed statement is the server's to reject, with a
// far better error message than this splitter could produce.
function indexAfterQuoted(sql, openIndex, quote) {
    let i = openIndex + 1;

    while (i < sql.length) {
        const ch = sql[i];

        if (ch === "\\" && quote !== "`") {
            i += 2;
            continue;
        }

        if (ch === quote) {
            if (sql[i + 1] === quote) {
                i += 2;
                continue;
            }
            return i + 1;
        }

        i += 1;
    }

    return sql.length;
}

function splitSqlStatements(sql) {
    const statements = [];

    let delimiter = DEFAULT_DELIMITER;
    let buffer = "";
    let hasCode = false;
    let isAtLineStart = true;
    let i = 0;

    const flush = () => {
        if (hasCode) {
            statements.push(buffer.trim());
        }
        buffer = "";
        hasCode = false;
    };

    while (i < sql.length) {
        const ch = sql[i];

        // MySQL requires whitespace after `--`, so `--` in an expression such as
        // `a - -b` is arithmetic rather than a comment.
        const isLineComment =
            (ch === "-" && sql[i + 1] === "-" && (i + 2 >= sql.length || /\s/.test(sql[i + 2]))) ||
            ch === "#";

        if (isLineComment) {
            const end = indexOfLineEnd(sql, i);
            buffer += sql.slice(i, end);
            i = end;
            continue;
        }

        if (ch === "/" && sql[i + 1] === "*") {
            const close = sql.indexOf("*/", i + 2);
            const end = close === -1 ? sql.length : close + 2;
            buffer += sql.slice(i, end);
            i = end;
            continue;
        }

        if (ch === "'" || ch === '"' || ch === "`") {
            const end = indexAfterQuoted(sql, i, ch);
            buffer += sql.slice(i, end);
            hasCode = true;
            isAtLineStart = false;
            i = end;
            continue;
        }

        if (isAtLineStart && !hasCode) {
            const directive = DELIMITER_DIRECTIVE.exec(sql.slice(i, i + 128));
            if (directive) {
                delimiter = directive[1];
                i = indexOfLineEnd(sql, i + directive[0].length);
                continue;
            }
        }

        if (sql.startsWith(delimiter, i)) {
            flush();
            isAtLineStart = false;
            i += delimiter.length;
            continue;
        }

        if (ch === "\n") {
            isAtLineStart = true;
        } else if (!/\s/.test(ch)) {
            hasCode = true;
            isAtLineStart = false;
        }

        buffer += ch;
        i += 1;
    }

    flush();

    return statements;
}

module.exports = { splitSqlStatements, DEFAULT_DELIMITER };
