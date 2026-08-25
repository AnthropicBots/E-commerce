// Every name `utils.js` exports must be a name `utils.js` declares.
//
// `window.AppUtils = { ... }` is one top-level object literal. An undeclared
// identifier inside it throws `ReferenceError` while the literal is being
// evaluated, which means the assignment never happens: `window.AppUtils` stays
// undefined, and every statement after it — the whole backward-compatibility
// block that publishes `notify`, `apiRequest`, `formatPrice`, `requireAuth`
// and the rest onto `window` — never runs either.
//
// That is what #1641 shipped. `reorderOrder` was added to the export list and
// to `window`, and the function itself never landed, so one missing function
// took out the shared helper surface on every page of the storefront (#1651).
//
// `npm run check:syntax` cannot see this. The file parses perfectly well; the
// identifier is only unresolved at evaluation time. So it is checked here.

const fs = require("fs");
const path = require("path");

const UTILS_PATH = path.join(
    __dirname,
    "..",
    "..",
    "frontend",
    "scripts",
    "utils.js"
);

const source = fs.readFileSync(UTILS_PATH, "utf8");

/**
 * Every identifier the given source declares at any depth.
 *
 * Deliberately generous: this test is here to catch a name that exists
 * nowhere, not to police scope. A shorthand property naming something that is
 * declared inside a function would be a different bug, and a stricter reading
 * here would only produce false alarms on a file this size.
 */
const declarationsIn = (text) => {
    const names = new Set();

    const add = (pattern) => {
        for (const match of text.matchAll(pattern)) {
            if (match[1]) {
                names.add(match[1]);
            }
        }
    };

    add(/\b(?:function|class)\s+([A-Za-z_$][\w$]*)/g);
    add(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g);

    // Destructured declarations: `const { a, b: c } = ...`
    for (const match of text.matchAll(/\b(?:const|let|var)\s*\{([^}]*)\}\s*=/g)) {
        match[1]
            .split(",")
            .map((part) => part.split(":").pop().split("=")[0].trim())
            .filter(Boolean)
            .forEach((name) => names.add(name));
    }

    return names;
};

/**
 * What an identifier in `utils.js` can legitimately resolve to.
 *
 * A bare identifier reaches the global scope, so a name `utils.js` never
 * declares still resolves if a script loaded before it published one onto
 * `window` -- `CONFIG` comes from `config.js` that way. Those count as
 * available; a name nothing anywhere declares or publishes does not.
 */
const resolvableNames = () => {
    const names = declarationsIn(source);

    const dir = path.dirname(UTILS_PATH);

    for (const file of fs.readdirSync(dir)) {
        if (!file.endsWith(".js") || file === "utils.js") {
            continue;
        }

        const sibling = fs.readFileSync(path.join(dir, file), "utf8");

        for (const match of sibling.matchAll(
            /window\.([A-Za-z_$][\w$]*)\s*=/g
        )) {
            names.add(match[1]);
        }

        // `config.js` declares CONFIG at the top level and freezes it onto
        // window at the end; the declaration is the thing utils.js sees.
        if (file === "config.js") {
            declarationsIn(sibling).forEach((name) => names.add(name));
        }
    }

    return names;
};

/**
 * The shorthand properties of the `window.AppUtils = { ... }` literal.
 *
 * Only shorthand entries are collected. `key: value` pairs carry their own
 * expression and are not the failure mode this guards.
 */
const appUtilsExports = () => {
    const start = source.indexOf("window.AppUtils = {");

    if (start === -1) {
        return null;
    }

    const open = source.indexOf("{", start);

    let depth = 0;
    let end = -1;

    for (let i = open; i < source.length; i += 1) {
        if (source[i] === "{") depth += 1;
        else if (source[i] === "}") {
            depth -= 1;
            if (depth === 0) {
                end = i;
                break;
            }
        }
    }

    const body = source.slice(open + 1, end);

    return body
        .split("\n")
        .map((line) => line.replace(/\/\/.*$/, "").trim())
        .filter((line) => /^[A-Za-z_$][\w$]*,?$/.test(line))
        .map((line) => line.replace(/,$/, ""));
};

describe("frontend/scripts/utils.js exports", () => {
    const declared = resolvableNames();

    test("assigns window.AppUtils from one object literal", () => {
        expect(source).toContain("window.AppUtils = {");
    });

    test("declares every name it puts on AppUtils", () => {
        const exported = appUtilsExports();

        expect(exported).not.toBeNull();
        expect(exported.length).toBeGreaterThan(20);

        const missing = exported.filter((name) => !declared.has(name));

        expect(missing).toEqual([]);
    });

    test("declares every name it publishes on window", () => {
        const missing = [];

        for (const match of source.matchAll(
            /window\.([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\s*;/g
        )) {
            const value = match[2];

            if (["window", "document", "globalThis", "undefined"].includes(value)) {
                continue;
            }

            if (!declared.has(value)) {
                missing.push(`window.${match[1]} = ${value}`);
            }
        }

        expect(missing).toEqual([]);
    });

    test("declares reorderOrder, which #1641 exported without writing", () => {
        expect(declared.has("reorderOrder")).toBe(true);
        expect(source).toMatch(/\breorderOrder\s*=\s*async\s*\(/);
    });

    test("exports reorderOrder on both AppUtils and window", () => {
        // Both call sites are defensive -- `dashboard-orders.js` and
        // `ordersHistory.js` each try `AppUtils.reorderOrder` and then fall
        // back to the bare global -- so both surfaces have to carry it or the
        // "Buy Again" button silently does nothing.
        expect(appUtilsExports()).toContain("reorderOrder");
        expect(source).toContain("window.reorderOrder = reorderOrder;");
    });
});
