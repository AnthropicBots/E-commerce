// The IP blocklist gate.
//
// blockSuspiciousIPs is the thing that enforces `blocked_ips`, the table 0011
// declares and 0012 ships a stored procedure for writing to. It never enforced
// anything: `const { db } = require("../config/db")` bound undefined, because
// config/db exports the pool itself rather than a `db` property, so the first
// statement threw a TypeError on every call and the catch fell through to
// next() (#1675).
//
// The failure mode is the dangerous one -- it fails open, silently, 100% of the
// time, and the only symptom is a console line per request. So these tests
// assert the gate actually closes, and that the one case where failing open is
// correct still does.
//
// The predicate is checked too. It used to be a fixed
// `blocked_at > DATE_SUB(NOW(), INTERVAL 7 DAY)` window, which ignored
// expires_at, is_permanent, unblocked_at and deleted_at -- every column the
// table keeps to describe whether a block is live.

jest.mock("../config/db", () => {
    const query = jest.fn();
    const pool = { query, getConnection: jest.fn() };
    pool.promise = pool;
    return pool;
});

jest.mock("../utils/logger", () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
}));

jest.mock("../services/aiCrawlerVerificationService", () => ({
    verifyCrawler: jest.fn(),
    logVerification: jest.fn(),
    checkIPReputation: jest.fn(),
    blockIP: jest.fn()
}));

const db = require("../config/db");
const logger = require("../utils/logger");
const verification = require("../services/aiCrawlerVerificationService");
const { blockSuspiciousIPs } = require("../middleware/aiCrawlerMiddleware");

const makeRes = () => {
    const res = { statusCode: null, body: null };
    res.status = (code) => {
        res.statusCode = code;
        return res;
    };
    res.json = (payload) => {
        res.body = payload;
        return res;
    };
    return res;
};

const run = async (req = { ip: "203.0.113.9" }) => {
    const res = makeRes();
    let passed = false;

    await blockSuspiciousIPs(req, res, () => {
        passed = true;
    });

    return { passed, status: res.statusCode, body: res.body };
};

/** No matching block row, and a clean reputation. */
const cleanAddress = () => {
    db.query.mockResolvedValue([[]]);
    verification.checkIPReputation.mockResolvedValue({ score: 90 });
};

beforeEach(() => {
    jest.clearAllMocks();
    cleanAddress();
});

// ---------------------------------------------------------------------------
// The regression
// ---------------------------------------------------------------------------

describe("the pool the middleware reaches for", () => {
    test("config/db has no `db` property to destructure", () => {
        const module = require("../config/db");

        expect(module.db).toBeUndefined();
        expect(module.promise).toBeDefined();
    });

    test("the blocklist query actually runs", async () => {
        // The defect: this threw before reaching the database at all, so
        // db.query was never called and the request sailed through.
        await run();

        expect(db.query).toHaveBeenCalledTimes(1);
        expect(db.query.mock.calls[0][0]).toMatch(/FROM\s+blocked_ips/);
    });

    test("the reputation gate is reached", async () => {
        // Nothing after the first statement used to run, so this was dead too.
        await run();

        expect(verification.checkIPReputation).toHaveBeenCalledWith("203.0.113.9");
    });
});

// ---------------------------------------------------------------------------
// Closing
// ---------------------------------------------------------------------------

describe("a blocked address", () => {
    beforeEach(() => {
        db.query.mockResolvedValue([
            [{ reason: "Poor reputation score", blocked_at: "2026-08-20 10:00:00" }]
        ]);
    });

    test("is refused with 403", async () => {
        const result = await run();

        expect(result.passed).toBe(false);
        expect(result.status).toBe(403);
        expect(result.body.error).toBe("IP address is blocked");
    });

    test("is told why and since when", async () => {
        const result = await run();

        expect(result.body.reason).toBe("Poor reputation score");
        expect(result.body.blocked_at).toBe("2026-08-20 10:00:00");
    });

    test("short-circuits before the reputation lookup", async () => {
        await run();

        expect(verification.checkIPReputation).not.toHaveBeenCalled();
    });
});

describe("an address with a poor reputation", () => {
    beforeEach(() => {
        db.query.mockResolvedValue([[]]);
        verification.checkIPReputation.mockResolvedValue({ score: 5 });
        verification.blockIP.mockResolvedValue(undefined);
    });

    test("is refused with 403", async () => {
        const result = await run();

        expect(result.passed).toBe(false);
        expect(result.status).toBe(403);
        expect(result.body.reputationScore).toBe(5);
    });

    test("is added to the blocklist", async () => {
        await run();

        expect(verification.blockIP).toHaveBeenCalledWith(
            "203.0.113.9",
            "Poor reputation score"
        );
    });
});

// ---------------------------------------------------------------------------
// Opening
// ---------------------------------------------------------------------------

describe("a clean address", () => {
    test("is passed through", async () => {
        const result = await run();

        expect(result.passed).toBe(true);
        expect(result.status).toBeNull();
    });

    test("is not added to the blocklist", async () => {
        await run();

        expect(verification.blockIP).not.toHaveBeenCalled();
    });

    test("a score exactly on the threshold is not blocked", async () => {
        verification.checkIPReputation.mockResolvedValue({ score: 20 });

        expect((await run()).passed).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// The predicate
// ---------------------------------------------------------------------------

describe("the blocklist query reads the columns the table keeps", () => {
    const sqlOf = async () => {
        await run();
        return db.query.mock.calls[0][0];
    };

    test("respects expires_at rather than a fixed window", async () => {
        // `blocked_at > DATE_SUB(NOW(), INTERVAL 7 DAY)` made every block last
        // exactly seven days regardless of what it was set to.
        const sql = await sqlOf();

        expect(sql).toMatch(/expires_at/);
        expect(sql).not.toMatch(/blocked_at\s*>\s*DATE_SUB/i);
    });

    test("treats a block with no expiry as live", async () => {
        // NULL expires_at means 'no expiry set'. Comparing it would drop the
        // row, since any comparison with NULL is NULL.
        expect(await sqlOf()).toMatch(/expires_at IS NULL/);
    });

    test("honours a permanent block", async () => {
        expect(await sqlOf()).toMatch(/is_permanent/);
    });

    test("releases an address that was explicitly unblocked", async () => {
        expect(await sqlOf()).toMatch(/unblocked_at IS NULL/);
    });

    test("ignores soft-deleted rows", async () => {
        expect(await sqlOf()).toMatch(/deleted_at IS NULL/);
    });

    test("binds the address rather than interpolating it", async () => {
        await run();

        const [sql, params] = db.query.mock.calls[0];

        expect(sql).toMatch(/ip_address = \?/);
        expect(params).toEqual(["203.0.113.9"]);
    });
});

// ---------------------------------------------------------------------------
// Failing open, on purpose this time
// ---------------------------------------------------------------------------

describe("when the lookup fails", () => {
    beforeEach(() => {
        db.query.mockRejectedValue(new Error("ECONNREFUSED"));
    });

    test("the request is still served", async () => {
        // Deliberate: an unreachable database must not take the site down.
        const result = await run();

        expect(result.passed).toBe(true);
    });

    test("the failure is logged through the project logger", async () => {
        await run();

        expect(logger.error).toHaveBeenCalledTimes(1);
        expect(logger.error.mock.calls[0][0]).toMatch(/203\.0\.113\.9/);
    });
});

describe("an address that cannot be determined", () => {
    test("falls back rather than throwing", async () => {
        const result = await run({});

        expect(result.passed).toBe(true);
        expect(db.query.mock.calls[0][1]).toEqual(["unknown"]);
    });

    test("reads req.connection.remoteAddress when req.ip is absent", async () => {
        await run({ connection: { remoteAddress: "198.51.100.4" } });

        expect(db.query.mock.calls[0][1]).toEqual(["198.51.100.4"]);
    });
});
