// backend/tests/syntaxGate.test.js
//
// Regression tests for #1297 and for the eight unparsable files fixed in the
// same PR (#1293, #1294, #1295, #1296).
//
// Eight files reached `main` in a state where `node --check` failed, four of
// them on the server's require path. These tests fail loudly if that ever
// happens again, and they also pin the behaviour of scripts/check-syntax.js
// itself -- a gate that silently stopped detecting failures would be worse
// than no gate at all.

const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const CHECKER = path.join(REPO_ROOT, 'scripts', 'check-syntax.js');

const IGNORED_DIRS = new Set([
    'node_modules', '.git', 'dist', 'build', 'coverage', '.next', '.vercel', 'vendor'
]);

/**
 * Recursively collect every `.js` file under `dir`.
 *
 * @param {string} dir
 * @param {string[]} [found]
 * @returns {string[]}
 */
function collectJsFiles(dir, found = []) {
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (error) {
        if (error.code === 'ENOENT') return found;
        throw error;
    }

    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (IGNORED_DIRS.has(entry.name)) continue;
            collectJsFiles(full, found);
        } else if (entry.isFile() && entry.name.endsWith('.js')) {
            found.push(full);
        }
    }
    return found;
}

/**
 * Run scripts/check-syntax.js over a path.
 *
 * The real checker is invoked rather than reimplementing parsing here: it
 * retries ESM syntax as a module before reporting, which a bare `vm.Script`
 * does not (frontend/scripts/ai-copywriter.js is a genuine ES module and would
 * otherwise be a false positive).
 *
 * @param {string} target - File or directory path.
 * @returns {{status: number, output: string}}
 */
function runChecker(target) {
    try {
        const output = execFileSync('node', [CHECKER, target], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        return { status: 0, output };
    } catch (error) {
        return {
            status: error.status,
            output: `${error.stdout || ''}${error.stderr || ''}`,
        };
    }
}

describe('repository parses', () => {
    const roots = ['backend', 'frontend', 'scripts']
        .map((r) => path.join(REPO_ROOT, r))
        .filter((r) => fs.existsSync(r));

    const files = roots.flatMap((r) => collectJsFiles(r));

    test('there are files to check', () => {
        expect(files.length).toBeGreaterThan(100);
    });

    test('every tracked .js file parses', () => {
        const { status, output } = runChecker(REPO_ROOT);
        expect(output).toContain('syntax check passed');
        expect(status).toBe(0);
    });

    // Each of these was unparsable on main. They are named explicitly so a
    // regression points straight at the issue that fixed it.
    test.each([
        ['backend/controllers/approvalController.js', 1293],
        ['backend/services/recommendationService.js', 1294],
        ['backend/routes/wishlistRoutes.js', 1295],
        ['frontend/scripts/product.js', 1296],
        ['frontend/scripts/product-cards-home.js', 1296],
        ['frontend/scripts/about.js', 1297],
        ['frontend/scripts/preservation.js', 1297],
        ['backend/services/agentBehaviourBaselineService.js', 1297],
    ])('%s parses (regression for #%i)', (relative) => {
        const full = path.join(REPO_ROOT, relative);
        expect(fs.existsSync(full)).toBe(true);

        try {
            new vm.Script(fs.readFileSync(full, 'utf8'), { filename: full });
        } catch (error) {
            throw new Error(`${relative} failed to parse: ${error.message}`);
        }
    });
});

describe('scripts/check-syntax.js', () => {
    let tmpDir;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'syntax-gate-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test('the checker exists and is executable by node', () => {
        expect(fs.existsSync(CHECKER)).toBe(true);
    });

    test('exits 0 for a directory of valid files', () => {
        fs.writeFileSync(path.join(tmpDir, 'ok.js'), 'const a = 1;\nfunction f() { return a; }\n');
        const { status, output } = runChecker(tmpDir);

        expect(status).toBe(0);
        expect(output).toContain('syntax check passed');
    });

    test('accepts classic browser scripts with top-level const', () => {
        // frontend/scripts/*.js are <script> files, not modules. A module-goal
        // parser would be wrong here, so this pins the script goal.
        fs.writeFileSync(
            path.join(tmpDir, 'classic.js'),
            'const elements = { a: 1 };\nfunction use() { return elements.a; }\n'
        );

        expect(runChecker(tmpDir).status).toBe(0);
    });

    // The three failure shapes actually seen on main.
    test.each([
        ['duplicate-declaration', 'const cache = new Map();\nconst cache = new Map();\n', 'has already been declared'],
        ['truncated-file', 'async function s() {\n  return {\n    timestamp\n', 'Unexpected end of input'],
        ['orphaned-ternary', 'function c() {\n  return `<div>\n    `\n    : ""\n  }`;\n}\n', 'Unexpected token'],
    ])('detects %s', (name, source, expected) => {
        fs.writeFileSync(path.join(tmpDir, `${name}.js`), source);
        const { status, output } = runChecker(tmpDir);

        expect(status).toBe(1);
        expect(output).toContain(expected);
        expect(output).toContain(`${name}.js`);
    });

    test('reports every failure in one pass, not just the first', () => {
        fs.writeFileSync(path.join(tmpDir, 'a-bad.js'), 'const x = 1;\nconst x = 2;\n');
        fs.writeFileSync(path.join(tmpDir, 'b-bad.js'), 'function open() {\n');
        fs.writeFileSync(path.join(tmpDir, 'c-good.js'), 'const ok = true;\n');

        const { status, output } = runChecker(tmpDir);

        expect(status).toBe(1);
        expect(output).toContain('a-bad.js');
        expect(output).toContain('b-bad.js');
        expect(output).toContain('2 of 3');
    });

    test('skips node_modules', () => {
        const nested = path.join(tmpDir, 'node_modules', 'pkg');
        fs.mkdirSync(nested, { recursive: true });
        fs.writeFileSync(path.join(nested, 'broken.js'), 'const y = ;\n');
        fs.writeFileSync(path.join(tmpDir, 'ok.js'), 'const ok = 1;\n');

        expect(runChecker(tmpDir).status).toBe(0);
    });
});
