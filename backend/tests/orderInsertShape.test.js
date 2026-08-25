// The shape of the INSERT statements order creation issues (#1521).
//
// `createOrderService` built its order INSERT from three lists kept in step by
// hand: the column names, the `?` placeholders and the arguments array. Three
// successive merges each added a column to two of the three, and what reached
// `main` was 28 columns, 23 placeholders and 28 arguments. MySQL refuses that
// outright -- ER_WRONG_VALUE_COUNT_ON_ROW -- so every checkout failed.
//
// Nothing caught it because every existing test of the order path mocks
// `services/order.service` wholesale (see the factory at the top of
// orderController.test.js), so the statement itself is never built. These
// tests build it.
//
// Three layers, deliberately:
//
//   1. `buildInsert` itself, because it is now the only thing that can put a
//      column and its value out of step.
//   2. The statement `createOrderService` actually issues, against a mocked
//      connection -- the assertion is on the SQL, since a mock accepts any
//      string and only a live MySQL would otherwise object.
//   3. A static sweep of every INSERT in the backend, so the same drift
//      appearing in a file this PR does not touch fails here too.

const path = require("path");
const fs = require("fs");

const {
    buildInsert,
    RAW_NOW
} = require("../services/order.service");

const BACKEND_DIR = path.resolve(__dirname, "..");

// ---------------------------------------------------------------------------
// 1. The builder
// ---------------------------------------------------------------------------

describe("buildInsert", () => {
    test("emits one placeholder per column and one parameter per placeholder", () => {
        const { sql, params } = buildInsert("orders", [
            ["id", "order-1"],
            ["total", 499],
            ["status", "pending"]
        ]);

        expect(sql).toBe(
            "INSERT INTO orders (id, total, status) VALUES (?, ?, ?)"
        );
        expect(params).toEqual(["order-1", 499, "pending"]);
        expect(countPlaceholders(sql)).toBe(params.length);
    });

    test("renders NOW() as SQL rather than passing it as a parameter", () => {
        const { sql, params } = buildInsert("orders", [
            ["id", "order-1"],
            ["created_at", RAW_NOW],
            ["updated_at", RAW_NOW]
        ]);

        expect(sql).toBe(
            "INSERT INTO orders (id, created_at, updated_at)"
            + " VALUES (?, NOW(), NOW())"
        );
        // The point of the marker: two of the three columns take no argument,
        // and the arguments array is shorter by exactly those two.
        expect(params).toEqual(["order-1"]);
    });

    test("stores the literal string 'NOW()' as a value, not as SQL", () => {
        // The marker is a Symbol precisely so a column whose value happens to
        // be the text NOW() is not silently turned into a timestamp.
        const { sql, params } = buildInsert("orders", [["notes", "NOW()"]]);

        expect(sql).toBe("INSERT INTO orders (notes) VALUES (?)");
        expect(params).toEqual(["NOW()"]);
    });

    test("keeps columns in the order they were given", () => {
        const { sql } = buildInsert("t", [
            ["b", 1],
            ["a", 2],
            ["c", 3]
        ]);

        expect(sql).toContain("(b, a, c)");
    });

    test("passes null and zero through as parameters", () => {
        // A falsy value is still a value. Skipping it would shift every
        // argument after it onto the wrong column, which is a quieter version
        // of the bug this file exists for.
        const { params } = buildInsert("t", [
            ["a", null],
            ["b", 0],
            ["c", ""],
            ["d", false]
        ]);

        expect(params).toEqual([null, 0, "", false]);
    });

    test("column count always equals placeholder count, for any input", () => {
        for (let size = 1; size <= 40; size += 1) {
            const pairs = Array.from({ length: size }, (_, index) => [
                `col_${index}`,
                index % 7 === 0 ? RAW_NOW : index
            ]);

            const { sql, params } = buildInsert("t", pairs);
            const { columns, values } = splitInsert(sql);

            expect(columns).toHaveLength(size);
            expect(values).toHaveLength(size);
            expect(countPlaceholders(sql)).toBe(params.length);
        }
    });
});

// ---------------------------------------------------------------------------
// 2. The statement order creation actually issues
// ---------------------------------------------------------------------------

describe("the orders INSERT createOrderService issues", () => {
    let createOrderService;
    let queries;

    const PRODUCT_ID = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
    const USER_ID = "3f2504e0-4f89-11d3-9a0c-0305e82c3302";

    const orderData = (total) => ({
        user_id: USER_ID,
        customer_name: "Asha Menon",
        customer_email: "asha@example.com",
        customer_phone: "9876543210",
        city: "Mumbai",
        state: "Maharashtra",
        zip: "400001",
        full_address: "12 Marine Drive",
        payment_method: "cash_on_delivery",
        items: [{ id: PRODUCT_ID, qty: 2 }],
        total
    });

    beforeEach(() => {
        jest.resetModules();

        queries = [];

        jest.doMock("../config/db", () => ({
            query: jest.fn().mockResolvedValue([[]]),
            getConnection: jest.fn()
        }));

        jest.doMock("../services/shipping.service", () => ({
            basketWeightKg: () => 1,
            quoteOptions: async () => ({
                selected: { code: "standard", label: "Standard", cost: 0 },
                options: [],
                freeShipping: true
            }),
            estimateDelivery: async () => ({ from: null, to: null })
        }));

        jest.doMock("../services/cartLifecycleService", () => ({
            markCartConverted: async () => ({ converted: false, cartId: null }),
            markCartConvertedById: async () => ({ converted: false, cartId: null })
        }));

        jest.doMock("../services/promo.service", () => ({
            validatePromo: async () => ({ valid: false, message: "no promo" })
        }));

        ({ createOrderService } = require("../services/order.service"));
    });

    afterEach(() => {
        jest.dontMock("../config/db");
        jest.dontMock("../services/shipping.service");
        jest.dontMock("../services/cartLifecycleService");
        jest.dontMock("../services/promo.service");
    });

    /**
     * A connection that records what it was asked to run and answers the few
     * reads order creation makes on the way through.
     */
    const mockConnection = () => ({
        query: jest.fn(async (sql, params) => {
            queries.push({ sql: String(sql), params });

            if (/FROM products/i.test(sql)) {
                return [
                    [
                        {
                            id: PRODUCT_ID,
                            name: "Cotton shirt",
                            price: 1000,
                            stock: 50,
                            image: "shirt.jpg",
                            weight: 0.5
                        }
                    ]
                ];
            }

            if (/FROM product_variants/i.test(sql)) {
                return [[]];
            }

            if (/^\s*UPDATE products/i.test(sql)) {
                return [{ affectedRows: 1 }];
            }

            return [{ affectedRows: 1, insertId: 1 }];
        })
    });

    const ordersInsert = () =>
        queries.find(({ sql }) => /INSERT INTO orders\b/i.test(sql));

    /**
     * Place one order and leave `queries` holding only that attempt.
     *
     * The submitted total has to agree with what the pricing engine makes of
     * the same basket, and the tax and shipping rules that decide it are
     * configuration. So the total is asked for rather than hardcoded: the
     * first attempt is refused and names the computed figure, and the second
     * uses it. A change to the tax rate then does not break a test that is
     * about the shape of an INSERT.
     */
    const placeOrder = async () => {
        try {
            await createOrderService(mockConnection(), orderData(1));
        } catch (error) {
            if (!error.computedTotal) throw error;

            queries = [];
            await createOrderService(
                mockConnection(),
                orderData(error.computedTotal)
            );
        }
    };

    test("names as many values as it names columns", async () => {
        await placeOrder();

        const insert = ordersInsert();
        expect(insert).toBeDefined();

        const { columns, values } = splitInsert(insert.sql);

        // This is the assertion that fails on the version of this file that
        // shipped: 28 columns against 23 values.
        expect(values).toHaveLength(columns.length);
    });

    test("supplies exactly one argument per placeholder", async () => {
        await placeOrder();

        const insert = ordersInsert();

        expect(insert.params).toHaveLength(countPlaceholders(insert.sql));
    });

    test("still writes the columns the order path depends on", async () => {
        await placeOrder();

        const { columns } = splitInsert(ordersInsert().sql);

        // Each of these arrived in a separate change, and each is one of the
        // columns the broken statement was silently dropping past the end of
        // its placeholder list.
        for (const column of [
            "order_number",
            "shipping_method",
            "estimated_delivery_from",
            "estimated_delivery",
            "recovery_token_id",
            "recovered_cart_id",
            "final_amount"
        ]) {
            expect(columns).toContain(column);
        }
    });

    test("writes NOW() as SQL for the timestamps", async () => {
        await placeOrder();

        const insert = ordersInsert();
        const { columns, values } = splitInsert(insert.sql);

        expect(values[columns.indexOf("created_at")]).toBe("NOW()");
        expect(values[columns.indexOf("updated_at")]).toBe("NOW()");
        expect(insert.params).not.toContain("NOW()");
    });

    test("puts each value under the column it was paired with", async () => {
        await placeOrder();

        const insert = ordersInsert();
        const { columns } = splitInsert(insert.sql);

        // Read the arguments back through the column list. A statement whose
        // counts happen to match can still be off by one, and that failure is
        // silent -- an email in the phone column, a total in the tax column --
        // where a count mismatch at least errors.
        const written = {};
        let argument = 0;

        for (const column of columns) {
            if (column === "created_at" || column === "updated_at") continue;
            written[column] = insert.params[argument];
            argument += 1;
        }

        expect(written.customer_email).toBe("asha@example.com");
        expect(written.customer_phone).toBe("9876543210");
        expect(written.zip).toBe("400001");
        expect(written.status).toBe("pending");
        expect(written.shipping_method).toBe("standard");
        expect(written.total).toBe(written.final_amount);
        expect(written.discount).toBe(written.discount_amount);
    });

    test("carries the recovery attribution the transaction resolved", async () => {
        // `recovery_token_id` and `recovered_cart_id` are two of the columns
        // that fell off the end of the placeholder list, and the call that
        // produces them lost its import in the same merge -- so this asserts
        // the whole path, not just that the statement parses.
        jest.resetModules();
        jest.doMock("../services/cartRecoveryAttributionService", () => ({
            resolveAttribution: async () => ({
                recoveryTokenId: 77,
                recoveredCartId: 88
            })
        }));
        ({ createOrderService } = require("../services/order.service"));

        await placeOrder();

        expect(ordersInsert().params).toEqual(
            expect.arrayContaining([77, 88])
        );

        jest.dontMock("../services/cartRecoveryAttributionService");
    });

    test("the order_items INSERT is the same shape", async () => {
        await placeOrder();

        const insert = queries.find(({ sql }) =>
            /INSERT INTO order_items\b/i.test(sql)
        );

        expect(insert).toBeDefined();

        const { columns, values } = splitInsert(insert.sql);

        expect(values).toHaveLength(columns.length);
        expect(insert.params).toHaveLength(countPlaceholders(insert.sql));
    });
});

// ---------------------------------------------------------------------------
// 3. Every other INSERT in the backend
// ---------------------------------------------------------------------------

describe("INSERT statements across the backend", () => {
    test("every INSERT names as many values as columns", () => {
        const offenders = [];

        for (const file of collectSourceFiles(BACKEND_DIR)) {
            const source = fs.readFileSync(file, "utf8");

            for (const statement of findInsertStatements(source)) {
                for (const row of statement.rows) {
                    if (row.length === statement.columns.length) continue;

                    offenders.push(
                        `${path.relative(BACKEND_DIR, file)}:${statement.line}`
                        + ` — INSERT INTO ${statement.table}`
                        + ` has ${statement.columns.length} columns`
                        + ` and ${row.length} values`
                    );
                }
            }
        }

        expect(offenders).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Split an INSERT into its column list and its first row of values.
 *
 * @param {string} sql
 * @returns {{ columns: string[], values: string[] }}
 */
function splitInsert(sql) {
    const statement = findInsertStatements(sql)[0];

    if (!statement) {
        throw new Error(`Not an INSERT this helper understands:\n${sql}`);
    }

    return { columns: statement.columns, values: statement.rows[0] };
}

/**
 * @param {string} sql
 * @returns {number} how many `?` parameters the statement takes
 */
function countPlaceholders(sql) {
    return (sql.match(/\?/g) || []).length;
}

/**
 * Pull every INSERT out of a chunk of source or SQL.
 *
 * Statements whose column list or values are assembled at runtime (a batch
 * insert built with `.map(() => "(?, ?)")`, for instance) are skipped: their
 * counts are not knowable by reading, and the ones that build both sides from
 * the same array cannot drift in the first place.
 *
 * @param {string} source
 * @returns {Array<{table: string, columns: string[], rows: string[][], line: number}>}
 */
function findInsertStatements(source) {
    const statements = [];
    const pattern = /INSERT\s+(?:IGNORE\s+)?INTO\s+`?(\w+)`?\s*\(([^)]*)\)\s*VALUES\s*/gi;

    for (const match of source.matchAll(pattern)) {
        const columnText = match[2];

        // Interpolated column list — not statically checkable.
        if (columnText.includes("${")) continue;

        const columns = columnText
            .split(",")
            .map((column) => column.trim().replace(/`/g, ""))
            .filter(Boolean);

        if (!columns.length) continue;

        const rows = readValueRows(source, match.index + match[0].length);

        if (!rows) continue;

        statements.push({
            table: match[1],
            columns,
            rows,
            line: source.slice(0, match.index).split("\n").length
        });
    }

    return statements;
}

/**
 * Read the `(...), (...)` row groups that follow a VALUES keyword.
 *
 * Returns null when the statement is not statically readable — an interpolated
 * row group, or a group that never closes because the literal ended.
 *
 * @param {string} source
 * @param {number} start - index of the first `(` after VALUES
 * @returns {string[][]|null}
 */
function readValueRows(source, start) {
    const rows = [];
    let index = start;

    while (index < source.length) {
        while (index < source.length && /[\s,]/.test(source[index])) index += 1;
        if (source[index] !== "(") break;

        let depth = 0;
        let end = index;

        for (; end < source.length; end += 1) {
            if (source[end] === "(") depth += 1;
            else if (source[end] === ")") {
                depth -= 1;
                if (depth === 0) break;
            }
            // A statement that runs off the end of its own literal is not one
            // we can read; bail rather than guess.
            else if (source[end] === "`" || source[end] === ";") return null;
        }

        if (depth !== 0) return null;

        const body = source.slice(index + 1, end);

        if (body.includes("${")) return null;

        rows.push(splitTopLevel(body));

        index = end + 1;

        // Anything other than another row group ends the VALUES clause.
        let lookahead = index;
        while (lookahead < source.length && /\s/.test(source[lookahead])) {
            lookahead += 1;
        }
        if (source[lookahead] !== ",") break;
        index = lookahead + 1;
    }

    return rows.length ? rows : null;
}

/**
 * Split a comma-separated value list, ignoring commas inside call parentheses
 * so `COALESCE(a, b)` counts as one value rather than two.
 *
 * @param {string} body
 * @returns {string[]}
 */
function splitTopLevel(body) {
    const parts = [];
    let depth = 0;
    let current = "";

    for (const character of body) {
        if (character === "(") depth += 1;
        if (character === ")") depth -= 1;

        if (character === "," && depth === 0) {
            parts.push(current.trim());
            current = "";
            continue;
        }

        current += character;
    }

    if (current.trim()) parts.push(current.trim());

    return parts;
}

/**
 * Every backend source file, skipping dependencies, coverage output and the
 * tests themselves.
 *
 * @param {string} directory
 * @param {string[]} [collected]
 * @returns {string[]}
 */
function collectSourceFiles(directory, collected = []) {
    const SKIP = new Set(["node_modules", "coverage", "tests", "logs", ".git"]);

    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (SKIP.has(entry.name)) continue;

        const full = path.join(directory, entry.name);

        if (entry.isDirectory()) {
            collectSourceFiles(full, collected);
        } else if (entry.name.endsWith(".js")) {
            collected.push(full);
        }
    }

    return collected;
}
