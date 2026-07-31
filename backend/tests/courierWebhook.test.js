// Tests for the courier webhook ingestion pipeline (#1157). The DB and logger
// are mocked so we can assert the persist → apply → mark-processed flow, status
// mapping, idempotency and graceful failure handling without a live MySQL.

jest.mock("../config/db", () => ({ query: jest.fn() }));
jest.mock("../utils/logger", () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
}));

const db = require("../config/db");
const service = require("../services/courierWebhookService");

// Configurable fake DB. `state` controls what the SELECTs return; INSERT/UPDATE
// calls are recorded so tests can assert side effects.
function installDb(state = {}) {
    const calls = [];
    let webhookAutoId = state.newWebhookId || 100;

    db.query.mockImplementation(async (sql, params = []) => {
        calls.push({ sql, params });

        if (/FROM courier_webhooks\s+WHERE JSON_UNQUOTE/i.test(sql)) {
            return [state.existingWebhook ? [state.existingWebhook] : []];
        }
        if (/FROM shipments\s+WHERE tracking_number/i.test(sql)) {
            return [state.shipment ? [state.shipment] : []];
        }
        if (/SELECT id, payload FROM courier_webhooks\s+WHERE processed = 0/i.test(sql)) {
            return [state.pending || []];
        }
        if (/^\s*INSERT INTO courier_webhooks/i.test(sql)) {
            return [{ insertId: webhookAutoId++ }];
        }
        if (/^\s*INSERT INTO shipment_tracking/i.test(sql)) {
            return [{ insertId: 1 }];
        }
        // UPDATE shipments / UPDATE courier_webhooks
        return [{ affectedRows: 1 }];
    });

    return { calls };
}

function sqlsMatching(calls, regex) {
    return calls.filter(({ sql }) => regex.test(sql));
}

const basePayload = {
    tracking_number: "AWB123",
    status: "in_transit",
    location: "Mumbai Hub",
    description: "Package in transit"
};

afterEach(() => {
    db.query.mockReset();
    delete process.env.COURIER_WEBHOOK_SECRET;
    delete process.env.COURIER_WEBHOOK_SECRET_SHIPROCKET;
});

describe("status mapping + normalization", () => {
    test("maps courier status vocabularies onto the shipment enum", () => {
        expect(service.mapCourierStatus("OUT FOR DELIVERY")).toBe("out_for_delivery");
        expect(service.mapCourierStatus("RTO")).toBe("returned");
        expect(service.mapCourierStatus("picked-up")).toBe("picked");
        expect(service.mapCourierStatus("Delivered")).toBe("delivered");
    });

    test("returns null for unknown courier statuses", () => {
        expect(service.mapCourierStatus("teleported")).toBeNull();
    });

    test("normalizeEvent requires tracking_number and status", () => {
        expect(() => service.normalizeEvent("generic", { status: "delivered" }))
            .toThrow(/tracking_number/);
        expect(() => service.normalizeEvent("generic", { tracking_number: "X" }))
            .toThrow(/status/);
    });

    test("normalizeEvent reads provider field aliases", () => {
        const event = service.normalizeEvent("delhivery", {
            awb: "WAY9",
            current_status: "Delivered",
            edd: "2026-08-01"
        });
        expect(event.trackingNumber).toBe("WAY9");
        expect(event.mappedStatus).toBe("delivered");
        expect(event.estimatedDelivery).toBe("2026-08-01");
    });
});

describe("ingestWebhook", () => {
    test("rejects unsupported providers with a 400 WebhookError", async () => {
        installDb();
        await expect(
            service.ingestWebhook({ provider: "notacourier", payload: basePayload })
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    test("persists the webhook, appends tracking and advances shipment status", async () => {
        const { calls } = installDb({ shipment: { id: 7, status: "pending" } });

        const result = await service.ingestWebhook({
            provider: "shiprocket",
            payload: basePayload
        });

        expect(result).toMatchObject({ duplicate: false, processed: true, shipmentId: 7, status: "in_transit" });
        expect(sqlsMatching(calls, /INSERT INTO courier_webhooks/i)).toHaveLength(1);
        expect(sqlsMatching(calls, /INSERT INTO shipment_tracking/i)).toHaveLength(1);
        const [shipmentUpdate] = sqlsMatching(calls, /UPDATE shipments SET status/i);
        expect(shipmentUpdate.params).toEqual(["in_transit", 7]);
        expect(sqlsMatching(calls, /UPDATE courier_webhooks\s+SET processed = 1/i)).toHaveLength(1);
    });

    test("sets actual_delivery_date when the shipment is delivered", async () => {
        const { calls } = installDb({ shipment: { id: 9, status: "in_transit" } });

        await service.ingestWebhook({
            provider: "generic",
            payload: { tracking_number: "AWB9", status: "delivered", occurred_at: "2026-08-05T10:00:00Z" }
        });

        const [deliveredUpdate] = sqlsMatching(calls, /UPDATE shipments\s+SET status = \?, actual_delivery_date/i);
        expect(deliveredUpdate.params).toEqual(["delivered", "2026-08-05", 9]);
    });

    test("is idempotent: a duplicate of an already-processed event is skipped", async () => {
        const { calls } = installDb({ existingWebhook: { id: 42, processed: 1 } });

        const result = await service.ingestWebhook({
            provider: "shiprocket",
            payload: basePayload
        });

        expect(result).toMatchObject({ duplicate: true, webhookId: 42 });
        expect(sqlsMatching(calls, /INSERT INTO courier_webhooks/i)).toHaveLength(0);
        expect(sqlsMatching(calls, /INSERT INTO shipment_tracking/i)).toHaveLength(0);
    });

    test("stores the payload and records an error when no shipment matches (no throw)", async () => {
        const { calls } = installDb({ shipment: null });

        const result = await service.ingestWebhook({
            provider: "shiprocket",
            payload: basePayload
        });

        expect(result).toMatchObject({ duplicate: false, processed: false });
        expect(result.error).toMatch(/No shipment found/);
        expect(sqlsMatching(calls, /INSERT INTO courier_webhooks/i)).toHaveLength(1);
        expect(sqlsMatching(calls, /UPDATE courier_webhooks\s+SET processed = 0/i)).toHaveLength(1);
        expect(sqlsMatching(calls, /INSERT INTO shipment_tracking/i)).toHaveLength(0);
    });

    test("rejects an invalid signature with a 401 when a secret is configured", async () => {
        process.env.COURIER_WEBHOOK_SECRET = "super-secret-value-1234567890";
        installDb({ shipment: { id: 1, status: "pending" } });

        await expect(
            service.ingestWebhook({
                provider: "shiprocket",
                payload: basePayload,
                signature: "deadbeef".repeat(8)
            })
        ).rejects.toMatchObject({ statusCode: 401 });
    });
});

describe("processPendingWebhooks", () => {
    test("reprocesses stored rows and reports a summary", async () => {
        const pending = [
            {
                id: 201,
                payload: JSON.stringify({
                    tracking_number: "AWB123",
                    status: "delivered",
                    __meta: { provider: "shiprocket" }
                })
            }
        ];
        installDb({ pending, shipment: { id: 5, status: "in_transit" } });

        const summary = await service.processPendingWebhooks(10);

        expect(summary).toEqual({ total: 1, processed: 1, failed: 0 });
    });
});
