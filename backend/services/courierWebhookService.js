// Courier webhook ingestion pipeline (Issue #1157).
//
// Turns raw courier-provider webhook deliveries into shipment status updates,
// backed by the existing `shipments`, `shipment_tracking` and `courier_webhooks`
// tables. The flow for each delivery is:
//
//   1. Verify the provider is supported (and the signature, if a secret is set).
//   2. Normalize the provider-specific payload into a common event shape.
//   3. Skip deliveries already processed (idempotency via a per-event dedupe key).
//   4. Persist the raw payload in `courier_webhooks` for audit/debugging.
//   5. Apply the event: append a `shipment_tracking` row and advance the
//      `shipments` status. Processing failures are recorded on the webhook row
//      (error_message) and never bubble up as an unhandled crash.
//
// `processPendingWebhooks` lets a background worker / scheduled job retry rows
// that were persisted but not yet processed (e.g. the shipment did not exist
// when the event first arrived).

const crypto = require("crypto");
const db = require("../config/db");
const logger = require("../utils/logger");
const { verifyClaudeSignature } = require("../utils/signatureVerification");
const { safeArray, sanitizeString } = require("../utils/helpers");

// Providers we accept webhooks from. Unknown providers are rejected up front so
// a typo in the URL doesn't silently store junk.
const SUPPORTED_PROVIDERS = new Set([
    "shiprocket",
    "delhivery",
    "bluedart",
    "generic"
]);

// Valid values for shipments.status (see backend/schema.sql).
const SHIPMENT_STATUSES = new Set([
    "pending",
    "picked",
    "in_transit",
    "out_for_delivery",
    "delivered",
    "failed",
    "returned"
]);

// Maps the many status strings couriers use onto our shipment status enum.
// Keys are normalized (lowercased, spaces/hyphens → underscore) before lookup.
const COURIER_STATUS_MAP = {
    pending: "pending",
    created: "pending",
    manifested: "pending",
    label_generated: "pending",
    ready_to_ship: "pending",

    picked: "picked",
    picked_up: "picked",
    pickup: "picked",
    pickup_complete: "picked",
    pickup_scheduled: "picked",

    in_transit: "in_transit",
    intransit: "in_transit",
    shipped: "in_transit",
    dispatched: "in_transit",
    at_hub: "in_transit",

    out_for_delivery: "out_for_delivery",
    ofd: "out_for_delivery",

    delivered: "delivered",
    completed: "delivered",

    failed: "failed",
    failed_delivery: "failed",
    undelivered: "failed",
    delivery_failed: "failed",
    exception: "failed",

    returned: "returned",
    rto: "returned",
    rto_delivered: "returned",
    return_to_origin: "returned"
};

// Reserved envelope key added to the stored payload so we can resolve the
// provider / dedupe key when reprocessing a persisted webhook without a schema
// change. The original provider fields are preserved alongside it.
const META_KEY = "__meta";

class WebhookError extends Error {
    constructor(message, statusCode) {
        super(message);
        this.name = "WebhookError";
        this.statusCode = statusCode;
    }
}

function normalizeStatusKey(value) {
    return sanitizeString(value)
        .toLowerCase()
        .replace(/[\s-]+/g, "_");
}

// Resolve a courier status string to a shipment enum value, or null if we don't
// recognize it (the raw value is still stored on the tracking row).
function mapCourierStatus(rawStatus) {
    return COURIER_STATUS_MAP[normalizeStatusKey(rawStatus)] || null;
}

function isSupportedProvider(provider) {
    return SUPPORTED_PROVIDERS.has(sanitizeString(provider).toLowerCase());
}

// Pull a value from the payload trying several common field aliases so one
// normalizer copes with slightly different provider schemas.
function pick(payload, keys) {
    for (const key of keys) {
        if (payload[key] !== undefined && payload[key] !== null && payload[key] !== "") {
            return payload[key];
        }
    }
    return undefined;
}

// Convert a raw provider payload into the common event shape. Throws a 400
// WebhookError when required fields are missing.
function normalizeEvent(provider, payload) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw new WebhookError("Webhook payload must be a JSON object", 400);
    }

    const trackingNumber = sanitizeString(
        pick(payload, ["tracking_number", "trackingNumber", "awb", "awb_code", "waybill"])
    );
    const status = sanitizeString(
        pick(payload, ["status", "current_status", "shipment_status", "event"])
    );

    const missing = [];
    if (!trackingNumber) missing.push("tracking_number");
    if (!status) missing.push("status");
    if (missing.length > 0) {
        throw new WebhookError(
            `Webhook payload missing required field(s): ${missing.join(", ")}`,
            400
        );
    }

    const occurredAtRaw = pick(payload, [
        "occurred_at",
        "timestamp",
        "event_time",
        "status_time",
        "updated_at"
    ]);
    const occurredAt = occurredAtRaw ? new Date(occurredAtRaw) : new Date();

    // A stable per-event id keeps duplicate deliveries idempotent. When the
    // provider gives us one we use it; otherwise we derive a deterministic hash
    // from the event's identifying fields.
    const providerEventId = sanitizeString(
        pick(payload, ["event_id", "eventId", "id", "webhook_id"])
    );
    const eventId = providerEventId || deriveEventId(trackingNumber, status, occurredAt);

    return {
        provider: provider.toLowerCase(),
        eventId,
        trackingNumber,
        rawStatus: status,
        mappedStatus: mapCourierStatus(status),
        description: sanitizeString(pick(payload, ["description", "message", "activity", "remark"])) || null,
        location: sanitizeString(pick(payload, ["location", "city", "current_location"])) || null,
        latitude: toNumberOrNull(pick(payload, ["latitude", "lat"])),
        longitude: toNumberOrNull(pick(payload, ["longitude", "lng", "lon"])),
        carrierStatusCode: sanitizeString(pick(payload, ["status_code", "carrier_status_code", "code"])) || null,
        estimatedDelivery: toDateStringOrNull(pick(payload, ["estimated_delivery", "edd", "expected_delivery"])),
        occurredAt: Number.isNaN(occurredAt.getTime()) ? new Date() : occurredAt
    };
}

function deriveEventId(trackingNumber, status, occurredAt) {
    const basis = `${trackingNumber}|${status}|${occurredAt instanceof Date ? occurredAt.toISOString() : occurredAt}`;
    return crypto.createHash("sha256").update(basis).digest("hex");
}

function toNumberOrNull(value) {
    if (value === undefined || value === null || value === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function toDateStringOrNull(value) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function verifySignature(provider, payload, signature) {
    const secret = process.env[`COURIER_WEBHOOK_SECRET_${provider.toUpperCase()}`]
        || process.env.COURIER_WEBHOOK_SECRET;

    // No secret configured → signature checks are disabled (local/dev). This is
    // intentional so the pipeline works without per-provider secrets, matching
    // how the rest of the project treats optional integrations.
    if (!secret) return;

    if (!verifyClaudeSignature(signature, payload, secret)) {
        throw new WebhookError("Invalid webhook signature", 401);
    }
}

async function findWebhookByDedupeKey(dedupeKey) {
    const [rows] = await db.query(
        `SELECT id, processed
         FROM courier_webhooks
         WHERE JSON_UNQUOTE(JSON_EXTRACT(payload, '$.${META_KEY}.dedupeKey')) = ?
         ORDER BY id DESC
         LIMIT 1`,
        [dedupeKey]
    );
    return safeArray(rows)[0] || null;
}

async function findShipmentByTracking(trackingNumber) {
    const [rows] = await db.query(
        `SELECT id, status FROM shipments
         WHERE tracking_number = ? AND deleted_at IS NULL
         LIMIT 1`,
        [trackingNumber]
    );
    return safeArray(rows)[0] || null;
}

async function insertWebhookRow({ shipmentId, eventType, payload }) {
    const [result] = await db.query(
        `INSERT INTO courier_webhooks (shipment_id, event_type, payload, processed)
         VALUES (?, ?, ?, 0)`,
        [shipmentId || null, eventType, JSON.stringify(payload)]
    );
    return result.insertId;
}

async function markWebhookProcessed(webhookId, shipmentId) {
    await db.query(
        `UPDATE courier_webhooks
         SET processed = 1, processed_at = NOW(), error_message = NULL, shipment_id = ?
         WHERE id = ?`,
        [shipmentId || null, webhookId]
    );
}

async function recordWebhookError(webhookId, message) {
    await db.query(
        `UPDATE courier_webhooks
         SET processed = 0, error_message = ?
         WHERE id = ?`,
        [String(message).slice(0, 1000), webhookId]
    );
}

// Append a tracking event and advance the parent shipment. Assumes the shipment
// exists; the caller resolves it first.
async function applyEventToShipment(shipment, event) {
    const isDelivered = event.mappedStatus === "delivered";

    await db.query(
        `INSERT INTO shipment_tracking
            (shipment_id, status, location, description, latitude, longitude,
             carrier_status_code, estimated_delivery, is_delivered, \`timestamp\`)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            shipment.id,
            event.mappedStatus || event.rawStatus,
            event.location,
            event.description,
            event.latitude,
            event.longitude,
            event.carrierStatusCode,
            event.estimatedDelivery,
            isDelivered ? 1 : 0,
            event.occurredAt
        ]
    );

    // Only touch shipments.status when we could map the courier status onto our
    // enum; an unrecognized status is still recorded on the tracking row above.
    if (event.mappedStatus && SHIPMENT_STATUSES.has(event.mappedStatus)) {
        if (isDelivered) {
            await db.query(
                `UPDATE shipments
                 SET status = ?, actual_delivery_date = ?
                 WHERE id = ?`,
                [event.mappedStatus, event.occurredAt.toISOString().slice(0, 10), shipment.id]
            );
        } else {
            await db.query(
                `UPDATE shipments SET status = ? WHERE id = ?`,
                [event.mappedStatus, shipment.id]
            );
        }
    }
}

async function processEvent(webhookId, event) {
    const shipment = await findShipmentByTracking(event.trackingNumber);
    if (!shipment) {
        throw new WebhookError(
            `No shipment found for tracking number ${event.trackingNumber}`,
            422
        );
    }
    await applyEventToShipment(shipment, event);
    await markWebhookProcessed(webhookId, shipment.id);
    return shipment.id;
}

// Entry point for a single inbound webhook delivery.
async function ingestWebhook({ provider, payload, signature }) {
    if (!isSupportedProvider(provider)) {
        throw new WebhookError(`Unsupported courier provider: ${provider}`, 400);
    }

    verifySignature(provider, payload, signature);

    const event = normalizeEvent(provider, payload);
    const dedupeKey = `${event.provider}:${event.eventId}`;

    const existing = await findWebhookByDedupeKey(dedupeKey);
    if (existing && existing.processed) {
        logger.info(`Duplicate courier webhook ignored (dedupeKey=${dedupeKey})`);
        return { duplicate: true, processed: true, webhookId: existing.id };
    }

    const storedPayload = {
        ...payload,
        [META_KEY]: {
            provider: event.provider,
            dedupeKey,
            eventId: event.eventId,
            trackingNumber: event.trackingNumber,
            receivedAt: new Date().toISOString()
        }
    };

    // Reuse the earlier failed row on retry instead of piling up duplicates.
    let webhookId = existing ? existing.id : null;
    const shipment = await findShipmentByTracking(event.trackingNumber);
    if (webhookId === null) {
        webhookId = await insertWebhookRow({
            shipmentId: shipment ? shipment.id : null,
            eventType: event.rawStatus,
            payload: storedPayload
        });
    }

    try {
        const shipmentId = await processEvent(webhookId, event);
        return {
            duplicate: false,
            processed: true,
            webhookId,
            shipmentId,
            status: event.mappedStatus
        };
    } catch (error) {
        // Persisted-but-unprocessed: log it on the row so a later retry (fresh
        // delivery or processPendingWebhooks) can pick it up, and don't crash.
        await recordWebhookError(webhookId, error.message);
        logger.warn(`Courier webhook ${webhookId} stored but not processed: ${error.message}`);
        return {
            duplicate: false,
            processed: false,
            webhookId,
            error: error.message
        };
    }
}

// Reprocess webhooks that were persisted but never applied (background job).
async function processPendingWebhooks(limit = 50) {
    const [rows] = await db.query(
        `SELECT id, payload FROM courier_webhooks
         WHERE processed = 0
         ORDER BY received_at ASC
         LIMIT ?`,
        [limit]
    );

    const summary = { total: safeArray(rows).length, processed: 0, failed: 0 };

    for (const row of safeArray(rows)) {
        try {
            const payload = typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload;
            const provider = payload?.[META_KEY]?.provider || "generic";
            const event = normalizeEvent(provider, payload);
            await processEvent(row.id, event);
            summary.processed += 1;
        } catch (error) {
            await recordWebhookError(row.id, error.message);
            summary.failed += 1;
            logger.warn(`Retry of courier webhook ${row.id} failed: ${error.message}`);
        }
    }

    return summary;
}

module.exports = {
    ingestWebhook,
    processPendingWebhooks,
    normalizeEvent,
    mapCourierStatus,
    isSupportedProvider,
    WebhookError,
    SUPPORTED_PROVIDERS,
    SHIPMENT_STATUSES
};
