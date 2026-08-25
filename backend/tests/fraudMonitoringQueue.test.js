// The medium-risk signup queue.
//
// detectSyntheticIdentity blocks a critical signup, challenges a high one, and
// lets a medium one through -- queued for review. The queue is the whole of the
// record for that middle band: nothing else on the signup path writes a row for
// it, so if the write is lost, the decision is lost.
//
// It was lost. flagForMonitoring inserted into `fraud_monitoring_queue`, which
// no migration created, so every call failed with ER_NO_SUCH_TABLE and the
// catch swallowed it into a console.error (#1674). The signup succeeded, the
// queue stayed empty, and nothing anywhere said so.
//
// Two things are checked here: that the table the code writes to is actually
// declared in the migration sequence, and that the write behaves -- shape,
// non-fatality, and a diagnosable message when it does fail.

const fs = require("fs");
const path = require("path");

jest.mock("../config/db", () => {
    const query = jest.fn();
    const pool = { query, getConnection: jest.fn() };
    // fraudDetectionMiddleware reaches the pool through `.promise`.
    pool.promise = pool;
    return pool;
});

jest.mock("../utils/logger", () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
}));

jest.mock("../config/redis", () => ({ eval: jest.fn() }));

const db = require("../config/db");
const logger = require("../utils/logger");
const { flagForMonitoring } = require("../middleware/fraudDetectionMiddleware");

const MIGRATIONS_DIR = path.join(__dirname, "..", "..", "migrations");

const allMigrations = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .map((name) => fs.readFileSync(path.join(MIGRATIONS_DIR, name), "utf8"))
    .join("\n");

const detection = {
    riskScore: 55,
    riskLevel: "medium",
    flags: ["disposable_email_domain", "no_device_id"]
};

const makeReq = (overrides = {}) => ({
    body: { email: "shopper@example.com" },
    ip: "203.0.113.9",
    ...overrides
});

beforeEach(() => {
    jest.clearAllMocks();
    db.query.mockResolvedValue([{ insertId: 1 }]);
});

// ---------------------------------------------------------------------------
// The gap itself
// ---------------------------------------------------------------------------

describe("the table the middleware writes to", () => {
    test("is declared by a migration", () => {
        // The regression. Before 0049 this matched nothing, and every insert
        // failed with ER_NO_SUCH_TABLE.
        expect(allMigrations).toMatch(
            /CREATE TABLE IF NOT EXISTS fraud_monitoring_queue/
        );
    });

    test("declares every column the INSERT names", () => {
        const table = allMigrations.match(
            /CREATE TABLE IF NOT EXISTS fraud_monitoring_queue([\s\S]*?)ENGINE=/
        );

        expect(table).not.toBeNull();

        for (const column of [
            "email",
            "risk_score",
            "risk_level",
            "flags",
            "ip_address",
            "created_at"
        ]) {
            expect(table[1]).toMatch(new RegExp(`\\b${column}\\b`));
        }
    });

    test("can record that an entry was reviewed", () => {
        // Without these a queue is only a log -- there is no way to take an
        // entry off it, so the next read returns everything ever queued.
        const table = allMigrations.match(
            /CREATE TABLE IF NOT EXISTS fraud_monitoring_queue([\s\S]*?)ENGINE=/
        )[1];

        expect(table).toMatch(/reviewed_at/);
        expect(table).toMatch(/reviewed_by/);
    });

    test("indexes the pending read", () => {
        const table = allMigrations.match(
            /CREATE TABLE IF NOT EXISTS fraud_monitoring_queue([\s\S]*?)ENGINE=/
        )[1];

        expect(table).toMatch(/INDEX\s+idx_fraud_queue_pending/);
    });

    test("describes a risk band the same way 0014 does", () => {
        // synthetic_identity_detections already declares this ENUM. Two tables
        // in the same feature disagreeing about the vocabulary is how a band
        // becomes unqueryable across both.
        const table = allMigrations.match(
            /CREATE TABLE IF NOT EXISTS fraud_monitoring_queue([\s\S]*?)ENGINE=/
        )[1];

        expect(table).toMatch(/ENUM\('low', 'medium', 'high', 'critical'\)/);
    });

    test("takes the next free migration number", () => {
        const numbers = fs
            .readdirSync(MIGRATIONS_DIR)
            .filter((name) => name.endsWith(".sql"))
            .map((name) => name.slice(0, 4));

        expect(new Set(numbers).size).toBe(numbers.length);
        expect(numbers).toContain("0049");
    });
});

// ---------------------------------------------------------------------------
// The write
// ---------------------------------------------------------------------------

describe("flagForMonitoring", () => {
    test("inserts into fraud_monitoring_queue", async () => {
        await flagForMonitoring(makeReq(), detection);

        expect(db.query).toHaveBeenCalledTimes(1);

        const [sql] = db.query.mock.calls[0];
        expect(sql).toMatch(/INSERT INTO fraud_monitoring_queue/);
    });

    test("binds one value per placeholder", async () => {
        await flagForMonitoring(makeReq(), detection);

        const [sql, params] = db.query.mock.calls[0];
        const placeholders = (sql.match(/\?/g) || []).length;

        expect(params).toHaveLength(placeholders);
    });

    test("records the address, the score, the level and the flags", async () => {
        await flagForMonitoring(makeReq(), detection);

        const [, params] = db.query.mock.calls[0];

        expect(params[0]).toBe("shopper@example.com");
        expect(params[1]).toBe(55);
        expect(params[2]).toBe("medium");
        expect(JSON.parse(params[3])).toEqual(detection.flags);
        expect(params[4]).toBe("203.0.113.9");
    });

    test("serialises the flags, since the column is JSON", async () => {
        await flagForMonitoring(makeReq(), detection);

        const [, params] = db.query.mock.calls[0];

        expect(typeof params[3]).toBe("string");
    });

    test("falls back to 'unknown' when there is no address to record", async () => {
        await flagForMonitoring(makeReq({ ip: undefined }), detection);

        const [, params] = db.query.mock.calls[0];

        expect(params[4]).toBe("unknown");
    });

    test("reports success", async () => {
        await expect(flagForMonitoring(makeReq(), detection)).resolves.toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Failing the way it should
// ---------------------------------------------------------------------------

describe("when the queue write fails", () => {
    const failing = () => {
        db.query.mockRejectedValue(
            new Error("ER_NO_SUCH_TABLE: Table 'ecommerce.fraud_monitoring_queue' doesn't exist")
        );
    };

    test("does not throw -- a monitoring write must not fail a signup", async () => {
        failing();

        await expect(flagForMonitoring(makeReq(), detection)).resolves.toBe(false);
    });

    test("says which signup was dropped", async () => {
        // The old message was 'Error flagging for monitoring:' and the error.
        // No email, no score, no level -- nothing to tie the failure back to.
        failing();

        await flagForMonitoring(makeReq(), detection);

        expect(logger.error).toHaveBeenCalledTimes(1);

        const [message] = logger.error.mock.calls[0];
        expect(message).toContain("shopper@example.com");
        expect(message).toContain("medium");
        expect(message).toContain("55");
    });

    test("goes through the project logger, not console", async () => {
        failing();

        await flagForMonitoring(makeReq(), detection);

        expect(logger.error).toHaveBeenCalled();
    });

    test("still names the failure when the address is missing", async () => {
        failing();

        await flagForMonitoring({ body: {}, ip: "203.0.113.9" }, detection);

        const [message] = logger.error.mock.calls[0];
        expect(message).toContain("unknown address");
    });
});
