/**
 * Event DLQ + poison handler tests (#1387).
 */

jest.mock("../config/db", () => ({
    query: jest.fn(async () => [[{ cnt: 0 }], undefined])
}));

jest.mock("../config/redis", () => {
    const store = new Map();
    return {
        get: jest.fn(async (k) => (store.has(k) ? store.get(k) : null)),
        set: jest.fn(async (k, v) => {
            store.set(k, v);
            return "OK";
        }),
        setex: jest.fn(async (k, _ttl, v) => {
            store.set(k, v);
            return "OK";
        }),
        __store: store,
        __reset() {
            store.clear();
        }
    };
});

jest.mock("../utils/logger", () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
}));

const db = require("../config/db");
const redis = require("../config/redis");
const {
    redactPii,
    computeBackoffMs,
    nextRetryAt,
    EventDlqService,
    DLQ_STATUS,
    DLQ_CONFIG
} = require("../services/eventDlqService");

describe("eventDlqService (#1387)", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        redis.__reset();
        db.query.mockResolvedValue([[{ cnt: 0 }]]);
    });

    test("redactPii strips email/phone/token fields and inline PII", () => {
        const cleaned = redactPii({
            userId: "u1",
            email: "alice@example.com",
            phone: "+91 98765 43210",
            nested: { access_token: "secret-token", note: "ok" },
            bio: "Reach me at bob@test.com please"
        });
        expect(cleaned.email).toBe("[REDACTED]");
        expect(cleaned.phone).toBe("[REDACTED]");
        expect(cleaned.nested.access_token).toBe("[REDACTED]");
        expect(cleaned.nested.note).toBe("ok");
        expect(cleaned.bio).toContain("[REDACTED]");
        expect(cleaned.userId).toBe("u1");
    });

    test("computeBackoffMs grows exponentially and caps", () => {
        const a1 = computeBackoffMs(1);
        const a3 = computeBackoffMs(3);
        expect(a3).toBeGreaterThan(a1);
        expect(computeBackoffMs(20)).toBeLessThanOrEqual(DLQ_CONFIG.backoffMaxMs + 1000);
        const when = nextRetryAt(2);
        expect(when.getTime()).toBeGreaterThan(Date.now());
    });

    test("enqueuePoison persists redacted payload and bumps depth", async () => {
        const service = new EventDlqService();
        db.query
            .mockResolvedValueOnce([{ affectedRows: 1 }]) // insert
            .mockResolvedValueOnce([[{ cnt: 1 }]]); // depth

        const result = await service.enqueuePoison({
            eventId: "EVT_1",
            eventType: "order.created",
            idempotencyKey: "key-1",
            payload: { orderId: "o1", email: "x@y.com" },
            errorMessage: "SMTP down",
            attempts: 5
        });

        expect(result.status).toBe(DLQ_STATUS.OPEN);
        expect(db.query).toHaveBeenCalled();
        const insertArgs = db.query.mock.calls[0][1];
        const payloadJson = insertArgs[5];
        expect(payloadJson).toContain("[REDACTED]");
        expect(payloadJson).not.toContain("x@y.com");
        expect(service.stats.enqueued).toBe(1);
    });

    test("replayOne calls outbox requeue and marks replayed", async () => {
        const service = new EventDlqService();
        const row = {
            id: "dlq-1",
            event_id: "EVT_1",
            event_type: "order.created",
            idempotency_key: "k",
            source: "outbox",
            payload_json: JSON.stringify({ orderId: "o1" }),
            metadata_json: "{}",
            error_json: "{}",
            attempts: 5,
            status: DLQ_STATUS.OPEN,
            replay_count: 0
        };

        db.query
            .mockResolvedValueOnce([[row]]) // select
            .mockResolvedValueOnce([{ affectedRows: 1 }]) // update replayed
            .mockResolvedValueOnce([[{ cnt: 0 }]]); // depth

        const outboxService = {
            requeueFromDlq: jest.fn(async () => ({ eventId: "EVT_1", mode: "reset" }))
        };

        const result = await service.replayOne("dlq-1", {
            outboxService,
            actorId: "admin-1"
        });

        expect(outboxService.requeueFromDlq).toHaveBeenCalled();
        expect(result.status).toBe(DLQ_STATUS.REPLAYED);
        expect(service.stats.replayed).toBe(1);
    });

    test("discard marks open entries discarded", async () => {
        const service = new EventDlqService();
        db.query
            .mockResolvedValueOnce([{ affectedRows: 1 }])
            .mockResolvedValueOnce([[{ cnt: 0 }]]);

        const result = await service.discard("dlq-2", {
            actorId: "admin-1",
            reason: "duplicate"
        });
        expect(result.status).toBe(DLQ_STATUS.DISCARDED);
        expect(service.stats.discarded).toBe(1);
    });

    test("replayBatch aggregates successes and failures", async () => {
        const service = new EventDlqService();
        jest.spyOn(service, "replayOne")
            .mockResolvedValueOnce({ id: "a", status: DLQ_STATUS.REPLAYED })
            .mockRejectedValueOnce(Object.assign(new Error("nope"), { code: "DLQ_NOT_OPEN" }));

        const batch = await service.replayBatch(["a", "b"], {});
        expect(batch.succeeded).toBe(1);
        expect(batch.failed).toBe(1);
    });

    test("getMetrics exposes dlq_depth", async () => {
        const service = new EventDlqService();
        db.query
            .mockResolvedValueOnce([[{ cnt: 7 }]])
            .mockResolvedValueOnce([[{ event_type: "order.created", cnt: 7 }]]);

        const metrics = await service.getMetrics();
        expect(metrics.dlq_depth).toBe(7);
        expect(metrics.byType[0].event_type).toBe("order.created");
    });
});
