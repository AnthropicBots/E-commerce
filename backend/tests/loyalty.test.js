// Tests for the loyalty program (#1232). The db module is mocked so we can
// assert the transactional ledger writes and tier engine without a live MySQL.
// A fake connection records every SQL string/params and returns a canned
// account row, mirroring the mocking style in inventoryReservation.test.js.

jest.mock("../config/db", () => {
    const query = jest.fn();
    const pool = { query, getConnection: jest.fn() };
    // eventSubscribers.js requires `.promise`; point it back at the pool.
    pool.promise = pool;
    return pool;
});

// Capture the handlers registered by the promotions subscriber so we can invoke
// the ORDER_CREATED auto-earn handler directly.
jest.mock("../services/domainEventService", () => {
    const registered = [];
    return {
        __registered: registered,
        DOMAIN_EVENTS: {
            ORDER_CREATED: "order.created",
            ORDER_PAYMENT_SUCCESS: "order.payment.success",
            ORDER_COMPLETED: "order.completed",
            PRODUCT_VIEWED: "product.viewed",
            USER_REGISTERED: "user.registered",
            WISHLIST_ITEM_ADDED: "wishlist.item.added"
        },
        domainEventService: {
            subscribe: jest.fn((eventName, handler, context = {}) => {
                registered.push({ eventName, handler, context });
            })
        }
    };
});

const db = require("../config/db");
const {
    loyaltyService,
    EARN_RATE,
    REDEEM_RATE,
    TIERS
} = require("../services/loyaltyService");

// Builds a fake transactional connection that returns `account` for the
// account SELECTs and a generic affected-rows result for writes.
function makeConnection(account) {
    const calls = [];
    const query = jest.fn(async (sql, params = []) => {
        calls.push({ sql, params });
        if (/FROM loyalty_accounts WHERE user_id = \?/i.test(sql)) {
            return [account ? [account] : []];
        }
        return [{ affectedRows: 1, insertId: 1 }];
    });
    const connection = {
        query,
        beginTransaction: jest.fn(async () => {}),
        commit: jest.fn(async () => {}),
        rollback: jest.fn(async () => {}),
        release: jest.fn()
    };
    return { connection, calls };
}

function sqlsMatching(calls, regex) {
    return calls.filter(({ sql }) => regex.test(sql));
}

function accountUpdate(calls) {
    return sqlsMatching(calls, /UPDATE loyalty_accounts\s+SET points_balance/i)[0];
}

function ledgerInsert(calls) {
    return sqlsMatching(calls, /INSERT INTO loyalty_transactions/i)[0];
}

afterEach(() => {
    db.query.mockReset();
    db.getConnection.mockReset();
    jest.restoreAllMocks();
});

describe("computeTier", () => {
    test("maps lifetime points to the correct tier at each threshold boundary", () => {
        expect(loyaltyService.computeTier(0).name).toBe("Bronze");
        expect(loyaltyService.computeTier(999).name).toBe("Bronze");
        expect(loyaltyService.computeTier(1000).name).toBe("Silver");
        expect(loyaltyService.computeTier(4999).name).toBe("Silver");
        expect(loyaltyService.computeTier(5000).name).toBe("Gold");
        expect(loyaltyService.computeTier(19999).name).toBe("Gold");
        expect(loyaltyService.computeTier(20000).name).toBe("Platinum");
        expect(loyaltyService.computeTier(10_000_000).name).toBe("Platinum");
    });

    test("exports a consistent, ascending tier ladder", () => {
        expect(EARN_RATE).toBe(1);
        expect(REDEEM_RATE).toBe(0.01);
        expect(TIERS.map((t) => t.name)).toEqual(["Bronze", "Silver", "Gold", "Platinum"]);
        for (let i = 1; i < TIERS.length; i++) {
            expect(TIERS[i].minLifetimePoints).toBeGreaterThan(TIERS[i - 1].minLifetimePoints);
            expect(TIERS[i].multiplier).toBeGreaterThan(TIERS[i - 1].multiplier);
        }
    });
});

describe("award", () => {
    test("scales base points by the current tier multiplier and appends an earn row", async () => {
        // Silver account (lifetime 2000, multiplier 1.25). $100 order => 100 base
        // points => floor(100 * 1.25) = 125 earned.
        const { connection, calls } = makeConnection({
            user_id: 7,
            points_balance: 500,
            lifetime_points: 2000,
            tier: "Silver"
        });
        db.getConnection.mockResolvedValue(connection);

        const result = await loyaltyService.award(7, { orderId: 42, amount: 100, reason: "order" });

        expect(result.pointsEarned).toBe(125);
        expect(result.balance).toBe(625);
        expect(result.lifetimePoints).toBe(2125);
        expect(result.tier).toBe("Silver");

        // Balance snapshot persisted in the same transaction.
        expect(accountUpdate(calls).params).toEqual([625, 2125, "Silver", 7]);

        // Signed, order-linked earn row.
        const ledger = ledgerInsert(calls);
        expect(ledger.params.slice(0, 5)).toEqual([7, 42, "earn", 125, 625]);

        expect(connection.commit).toHaveBeenCalledTimes(1);
        expect(connection.rollback).not.toHaveBeenCalled();
        expect(connection.release).toHaveBeenCalledTimes(1);
    });

    test("upgrades the tier when the award crosses a lifetime threshold", async () => {
        // Bronze account (lifetime 900). $200 order at 1.0x => 200 points =>
        // lifetime 1100 crosses the 1000 Silver threshold.
        const { connection, calls } = makeConnection({
            user_id: 9,
            points_balance: 900,
            lifetime_points: 900,
            tier: "Bronze"
        });
        db.getConnection.mockResolvedValue(connection);

        const result = await loyaltyService.award(9, { orderId: 1, amount: 200 });

        expect(result.pointsEarned).toBe(200);
        expect(result.tier).toBe("Silver");
        expect(result.tierUpgraded).toBe(true);
        expect(accountUpdate(calls).params).toEqual([1100, 1100, "Silver", 9]);
    });
});

describe("adjust", () => {
    test("writes a signed positive adjust row and lifts lifetime/tier", async () => {
        const { connection, calls } = makeConnection({
            user_id: 3,
            points_balance: 500,
            lifetime_points: 500,
            tier: "Bronze"
        });
        db.getConnection.mockResolvedValue(connection);

        const result = await loyaltyService.adjust(3, { points: 600, reason: "goodwill" });

        expect(result.pointsAdjusted).toBe(600);
        expect(result.balance).toBe(1100);
        expect(result.lifetimePoints).toBe(1100);
        expect(result.tier).toBe("Silver");

        const ledger = ledgerInsert(calls);
        expect(ledger.params.slice(0, 5)).toEqual([3, null, "adjust", 600, 1100]);
    });

    test("writes a signed negative adjust row without reducing lifetime", async () => {
        const { connection, calls } = makeConnection({
            user_id: 3,
            points_balance: 500,
            lifetime_points: 500,
            tier: "Bronze"
        });
        db.getConnection.mockResolvedValue(connection);

        const result = await loyaltyService.adjust(3, { points: -50, reason: "clawback" });

        expect(result.pointsAdjusted).toBe(-50);
        expect(result.balance).toBe(450);
        expect(result.lifetimePoints).toBe(500);

        const ledger = ledgerInsert(calls);
        expect(ledger.params.slice(0, 5)).toEqual([3, null, "adjust", -50, 450]);
    });

    test("rejects a zero adjustment", async () => {
        await expect(loyaltyService.adjust(3, { points: 0 })).rejects.toThrow(/non-zero integer/i);
        expect(db.getConnection).not.toHaveBeenCalled();
    });
});

describe("redeem", () => {
    test("throws a clear error when balance is insufficient", async () => {
        const { connection } = makeConnection({
            user_id: 3,
            points_balance: 40,
            lifetime_points: 40,
            tier: "Bronze"
        });
        db.getConnection.mockResolvedValue(connection);

        await expect(loyaltyService.redeem(3, { points: 100 })).rejects.toThrow(
            /Insufficient points to redeem: requested 100, available 40/i
        );
        expect(connection.rollback).toHaveBeenCalledTimes(1);
        expect(connection.commit).not.toHaveBeenCalled();
    });
});

describe("auto-earn subscriber (ORDER_CREATED)", () => {
    test("awards points for the order's user and amount, guarding failures", async () => {
        const { setupPromotionsSubscriber } = require("../services/eventSubscribers");
        const { __registered } = require("../services/domainEventService");

        const awardSpy = jest.spyOn(loyaltyService, "award").mockResolvedValue({});

        setupPromotionsSubscriber();

        const entry = __registered.find(
            (r) => r.eventName === "order.created" && r.context.name === "promotions"
        );
        expect(entry).toBeDefined();

        await entry.handler({ orderId: 42, userId: 7, total: 250 });

        expect(awardSpy).toHaveBeenCalledWith(7, {
            orderId: 42,
            amount: 250,
            reason: "order"
        });
    });

    test("does not throw when award fails (non-blocking)", async () => {
        const { setupPromotionsSubscriber } = require("../services/eventSubscribers");
        const { __registered } = require("../services/domainEventService");

        jest.spyOn(loyaltyService, "award").mockRejectedValue(new Error("db down"));

        setupPromotionsSubscriber();
        const entry = __registered.find(
            (r) => r.eventName === "order.created" && r.context.name === "promotions"
        );

        await expect(entry.handler({ orderId: 99, userId: 5, total: 10 })).resolves.toBeUndefined();
    });
});

// ============================================================================
// IDEMPOTENCY AND REVERSAL (#1476)
// ============================================================================
//
// `makeConnection` above answers the account SELECT and returns a generic
// affected-rows result for everything else, which means it answers the ledger
// lookups with `[{ affectedRows: 1, insertId: 1 }]` -- truthy, and not a row.
// These tests need to control what the ledger returns, so they build on it.

/**
 * A connection whose ledger lookups answer with `ledgerRows`.
 *
 * @param {object} account The loyalty_accounts row.
 * @param {{earn?: object|null, adjust?: object|null}} ledgerRows
 */
function makeLedgerConnection(account, { earn = null, adjust = null } = {}) {
    const calls = [];
    const query = jest.fn(async (sql, params = []) => {
        calls.push({ sql, params });

        if (/FROM loyalty_accounts WHERE user_id = \?/i.test(sql)) {
            return [account ? [account] : []];
        }
        if (/FROM loyalty_transactions[\s\S]*type = 'earn'/i.test(sql)) {
            return [earn ? [earn] : []];
        }
        if (/FROM loyalty_transactions[\s\S]*type = 'adjust'/i.test(sql)) {
            return [adjust ? [adjust] : []];
        }
        return [{ affectedRows: 1, insertId: 1 }];
    });

    const connection = {
        query,
        beginTransaction: jest.fn(async () => {}),
        commit: jest.fn(async () => {}),
        rollback: jest.fn(async () => {}),
        release: jest.fn()
    };
    return { connection, calls };
}

const bronzeAccount = (overrides = {}) => ({
    user_id: 7,
    points_balance: 500,
    lifetime_points: 500,
    tier: "Bronze",
    ...overrides
});

describe("award idempotency", () => {
    test("credits an order that has not been awarded yet", async () => {
        const { connection, calls } = makeLedgerConnection(bronzeAccount(), { earn: null });
        db.getConnection.mockResolvedValue(connection);

        const result = await loyaltyService.award(7, { orderId: 42, amount: 100 });

        expect(result.pointsEarned).toBe(100);
        expect(result.alreadyAwarded).toBe(false);
        expect(ledgerInsert(calls)).toBeDefined();
    });

    test("does not credit an order twice", async () => {
        // The bug: ORDER_CREATED is an `{ async: true }` subscriber, so anything
        // that republishes it -- a retry, a backfill, a second app instance --
        // called award again and it paid again.
        const { connection, calls } = makeLedgerConnection(bronzeAccount(), {
            earn: { id: 11, points: 100, balance_after: 500 }
        });
        db.getConnection.mockResolvedValue(connection);

        const result = await loyaltyService.award(7, { orderId: 42, amount: 100 });

        expect(result.alreadyAwarded).toBe(true);
        expect(result.pointsEarned).toBe(100);
        expect(result.balance).toBe(500);

        // Nothing written: no second ledger row, no balance change.
        expect(ledgerInsert(calls)).toBeUndefined();
        expect(accountUpdate(calls)).toBeUndefined();
        expect(connection.commit).toHaveBeenCalledTimes(1);
    });

    test("checks for a prior award on the transaction's own connection", async () => {
        // Read outside the account lock, two concurrent awards for the same
        // order both see nothing and both credit.
        const { connection, calls } = makeLedgerConnection(bronzeAccount(), { earn: null });
        db.getConnection.mockResolvedValue(connection);

        await loyaltyService.award(7, { orderId: 42, amount: 100 });

        const lookup = sqlsMatching(calls, /FROM loyalty_transactions[\s\S]*type = 'earn'/i)[0];
        expect(lookup).toBeDefined();
        expect(lookup.params).toEqual([7, 42]);
        expect(db.query).not.toHaveBeenCalled();
    });

    test("does not deduplicate an award with no orderId", async () => {
        // There is nothing to key it on, so it is not claimed to be idempotent.
        const { connection, calls } = makeLedgerConnection(bronzeAccount(), { earn: null });
        db.getConnection.mockResolvedValue(connection);

        const result = await loyaltyService.award(7, { orderId: null, amount: 50 });

        expect(result.pointsEarned).toBe(50);
        expect(sqlsMatching(calls, /FROM loyalty_transactions[\s\S]*type = 'earn'/i)).toHaveLength(0);
    });
});

describe("award input validation", () => {
    test.each([[-500], [-1], [Number.NaN], [Number.POSITIVE_INFINITY], ["nonsense"]])(
        "refuses an amount of %p",
        async (amount) => {
            const { connection } = makeLedgerConnection(bronzeAccount());
            db.getConnection.mockResolvedValue(connection);

            await expect(loyaltyService.award(7, { orderId: 1, amount })).rejects.toThrow(
                /must be a non-negative number/
            );
        }
    );

    test("a negative amount can no longer drive the balance down", async () => {
        // This was the only way to get a negative balance into loyalty_accounts:
        // redeem() and adjust() both validate and both refuse to go negative,
        // award() did neither and wrote the result as an `earn`.
        const { connection, calls } = makeLedgerConnection(bronzeAccount());
        db.getConnection.mockResolvedValue(connection);

        await expect(
            loyaltyService.award(7, { orderId: 1, amount: -500 })
        ).rejects.toThrow();

        expect(accountUpdate(calls)).toBeUndefined();
    });

    test("accepts a zero-value order without writing a negative row", async () => {
        const { connection } = makeLedgerConnection(bronzeAccount(), { earn: null });
        db.getConnection.mockResolvedValue(connection);

        const result = await loyaltyService.award(7, { orderId: 1, amount: 0 });

        expect(result.pointsEarned).toBe(0);
    });
});

describe("reverse", () => {
    test("claws back the points an order earned and lowers the tier with them", async () => {
        // Silver on 1100 lifetime; the order that earned 200 is returned, so
        // lifetime falls to 900 and the account is Bronze again. Leaving
        // lifetime alone would let the customer keep a tier bought with an
        // order they sent back.
        const { connection, calls } = makeLedgerConnection(
            bronzeAccount({ points_balance: 1100, lifetime_points: 1100, tier: "Silver" }),
            { earn: { id: 11, points: 200, balance_after: 1100 }, adjust: null }
        );
        db.getConnection.mockResolvedValue(connection);

        const result = await loyaltyService.reverse(7, { orderId: 42, reason: "returned" });

        expect(result.pointsReversed).toBe(200);
        expect(result.balance).toBe(900);
        expect(result.lifetimePoints).toBe(900);
        expect(result.tier).toBe("Bronze");
        expect(result.tierDowngraded).toBe(true);

        expect(accountUpdate(calls).params).toEqual([900, 900, "Bronze", 7]);

        const ledger = ledgerInsert(calls);
        expect(ledger.params.slice(0, 5)).toEqual([7, 42, "adjust", -200, 900]);
    });

    test("is idempotent — a second reversal claws back nothing further", async () => {
        const { connection, calls } = makeLedgerConnection(
            bronzeAccount({ points_balance: 900, lifetime_points: 900 }),
            { earn: { id: 11, points: 200 }, adjust: { id: 12, points: -200 } }
        );
        db.getConnection.mockResolvedValue(connection);

        const result = await loyaltyService.reverse(7, { orderId: 42 });

        expect(result.alreadyReversed).toBe(true);
        expect(result.pointsReversed).toBe(200);
        expect(accountUpdate(calls)).toBeUndefined();
        expect(ledgerInsert(calls)).toBeUndefined();
    });

    test("clamps at zero when the points have already been spent", async () => {
        // An unsettleable debt over a refund the customer is entitled to is a
        // worse answer than absorbing the difference, so the shortfall is
        // recorded rather than charged.
        const { connection, calls } = makeLedgerConnection(
            bronzeAccount({ points_balance: 50, lifetime_points: 200 }),
            { earn: { id: 11, points: 200 }, adjust: null }
        );
        db.getConnection.mockResolvedValue(connection);

        const result = await loyaltyService.reverse(7, { orderId: 42 });

        expect(result.balance).toBe(0);
        expect(result.pointsReversed).toBe(200);
        expect(result.pointsClawedBack).toBe(50);

        const metadata = JSON.parse(ledgerInsert(calls).params[6]);
        expect(metadata.shortfall).toBe(150);
        expect(metadata.pointsAwarded).toBe(200);
    });

    test("is a no-op for an order that never earned anything", async () => {
        // A cancellation before the award landed, or an order predating the
        // program. The caller wanted the points gone and they are.
        const { connection, calls } = makeLedgerConnection(bronzeAccount(), {
            earn: null,
            adjust: null
        });
        db.getConnection.mockResolvedValue(connection);

        const result = await loyaltyService.reverse(7, { orderId: 999 });

        expect(result.pointsReversed).toBe(0);
        expect(accountUpdate(calls)).toBeUndefined();
        expect(ledgerInsert(calls)).toBeUndefined();
    });

    test("requires an orderId", async () => {
        await expect(loyaltyService.reverse(7, {})).rejects.toThrow(/without an orderId/);
        await expect(loyaltyService.reverse(7, { orderId: null })).rejects.toThrow();
    });
});
