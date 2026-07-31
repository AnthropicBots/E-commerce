// backend/services/provenanceService.js
const db = require('../config/db').promise;
const crypto = require('crypto');
const EventEmitter = require('events');

// ============================================
// PROVENANCE CONFIGURATION
// ============================================

const ENTITY_TYPES = {
    PRODUCT: 'product',
    ORDER: 'order',
    USER: 'user',
    CART: 'cart',
    PAYMENT: 'payment',
    INVOICE: 'invoice',
    RECOMMENDATION: 'recommendation',
    PROMOTION: 'promotion',
    INVENTORY: 'inventory',
    REVIEW: 'review',
    ANALYTICS: 'analytics'
};

const OPERATION_TYPES = {
    CREATE: 'create',
    UPDATE: 'update',
    DELETE: 'delete',
    READ: 'read',
    TRANSFORM: 'transform',
    MERGE: 'merge',
    SPLIT: 'split',
    MIGRATE: 'migrate',
    PROCESS: 'process',
    GENERATE: 'generate'
};

const PROVENANCE_STATUS = {
    PENDING: 'pending',
    COMPLETED: 'completed',
    FAILED: 'failed',
    PARTIAL: 'partial'
};

// ============================================
// PROVENANCE SERVICE
// ============================================

class ProvenanceService extends EventEmitter {
    constructor() {
        super();
        this.provenanceRecords = new Map();
        this.lineageGraph = new Map();
        this.entityHistory = new Map();
        this.correlationCache = new Map();
        this.isInitialized = false;
        this.bufferSize = 100;
        this.flushInterval = 5000;
        this.recordBuffer = [];
    }

    /**
     * Initialize provenance service
     */
    async initialize() {
        if (this.isInitialized) return;

        // Load existing provenance records
        await this.loadProvenanceRecords();

        // Start periodic flush
        setInterval(() => this.flushBuffer(), this.flushInterval);

        this.isInitialized = true;
        console.log('✅ Data Provenance Service initialized');
        return this;
    }

    /**
     * Record a provenance event
     */
    async recordProvenance(data) {
        const record = {
            id: this.generateProvenanceId(),
            entityId: data.entityId,
            entityType: data.entityType || ENTITY_TYPES.PRODUCT,
            sourceModule: data.sourceModule || 'unknown',
            destinationModule: data.destinationModule || 'unknown',
            operation: data.operation || OPERATION_TYPES.PROCESS,
            previousVersion: data.previousVersion || null,
            currentVersion: data.currentVersion || null,
            responsibleService: data.responsibleService || 'system',
            correlationId: data.correlationId || null,
            metadata: data.metadata || {},
            status: data.status || PROVENANCE_STATUS.COMPLETED,
            timestamp: new Date().toISOString(),
            hash: null
        };

        // Generate hash for integrity
        record.hash = this.generateHash(record);

        // Store in memory
        this.provenanceRecords.set(record.id, record);

        // Add to buffer for batch processing
        this.recordBuffer.push(record);

        // Update lineage graph
        this.updateLineageGraph(record);

        // Update entity history
        this.updateEntityHistory(record);

        // Emit event
        this.emit('provenance.recorded', record);

        // Flush if buffer is full
        if (this.recordBuffer.length >= this.bufferSize) {
            await this.flushBuffer();
        }

        return record;
    }

    /**
     * Record product provenance
     */
    async recordProductProvenance(productId, operation, data = {}) {
        return this.recordProvenance({
            entityId: productId,
            entityType: ENTITY_TYPES.PRODUCT,
            operation,
            sourceModule: data.sourceModule || 'catalog',
            destinationModule: data.destinationModule || 'catalog',
            previousVersion: data.previousVersion,
            currentVersion: data.currentVersion,
            responsibleService: data.responsibleService || 'product-service',
            metadata: {
                productName: data.productName,
                category: data.category,
                price: data.price,
                ...data.metadata
            },
            correlationId: data.correlationId
        });
    }

    /**
     * Record order provenance
     */
    async recordOrderProvenance(orderId, operation, data = {}) {
        return this.recordProvenance({
            entityId: orderId,
            entityType: ENTITY_TYPES.ORDER,
            operation,
            sourceModule: data.sourceModule || 'checkout',
            destinationModule: data.destinationModule || 'orders',
            previousVersion: data.previousVersion,
            currentVersion: data.currentVersion,
            responsibleService: data.responsibleService || 'order-service',
            metadata: {
                userId: data.userId,
                total: data.total,
                status: data.status,
                ...data.metadata
            },
            correlationId: data.correlationId
        });
    }

    /**
     * Record user provenance
     */
    async recordUserProvenance(userId, operation, data = {}) {
        return this.recordProvenance({
            entityId: userId,
            entityType: ENTITY_TYPES.USER,
            operation,
            sourceModule: data.sourceModule || 'auth',
            destinationModule: data.destinationModule || 'user-management',
            previousVersion: data.previousVersion,
            currentVersion: data.currentVersion,
            responsibleService: data.responsibleService || 'auth-service',
            metadata: {
                email: data.email,
                role: data.role,
                ...data.metadata
            },
            correlationId: data.correlationId
        });
    }

    /**
     * Record cart provenance
     */
    async recordCartProvenance(cartId, operation, data = {}) {
        return this.recordProvenance({
            entityId: cartId,
            entityType: ENTITY_TYPES.CART,
            operation,
            sourceModule: data.sourceModule || 'cart',
            destinationModule: data.destinationModule || 'cart',
            previousVersion: data.previousVersion,
            currentVersion: data.currentVersion,
            responsibleService: data.responsibleService || 'cart-service',
            metadata: {
                userId: data.userId,
                itemCount: data.itemCount,
                total: data.total,
                ...data.metadata
            },
            correlationId: data.correlationId
        });
    }

    /**
     * Record payment provenance
     */
    async recordPaymentProvenance(paymentId, operation, data = {}) {
        return this.recordProvenance({
            entityId: paymentId,
            entityType: ENTITY_TYPES.PAYMENT,
            operation,
            sourceModule: data.sourceModule || 'payment',
            destinationModule: data.destinationModule || 'payment',
            previousVersion: data.previousVersion,
            currentVersion: data.currentVersion,
            responsibleService: data.responsibleService || 'payment-service',
            metadata: {
                orderId: data.orderId,
                amount: data.amount,
                method: data.method,
                status: data.status,
                ...data.metadata
            },
            correlationId: data.correlationId
        });
    }

    /**
     * Get provenance for an entity
     */
    async getProvenance(entityId, entityType = null, filters = {}) {
        let records = Array.from(this.provenanceRecords.values())
            .filter(r => r.entityId === entityId);

        if (entityType) {
            records = records.filter(r => r.entityType === entityType);
        }

        if (filters.operation) {
            records = records.filter(r => r.operation === filters.operation);
        }

        if (filters.fromDate) {
            records = records.filter(r => r.timestamp >= filters.fromDate);
        }

        if (filters.toDate) {
            records = records.filter(r => r.timestamp <= filters.toDate);
        }

        if (filters.limit) {
            records = records.slice(-filters.limit);
        }

        return records.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    }

    /**
     * Get entity lineage (complete history)
     */
    async getEntityLineage(entityId, entityType = null) {
        const records = await this.getProvenance(entityId, entityType);
        
        const lineage = {
            entityId,
            entityType,
            records: records,
            timeline: records.map(r => ({
                timestamp: r.timestamp,
                operation: r.operation,
                source: r.sourceModule,
                destination: r.destinationModule,
                version: r.currentVersion
            })),
            summary: {
                totalOperations: records.length,
                firstSeen: records[0]?.timestamp || null,
                lastSeen: records[records.length - 1]?.timestamp || null,
                modules: [...new Set(records.map(r => r.sourceModule))],
                operations: [...new Set(records.map(r => r.operation))]
            }
        };

        return lineage;
    }

    /**
     * Get entity flow (how data moves between modules)
     */
    async getEntityFlow(entityId, entityType = null) {
        const records = await this.getProvenance(entityId, entityType);
        
        const flow = [];
        let currentModule = null;

        for (const record of records) {
            if (record.sourceModule !== currentModule) {
                flow.push({
                    from: record.sourceModule,
                    to: record.destinationModule,
                    operation: record.operation,
                    timestamp: record.timestamp,
                    count: 1
                });
                currentModule = record.destinationModule;
            } else {
                // Update last flow entry
                const last = flow[flow.length - 1];
                if (last) {
                    last.count++;
                    last.to = record.destinationModule;
                }
            }
        }

        return flow;
    }

    /**
     * Get module dependencies based on provenance
     */
    async getModuleDependencies() {
        const dependencies = new Map();

        for (const record of this.provenanceRecords.values()) {
            const key = `${record.sourceModule}->${record.destinationModule}`;
            if (!dependencies.has(key)) {
                dependencies.set(key, {
                    source: record.sourceModule,
                    destination: record.destinationModule,
                    count: 0,
                    entities: new Set()
                });
            }
            const dep = dependencies.get(key);
            dep.count++;
            dep.entities.add(record.entityId);
        }

        return Array.from(dependencies.values()).map(d => ({
            ...d,
            entities: Array.from(d.entities)
        }));
    }

    /**
     * Get provenance statistics
     */
    async getStatistics() {
        const records = Array.from(this.provenanceRecords.values());
        
        return {
            totalRecords: records.length,
            byEntityType: records.reduce((acc, r) => {
                acc[r.entityType] = (acc[r.entityType] || 0) + 1;
                return acc;
            }, {}),
            byOperation: records.reduce((acc, r) => {
                acc[r.operation] = (acc[r.operation] || 0) + 1;
                return acc;
            }, {}),
            byModule: records.reduce((acc, r) => {
                acc[r.sourceModule] = (acc[r.sourceModule] || 0) + 1;
                acc[r.destinationModule] = (acc[r.destinationModule] || 0) + 1;
                return acc;
            }, {}),
            uniqueEntities: new Set(records.map(r => r.entityId)).size,
            bufferSize: this.recordBuffer.length,
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Flush buffer to database
     */
    async flushBuffer() {
        if (this.recordBuffer.length === 0) return;

        const batch = [...this.recordBuffer];
        this.recordBuffer = [];

        try {
            for (const record of batch) {
                await db.query(
                    `INSERT INTO provenance_records 
                     (provenance_id, entity_id, entity_type, source_module,
                      destination_module, operation, previous_version,
                      current_version, responsible_service, correlation_id,
                      metadata, status, hash, timestamp)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                     ON DUPLICATE KEY UPDATE
                     status = VALUES(status),
                     metadata = VALUES(metadata)`,
                    [
                        record.id,
                        record.entityId,
                        record.entityType,
                        record.sourceModule,
                        record.destinationModule,
                        record.operation,
                        record.previousVersion,
                        record.currentVersion,
                        record.responsibleService,
                        record.correlationId,
                        JSON.stringify(record.metadata),
                        record.status,
                        record.hash,
                        record.timestamp
                    ]
                );
            }

            console.log(`📝 Flushed ${batch.length} provenance records`);
        } catch (error) {
            console.error('Flush buffer error:', error);
            // Re-queue failed records
            this.recordBuffer = [...batch, ...this.recordBuffer];
        }
    }

    /**
     * Update lineage graph
     */
    updateLineageGraph(record) {
        const key = `${record.entityId}:${record.entityType}`;
        if (!this.lineageGraph.has(key)) {
            this.lineageGraph.set(key, []);
        }
        this.lineageGraph.get(key).push(record.id);
    }

    /**
     * Update entity history
     */
    updateEntityHistory(record) {
        const key = `${record.entityId}:${record.entityType}`;
        if (!this.entityHistory.has(key)) {
            this.entityHistory.set(key, []);
        }
        this.entityHistory.get(key).push({
            recordId: record.id,
            timestamp: record.timestamp,
            version: record.currentVersion,
            operation: record.operation
        });
    }

    /**
     * Generate hash for record
     */
    generateHash(record) {
        const data = {
            entityId: record.entityId,
            entityType: record.entityType,
            operation: record.operation,
            timestamp: record.timestamp,
            sourceModule: record.sourceModule,
            destinationModule: record.destinationModule
        };
        return crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
    }

    /**
     * Generate provenance ID
     */
    generateProvenanceId() {
        return `PROV_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    }

    /**
     * Load provenance records from database
     */
    async loadProvenanceRecords() {
        try {
            const [rows] = await db.query(
                `SELECT * FROM provenance_records 
                 ORDER BY timestamp DESC 
                 LIMIT 10000`
            );

            for (const row of rows) {
                const record = {
                    id: row.provenance_id,
                    entityId: row.entity_id,
                    entityType: row.entity_type,
                    sourceModule: row.source_module,
                    destinationModule: row.destination_module,
                    operation: row.operation,
                    previousVersion: row.previous_version,
                    currentVersion: row.current_version,
                    responsibleService: row.responsible_service,
                    correlationId: row.correlation_id,
                    metadata: JSON.parse(row.metadata || '{}'),
                    status: row.status,
                    hash: row.hash,
                    timestamp: row.timestamp
                };

                this.provenanceRecords.set(record.id, record);
                this.updateLineageGraph(record);
                this.updateEntityHistory(record);
            }

            console.log(`📊 Loaded ${rows.length} provenance records`);
        } catch (error) {
            console.error('Load provenance records error:', error);
        }
    }

    /**
     * Get provenance by correlation ID
     */
    async getByCorrelationId(correlationId) {
        return Array.from(this.provenanceRecords.values())
            .filter(r => r.correlationId === correlationId)
            .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    }

    /**
     * Search provenance records
     */
    async searchProvenance(query) {
        const results = [];
        const lowerQuery = query.toLowerCase();

        for (const record of this.provenanceRecords.values()) {
            if (record.entityId.toLowerCase().includes(lowerQuery) ||
                record.entityType.toLowerCase().includes(lowerQuery) ||
                record.sourceModule.toLowerCase().includes(lowerQuery) ||
                record.destinationModule.toLowerCase().includes(lowerQuery) ||
                record.operation.toLowerCase().includes(lowerQuery) ||
                JSON.stringify(record.metadata).toLowerCase().includes(lowerQuery)) {
                results.push(record);
            }
        }

        return results;
    }

    /**
     * Shutdown service
     */
    async shutdown() {
        await this.flushBuffer();
        console.log('⏹️ Data Provenance Service shut down');
    }
}

// ============================================
// PROVENANCE MIDDLEWARE
// ============================================

/**
 * Middleware to add provenance context
 */
function provenanceMiddleware(req, res, next) {
    req.provenance = {
        correlationId: req.correlationId || req.headers['x-correlation-id'] || null,
        sourceModule: req.path.split('/')[2] || 'unknown',
        responsibleService: req.user?.role || 'system',
        timestamp: new Date().toISOString()
    };
    next();
}

// ============================================
// PROVENANCE DECORATOR
// ============================================

/**
 * Decorator to automatically record provenance
 */
function recordProvenance(entityType, operation, entityIdExtractor) {
    return function(target, propertyKey, descriptor) {
        const originalMethod = descriptor.value;

        descriptor.value = async function(...args) {
            const result = await originalMethod.apply(this, args);
            
            try {
                const provenanceService = require('./provenanceService').provenanceService;
                const entityId = typeof entityIdExtractor === 'function' 
                    ? entityIdExtractor(result, ...args)
                    : result?.id || result?.data?.id;

                if (entityId) {
                    await provenanceService.recordProvenance({
                        entityId,
                        entityType,
                        operation,
                        sourceModule: this.constructor.name || 'unknown',
                        destinationModule: 'unknown',
                        currentVersion: JSON.stringify(result),
                        responsibleService: this.constructor.name || 'system',
                        metadata: {
                            method: propertyKey,
                            args: JSON.stringify(args)
                        }
                    });
                }
            } catch (error) {
                console.error('Provenance recording error:', error);
            }

            return result;
        };

        return descriptor;
    };
}

// ============================================
// EXPORT
// ============================================

module.exports = {
    ProvenanceService,
    ENTITY_TYPES,
    OPERATION_TYPES,
    PROVENANCE_STATUS,
    provenanceMiddleware,
    recordProvenance,
    provenanceService: new ProvenanceService()
};