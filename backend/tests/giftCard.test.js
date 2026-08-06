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

        const result = await service.issue({ amount: 50, currency: "INR" });

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
            [{ balance: 25.5, currency: "INR", status: "active", expires_at: null }]
        ]);

        const balance = await service.getBalance(code);

        expect(balance).toEqual({
            balance: 25.5,
            currency: "INR",
            status: "active",
            expiresAt: null,
            redeemable: true
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
                return [[{ id: 7, balance: 50, currency: "INR", status: "active", expires_at: null }]];
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
                    currency: "INR",
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
                return [[{ id: 9, balance: 50, currency: "INR", status: "active", expires_at: null }]];
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
                return [[{ id: 3, balance: 40, currency: "INR", status: "active", expires_at: null }]];
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

// ============================================================================
// APPLYING A CARD TO AN ORDER (#1478)
// ============================================================================
//
// What this used to do: write `orderId` into the ledger row and nothing else.
// The order was never read -- so any authenticated caller could attach a
// redemption to any order id -- and `orders` was untouched, so the balance was
// spent and the customer was still charged in full.

const ORDER_ID = "11111111-1111-1111-1111-111111111111";
const OWNER_ID = "22222222-2222-2222-2222-222222222222";
const STRANGER_ID = "33333333-3333-3333-3333-333333333333";

/** An unpaid order belonging to OWNER_ID. */
function payableOrder(overrides = {}) {
    return {
        id: ORDER_ID,
        user_id: OWNER_ID,
        status: "pending",
        payment_status: "pending",
        total: 100,
        gift_card_amount: 0,
        deleted_at: null,
        ...overrides
    };
}

/** A live card with `balance` on it. */
function activeCard(overrides = {}) {
    return { id: 12, balance: 100, currency: "INR", status: "active", expires_at: null, ...overrides };
}

/**
 * A connection answering the order lock, the card lock and the writes.
 */
function orderConnection({ order = payableOrder(), card = activeCard() } = {}) {
    return makeTxnConnection((sql) => {
        if (/FROM orders/i.test(sql)) {
            return [order ? [order] : []];
        }
        if (/FROM gift_cards WHERE code_hash = \?/i.test(sql)) {
            return [card ? [card] : []];
        }
        if (/INSERT INTO gift_card_transactions/i.test(sql)) {
            return [{ insertId: 77, affectedRows: 1 }];
        }
        return [{ affectedRows: 1 }];
    });
}

describe("applyToOrder — the order actually gets paid", () => {
    test("reduces what the order owes, not just the card balance", async () => {
        const connection = orderConnection();
        db.getConnection.mockResolvedValue(connection);

        const result = await service.applyToOrder("9999000011112222", ORDER_ID, 60, null, {
            userId: OWNER_ID
        });

        expect(result.balanceAfter).toBe(40);
        expect(result.orderPaidByGiftCards).toBe(60);
        expect(result.orderOutstanding).toBe(40);
        expect(result.orderSettled).toBe(false);

        const orderUpdate = sqlsMatching(connection.calls, /UPDATE orders/i);
        expect(orderUpdate).toHaveLength(1);
        expect(orderUpdate[0].params[0]).toBe(60);
        // Still owes 40, so it is not marked paid.
        expect(orderUpdate[0].params[1]).toBe("pending");
    });

    test("marks the order paid when the card covers it in full", async () => {
        const connection = orderConnection({ card: activeCard({ balance: 250 }) });
        db.getConnection.mockResolvedValue(connection);

        const result = await service.applyToOrder("CODE000000000000", ORDER_ID, 100, null, {
            userId: OWNER_ID
        });

        expect(result.orderOutstanding).toBe(0);
        expect(result.orderSettled).toBe(true);
        expect(sqlsMatching(connection.calls, /UPDATE orders/i)[0].params[1]).toBe("paid");
    });

    test("settles the order in the same transaction as the balance decrement", async () => {
        // Otherwise the ledger and the order can disagree about what was paid.
        const connection = orderConnection();
        db.getConnection.mockResolvedValue(connection);

        await service.applyToOrder("CODE000000000000", ORDER_ID, 60, null, { userId: OWNER_ID });

        expect(connection.beginTransaction).toHaveBeenCalledTimes(1);
        expect(connection.commit).toHaveBeenCalledTimes(1);
        expect(sqlsMatching(connection.calls, /UPDATE gift_cards SET balance/i)).toHaveLength(1);
        expect(sqlsMatching(connection.calls, /UPDATE orders/i)).toHaveLength(1);
    });

    test("still ties the ledger row to the order", async () => {
        const connection = orderConnection();
        db.getConnection.mockResolvedValue(connection);

        await service.applyToOrder("CODE000000000000", ORDER_ID, 60, null, { userId: OWNER_ID });

        const ledger = sqlsMatching(connection.calls, /INSERT INTO gift_card_transactions/i);
        expect(ledger).toHaveLength(1);
        expect(ledger[0].params[1]).toBe(ORDER_ID);
        expect(ledger[0].params[2]).toBe("redeem");
    });

    test("takes the order lock before the card lock", async () => {
        // Always this direction, so two redemptions against one order cannot
        // deadlock by each holding what the other is waiting for.
        const connection = orderConnection();
        db.getConnection.mockResolvedValue(connection);

        await service.applyToOrder("CODE000000000000", ORDER_ID, 60, null, { userId: OWNER_ID });

        const locks = connection.calls
            .map(({ sql }) => sql)
            .filter((sql) => /FOR UPDATE/i.test(sql));

        expect(locks[0]).toMatch(/FROM orders/i);
        expect(locks[1]).toMatch(/FROM gift_cards/i);
    });
});

describe("applyToOrder — ownership", () => {
    test("refuses an order belonging to somebody else", async () => {
        const connection = orderConnection();
        db.getConnection.mockResolvedValue(connection);

        await expect(
            service.applyToOrder("CODE000000000000", ORDER_ID, 25, null, { userId: STRANGER_ID })
        ).rejects.toMatchObject({ code: "ORDER_NOT_FOUND" });

        expect(sqlsMatching(connection.calls, /UPDATE gift_cards/i)).toHaveLength(0);
        expect(connection.rollback).toHaveBeenCalledTimes(1);
    });

    test("answers identically for an order that does not exist", async () => {
        // Distinguishing "not yours" from "no such order" makes this endpoint a
        // way to enumerate order ids.
        const connection = orderConnection({ order: null });
        db.getConnection.mockResolvedValue(connection);

        await expect(
            service.applyToOrder("CODE000000000000", ORDER_ID, 25, null, { userId: OWNER_ID })
        ).rejects.toMatchObject({ code: "ORDER_NOT_FOUND" });
    });

    test("refuses a soft-deleted order", async () => {
        const connection = orderConnection({ order: payableOrder({ deleted_at: new Date() }) });
        db.getConnection.mockResolvedValue(connection);

        await expect(
            service.applyToOrder("CODE000000000000", ORDER_ID, 25, null, { userId: OWNER_ID })
        ).rejects.toMatchObject({ code: "ORDER_NOT_FOUND" });
    });

    test("refuses when no userId is supplied at all", async () => {
        // A caller that forgets to pass one must not fall through to the old
        // behaviour of trusting the body.
        const connection = orderConnection();
        db.getConnection.mockResolvedValue(connection);

        await expect(
            service.applyToOrder("CODE000000000000", ORDER_ID, 25)
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
});

describe("applyToOrder — what may still be paid", () => {
    test("refuses an order that is already paid", async () => {
        const connection = orderConnection({
            order: payableOrder({ payment_status: "paid" })
        });
        db.getConnection.mockResolvedValue(connection);

        await expect(
            service.applyToOrder("CODE000000000000", ORDER_ID, 25, null, { userId: OWNER_ID })
        ).rejects.toMatchObject({ code: "ORDER_NOT_PAYABLE" });
    });

    test("refuses a cancelled order even when payment_status still reads pending", async () => {
        const connection = orderConnection({ order: payableOrder({ status: "cancelled" }) });
        db.getConnection.mockResolvedValue(connection);

        await expect(
            service.applyToOrder("CODE000000000000", ORDER_ID, 25, null, { userId: OWNER_ID })
        ).rejects.toMatchObject({ code: "ORDER_NOT_PAYABLE" });
    });

    test("refuses an order other cards have already covered", async () => {
        const connection = orderConnection({
            order: payableOrder({ total: 100, gift_card_amount: 100 })
        });
        db.getConnection.mockResolvedValue(connection);

        await expect(
            service.applyToOrder("CODE000000000000", ORDER_ID, 25, null, { userId: OWNER_ID })
        ).rejects.toMatchObject({ code: "ORDER_SETTLED" });
    });
});

describe("applyToOrder — the amount", () => {
    test("clamps an amount larger than what is outstanding", async () => {
        // A caller asking for more than is owed is asking to overpay. Taking
        // what is owed is the right answer -- the balance is theirs and so is
        // the order.
        const connection = orderConnection({ card: activeCard({ balance: 500 }) });
        db.getConnection.mockResolvedValue(connection);

        const result = await service.applyToOrder("CODE000000000000", ORDER_ID, 400, null, {
            userId: OWNER_ID
        });

        expect(result.amount).toBe(100);
        expect(result.balanceAfter).toBe(400);
        expect(result.orderOutstanding).toBe(0);
    });

    test("clamps against what other cards have already paid", async () => {
        const connection = orderConnection({
            order: payableOrder({ total: 100, gift_card_amount: 70 }),
            card: activeCard({ balance: 500 })
        });
        db.getConnection.mockResolvedValue(connection);

        const result = await service.applyToOrder("CODE000000000000", ORDER_ID, 90, null, {
            userId: OWNER_ID
        });

        expect(result.amount).toBe(30);
        expect(result.orderPaidByGiftCards).toBe(100);
        expect(result.orderSettled).toBe(true);
    });

    test("an omitted amount means as much as the card can cover", async () => {
        const connection = orderConnection({ card: activeCard({ balance: 40 }) });
        db.getConnection.mockResolvedValue(connection);

        const result = await service.applyToOrder("CODE000000000000", ORDER_ID, undefined, null, {
            userId: OWNER_ID
        });

        // Outstanding is 100, the card holds 40 -- so it pays 40 and the card
        // is emptied, not refused for being short.
        expect(result.amount).toBe(40);
        expect(result.balanceAfter).toBe(0);
        expect(result.orderOutstanding).toBe(60);
    });

    test("still refuses a card that cannot cover the clamped amount", async () => {
        const connection = orderConnection({ card: activeCard({ balance: 10 }) });
        db.getConnection.mockResolvedValue(connection);

        await expect(
            service.applyToOrder("CODE000000000000", ORDER_ID, 50, null, { userId: OWNER_ID })
        ).rejects.toMatchObject({ code: "INSUFFICIENT_BALANCE" });
    });
});

describe("currency", () => {
    test("refuses a card issued in a currency the store does not price in", async () => {
        // gift_cards.currency defaulted to USD while the store prices in INR,
        // and nothing compared the two. Subtracting one from the other means
        // choosing an exchange rate, and there is none to choose.
        const connection = orderConnection({ card: activeCard({ currency: "USD" }) });
        db.getConnection.mockResolvedValue(connection);

        await expect(
            service.applyToOrder("CODE000000000000", ORDER_ID, 25, null, { userId: OWNER_ID })
        ).rejects.toMatchObject({ code: "CURRENCY_MISMATCH" });

        expect(sqlsMatching(connection.calls, /UPDATE orders/i)).toHaveLength(0);
    });

    test("issues in the store's currency by default", async () => {
        const connection = makeTxnConnection((sql) =>
            /INSERT INTO gift_cards/i.test(sql)
                ? [{ insertId: 1, affectedRows: 1 }]
                : [{ insertId: 2, affectedRows: 1 }]
        );
        db.getConnection.mockResolvedValue(connection);

        const result = await service.issue({ amount: 50 });

        expect(result.currency).toBe("INR");
        expect(sqlsMatching(connection.calls, /INSERT INTO gift_cards/i)[0].params[2]).toBe("INR");
    });
});

describe("getBalance — expiry", () => {
    test("reports an expired card as expired, not as active", async () => {
        // Nothing sweeps expires_at into the status column, so a lapsed card
        // read `active` with its full balance right up until the customer tried
        // to spend it and got a 410.
        db.query.mockResolvedValue([[{
            balance: 50,
            currency: "INR",
            status: "active",
            expires_at: new Date(Date.now() - 24 * 60 * 60 * 1000)
        }]]);

        const balance = await service.getBalance("EXPIREDCARD00000");

        expect(balance.status).toBe("expired");
        expect(balance.redeemable).toBe(false);
        // The balance is still reported: it is a real figure, and hiding it
        // would leave the customer unable to see what they are asking about.
        expect(balance.balance).toBe(50);
    });

    test("leaves a card with no expiry alone", async () => {
        db.query.mockResolvedValue([[
            { balance: 50, currency: "INR", status: "active", expires_at: null }
        ]]);

        await expect(service.getBalance("CODE000000000000")).resolves.toMatchObject({
            status: "active",
            redeemable: true
        });
    });

    test("is not redeemable when the card is in a foreign currency", async () => {
        db.query.mockResolvedValue([[
            { balance: 50, currency: "USD", status: "active", expires_at: null }
        ]]);

        await expect(service.getBalance("CODE000000000000")).resolves.toMatchObject({
            redeemable: false
        });
    });

    test("is not redeemable when the balance is gone", async () => {
        db.query.mockResolvedValue([[
            { balance: 0, currency: "INR", status: "redeemed", expires_at: null }
        ]]);

        await expect(service.getBalance("CODE000000000000")).resolves.toMatchObject({
            redeemable: false
        });
    });
});
