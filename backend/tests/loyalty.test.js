// Tests for the loyalty ledger core (#1232, PR 1/3). The db module is mocked so
// we exercise the transactional earn/redeem paths without a live MySQL: a fake
// connection records every SQL string + params and returns canned rows keyed
// off the query text, and the transaction helpers are spies so we can assert
// commit-on-success / rollback-on-failure.

jest.mock("../config/db", () => ({
    query: jest.fn(),
    getConnection: jest.fn(),
    beginTransaction: jest.fn(async () => {}),
    commitTransaction: jest.fn(async () => {}),
    rollbackTransaction: jest.fn(async () => {}),
}));

const db = require("../config/db");
const { loyaltyService, EARN_RATE, REDEEM_RATE } = require("../services/loyaltyService");

// Fake promise-pool connection: `.query()` returns canned rows based on the SQL
// text and records each call so tests can assert on the SQL/params.
function makeConnection(responder) {
    const calls = [];
    const query = jest.fn(async (sql, params = []) => {
        calls.push({ sql, params });
        return responder(sql, params);
    });
    return { query, calls, release: jest.fn() };
}

function sqlsMatching(calls, regex) {
    return calls.filter(({ sql }) => regex.test(sql));
}

afterEach(() => {
    jest.clearAllMocks();
});

describe("award", () => {
    test("computes points from amount via EARN_RATE and records balance_after", async () => {
        const conn = makeConnection((sql) => {
            if (/SELECT points_balance, lifetime_points/i.test(sql)) {
                return [[{ points_balance: 100, lifetime_points: 300 }]];
            }
            return [{ affectedRows: 1, insertId: 1 }];
        });
        db.getConnection.mockResolvedValue(conn);

        const newBalance = await loyaltyService.award("user-1", {
            orderId: 55,
            amount: 250,
            reason: "order #55",
        });

        // 250 currency units * EARN_RATE(1) = 250 points on top of the 100 held.
        expect(newBalance).toBe(100 + 250 * EARN_RATE);

        expect(db.beginTransaction).toHaveBeenCalledTimes(1);
        expect(db.commitTransaction).toHaveBeenCalledTimes(1);
        expect(db.rollbackTransaction).not.toHaveBeenCalled();
        expect(conn.release).toHaveBeenCalledTimes(1);

        const inserts = sqlsMatching(conn.calls, /INSERT INTO loyalty_transactions/i);
        expect(inserts).toHaveLength(1);
        const [userId, orderId, type, points, balanceAfter] = inserts[0].params;
        expect({ userId, orderId, type, points, balanceAfter }).toEqual({
            userId: "user-1",
            orderId: 55,
            type: "earn",
            points: 250,
            balanceAfter: 350,
        });
    });

    test("floors fractional points and rejects a negative amount", async () => {
        const conn = makeConnection((sql) => {
            if (/SELECT points_balance, lifetime_points/i.test(sql)) {
                return [[{ points_balance: 0, lifetime_points: 0 }]];
            }
            return [{ affectedRows: 1 }];
        });
        db.getConnection.mockResolvedValue(conn);

        const balance = await loyaltyService.award("user-2", { amount: 10.9 });
        expect(balance).toBe(10);

        await expect(loyaltyService.award("user-2", { amount: -5 })).rejects.toThrow(
            /non-negative numeric amount/i
        );
    });
});

describe("redeem", () => {
    test("succeeds when the balance covers the request and returns the discount value", async () => {
        const conn = makeConnection((sql) => {
            if (/SELECT points_balance FROM loyalty_accounts/i.test(sql)) {
                return [[{ points_balance: 500 }]];
            }
            return [{ affectedRows: 1, insertId: 1 }];
        });
        db.getConnection.mockResolvedValue(conn);

        const result = await loyaltyService.redeem("user-1", { points: 200, reason: "checkout" });

        expect(result).toEqual({
            pointsRedeemed: 200,
            discountValue: 200 * REDEEM_RATE,
            balance: 300,
        });
        expect(db.commitTransaction).toHaveBeenCalledTimes(1);
        expect(db.rollbackTransaction).not.toHaveBeenCalled();
        expect(conn.release).toHaveBeenCalledTimes(1);

        // Ledger row is signed-negative with balance_after tracking the new total.
        const inserts = sqlsMatching(conn.calls, /INSERT INTO loyalty_transactions/i);
        expect(inserts).toHaveLength(1);
        const [, , type, points, balanceAfter] = inserts[0].params;
        expect({ type, points, balanceAfter }).toEqual({
            type: "redeem",
            points: -200,
            balanceAfter: 300,
        });
    });

    test("throws naming the shortfall on insufficient balance and rolls back without writing", async () => {
        const conn = makeConnection((sql) => {
            if (/SELECT points_balance FROM loyalty_accounts/i.test(sql)) {
                return [[{ points_balance: 50 }]];
            }
            return [{ affectedRows: 1 }];
        });
        db.getConnection.mockResolvedValue(conn);

        await expect(
            loyaltyService.redeem("user-1", { points: 200 })
        ).rejects.toThrow(/requested 200, available 50, short by 150/i);

        // Never appended a ledger row or updated the balance.
        expect(sqlsMatching(conn.calls, /INSERT INTO loyalty_transactions/i)).toHaveLength(0);
        expect(sqlsMatching(conn.calls, /UPDATE loyalty_accounts SET points_balance/i)).toHaveLength(0);

        expect(db.rollbackTransaction).toHaveBeenCalledTimes(1);
        expect(db.commitTransaction).not.toHaveBeenCalled();
        expect(conn.release).toHaveBeenCalledTimes(1);
    });

    test("rejects a non-positive points request before touching the DB", async () => {
        await expect(loyaltyService.redeem("user-1", { points: 0 })).rejects.toThrow(
            /positive integer/i
        );
        expect(db.getConnection).not.toHaveBeenCalled();
    });
});

describe("getHistory", () => {
    test("returns the pagination envelope and passes limit/offset to SQL", async () => {
        const rows = [
            { id: 3, user_id: "user-1", type: "redeem", points: -200, balance_after: 300 },
            { id: 2, user_id: "user-1", type: "earn", points: 250, balance_after: 500 },
        ];
        db.query.mockResolvedValue([rows, null]);

        const history = await loyaltyService.getHistory("user-1", { limit: 10, offset: 20 });

        expect(history).toEqual({
            userId: "user-1",
            limit: 10,
            offset: 20,
            count: 2,
            transactions: rows,
        });

        const [sql, params] = db.query.mock.calls[0];
        expect(sql).toMatch(/LIMIT \? OFFSET \?/i);
        expect(params).toEqual(["user-1", 10, 20]);
    });
});
