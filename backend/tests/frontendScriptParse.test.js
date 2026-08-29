// Every frontend script has to parse, and shop.js has to keep exactly one
// initialization block.
//
// `frontend/scripts/shop.js` reached `main` unparsable (#1696). The responsive
// refactor duplicated the tail of the file and interleaved the two copies,
// leaving an unclosed arrow body, a second half-finished `DOMContentLoaded`
// registration, orphaned statements referring to a `filterUrlParams` that was
// no longer declared, and an IntersectionObserver options object passed as the
// third argument to `addEventListener`. The browser answered with
// `Uncaught SyntaxError: Unexpected end of input` and ran nothing at all on
// shop.html: no product fetch, no filters, no sort, no infinite scroll.
//
// `scripts/check-syntax.js` does catch the parse failure, but it is a separate
// npm script and CI runs it as its own step, so a red parse is easy to read as
// "the syntax job is flaky" rather than "the shop page is dead". Pinning it in
// the jest suite puts the failure next to the behaviour it breaks.
//
// The parse goal here matches check-syntax.js: `frontend/scripts/**` are
// classic <script> files, not modules, so they are compiled with `vm.Script`,
// which uses V8's script goal -- the same goal a <script> tag and CommonJS use.

const fs = require("fs");
const path = require("path");
const vm = require("vm");

// Messages V8 emits when module-only syntax meets the script goal.
const ESM_MARKER =
    /^(Cannot use import statement|Unexpected token 'export'|await is only valid)/;

const SCRIPTS_DIR = path.join(__dirname, "..", "..", "frontend", "scripts");

/** Every `.js` file the shop pages can load, relative to frontend/scripts. */
const scriptFiles = fs
    .readdirSync(SCRIPTS_DIR)
    .filter((name) => name.endsWith(".js"))
    .sort();

const readScript = (name) =>
    fs.readFileSync(path.join(SCRIPTS_DIR, name), "utf8");

/**
 * Compile `source` the way a browser compiles a classic script.
 *
 * @param {string} source - File contents.
 * @param {string} filename - Reported in the thrown error.
 * @returns {Error|null} The SyntaxError, or null when it parses.
 */
function parseFailure(source, filename) {
    try {
        // `new vm.Script` compiles but never runs the code.
        new vm.Script(source, { filename });
        return null;
    } catch (error) {
        // `instanceof` is unreliable here: jest runs each suite in its own vm
        // context, so a SyntaxError raised by `new vm.Script` is not an
        // instance of *this* realm's SyntaxError. Match on the name instead.
        if (error.name !== "SyntaxError") throw error;

        // A handful of files under frontend/scripts are genuine ES modules.
        // The script goal rejects `import`/`export` outright, so retry them the
        // way scripts/check-syntax.js does before calling the file broken.
        if (typeof vm.SourceTextModule === "function") {
            try {
                new vm.SourceTextModule(source, { identifier: filename });
                return null;
            } catch (moduleError) {
                if (moduleError.name !== "SyntaxError") throw moduleError;
                return moduleError;
            }
        }

        // vm.SourceTextModule needs --experimental-vm-modules, which the jest
        // config does not pass. Without it, unambiguous ESM markers are
        // accepted rather than failing a file this test cannot judge.
        if (ESM_MARKER.test(error.message)) {
            return null;
        }

        return error;
    }
}

describe("frontend scripts parse", () => {
    test("there is at least one script to check", () => {
        // A glob that silently matches nothing is a test that silently passes.
        expect(scriptFiles.length).toBeGreaterThan(0);
    });

    test.each(scriptFiles)("%s parses as a classic script", (name) => {
        const failure = parseFailure(readScript(name), name);

        expect(failure && `${name}: ${failure.message}`).toBeNull();
    });
});

describe("shop.js has one initialization block", () => {
    const shopJs = readScript("shop.js");

    test("exactly one DOMContentLoaded listener is registered", () => {
        // Two registrations is the shape the duplication took, and the second
        // copy is where the unbalanced braces came from. One handler also
        // means the element lookups happen once, in a known order, before
        // fetchProducts() runs.
        const registrations = shopJs.match(/"DOMContentLoaded"/g) || [];

        expect(registrations).toHaveLength(1);
    });

    test("no statement references an undeclared filterUrlParams", () => {
        // `filterUrlParams` is declared inside the clear-filters listener. The
        // broken file had `filterUrlParams.delete(...)` stranded in the second
        // handler, several scopes away from any declaration -- a ReferenceError
        // waiting for the first click.
        const declarations = (shopJs.match(/const\s+filterUrlParams\s*=/g) || []).length;
        const uses = (shopJs.match(/\bfilterUrlParams\b/g) || []).length;

        expect(declarations).toBe(1);
        // One declaration plus its uses inside the one listener that declares it.
        expect(uses).toBeGreaterThan(1);
    });

    test("addEventListener is never handed IntersectionObserver options", () => {
        // `{ rootMargin: ... }` is an observer option. Passing it as the third
        // argument to addEventListener is silently accepted by the browser --
        // it is read as an options bag with no recognised keys -- so this only
        // ever showed up as a listener that looked wired and was not.
        const misuse = /addEventListener\([\s\S]{0,600}?rootMargin/;

        expect(misuse.test(shopJs)).toBe(false);
    });
});

describe("clearing filters clears the URL too", () => {
    const shopJs = readScript("shop.js");

    // A shopper arriving from the mega menu carries ?category=&subcategory= and
    // has filters.megaCategory/megaSubcategory seeded from them. Resetting only
    // the checkboxes leaves both in place, so the next applyFilters() re-applies
    // the filter the button just cleared and a reload brings it back. These
    // four steps were all inside the fragment the merge stranded.
    const listener = shopJs.slice(shopJs.indexOf("active-clear-filters"));

    test.each([
        ['strips "category" from the query string', /filterUrlParams\.delete\(\s*"category"\s*\)/],
        ['strips "subcategory" from the query string', /filterUrlParams\.delete\(\s*"subcategory"\s*\)/],
        ["rewrites the address bar", /window\.history\.replaceState\(/],
        ["clears filters.megaCategory", /filters\.megaCategory\s*=\s*""/],
        ["clears filters.megaSubcategory", /filters\.megaSubcategory\s*=\s*""/],
        ["re-runs the query", /applyFilters\(\s*\{\s*resetPage:\s*true\s*\}\s*\)/],
    ])("the clear-filters handler %s", (_label, pattern) => {
        expect(pattern.test(listener)).toBe(true);
    });
});
