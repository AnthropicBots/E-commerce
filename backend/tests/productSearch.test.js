jest.mock("../config/db", () => ({ query: jest.fn() }));

const db = require("../config/db");
const { getProducts } = require("../controllers/productController");

function mockRes() {
    return {
        statusCode: null,
        body: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(payload) {
            this.body = payload;
            return this;
        }
    };
}

function ftError() {
    const err = new Error("Can't find FULLTEXT index matching the column list");
    err.code = "ER_FT_MATCHING_KEY_NOT_FOUND";
    return err;
}

// What MySQL raises when a column named in the statement exists on more than
// one of the joined tables. `products` and `categories` both have `name` and
// `description`, which is what the unqualified MATCH() list used to hit
// (#1544).
function ambiguousColumnError() {
    const err = new Error("Column 'name' in field list is ambiguous");
    err.code = "ER_NON_UNIQ_ERROR";
    err.errno = 1052;
    return err;
}

function calls() {
    return db.query.mock.calls.map(([sql]) => sql);
}

// The four columns of `ft_product_search`.
const SEARCHABLE_COLUMNS = [
    "name",
    "description",
    "short_description",
    "meta_keywords"
];

describe("getProducts — full-text search", () => {
    beforeEach(() => {
        db.query.mockReset();
    });

    test("uses the FULLTEXT index (MATCH...AGAINST) for both count and product queries", async () => {
        db.query.mockImplementation(async (sql) => {
            if (/SELECT COUNT/.test(sql)) return [[{ total: 3 }]];
            return [[{ id: 1 }]];
        });
        const res = mockRes();

        await getProducts({ query: { search: "wireless mouse" } }, res);

        expect(res.statusCode).toBe(200);
        const sqls = calls();
        expect(sqls.every((sql) => /MATCH\(.*\) AGAINST \(\? IN BOOLEAN MODE\)/.test(sql))).toBe(true);
        expect(sqls.some((sql) => /LIKE/.test(sql))).toBe(false);
    });

    test("passes a boolean-mode expression with required + prefix tokens", async () => {
        db.query.mockImplementation(async (sql) => {
            if (/SELECT COUNT/.test(sql)) return [[{ total: 0 }]];
            return [[]];
        });
        const res = mockRes();

        await getProducts({ query: { search: "red shoes" } }, res);

        const [, params] = db.query.mock.calls[0];
        expect(params).toContain("+red* +shoes*");
    });

    test("falls back to LIKE when the FULLTEXT index is unavailable", async () => {
        db.query.mockImplementation(async (sql) => {
            if (/MATCH/.test(sql)) throw ftError();
            if (/SELECT COUNT/.test(sql)) return [[{ total: 1 }]];
            return [[{ id: 7 }]];
        });
        const res = mockRes();

        await getProducts({ query: { search: "laptop" } }, res);

        expect(res.statusCode).toBe(200);
        expect(res.body.total).toBe(1);
        const sqls = calls();
        expect(sqls.some((sql) => /LIKE/.test(sql))).toBe(true);
    });

    // ------------------------------------------------------------------
    // #1544
    // ------------------------------------------------------------------

    test("qualifies every MATCH() column with the products alias", async () => {
        db.query.mockImplementation(async (sql) => {
            if (/SELECT COUNT/.test(sql)) return [[{ total: 1 }]];
            return [[{ id: 1 }]];
        });
        const res = mockRes();

        await getProducts({ query: { search: "shoes" } }, res);

        expect(res.statusCode).toBe(200);

        const matchSqls = calls().filter((sql) => /MATCH\(/.test(sql));
        expect(matchSqls.length).toBeGreaterThan(0);

        for (const sql of matchSqls) {
            const [, columnList] = sql.match(/MATCH\(([^)]*)\)/);

            // Every column carries the alias. `categories` has `name` and
            // `description` too, so an unqualified one is ER_NON_UNIQ_ERROR.
            for (const column of SEARCHABLE_COLUMNS) {
                expect(columnList).toContain(`p.${column}`);
            }

            expect(
                columnList
                    .split(",")
                    .every((column) => column.trim().startsWith("p."))
            ).toBe(true);
        }
    });

    test("the MATCH() column list is exactly the ft_product_search index", async () => {
        db.query.mockImplementation(async (sql) => {
            if (/SELECT COUNT/.test(sql)) return [[{ total: 0 }]];
            return [[]];
        });
        const res = mockRes();

        await getProducts({ query: { search: "kettle" } }, res);

        const [matchSql] = calls().filter((sql) => /MATCH\(/.test(sql));
        const [, columnList] = matchSql.match(/MATCH\(([^)]*)\)/);

        // Order and membership both matter: MySQL only uses a FULLTEXT index
        // when the MATCH() list matches the index definition.
        expect(columnList.split(",").map((column) => column.trim())).toEqual(
            SEARCHABLE_COLUMNS.map((column) => `p.${column}`)
        );
    });

    test("an ambiguous-column error degrades to LIKE instead of 500-ing", async () => {
        db.query.mockImplementation(async (sql) => {
            if (/MATCH/.test(sql)) throw ambiguousColumnError();
            if (/SELECT COUNT/.test(sql)) return [[{ total: 2 }]];
            return [[{ id: 3 }, { id: 4 }]];
        });
        const res = mockRes();

        await getProducts({ query: { search: "mixer" } }, res);

        expect(res.statusCode).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.total).toBe(2);
        expect(calls().some((sql) => /LIKE/.test(sql))).toBe(true);
    });

    test("the LIKE fallback searches the same columns the index does", async () => {
        db.query.mockImplementation(async (sql) => {
            if (/MATCH/.test(sql)) throw ftError();
            if (/SELECT COUNT/.test(sql)) return [[{ total: 1 }]];
            return [[{ id: 9 }]];
        });
        const res = mockRes();

        await getProducts({ query: { search: "waterproof" } }, res);

        const likeSqls = calls().filter((sql) => /LIKE/.test(sql));
        expect(likeSqls.length).toBeGreaterThan(0);

        for (const sql of likeSqls) {
            for (const column of SEARCHABLE_COLUMNS) {
                expect(sql).toMatch(new RegExp(`p\\.${column} LIKE \\?`));
            }
        }
    });

    test("the LIKE fallback binds the wildcard term once per searched column", async () => {
        db.query.mockImplementation(async (sql) => {
            if (/MATCH/.test(sql)) throw ftError();
            if (/SELECT COUNT/.test(sql)) return [[{ total: 0 }]];
            return [[]];
        });
        const res = mockRes();

        await getProducts({ query: { search: "cotton" } }, res);

        const [, params] = db.query.mock.calls.find(([sql]) => /LIKE/.test(sql));
        const bound = params.filter((value) => value === "%cotton%");

        expect(bound).toHaveLength(SEARCHABLE_COLUMNS.length);
    });

    test("the LIKE fallback keeps its OR group bracketed so other filters still AND", async () => {
        db.query.mockImplementation(async (sql) => {
            if (/MATCH/.test(sql)) throw ftError();
            if (/SELECT COUNT/.test(sql)) return [[{ total: 0 }]];
            return [[]];
        });
        const res = mockRes();

        await getProducts(
            { query: { search: "lamp", minPrice: "100", maxPrice: "500" } },
            res
        );

        const [sql] = db.query.mock.calls.find(([text]) => /LIKE/.test(text));

        // Unbracketed, `a OR b AND price >= ?` binds the price filter to the
        // last LIKE only and the other three columns ignore it entirely.
        expect(sql).toMatch(/\(\s*p\.name LIKE \?[\s\S]*?\)\s*AND/);
        expect(sql).toMatch(/p\.price >= \?/);
    });

    test("LIKE special characters in the search term stay escaped in the fallback", async () => {
        db.query.mockImplementation(async (sql) => {
            if (/MATCH/.test(sql)) throw ftError();
            if (/SELECT COUNT/.test(sql)) return [[{ total: 0 }]];
            return [[]];
        });
        const res = mockRes();

        await getProducts({ query: { search: "50% off" } }, res);

        const [, params] = db.query.mock.calls.find(([sql]) => /LIKE/.test(sql));

        expect(params.some((value) => value === "%50\\% off%")).toBe(true);
    });

    test("does not add a search predicate when no search term is given", async () => {
        db.query.mockImplementation(async (sql) => {
            if (/SELECT COUNT/.test(sql)) return [[{ total: 5 }]];
            return [[{ id: 1 }]];
        });
        const res = mockRes();

        await getProducts({ query: {} }, res);

        const sqls = calls();
        expect(sqls.some((sql) => /MATCH|LIKE/.test(sql))).toBe(false);
    });

    test("keeps category filter and search predicate together (count mirrors product query)", async () => {
        db.query.mockImplementation(async (sql) => {
            if (/SELECT COUNT/.test(sql)) return [[{ total: 2 }]];
            return [[{ id: 1 }]];
        });
        const res = mockRes();

        await getProducts({ query: { search: "toy car", category: "toys" } }, res);

        const [countSql] = db.query.mock.calls.find(([sql]) => /SELECT COUNT/.test(sql));
        const [productSql] = db.query.mock.calls.find(([sql]) => /FROM products[\s\S]*LIMIT/.test(sql));
        for (const sql of [countSql, productSql]) {
            expect(sql).toMatch(/MATCH\(.*\) AGAINST/);
            expect(sql).toMatch(/IN \(/); // category IN (...) clause
        }
    });
});
