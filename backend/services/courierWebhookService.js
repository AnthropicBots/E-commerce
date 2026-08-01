// backend/services/courierWebhookService.js
// Courier webhook ingestion pipeline with Circuit Breaker Pattern & Dead-Letter Queue.
// Features:
// - Circuit Breaker states (CLOSED, OPEN, HALF-OPEN) with dynamic threshold monitoring
// - Exponential backoff with jitter for retry logic
// - Dead-Letter Queue (DLQ) for failed delivery status webhooks
// - Fallback response mechanisms for non-critical courier updates
// - Prevents cascade failures and event loop blocking

const crypto = require("crypto");
const db = require("../config/db");
const logger = require("../utils/logger");
const { verifyClaudeSignature } = require("../utils/signatureVerification");
const { safeArray, sanitizeString } = require("../utils/helpers");
const CircuitBreaker = require("opossum");
const { promisify } = require("util");

// ============================================
// REDIS CONNECTION FOR DLQ & STATE MANAGEMENT
// ============================================

// Shared client -- see config/redis.js. This module used to construct its own
// `new Redis({ ... })`, which meant an extra connection per module and made
// the module impossible to load without a live Redis (#1341).
const redis = require("../config/redis");

// ============================================
// CIRCUIT BREAKER CONFIGURATION
// ============================================

const CIRCUIT_BREAKER_CONFIG = {
    // Failure threshold: 50% of requests must fail to open the circuit
    errorThresholdPercentage: 50,
    // Minimum number of requests before circuit breaker evaluates
    rollingCountTimeout: 10000,
    rollingCountBuckets: 10,
    // Time to wait before attempting to close the circuit (30 seconds)
    resetTimeout: 30000,
    // Timeout for individual requests (5 seconds)
    timeout: 5000,
    // Maximum number of concurrent requests
    maxConcurrentRequests: 10,
    // Name for monitoring
    name: "courierWebhook",
    // Enable metrics collection
    enabled: true
};

// ============================================
// RETRY & DLQ CONFIGURATION
// ============================================

const RETRY_CONFIG = {
    maxRetries: 3,
    baseDelay: 1000,
    maxDelay: 30000,
    jitterFactor: 0.3,
    backoffMultiplier: 2
};

const DLQ_CONFIG = {
    maxRetries: 5,
    ttl: 604800, // 7 days in seconds
    maxQueueSize: 10000
};

// ============================================
// PROVIDERS & STATUS MAPPING
// ============================================

const SUPPORTED_PROVIDERS = new Set([
    "shiprocket",
    "delhivery",
    "bluedart",
    "generic"
]);

const SHIPMENT_STATUSES = new Set([
    "pending",
    "picked",
    "in_transit",
    "out_for_delivery",
    "delivered",
    "failed",
    "returned"
]);

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

const META_KEY = "__meta";

// ============================================
// CIRCUIT BREAKER INSTANCES
// ============================================

// Circuit breaker for courier API calls
class CourierCircuitBreaker {
    constructor(provider) {
        this.provider = provider;
        this.breaker = new CircuitBreaker(
            this.executeProviderCall.bind(this),
            {
                ...CIRCUIT_BREAKER_CONFIG,
                name: `courier_${provider}`
            }
        );
        this.setupEventListeners();
        this.state = "CLOSED";
        this.failureCount = 0;
        this.successCount = 0;
    }

    setupEventListeners() {
        this.breaker.on("open", () => {
            this.state = "OPEN";
            logger.warn(`Circuit breaker OPEN for provider: ${this.provider}`);
            this.logCircuitState("OPEN");
        });

        this.breaker.on("halfOpen", () => {
            this.state = "HALF-OPEN";
            logger.info(`Circuit breaker HALF-OPEN for provider: ${this.provider}`);
            this.logCircuitState("HALF-OPEN");
        });

        this.breaker.on("close", () => {
            this.state = "CLOSED";
            this.failureCount = 0;
            this.successCount = 0;
            logger.info(`Circuit breaker CLOSED for provider: ${this.provider}`);
            this.logCircuitState("CLOSED");
        });

        this.breaker.on("failure", (error) => {
            this.failureCount++;
            logger.error(`Circuit breaker failure for ${this.provider}:`, error.message);
        });

        this.breaker.on("success", () => {
            this.successCount++;
        });
    }

    async executeProviderCall(fn, ...args) {
        const startTime = Date.now();
        try {
            const result = await fn(...args);
            this.logMetrics("success", Date.now() - startTime);
            return result;
        } catch (error) {
            this.logMetrics("failure", Date.now() - startTime);
            throw error;
        }
    }

    async fire(fn, ...args) {
        return this.breaker.fire(fn, ...args);
    }

    logCircuitState(state) {
        const key = `circuit_breaker:${this.provider}:state`;
        redis.setex(key, 3600, JSON.stringify({
            state,
            timestamp: new Date().toISOString(),
            failureCount: this.failureCount,
            successCount: this.successCount
        }));
    }

    logMetrics(type, duration) {
        const key = `metrics:courier:${this.provider}`;
        const metric = {
            type,
            duration,
            timestamp: new Date().toISOString()
        };
        redis.rpush(key, JSON.stringify(metric));
        redis.ltrim(key, -1000, -1);
    }

    getStatus() {
        return {
            provider: this.provider,
            state: this.state,
            failureCount: this.failureCount,
            successCount: this.successCount,
            isOpen: this.breaker.opened,
            isHalfOpen: this.breaker.halfOpen,
            stats: this.breaker.stats
        };
    }
}

// ============================================
// DEAD-LETTER QUEUE (DLQ) SERVICE
// ============================================

class DeadLetterQueueService {
    constructor() {
        this.redis = redis;
        this.queueKey = "dlq:courier:webhooks";
        this.processingKey = "dlq:courier:processing";
        this.failedKey = "dlq:courier:failed";
        this.processedKey = "dlq:courier:processed";
        this.retryCountKey = "dlq:courier:retry:";
        this.initialized = false;
    }

    async initialize() {
        if (this.initialized) return;
        
        try {
            // Ensure Redis is connected
            await this.redis.ping();
            this.initialized = true;
            logger.info("✅ Dead-Letter Queue Service initialized");
        } catch (error) {
            logger.error("❌ DLQ initialization failed:", error);
            throw error;
        }
    }

    /**
     * Add failed webhook to DLQ
     */
    async enqueue(webhookData, error) {
        try {
            const entry = {
                id: webhookData.id || `dlq_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
                webhookId: webhookData.webhookId,
                provider: webhookData.provider,
                payload: webhookData.payload,
                error: {
                    message: error.message,
                    stack: error.stack,
                    timestamp: new Date().toISOString()
                },
                attempts: 0,
                maxRetries: DLQ_CONFIG.maxRetries,
                enqueuedAt: new Date().toISOString(),
                lastAttempt: null,
                status: "pending"
            };

            // Check queue size
            const queueSize = await this.redis.llen(this.queueKey);
            if (queueSize >= DLQ_CONFIG.maxQueueSize) {
                logger.error(`DLQ queue size limit reached: ${queueSize}`);
                // Store to backup file or database as fallback
                await this.storeToBackup(entry);
                return null;
            }

            const serialized = JSON.stringify(entry);
            await this.redis.rpush(this.queueKey, serialized);
            await this.redis.expire(this.queueKey, DLQ_CONFIG.ttl);
            
            // Store retry count
            await this.redis.setex(
                `${this.retryCountKey}${entry.id}`,
                DLQ_CONFIG.ttl,
                JSON.stringify({ attempts: 0, maxRetries: DLQ_CONFIG.maxRetries })
            );

            logger.info(`📦 Webhook added to DLQ: ${entry.id}`);
            return entry;
        } catch (error) {
            logger.error("DLQ enqueue error:", error);
            // Fallback: store to database
            await this.storeToDatabase(webhookData, error);
            return null;
        }
    }

    /**
     * Dequeue and process items from DLQ
     */
    async dequeue(limit = 10) {
        try {
            const items = [];
            
            for (let i = 0; i < limit; i++) {
                const item = await this.redis.lpop(this.queueKey);
                if (!item) break;
                
                try {
                    const parsed = JSON.parse(item);
                    const retryData = await this.redis.get(`${this.retryCountKey}${parsed.id}`);
                    let retryInfo = retryData ? JSON.parse(retryData) : { attempts: 0 };
                    
                    retryInfo.attempts += 1;
                    parsed.attempts = retryInfo.attempts;
                    parsed.lastAttempt = new Date().toISOString();
                    
                    if (parsed.attempts > parsed.maxRetries) {
                        // Max retries exceeded - mark as permanently failed
                        parsed.status = "failed";
                        await this.redis.rpush(this.failedKey, JSON.stringify(parsed));
                        await this.redis.del(`${this.retryCountKey}${parsed.id}`);
                        logger.error(`DLQ item ${parsed.id} exceeded max retries, moved to failed queue`);
                        continue;
                    }
                    
                    // Update retry count
                    await this.redis.setex(
                        `${this.retryCountKey}${parsed.id}`,
                        DLQ_CONFIG.ttl,
                        JSON.stringify(retryInfo)
                    );
                    
                    // Add to processing queue (for monitoring)
                    await this.redis.rpush(this.processingKey, JSON.stringify(parsed));
                    
                    items.push(parsed);
                } catch (error) {
                    logger.error("DLQ dequeue parse error:", error);
                    // Move corrupted items to failed queue
                    await this.redis.rpush(this.failedKey, item);
                }
            }
            
            return items;
        } catch (error) {
            logger.error("DLQ dequeue error:", error);
            return [];
        }
    }

    /**
     * Mark DLQ item as processed
     */
    async markProcessed(itemId) {
        try {
            // Move from processing to processed
            const items = await this.redis.lrange(this.processingKey, 0, -1);
            for (const item of items) {
                const parsed = JSON.parse(item);
                if (parsed.id === itemId) {
                    await this.redis.lrem(this.processingKey, 1, item);
                    parsed.status = "processed";
                    parsed.processedAt = new Date().toISOString();
                    await this.redis.rpush(this.processedKey, JSON.stringify(parsed));
                    await this.redis.del(`${this.retryCountKey}${itemId}`);
                    break;
                }
            }
        } catch (error) {
            logger.error("DLQ mark processed error:", error);
        }
    }

    /**
     * Get DLQ statistics
     */
    async getStats() {
        try {
            const [pending, processing, failed, processed, queueSize] = await Promise.all([
                this.redis.llen(this.queueKey),
                this.redis.llen(this.processingKey),
                this.redis.llen(this.failedKey),
                this.redis.llen(this.processedKey),
                this.redis.llen(this.queueKey)
            ]);

            return {
                pending,
                processing,
                failed,
                processed,
                queueSize,
                maxQueueSize: DLQ_CONFIG.maxQueueSize,
                ttl: DLQ_CONFIG.ttl
            };
        } catch (error) {
            logger.error("DLQ stats error:", error);
            return null;
        }
    }

    /**
     * Fallback: Store to database
     */
    async storeToDatabase(webhookData, error) {
        try {
            await db.query(
                `INSERT INTO courier_webhook_errors 
                 (webhook_id, provider, payload, error_message, error_stack, created_at)
                 VALUES (?, ?, ?, ?, ?, NOW())`,
                [
                    webhookData.webhookId || null,
                    webhookData.provider || 'unknown',
                    JSON.stringify(webhookData.payload || {}),
                    error.message || 'Unknown error',
                    error.stack || null
                ]
            );
        } catch (dbError) {
            logger.error("Failed to store DLQ fallback to database:", dbError);
        }
    }

    /**
     * Fallback: Store to backup file
     */
    async storeToBackup(entry) {
        try {
            const fs = require('fs').promises;
            const backupDir = './logs/dlq_backup';
            await fs.mkdir(backupDir, { recursive: true });
            const filename = `${backupDir}/dlq_${new Date().toISOString().slice(0,10)}.json`;
            const content = await fs.readFile(filename, 'utf-8').catch(() => '[]');
            const data = JSON.parse(content);
            data.push(entry);
            await fs.writeFile(filename, JSON.stringify(data, null, 2));
        } catch (error) {
            logger.error("DLQ backup storage error:", error);
        }
    }
}

// ============================================
// MAIN COURIER WEBHOOK SERVICE
// ============================================

// Upper bound on the in-process dedupe cache. Every distinct webhook event
// adds one entry and nothing ever removed them, so a long-lived process
// accumulated one Map entry per courier event forever -- an unbounded leak on
// the hottest path in the service. Oldest-first eviction is enough here: the
// cache is only a fast path in front of `findWebhookByDedupeKey`, so an evicted
// key costs one extra SELECT, never a double-process.
const PROCESSED_CACHE_LIMIT = Number(process.env.COURIER_PROCESSED_CACHE_LIMIT) || 10000;

class CourierWebhookService {
    constructor() {
        this.circuitBreakers = new Map();
        this.dlq = new DeadLetterQueueService();
        this.processedCache = new Map();
        this.initialized = false;
        this.processingLocks = new Map();
    }

    /**
     * Record a processed event, evicting the oldest entry once the cache is
     * full. Map preserves insertion order, so the first key is the oldest.
     */
    rememberProcessed(dedupeKey, value) {
        if (this.processedCache.size >= PROCESSED_CACHE_LIMIT) {
            const oldest = this.processedCache.keys().next().value;
            this.processedCache.delete(oldest);
        }
        this.processedCache.set(dedupeKey, value);
    }

    /**
     * Drop the dedupe cache. Used by tests, which share this singleton across
     * cases and would otherwise see one case's event treated as another's
     * duplicate.
     */
    clearProcessedCache() {
        this.processedCache.clear();
    }

    async initialize() {
        if (this.initialized) return;
        
        try {
            await this.dlq.initialize();
            this.initialized = true;
            logger.info("✅ Courier Webhook Service initialized");
        } catch (error) {
            logger.error("❌ Courier Webhook Service initialization failed:", error);
            throw error;
        }
    }

    /**
     * Get or create circuit breaker for provider
     */
    getCircuitBreaker(provider) {
        const key = provider.toLowerCase();
        if (!this.circuitBreakers.has(key)) {
            this.circuitBreakers.set(key, new CourierCircuitBreaker(key));
        }
        return this.circuitBreakers.get(key);
    }

    /**
     * Execute courier operation with circuit breaker
     */
    async executeWithCircuitBreaker(provider, operation, ...args) {
        const cb = this.getCircuitBreaker(provider);
        
        // Check if circuit is open
        if (cb.breaker.opened) {
            logger.warn(`Circuit breaker is OPEN for ${provider}, using fallback`);
            return this.executeFallback(provider, operation, ...args);
        }

        try {
            const result = await cb.fire(operation, ...args);
            return result;
        } catch (error) {
            // Check if this is a retryable error
            if (this.isRetryableError(error)) {
                logger.warn(`Retryable error for ${provider}:`, error.message);
                // Log to DLQ for retry
                await this.dlq.enqueue(
                    { provider, args: JSON.stringify(args), operation: operation.name },
                    error
                );
            }
            throw error;
        }
    }

    /**
     * Execute fallback for non-critical updates
     */
    async executeFallback(provider, operation, ...args) {
        logger.info(`Executing fallback for ${provider}`);
        
        // Return a safe default response
        return {
            success: true,
            fallback: true,
            message: "Operation completed with fallback response",
            provider,
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Check if error is retryable
     */
    isRetryableError(error) {
        const retryableMessages = [
            "ETIMEDOUT",
            "ECONNRESET",
            "ECONNREFUSED",
            "timeout",
            "network",
            "5xx",
            "503",
            "504",
            "502"
        ];
        const errorString = error.message + error.code;
        return retryableMessages.some(msg => 
            errorString.toLowerCase().includes(msg.toLowerCase())
        );
    }

    /**
     * Process DLQ items with exponential backoff
     */
    async processDLQ(limit = 10) {
        const items = await this.dlq.dequeue(limit);
        const results = { processed: 0, failed: 0, skipped: 0 };

        for (const item of items) {
            try {
                // Calculate delay with jitter
                const delay = this.calculateBackoffDelay(item.attempts);
                await this.sleep(delay);

                // Attempt to reprocess
                const payload = typeof item.payload === 'string' ? 
                    JSON.parse(item.payload) : item.payload;
                
                const provider = item.provider || payload?.provider || 'generic';
                const event = this.normalizeEvent(provider, payload);
                const result = await this.processWebhook(item.webhookId, event);

                if (result.processed) {
                    await this.dlq.markProcessed(item.id);
                    results.processed++;
                } else {
                    results.failed++;
                }
            } catch (error) {
                logger.error(`DLQ processing error for item ${item.id}:`, error);
                results.failed++;
            }
        }

        return results;
    }

    /**
     * Calculate backoff delay with jitter
     */
    calculateBackoffDelay(attempt) {
        const baseDelay = RETRY_CONFIG.baseDelay;
        const maxDelay = RETRY_CONFIG.maxDelay;
        const jitterFactor = RETRY_CONFIG.jitterFactor;
        
        // Exponential backoff
        let delay = baseDelay * Math.pow(RETRY_CONFIG.backoffMultiplier, attempt - 1);
        
        // Add jitter
        const jitter = (Math.random() * 2 - 1) * delay * jitterFactor;
        delay = Math.min(delay + jitter, maxDelay);
        
        return Math.max(delay, 0);
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Ingest webhook with circuit breaker protection
     */
    async ingestWebhook({ provider, payload, signature }) {
        if (!this.isSupportedProvider(provider)) {
            throw new WebhookError(`Unsupported courier provider: ${provider}`, 400);
        }

        // Acquire processing lock
        const lockKey = `lock:webhook:${provider}:${payload.tracking_number || payload.id}`;
        if (await this.acquireLock(lockKey)) {
            try {
                return await this.executeWithCircuitBreaker(
                    provider,
                    this._ingestWebhookInternal.bind(this),
                    { provider, payload, signature }
                );
            } finally {
                await this.releaseLock(lockKey);
            }
        } else {
            logger.warn(`Webhook already processing: ${lockKey}`);
            return { 
                duplicate: true, 
                processed: false, 
                message: "Webhook already being processed" 
            };
        }
    }

    /**
     * Internal webhook ingestion
     */
    async _ingestWebhookInternal({ provider, payload, signature }) {
        this.verifySignature(provider, payload, signature);

        const event = this.normalizeEvent(provider, payload);
        const dedupeKey = `${event.provider}:${event.eventId}`;

        // Check cache first
        if (this.processedCache.has(dedupeKey)) {
            const cached = this.processedCache.get(dedupeKey);
            if (cached.processed) {
                logger.info(`Duplicate courier webhook ignored (dedupeKey=${dedupeKey})`);
                return { duplicate: true, processed: true, webhookId: cached.webhookId };
            }
        }

        const existing = await this.findWebhookByDedupeKey(dedupeKey);
        if (existing && existing.processed) {
            // Cache for future duplicates
            this.rememberProcessed(dedupeKey, {
                processed: true,
                webhookId: existing.id
            });
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

        let webhookId = existing ? existing.id : null;
        const shipment = await this.findShipmentByTracking(event.trackingNumber);
        
        if (webhookId === null) {
            webhookId = await this.insertWebhookRow({
                shipmentId: shipment ? shipment.id : null,
                eventType: event.rawStatus,
                payload: storedPayload
            });
        }

        try {
            const shipmentId = await this.processEvent(webhookId, event);
            this.rememberProcessed(dedupeKey, {
                processed: true,
                webhookId,
                shipmentId
            });
            return {
                duplicate: false,
                processed: true,
                webhookId,
                shipmentId,
                status: event.mappedStatus
            };
        } catch (error) {
            // Log to DLQ for retry
            await this.dlq.enqueue({
                webhookId,
                provider,
                payload: storedPayload,
                error: error.message
            }, error);
            
            await this.recordWebhookError(webhookId, error.message);
            logger.warn(`Courier webhook ${webhookId} stored but not processed: ${error.message}`);
            return {
                duplicate: false,
                processed: false,
                webhookId,
                error: error.message
            };
        }
    }

    /**
     * Process pending webhooks with batch processing
     */
    async processPendingWebhooks(limit = 50) {
        const [rows] = await db.query(
            `SELECT id, payload FROM courier_webhooks
             WHERE processed = 0
             ORDER BY received_at ASC
             LIMIT ?`,
            [limit]
        );

        const summary = { 
            total: safeArray(rows).length, 
            processed: 0, 
            failed: 0,
            retried: 0
        };

        for (const row of safeArray(rows)) {
            // Acquire lock for this row
            const lockKey = `lock:webhook:${row.id}`;
            if (!await this.acquireLock(lockKey)) {
                summary.failed++;
                continue;
            }

            try {
                const payload = typeof row.payload === "string" ? 
                    JSON.parse(row.payload) : row.payload;
                const provider = payload?.[META_KEY]?.provider || "generic";
                const event = this.normalizeEvent(provider, payload);
                await this.processEvent(row.id, event);
                summary.processed++;
            } catch (error) {
                await this.recordWebhookError(row.id, error.message);
                summary.failed++;
                logger.warn(`Retry of courier webhook ${row.id} failed: ${error.message}`);
            } finally {
                await this.releaseLock(lockKey);
            }
        }

        // Process DLQ items as well
        if (summary.processed > 0) {
            const dlqResult = await this.processDLQ(limit);
            summary.retried = dlqResult.processed;
            summary.failed += dlqResult.failed;
        }

        return summary;
    }

    /**
     * Acquire distributed lock using Redis
     */
    async acquireLock(key, ttl = 30000) {
        try {
            const result = await redis.set(key, Date.now().toString(), 'NX', 'PX', ttl);
            return result === 'OK';
        } catch (error) {
            logger.error('Lock acquire error:', error);
            return false;
        }
    }

    /**
     * Release distributed lock
     */
    async releaseLock(key) {
        try {
            await redis.del(key);
            return true;
        } catch (error) {
            logger.error('Lock release error:', error);
            return false;
        }
    }

    // ============================================
    // HELPER METHODS
    // ============================================

    isSupportedProvider(provider) {
        return SUPPORTED_PROVIDERS.has(sanitizeString(provider).toLowerCase());
    }

    normalizeStatusKey(value) {
        return sanitizeString(value)
            .toLowerCase()
            .replace(/[\s-]+/g, "_");
    }

    mapCourierStatus(rawStatus) {
        return COURIER_STATUS_MAP[this.normalizeStatusKey(rawStatus)] || null;
    }

    normalizeEvent(provider, payload) {
        if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
            throw new WebhookError("Webhook payload must be a JSON object", 400);
        }

        const trackingNumber = sanitizeString(
            this.pick(payload, ["tracking_number", "trackingNumber", "awb", "awb_code", "waybill"])
        );
        const status = sanitizeString(
            this.pick(payload, ["status", "current_status", "shipment_status", "event"])
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

        const occurredAtRaw = this.pick(payload, [
            "occurred_at",
            "timestamp",
            "event_time",
            "status_time",
            "updated_at"
        ]);
        const occurredAt = occurredAtRaw ? new Date(occurredAtRaw) : new Date();

        const providerEventId = sanitizeString(
            this.pick(payload, ["event_id", "eventId", "id", "webhook_id"])
        );
        const eventId = providerEventId || this.deriveEventId(trackingNumber, status, occurredAt);

        return {
            provider: provider.toLowerCase(),
            eventId,
            trackingNumber,
            rawStatus: status,
            mappedStatus: this.mapCourierStatus(status),
            description: sanitizeString(this.pick(payload, ["description", "message", "activity", "remark"])) || null,
            location: sanitizeString(this.pick(payload, ["location", "city", "current_location"])) || null,
            latitude: this.toNumberOrNull(this.pick(payload, ["latitude", "lat"])),
            longitude: this.toNumberOrNull(this.pick(payload, ["longitude", "lng", "lon"])),
            carrierStatusCode: sanitizeString(this.pick(payload, ["status_code", "carrier_status_code", "code"])) || null,
            estimatedDelivery: this.toDateStringOrNull(this.pick(payload, ["estimated_delivery", "edd", "expected_delivery"])),
            occurredAt: Number.isNaN(occurredAt.getTime()) ? new Date() : occurredAt
        };
    }

    pick(payload, keys) {
        for (const key of keys) {
            if (payload[key] !== undefined && payload[key] !== null && payload[key] !== "") {
                return payload[key];
            }
        }
        return undefined;
    }

    deriveEventId(trackingNumber, status, occurredAt) {
        const basis = `${trackingNumber}|${status}|${occurredAt instanceof Date ? occurredAt.toISOString() : occurredAt}`;
        return crypto.createHash("sha256").update(basis).digest("hex");
    }

    toNumberOrNull(value) {
        if (value === undefined || value === null || value === "") return null;
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }

    toDateStringOrNull(value) {
        if (!value) return null;
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
    }

    verifySignature(provider, payload, signature) {
        const secret = process.env[`COURIER_WEBHOOK_SECRET_${provider.toUpperCase()}`]
            || process.env.COURIER_WEBHOOK_SECRET;

        if (!secret) return;

        if (!verifyClaudeSignature(signature, payload, secret)) {
            throw new WebhookError("Invalid webhook signature", 401);
        }
    }

    async findWebhookByDedupeKey(dedupeKey) {
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

    async findShipmentByTracking(trackingNumber) {
        // order_id comes along so a courier event can be reflected onto the
        // order's status history (#1351). Before this, the pipeline advanced
        // `shipments.status` and nothing propagated it anywhere the customer
        // could see.
        const [rows] = await db.query(
            `SELECT id, status, order_id FROM shipments
             WHERE tracking_number = ? AND deleted_at IS NULL
             LIMIT 1`,
            [trackingNumber]
        );
        return safeArray(rows)[0] || null;
    }

    async insertWebhookRow({ shipmentId, eventType, payload }) {
        const [result] = await db.query(
            `INSERT INTO courier_webhooks (shipment_id, event_type, payload, processed)
             VALUES (?, ?, ?, 0)`,
            [shipmentId || null, eventType, JSON.stringify(payload)]
        );
        return result.insertId;
    }

    async markWebhookProcessed(webhookId, shipmentId) {
        await db.query(
            `UPDATE courier_webhooks
             SET processed = 1, processed_at = NOW(), error_message = NULL, shipment_id = ?
             WHERE id = ?`,
            [shipmentId || null, webhookId]
        );
    }

    async recordWebhookError(webhookId, message) {
        await db.query(
            `UPDATE courier_webhooks
             SET processed = 0, error_message = ?
             WHERE id = ?`,
            [String(message).slice(0, 1000), webhookId]
        );
    }

    async processEvent(webhookId, event) {
        const shipment = await this.findShipmentByTracking(event.trackingNumber);
        if (!shipment) {
            throw new WebhookError(
                `No shipment found for tracking number ${event.trackingNumber}`,
                422
            );
        }
        await this.applyEventToShipment(shipment, event);
        await this.markWebhookProcessed(webhookId, shipment.id);
        return shipment.id;
    }

    async applyEventToShipment(shipment, event) {
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

            await this.reflectOntoOrder(shipment, event);
        }
    }

    /**
     * Mirror a courier event onto the order the shipment belongs to.
     *
     * The pipeline advanced `shipments.status` and stopped there, so a parcel
     * could be marked delivered by the carrier while the customer's order page
     * still said "processing" (#1351).
     *
     * Only the statuses that mean something to a shopper are mirrored: a
     * shipment moving between internal hub states is not an order status
     * change, and putting every carrier scan on the order timeline would bury
     * the four events that matter.
     *
     * Failure is contained. A courier webhook must still be marked processed
     * even if the order-side write fails, or the DLQ will replay an event that
     * has already been applied to the shipment.
     */
    async reflectOntoOrder(shipment, event) {
        const ORDER_VISIBLE = {
            shipped: "shipped",
            out_for_delivery: "out_for_delivery",
            delivered: "delivered",
            returned: "cancelled"
        };

        const orderStatus = ORDER_VISIBLE[event.mappedStatus];
        if (!orderStatus || !shipment.order_id) return false;

        const connection = await db.getConnection();

        try {
            await connection.beginTransaction();

            const [orders] = await connection.query(
                "SELECT status FROM orders WHERE id = ? FOR UPDATE",
                [shipment.order_id]
            );

            const current = safeArray(orders)[0];

            if (!current || current.status === orderStatus) {
                await connection.rollback();
                return false;
            }

            await connection.query("UPDATE orders SET status = ? WHERE id = ?", [
                orderStatus,
                shipment.order_id
            ]);

            await orderStatusHistory.recordTransition(connection, {
                orderId: shipment.order_id,
                fromStatus: current.status,
                toStatus: orderStatus,
                source: "courier",
                reason: event.description || `Courier reported ${event.rawStatus}`,
                metadata: {
                    provider: event.provider,
                    trackingNumber: event.trackingNumber,
                    carrierStatus: event.rawStatus,
                    location: event.location || null
                }
            });

            await connection.commit();
            return true;
        } catch (error) {
            await connection.rollback();
            logger.error(
                `Could not reflect courier event onto order ${shipment.order_id}: ${error.message}`
            );
            return false;
        } finally {
            connection.release();
        }
    }

    /**
     * Get circuit breaker status for all providers
     */
    getCircuitBreakerStatus() {
        const status = {};
        for (const [provider, cb] of this.circuitBreakers) {
            status[provider] = cb.getStatus();
        }
        return status;
    }

    /**
     * Get DLQ statistics
     */
    async getDLQStats() {
        return await this.dlq.getStats();
    }

    /**
     * Manual retry of DLQ item
     */
    async manualRetryDLQ(itemId) {
        try {
            const items = await this.redis.lrange(this.dlq.failedKey, 0, -1);
            for (const item of items) {
                const parsed = JSON.parse(item);
                if (parsed.id === itemId) {
                    // Move back to main queue
                    await this.redis.lrem(this.dlq.failedKey, 1, item);
                    parsed.status = 'pending';
                    parsed.attempts = 0;
                    await this.redis.rpush(this.dlq.queueKey, JSON.stringify(parsed));
                    return { success: true, message: 'Item moved to DLQ queue for retry' };
                }
            }
            return { success: false, message: 'Item not found in failed queue' };
        } catch (error) {
            logger.error('Manual DLQ retry error:', error);
            return { success: false, message: error.message };
        }
    }

    /**
     * Get service status
     */
    getStatus() {
        return {
            initialized: this.initialized,
            circuitBreakers: this.circuitBreakers.size,
            processedCacheSize: this.processedCache.size,
            dlqInitialized: this.dlq.initialized,
            timestamp: new Date().toISOString()
        };
    }
}

// ============================================
// CUSTOM ERROR CLASS
// ============================================

class WebhookError extends Error {
    constructor(message, statusCode) {
        super(message);
        this.name = "WebhookError";
        this.statusCode = statusCode;
    }
}

// ============================================
// EXPORT
// ============================================

const courierWebhookService = new CourierWebhookService();

module.exports = {
    courierWebhookService,
    CourierWebhookService,
    DeadLetterQueueService,
    CourierCircuitBreaker,
    WebhookError,
    SUPPORTED_PROVIDERS,
    SHIPMENT_STATUSES,
    RETRY_CONFIG,
    DLQ_CONFIG,
    CIRCUIT_BREAKER_CONFIG
};

// Flat, singleton-bound surface.
//
// #1157 shipped this module as a bag of functions:
// `require('./courierWebhookService').ingestWebhook(...)`. The circuit-breaker
// and DLQ rework in #1268 turned it into a class and exported only the named
// bag above, which silently turned every one of those call sites into
// "is not a function" -- including all eleven tests in
// tests/courierWebhook.test.js (#1341).
//
// Both shapes are supported now. The methods are bound to the singleton, so
// destructuring (`const { ingestWebhook } = require(...)`) keeps working too.
[
    'ingestWebhook',
    'processPendingWebhooks',
    'processDLQ',
    'normalizeEvent',
    'mapCourierStatus',
    'isSupportedProvider',
    'verifySignature',
    'getCircuitBreakerStatus',
    'getDLQStats',
    'manualRetryDLQ',
    'getCircuitBreaker',
    'initialize'
].forEach((method) => {
    if (typeof courierWebhookService[method] === 'function') {
        module.exports[method] = courierWebhookService[method].bind(courierWebhookService);
    }
});