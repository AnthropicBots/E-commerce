// backend/services/temporalDataService.js
const db = require('../config/db').promise;
const crypto = require('crypto');
const EventEmitter = require('events');

// ============================================
// TEMPORAL DATA CONFIGURATION
// ============================================

const TEMPORAL_CONFIG = {
    versionRetention: 365, // days
    maxVersions: 100,
    autoArchive: true,
    archiveBatchSize: 1000,
    compressionEnabled: false
};

const ENTITY_TYPES = {
    PRODUCT: 'product',
    ORDER: 'order',
    USER: 'user',
    PRICE: 'price',
    INVENTORY: 'inventory',
    COUPON: 'coupon',
    SHIPPING: 'shipping',
    RECOMMENDATION: 'recommendation'
};

// ============================================
// TEMPORAL DATA SERVICE
// ============================================

class TemporalDataService extends EventEmitter {
    constructor() {
        super();
        this.temporalRecords = new Map();
        this.versionCache = new Map();
        this.archiveQueue = [];
        this.isArchiving = false;
        this.isInitialized = false;
    }

    /**
     * Initialize temporal data service
     */
    async initialize() {
        if (this.isInitialized) return;

        // Load recent temporal records
        await this.loadRecentRecords();

        // Start auto-archiving
        if (TEMPORAL_CONFIG.autoArchive) {
            setInterval(() => this.archiveOldRecords(), 3600000); // 1 hour
        }

        this.isInitialized = true;
        console.log('✅ Temporal Data Service initialized');
        return this;
    }

    /**
     * Save a new version of an entity
     */
    async saveVersion(entityType, entityId, data, metadata = {}) {
        const version = {
            id: this.generateVersionId(),
            entityType,
            entityId,
            versionNumber: await this.getNextVersionNumber(entityType, entityId),
            data: data,
            metadata: {
                ...metadata,
                modifiedBy: metadata.modifiedBy || 'system',
                changeReason: metadata.changeReason || 'Update',
                timestamp: new Date().toISOString()
            },
            validFrom: new Date().toISOString(),
            validUntil: null,
            hash: null
        };

        // Generate hash for integrity
        version.hash = this.generateHash(version);

        // If there's a current version, set its validUntil
        const currentVersion = await this.getCurrentVersion(entityType, entityId);
        if (currentVersion) {
            currentVersion.validUntil = version.validFrom;
            await this.updateVersion(currentVersion);
        }

        // Store new version
        this.temporalRecords.set(version.id, version);
        await this.storeVersion(version);

        // Update cache
        this.versionCache.set(`${entityType}:${entityId}`, version);

        this.emit('version.saved', { 
            entityType, 
            entityId, 
            versionNumber: version.versionNumber 
        });

        console.log(`📝 Version saved: ${entityType} ${entityId} v${version.versionNumber}`);
        return version;
    }

    /**
     * Get current version of an entity
     */
    async getCurrentVersion(entityType, entityId) {
        const cacheKey = `${entityType}:${entityId}`;
        
        // Check cache
        if (this.versionCache.has(cacheKey)) {
            return this.versionCache.get(cacheKey);
        }

        // Query database
        const [rows] = await db.query(
            `SELECT * FROM temporal_records 
             WHERE entity_type = ? AND entity_id = ? 
             AND valid_until IS NULL 
             ORDER BY version_number DESC 
             LIMIT 1`,
            [entityType, entityId]
        );

        if (rows.length > 0) {
            const version = this.mapRowToVersion(rows[0]);
            this.versionCache.set(cacheKey, version);
            return version;
        }

        return null;
    }

    /**
     * Get version by number
     */
    async getVersion(entityType, entityId, versionNumber) {
        const [rows] = await db.query(
            `SELECT * FROM temporal_records 
             WHERE entity_type = ? AND entity_id = ? 
             AND version_number = ?`,
            [entityType, entityId, versionNumber]
        );

        if (rows.length > 0) {
            return this.mapRowToVersion(rows[0]);
        }

        return null;
    }

    /**
     * Get all versions of an entity
     */
    async getVersions(entityType, entityId, filters = {}) {
        let query = `
            SELECT * FROM temporal_records 
            WHERE entity_type = ? AND entity_id = ?
        `;
        const params = [entityType, entityId];

        if (filters.fromDate) {
            query += ' AND valid_from >= ?';
            params.push(filters.fromDate);
        }

        if (filters.toDate) {
            query += ' AND valid_from <= ?';
            params.push(filters.toDate);
        }

        if (filters.modifiedBy) {
            query += ' AND JSON_EXTRACT(metadata, "$.modifiedBy") = ?';
            params.push(filters.modifiedBy);
        }

        query += ' ORDER BY version_number DESC';

        if (filters.limit) {
            query += ' LIMIT ?';
            params.push(filters.limit);
        }

        const [rows] = await db.query(query, params);
        return rows.map(row => this.mapRowToVersion(row));
    }

    /**
     * Get version history with pagination
     */
    async getVersionHistory(entityType, entityId, page = 1, limit = 20) {
        const offset = (page - 1) * limit;

        const [rows] = await db.query(
            `SELECT * FROM temporal_records 
             WHERE entity_type = ? AND entity_id = ? 
             ORDER BY version_number DESC 
             LIMIT ? OFFSET ?`,
            [entityType, entityId, limit, offset]
        );

        const [countResult] = await db.query(
            `SELECT COUNT(*) as total FROM temporal_records 
             WHERE entity_type = ? AND entity_id = ?`,
            [entityType, entityId]
        );

        return {
            data: rows.map(row => this.mapRowToVersion(row)),
            pagination: {
                page,
                limit,
                total: countResult[0]?.total || 0,
                pages: Math.ceil((countResult[0]?.total || 0) / limit)
            }
        };
    }

    /**
     * Get entity state at a specific point in time
     */
    async getStateAtTime(entityType, entityId, timestamp) {
        const [rows] = await db.query(
            `SELECT * FROM temporal_records 
             WHERE entity_type = ? AND entity_id = ? 
             AND valid_from <= ? 
             AND (valid_until IS NULL OR valid_until > ?)
             ORDER BY version_number DESC 
             LIMIT 1`,
            [entityType, entityId, timestamp, timestamp]
        );

        if (rows.length > 0) {
            return this.mapRowToVersion(rows[0]);
        }

        return null;
    }

    /**
     * Get entity state at a specific version
     */
    async getStateAtVersion(entityType, entityId, versionNumber) {
        return this.getVersion(entityType, entityId, versionNumber);
    }

    /**
     * Compare two versions
     */
    compareVersions(version1, version2) {
        if (!version1 || !version2) return null;

        const diff = {
            version1: version1.versionNumber,
            version2: version2.versionNumber,
            changes: {}
        };

        const data1 = version1.data;
        const data2 = version2.data;

        // Find added/removed/changed fields
        const allKeys = new Set([...Object.keys(data1), ...Object.keys(data2)]);

        for (const key of allKeys) {
            if (!(key in data1)) {
                diff.changes[key] = { type: 'added', newValue: data2[key] };
            } else if (!(key in data2)) {
                diff.changes[key] = { type: 'removed', oldValue: data1[key] };
            } else if (JSON.stringify(data1[key]) !== JSON.stringify(data2[key])) {
                diff.changes[key] = { 
                    type: 'modified', 
                    oldValue: data1[key], 
                    newValue: data2[key] 
                };
            }
        }

        return diff;
    }

    /**
     * Archive old records
     */
    async archiveOldRecords() {
        if (this.isArchiving) return;

        this.isArchiving = true;

        try {
            const cutoff = new Date();
            cutoff.setDate(cutoff.getDate() - TEMPORAL_CONFIG.versionRetention);

            const [rows] = await db.query(
                `SELECT * FROM temporal_records 
                 WHERE valid_from < ? 
                 AND valid_until IS NOT NULL 
                 AND archived = 0
                 LIMIT ?`,
                [cutoff.toISOString(), TEMPORAL_CONFIG.archiveBatchSize]
            );

            if (rows.length > 0) {
                const ids = rows.map(row => row.id);
                await db.query(
                    `UPDATE temporal_records SET archived = 1 WHERE id IN (?)`,
                    [ids]
                );

                console.log(`📦 Archived ${rows.length} old records`);
                this.emit('records.archived', { count: rows.length });
            }
        } catch (error) {
            console.error('Archive error:', error);
        } finally {
            this.isArchiving = false;
        }
    }

    /**
     * Restore archived record
     */
    async restoreRecord(recordId) {
        await db.query(
            `UPDATE temporal_records SET archived = 0 WHERE id = ?`,
            [recordId]
        );

        const [rows] = await db.query(
            `SELECT * FROM temporal_records WHERE id = ?`,
            [recordId]
        );

        if (rows.length > 0) {
            const version = this.mapRowToVersion(rows[0]);
            this.temporalRecords.set(version.id, version);
            return version;
        }

        return null;
    }

    /**
     * Get statistics
     */
    async getStatistics() {
        const [stats] = await db.query(
            `SELECT 
                COUNT(*) as total_records,
                COUNT(DISTINCT entity_type) as entity_types,
                COUNT(DISTINCT entity_id) as unique_entities,
                AVG(JSON_LENGTH(data)) as avg_data_size,
                MAX(version_number) as max_version
             FROM temporal_records`
        );

        const [dailyStats] = await db.query(
            `SELECT 
                DATE(valid_from) as date,
                COUNT(*) as records_created
             FROM temporal_records
             WHERE valid_from > DATE_SUB(NOW(), INTERVAL 30 DAY)
             GROUP BY DATE(valid_from)
             ORDER BY date DESC`
        );

        return {
            ...stats[0],
            dailyStats,
            cacheSize: this.versionCache.size,
            archiveQueueSize: this.archiveQueue.length,
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Get status
     */
    getStatus() {
        return {
            initialized: this.isInitialized,
            records: this.temporalRecords.size,
            cacheSize: this.versionCache.size,
            archiveQueue: this.archiveQueue.length,
            isArchiving: this.isArchiving,
            retentionDays: TEMPORAL_CONFIG.versionRetention
        };
    }

    // ============================================
    // HELPER FUNCTIONS
    // ============================================

    generateVersionId() {
        return `VER_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    }

    generateHash(version) {
        const data = {
            entityType: version.entityType,
            entityId: version.entityId,
            versionNumber: version.versionNumber,
            data: version.data,
            timestamp: version.validFrom
        };
        return crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
    }

    async getNextVersionNumber(entityType, entityId) {
        const [result] = await db.query(
            `SELECT MAX(version_number) as max_version 
             FROM temporal_records 
             WHERE entity_type = ? AND entity_id = ?`,
            [entityType, entityId]
        );

        return (result[0]?.max_version || 0) + 1;
    }

    mapRowToVersion(row) {
        return {
            id: row.id,
            entityType: row.entity_type,
            entityId: row.entity_id,
            versionNumber: row.version_number,
            data: JSON.parse(row.data),
            metadata: JSON.parse(row.metadata || '{}'),
            validFrom: row.valid_from,
            validUntil: row.valid_until,
            hash: row.hash,
            archived: row.archived === 1,
            createdAt: row.created_at
        };
    }

    // ============================================
    // DATABASE OPERATIONS
    // ============================================

    async loadRecentRecords() {
        try {
            const [rows] = await db.query(
                `SELECT * FROM temporal_records 
                 WHERE archived = 0 
                 ORDER BY created_at DESC 
                 LIMIT 1000`
            );

            for (const row of rows) {
                const version = this.mapRowToVersion(row);
                this.temporalRecords.set(version.id, version);
                this.versionCache.set(`${version.entityType}:${version.entityId}`, version);
            }

            console.log(`📊 Loaded ${rows.length} recent temporal records`);
        } catch (error) {
            console.error('Load records error:', error);
        }
    }

    async storeVersion(version) {
        try {
            await db.query(
                `INSERT INTO temporal_records 
                 (id, entity_type, entity_id, version_number, data,
                  metadata, valid_from, valid_until, hash, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    version.id,
                    version.entityType,
                    version.entityId,
                    version.versionNumber,
                    JSON.stringify(version.data),
                    JSON.stringify(version.metadata),
                    version.validFrom,
                    version.validUntil,
                    version.hash,
                    new Date().toISOString()
                ]
            );
        } catch (error) {
            console.error('Store version error:', error);
        }
    }

    async updateVersion(version) {
        await db.query(
            `UPDATE temporal_records 
             SET valid_until = ? 
             WHERE id = ?`,
            [version.validUntil, version.id]
        );
    }

    // ============================================
    // SNAPSHOT FUNCTIONS
    // ============================================

    /**
     * Create a snapshot of an entity at a specific time
     */
    async createSnapshot(entityType, entityId, timestamp = null) {
        const state = await this.getStateAtTime(
            entityType, 
            entityId, 
            timestamp || new Date().toISOString()
        );

        if (!state) return null;

        const snapshot = {
            entityType: state.entityType,
            entityId: state.entityId,
            versionNumber: state.versionNumber,
            state: state.data,
            timestamp: state.validFrom,
            capturedAt: new Date().toISOString(),
            hash: this.generateHash({ ...state, capturedAt: new Date().toISOString() })
        };

        return snapshot;
    }

    /**
     * Get entity evolution timeline
     */
    async getEvolutionTimeline(entityType, entityId) {
        const versions = await this.getVersions(entityType, entityId);
        
        return versions.map(v => ({
            version: v.versionNumber,
            timestamp: v.validFrom,
            data: v.data,
            changes: v.metadata.changeReason || 'Update'
        }));
    }

    /**
     * Check if entity version exists
     */
    async versionExists(entityType, entityId, versionNumber) {
        const [rows] = await db.query(
            `SELECT COUNT(*) as count FROM temporal_records 
             WHERE entity_type = ? AND entity_id = ? 
             AND version_number = ?`,
            [entityType, entityId, versionNumber]
        );

        return rows[0]?.count > 0;
    }

    /**
     * Delete version (soft delete)
     */
    async deleteVersion(versionId) {
        await db.query(
            `UPDATE temporal_records SET archived = 1 WHERE id = ?`,
            [versionId]
        );
    }
}

// ============================================
// TEMPORAL DATA MIDDLEWARE
// ============================================

/**
 * Middleware to automatically track entity changes
 */
function trackEntityChanges(entityType, idExtractor, dataExtractor) {
    return async (req, res, next) => {
        const originalJson = res.json;

        res.json = async function(data) {
            if (res.statusCode >= 200 && res.statusCode < 300) {
                try {
                    const temporalService = require('./temporalDataService').temporalDataService;
                    const entityId = typeof idExtractor === 'function' 
                        ? idExtractor(req, data) 
                        : req.params.id;

                    const entityData = typeof dataExtractor === 'function'
                        ? dataExtractor(req, data)
                        : data;

                    if (entityId && entityData) {
                        await temporalService.saveVersion(
                            entityType,
                            entityId,
                            entityData,
                            {
                                modifiedBy: req.user?.id || 'system',
                                changeReason: `Updated via ${req.method} ${req.path}`
                            }
                        );
                    }
                } catch (error) {
                    console.error('Temporal tracking error:', error);
                }
            }

            return originalJson.call(this, data);
        };

        next();
    };
}

// ============================================
// EXPORT
// ============================================

module.exports = {
    TemporalDataService,
    ENTITY_TYPES,
    trackEntityChanges,
    temporalDataService: new TemporalDataService()
};