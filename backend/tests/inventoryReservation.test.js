// Tests for inventory reservation (#1215). The db module is mocked so we can
// assert the FOR UPDATE-guarded oversell check and the units-vs-rows lock
// consumption without a live MySQL. A fake connection/pool records every SQL
// string and returns canned rows keyed off the query text.

jest.mock("../config/db", () => {
    const query = jest.fn();
    const pool = { query, getConnection: jest.fn() };
    return pool;
});

const db = require("../config/db");
const service = require("../services/inventoryReservationService");

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

function sqlsMatching(calls, regex) {
    return calls.filter(({ sql }) => regex.test(sql));
}

afterEach(() => {
    db.query.mockReset();
    db.getConnection.mockReset();
});

describe("consumeLocks", () => {
    test("consumes exact units across rows, decrements the final partial row, orders by expires_at", async () => {
        // 5 units to consume across rows holding 2, 2 and 3 units.
        const { query, calls } = makeConnection((sql) => {
            if (/^\s*SELECT id, quantity FROM inventory_locks/i.test(sql)) {
                return [[
                    { id: 10, quantity: 2 },
                    { id: 11, quantity: 2 },
                    { id: 12, quantity: 3 }
                ]];
            }
            return [{ affectedRows: 1 }];
        });

        await service.consumeLocks("user-1", [{ productId: 7, quantity: 5 }], { query });

        const selects = sqlsMatching(calls, /SELECT id, quantity FROM inventory_locks/i);
        expect(selects).toHaveLength(1);
        expect(selects[0].sql).toMatch(/ORDER BY expires_at ASC/i);

        // Rows 10 and 11 (2 + 2 = 4) are fully deleted; row 12 keeps 3 - 1 = 2.
        const deletes = sqlsMatching(calls, /^\s*DELETE FROM inventory_locks WHERE id = \?/i);
        expect(deletes.map((c) => c.params[0])).toEqual([10, 11]);

        const updates = sqlsMatching(calls, /UPDATE inventory_locks SET quantity = quantity - \?/i);
        expect(updates).toHaveLength(1);
        expect(updates[0].params).toEqual([1, 12]);
    });

    test("stops once the requested units are satisfied by whole rows", async () => {
        const { query, calls } = makeConnection((sql) => {
            if (/^\s*SELECT id, quantity FROM inventory_locks/i.test(sql)) {
                return [[
                    { id: 20, quantity: 2 },
                    { id: 21, quantity: 5 }
                ]];
            }
            return [{ affectedRows: 1 }];
        });

        await service.consumeLocks("user-1", [{ productId: 9, quantity: 2 }], { query });

        const deletes = sqlsMatching(calls, /^\s*DELETE FROM inventory_locks WHERE id = \?/i);
        expect(deletes.map((c) => c.params[0])).toEqual([20]);
        expect(sqlsMatching(calls, /UPDATE inventory_locks/i)).toHaveLength(0);
    });
});

describe("reserveStock", () => {
    test("rejects when requested quantity exceeds available and locks the product row FOR UPDATE", async () => {
        // stock 10, already 8 locked -> only 2 available, request 5 -> reject.
        const { query, calls } = makeConnection((sql) => {
            if (/SELECT stock FROM products WHERE id = \?/i.test(sql)) {
                return [[{ stock: 10 }]];
            }
            if (/SELECT SUM\(quantity\) as locked_qty/i.test(sql)) {
                return [[{ locked_qty: 8 }]];
            }
            return [{ affectedRows: 1 }];
        });

        const reserved = await service.reserveStock("user-1", 7, 5, { query });

        expect(reserved).toBe(false);

        const stockSelect = sqlsMatching(calls, /SELECT stock FROM products WHERE id = \?/i);
        expect(stockSelect).toHaveLength(1);
        expect(stockSelect[0].sql).toMatch(/FOR UPDATE/i);

        // Rejection must not insert a lock.
        expect(sqlsMatching(calls, /INSERT INTO inventory_locks/i)).toHaveLength(0);
    });

    test("inserts a lock when capacity is available", async () => {
        const { query, calls } = makeConnection((sql) => {
            if (/SELECT stock FROM products WHERE id = \?/i.test(sql)) {
                return [[{ stock: 10 }]];
            }
            if (/SELECT SUM\(quantity\) as locked_qty/i.test(sql)) {
                return [[{ locked_qty: 2 }]];
            }
            return [{ affectedRows: 1, insertId: 1 }];
        });

        const reserved = await service.reserveStock("user-1", 7, 3, { query });

        expect(reserved).toBe(true);
        const inserts = sqlsMatching(calls, /INSERT INTO inventory_locks/i);
        expect(inserts).toHaveLength(1);
        expect(inserts[0].params.slice(0, 3)).toEqual(["user-1", 7, 3]);
    });

    test("without a connection, opens its own transaction around the FOR UPDATE and commits", async () => {
        const conn = makeConnection((sql) => {
            if (/SELECT stock FROM products WHERE id = \?/i.test(sql)) {
                return [[{ stock: 10 }]];
            }
            if (/SELECT SUM\(quantity\) as locked_qty/i.test(sql)) {
                return [[{ locked_qty: 0 }]];
            }
            return [{ affectedRows: 1, insertId: 1 }];
        });
        const connection = {
            query: conn.query,
            beginTransaction: jest.fn(async () => {}),
            commit: jest.fn(async () => {}),
            rollback: jest.fn(async () => {}),
            release: jest.fn()
        };
        db.getConnection.mockResolvedValue(connection);

        const reserved = await service.reserveStock("user-1", 7, 3);

        expect(reserved).toBe(true);
        expect(db.getConnection).toHaveBeenCalledTimes(1);
        expect(connection.beginTransaction).toHaveBeenCalledTimes(1);
        expect(connection.commit).toHaveBeenCalledTimes(1);
        expect(connection.rollback).not.toHaveBeenCalled();
        expect(connection.release).toHaveBeenCalledTimes(1);
        expect(sqlsMatching(conn.calls, /SELECT stock FROM products WHERE id = \? FOR UPDATE/i)).toHaveLength(1);
    });
});
