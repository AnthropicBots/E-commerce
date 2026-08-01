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

function calls() {
    return db.query.mock.calls.map(([sql]) => sql);
}

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
