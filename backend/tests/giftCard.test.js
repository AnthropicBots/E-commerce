// Tests for gift cards / store credit (#1231). The db module is mocked so we
// can assert the FOR UPDATE-guarded redemption and the append-only ledger
// writes without a live MySQL. A fake connection/pool records every SQL string
// and returns canned rows keyed off the query text. Codes are looked up by
// SHA-256 hash, so we compute the expected hash independently here.

jest.mock("../config/db", () => {
    const query = jest.fn();
    const pool = { query, getConnection: jest.fn() };
    return pool;
});

const crypto = require("crypto");
const db = require("../config/db");
const service = require("../services/giftCardService");

function sha256(code) {
    return crypto.createHash("sha256").update(String(code)).digest("hex");
}

// Builds a fake connection whose `.query()` returns canned rows based on the
// SQL text, and records every call so tests can assert on the SQL/params.
function makeConnection(responder) {
    const calls = [];
    const query = jest.fn(async (sql, params = []) => {
        calls.push({ sql, params });
        return responder(sql, params);
    });
    return { query, calls };
}

// Wraps a recording connection with transaction hooks so we can assert the
// service opened / committed / rolled back its own transaction.
function makeTxnConnection(responder) {
    const conn = makeConnection(responder);
    return {
        query: conn.query,
        calls: conn.calls,
        beginTransaction: jest.fn(async () => {}),
        commit: jest.fn(async () => {}),
        rollback: jest.fn(async () => {}),
        release: jest.fn()
    };
}

function sqlsMatching(calls, regex) {
    return calls.filter(({ sql }) => regex.test(sql));
}

afterEach(() => {
    db.query.mockReset();
    db.getConnection.mockReset();
});

describe("issue", () => {
    test("opens a transaction, inserts card + issue ledger row, returns plaintext code", async () => {
        const connection = makeTxnConnection((sql) => {
            if (/INSERT INTO gift_cards/i.test(sql)) {
                return [{ insertId: 42, affectedRows: 1 }];
            }
            return [{ insertId: 100, affectedRows: 1 }];
        });
        db.getConnection.mockResolvedValue(connection);

        const result = await service.issue({ amount: 50, currency: "USD" });

        expect(connection.beginTransaction).toHaveBeenCalledTimes(1);
        expect(connection.commit).toHaveBeenCalledTimes(1);
        expect(connection.rollback).not.toHaveBeenCalled();
        expect(connection.release).toHaveBeenCalledTimes(1);

        // Plaintext code returned once, and its hash is what gets stored.
        expect(typeof result.code).toBe("string");
        expect(result.code.length).toBeGreaterThan(0);
        expect(result.id).toBe(42);
        expect(result.balance).toBe(50);

        const cardInserts = sqlsMatching(connection.calls, /INSERT INTO gift_cards/i);
        expect(cardInserts).toHaveLength(1);
        expect(cardInserts[0].params[0]).toBe(sha256(result.code));
        expect(cardInserts[0].params[1]).toBe(50);
        expect(cardInserts[0].params[3]).toBe("active");

        // Opening ledger row: type 'issue', balance_after == full amount.
        const ledgerInserts = sqlsMatching(connection.calls, /INSERT INTO gift_card_transactions/i);
        expect(ledgerInserts).toHaveLength(1);
        expect(ledgerInserts[0].params[0]).toBe(42);
        expect(ledgerInserts[0].params[2]).toBe("issue");
        expect(ledgerInserts[0].params[4]).toBe(50);
    });

    test("rejects a non-positive amount without touching the db", async () => {
        await expect(service.issue({ amount: 0 })).rejects.toMatchObject({
            code: "INVALID_AMOUNT"
        });
        expect(db.getConnection).not.toHaveBeenCalled();
    });
});

describe("getBalance", () => {
    test("looks up by code_hash and returns balance/status/expiry without a lock", async () => {
        const code = "ABCDEF0123456789";
        db.query.mockResolvedValue([
            [{ balance: 25.5, currency: "USD", status: "active", expires_at: null }]
        ]);

        const balance = await service.getBalance(code);

        expect(balance).toEqual({
            balance: 25.5,
            currency: "USD",
            status: "active",
            expiresAt: null
        });

        const [sql, params] = db.query.mock.calls[0];
        expect(sql).toMatch(/SELECT .* FROM gift_cards WHERE code_hash = \?/i);
        expect(sql).not.toMatch(/FOR UPDATE/i);
        expect(params[0]).toBe(sha256(code));
    });

    test("throws NOT_FOUND for an unknown code", async () => {
        db.query.mockResolvedValue([[]]);

        await expect(service.getBalance("NOPE")).rejects.toMatchObject({
            code: "NOT_FOUND"
        });
    });
});

describe("redeem", () => {
    test("locks the row FOR UPDATE, decrements balance, writes a redeem ledger row, and commits", async () => {
        const code = "1111222233334444";
        const connection = makeTxnConnection((sql) => {
            if (/SELECT .* FROM gift_cards WHERE code_hash = \?/i.test(sql)) {
                return [[{ id: 7, balance: 50, currency: "USD", status: "active", expires_at: null }]];
            }
            if (/INSERT INTO gift_card_transactions/i.test(sql)) {
                return [{ insertId: 900, affectedRows: 1 }];
            }
            return [{ affectedRows: 1 }];
        });
        db.getConnection.mockResolvedValue(connection);

        const result = await service.redeem(code, 30);

        expect(result.balanceAfter).toBe(20);

        // Serialized under FOR UPDATE, keyed on the hashed code.
        const locking = sqlsMatching(connection.calls, /SELECT .* FROM gift_cards WHERE code_hash = \? FOR UPDATE/i);
        expect(locking).toHaveLength(1);
        expect(locking[0].params[0]).toBe(sha256(code));

        // Balance decremented to 20.
        const updates = sqlsMatching(connection.calls, /UPDATE gift_cards SET balance = \?/i);
        expect(updates).toHaveLength(1);
        expect(updates[0].params[0]).toBe(20);

        // Ledger row: type 'redeem', balance_after 20, no order tie.
        const ledger = sqlsMatching(connection.calls, /INSERT INTO gift_card_transactions/i);
        expect(ledger).toHaveLength(1);
        expect(ledger[0].params[1]).toBeNull();
        expect(ledger[0].params[2]).toBe("redeem");
        expect(ledger[0].params[4]).toBe(20);

        expect(connection.beginTransaction).toHaveBeenCalledTimes(1);
        expect(connection.commit).toHaveBeenCalledTimes(1);
        expect(connection.rollback).not.toHaveBeenCalled();
        expect(connection.release).toHaveBeenCalledTimes(1);
    });

    test("rejects an expired card, rolls back, and writes nothing", async () => {
        const connection = makeTxnConnection((sql) => {
            if (/SELECT .* FROM gift_cards WHERE code_hash = \?/i.test(sql)) {
                return [[{
                    id: 8,
                    balance: 50,
                    currency: "USD",
                    status: "active",
                    expires_at: new Date(Date.now() - 24 * 60 * 60 * 1000)
                }]];
            }
            return [{ affectedRows: 1 }];
        });
        db.getConnection.mockResolvedValue(connection);

        await expect(service.redeem("EXPIREDCARD00000", 10)).rejects.toMatchObject({
            code: "EXPIRED"
        });

        expect(sqlsMatching(connection.calls, /UPDATE gift_cards/i)).toHaveLength(0);
        expect(sqlsMatching(connection.calls, /INSERT INTO gift_card_transactions/i)).toHaveLength(0);
        expect(connection.commit).not.toHaveBeenCalled();
        expect(connection.rollback).toHaveBeenCalledTimes(1);
        expect(connection.release).toHaveBeenCalledTimes(1);
    });

    // The double-spend guard: two concurrent redeems both take the FOR UPDATE
    // lock in turn; the loser sees the already-decremented balance and must be
    // rejected. Here the request exceeds the available balance, so it is
    // refused WITHOUT decrementing below zero or writing a ledger row.
    test("rejects an over-redeem without dropping balance below zero or writing a ledger row", async () => {
        const connection = makeTxnConnection((sql) => {
            if (/SELECT .* FROM gift_cards WHERE code_hash = \?/i.test(sql)) {
                return [[{ id: 9, balance: 50, currency: "USD", status: "active", expires_at: null }]];
            }
            return [{ affectedRows: 1 }];
        });
        db.getConnection.mockResolvedValue(connection);

        await expect(service.redeem("LOSERCARD0000000", 80)).rejects.toMatchObject({
            code: "INSUFFICIENT_BALANCE"
        });

        // The row was still locked FOR UPDATE before the rejection.
        expect(
            sqlsMatching(connection.calls, /SELECT .* FROM gift_cards WHERE code_hash = \? FOR UPDATE/i)
        ).toHaveLength(1);

        // No balance write and no ledger row on rejection.
        expect(sqlsMatching(connection.calls, /UPDATE gift_cards/i)).toHaveLength(0);
        expect(sqlsMatching(connection.calls, /INSERT INTO gift_card_transactions/i)).toHaveLength(0);
        expect(connection.commit).not.toHaveBeenCalled();
        expect(connection.rollback).toHaveBeenCalledTimes(1);
    });

    test("uses a caller-owned connection without opening its own transaction", async () => {
        const code = "5555666677778888";
        const conn = makeConnection((sql) => {
            if (/SELECT .* FROM gift_cards WHERE code_hash = \?/i.test(sql)) {
                return [[{ id: 3, balance: 40, currency: "USD", status: "active", expires_at: null }]];
            }
            if (/INSERT INTO gift_card_transactions/i.test(sql)) {
                return [{ insertId: 5, affectedRows: 1 }];
            }
            return [{ affectedRows: 1 }];
        });

        const result = await service.redeem(code, 15, { query: conn.query });

        expect(result.balanceAfter).toBe(25);
        // Caller owns the transaction, so the service must not grab its own.
        expect(db.getConnection).not.toHaveBeenCalled();
        expect(
            sqlsMatching(conn.calls, /SELECT .* FROM gift_cards WHERE code_hash = \? FOR UPDATE/i)
        ).toHaveLength(1);
    });
});

describe("applyToOrder", () => {
    test("ties the redeem ledger row to the order id", async () => {
        const code = "9999000011112222";
        const orderId = "11111111-1111-1111-1111-111111111111";
        const conn = makeConnection((sql) => {
            if (/SELECT .* FROM gift_cards WHERE code_hash = \?/i.test(sql)) {
                return [[{ id: 12, balance: 100, currency: "USD", status: "active", expires_at: null }]];
            }
            if (/INSERT INTO gift_card_transactions/i.test(sql)) {
                return [{ insertId: 77, affectedRows: 1 }];
            }
            return [{ affectedRows: 1 }];
        });

        const result = await service.applyToOrder(code, orderId, 60, { query: conn.query });

        expect(result.balanceAfter).toBe(40);
        const ledger = sqlsMatching(conn.calls, /INSERT INTO gift_card_transactions/i);
        expect(ledger).toHaveLength(1);
        expect(ledger[0].params[1]).toBe(orderId);
        expect(ledger[0].params[2]).toBe("redeem");
    });
});
