// Tests for inventory reservation (#1215 / #1260).
// The db + cacheService modules are mocked so we can assert FOR UPDATE-guarded
// oversell checks, Redis pre-lock collapsing, and 100+ parallel checkouts on a
// single-stock SKU without a live MySQL/Redis.

jest.mock("../config/db", () => {
    const query = jest.fn();
    const pool = { query, getConnection: jest.fn() };
    return pool;
});

jest.mock("../services/cacheService", () => ({
    cacheService: {
        withLock: jest.fn(async (_resource, fn) => fn()),
        acquireLock: jest.fn(async () => ({ ok: true, token: "t" })),
        releaseLock: jest.fn(async () => true)
    }
}));

const db = require("../config/db");
const { cacheService } = require("../services/cacheService");
const service = require("../services/inventoryReservationService");

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
    cacheService.withLock.mockClear();
    cacheService.withLock.mockImplementation(async (_resource, fn) => fn());
});

describe("consumeLocks", () => {
    test("consumes exact units across rows, decrements the final partial row, orders by expires_at", async () => {
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
        const { query, calls } = makeConnection((sql) => {
            if (/SELECT .*stock.* FROM products WHERE id = \?/i.test(sql)) {
                return [[{ id: 7, stock: 10, name: "Widget" }]];
            }
            if (/SELECT SUM\(quantity\) as locked_qty/i.test(sql)) {
                return [[{ locked_qty: 8 }]];
            }
            return [{ affectedRows: 1 }];
        });

        const reserved = await service.reserveStock("user-1", 7, 5, { query });

        expect(reserved).toBe(false);

        const stockSelect = sqlsMatching(calls, /SELECT .* FROM products WHERE id = \?/i);
        expect(stockSelect).toHaveLength(1);
        expect(stockSelect[0].sql).toMatch(/FOR UPDATE/i);
        expect(sqlsMatching(calls, /INSERT INTO inventory_locks/i)).toHaveLength(0);
    });

    test("returns structured conflict with availableStock (#1260)", async () => {
        const { query } = makeConnection((sql) => {
            if (/SELECT .*stock.* FROM products WHERE id = \?/i.test(sql)) {
                return [[{ id: 7, stock: 3, name: "Widget" }]];
            }
            if (/SELECT SUM\(quantity\) as locked_qty/i.test(sql)) {
                return [[{ locked_qty: 2 }]];
            }
            return [{ affectedRows: 1 }];
        });

        const detailed = await service.reserveStockDetailed("user-1", 7, 5, { query });

        expect(detailed.ok).toBe(false);
        expect(detailed.code).toBe("INVENTORY_CONFLICT");
        expect(detailed.availableStock).toBe(1);
        expect(detailed.requested).toBe(5);
        expect(detailed.productId).toBe(7);
    });

    test("inserts a lock when capacity is available", async () => {
        const { query, calls } = makeConnection((sql) => {
            if (/SELECT .*stock.* FROM products WHERE id = \?/i.test(sql)) {
                return [[{ id: 7, stock: 10, name: "Widget" }]];
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
        expect(cacheService.withLock).toHaveBeenCalled();
    });

    test("without a connection, opens its own transaction around the FOR UPDATE and commits", async () => {
        const conn = makeConnection((sql) => {
            if (/SELECT .*stock.* FROM products WHERE id = \?/i.test(sql)) {
                return [[{ id: 7, stock: 10, name: "Widget" }]];
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
        expect(sqlsMatching(conn.calls, /FOR UPDATE/i).length).toBeGreaterThan(0);
    });

    test("uses 10-minute reservation TTL", () => {
        expect(service.LOCK_TTL_MS).toBe(10 * 60 * 1000);
    });
});

describe("high-concurrency single-stock overbooking (#1260)", () => {
    test("100 parallel checkout reservations on stock=1 — only one succeeds", async () => {
        let lockedQty = 0;
        const STOCK = 1;

        // Redlock collapses concurrent critical sections for the same SKU
        let lockChain = Promise.resolve();
        cacheService.withLock.mockImplementation(async (_resource, fn) => {
            const run = lockChain.then(fn);
            lockChain = run.then(() => undefined, () => undefined);
            return run;
        });

        const query = jest.fn(async (sql, params = []) => {
            if (/DELETE FROM inventory_locks WHERE expires_at/i.test(sql)) {
                return [{ affectedRows: 0 }];
            }
            if (/SELECT .*stock.* FROM products WHERE id = \?/i.test(sql)) {
                return [[{ id: 7, stock: STOCK, name: "Rare Item" }]];
            }
            if (/SELECT SUM\(quantity\) as locked_qty/i.test(sql)) {
                return [[{ locked_qty: lockedQty }]];
            }
            if (/INSERT INTO inventory_locks/i.test(sql)) {
                const qty = params[2];
                lockedQty += qty;
                return [{ affectedRows: 1, insertId: lockedQty }];
            }
            return [{ affectedRows: 1 }];
        });

        const connection = { query };

        const attempts = Array.from({ length: 100 }, (_, i) =>
            service.reserveStock(`user-${i}`, 7, 1, connection)
        );

        const results = await Promise.all(attempts);
        const winners = results.filter(Boolean);

        expect(winners).toHaveLength(1);
        expect(lockedQty).toBe(1);
        expect(cacheService.withLock).toHaveBeenCalled();
    });

    test("deductStockAtomic refuses underflow", async () => {
        const { query } = makeConnection((sql) => {
            if (/UPDATE products SET stock = stock - \?/i.test(sql)) {
                return [{ affectedRows: 0 }];
            }
            return [{ affectedRows: 1 }];
        });

        const result = await service.deductStockAtomic({ query }, 7, 2);
        expect(result.ok).toBe(false);
        expect(result.productId).toBe(7);
    });
});
