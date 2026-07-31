// backend/services/schemaRegistryService.js
const fs = require('fs');
const path = require('path');
const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const db = require('../config/db').promise;
const crypto = require('crypto');

// ============================================
// SCHEMA REGISTRY CONFIGURATION
// ============================================

const SCHEMA_TYPES = {
    API_REQUEST: 'api_request',
    API_RESPONSE: 'api_response',
    INTERNAL_EVENT: 'internal_event',
    NOTIFICATION: 'notification',
    RECOMMENDATION: 'recommendation',
    DOMAIN_EVENT: 'domain_event'
};

const SCHEMA_STATUS = {
    DRAFT: 'draft',
    ACTIVE: 'active',
    DEPRECATED: 'deprecated',
    ARCHIVED: 'archived'
};

// ============================================
// SCHEMA REGISTRY SERVICE
// ============================================

class SchemaRegistryService {
    constructor() {
        this.schemas = new Map();
        this.validators = new Map();
        this.schemaCache = new Map();
        this.ajv = new Ajv({
            allErrors: true,
            strict: false
        });
        addFormats(this.ajv);
        this.schemasPath = path.join(__dirname, '../schemas');
    }

    /**
     * Initialize schema registry
     */
    async initialize() {
        // Load schemas from database
        await this.loadSchemas();

        // Load schemas from filesystem
        await this.loadSchemaFiles();

        console.log('✅ Schema Registry initialized');
        return this;
    }

    /**
     * Register a new schema
     */
    async registerSchema(data) {
        const schema = {
            id: this.generateSchemaId(),
            name: data.name,
            type: data.type || SCHEMA_TYPES.API_REQUEST,
            version: data.version || '1.0.0',
            description: data.description || '',
            schema: data.schema,
            status: data.status || SCHEMA_STATUS.DRAFT,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            examples: data.examples || [],
            metadata: data.metadata || {}
        };

        // Validate schema
        this.validateSchemaDefinition(schema);

        // Compile validator
        const validator = this.ajv.compile(schema.schema);

        this.schemas.set(schema.id, schema);
        this.validators.set(schema.id, validator);

        // Store in database
        await this.storeSchema(schema);

        // Clear cache
        this.clearCache(schema.name);

        console.log(`📋 Schema registered: ${schema.name} v${schema.version} (${schema.id})`);
        return schema;
    }

    /**
     * Get schema by ID
     */
    getSchema(id) {
        return this.schemas.get(id) || null;
    }

    /**
     * Get schema by name and version
     */
    getSchemaByName(name, version = 'latest') {
        const schemas = Array.from(this.schemas.values())
            .filter(s => s.name === name && s.status !== SCHEMA_STATUS.ARCHIVED);

        if (schemas.length === 0) return null;

        if (version === 'latest') {
            return schemas.sort((a, b) => b.version.localeCompare(a.version))[0];
        }

        return schemas.find(s => s.version === version) || null;
    }

    /**
     * Get all schemas
     */
    getAllSchemas(filters = {}) {
        let schemas = Array.from(this.schemas.values());

        if (filters.type) {
            schemas = schemas.filter(s => s.type === filters.type);
        }

        if (filters.status) {
            schemas = schemas.filter(s => s.status === filters.status);
        }

        if (filters.name) {
            schemas = schemas.filter(s => s.name.includes(filters.name));
        }

        return schemas;
    }

    /**
     * Validate data against schema
     */
    validate(data, schemaId) {
        const validator = this.validators.get(schemaId);
        if (!validator) {
            throw new Error(`Validator not found for schema: ${schemaId}`);
        }

        const valid = validator(data);

        if (!valid) {
            const errors = validator.errors || [];
            return {
                valid: false,
                errors: errors.map(e => ({
                    path: e.instancePath || '',
                    message: e.message || 'Validation error',
                    params: e.params
                }))
            };
        }

        return { valid: true, errors: [] };
    }

    /**
     * Validate data by schema name
     */
    validateByName(data, name, version = 'latest') {
        const schema = this.getSchemaByName(name, version);
        if (!schema) {
            throw new Error(`Schema not found: ${name} v${version}`);
        }

        return this.validate(data, schema.id);
    }

    /**
     * Deprecate a schema
     */
    async deprecateSchema(id, reason) {
        const schema = this.schemas.get(id);
        if (!schema) {
            throw new Error(`Schema not found: ${id}`);
        }

        schema.status = SCHEMA_STATUS.DEPRECATED;
        schema.deprecatedAt = new Date().toISOString();
        schema.deprecationReason = reason;
        schema.updatedAt = new Date().toISOString();

        await this.storeSchema(schema);
        this.clearCache(schema.name);

        console.log(`⚠️ Schema deprecated: ${schema.name} v${schema.version}`);
        return schema;
    }

    /**
     * Activate a schema
     */
    async activateSchema(id) {
        const schema = this.schemas.get(id);
        if (!schema) {
            throw new Error(`Schema not found: ${id}`);
        }

        schema.status = SCHEMA_STATUS.ACTIVE;
        schema.activatedAt = new Date().toISOString();
        schema.updatedAt = new Date().toISOString();

        await this.storeSchema(schema);
        this.clearCache(schema.name);

        console.log(`✅ Schema activated: ${schema.name} v${schema.version}`);
        return schema;
    }

    /**
     * Archive a schema
     */
    async archiveSchema(id) {
        const schema = this.schemas.get(id);
        if (!schema) {
            throw new Error(`Schema not found: ${id}`);
        }

        schema.status = SCHEMA_STATUS.ARCHIVED;
        schema.archivedAt = new Date().toISOString();
        schema.updatedAt = new Date().toISOString();

        await this.storeSchema(schema);
        this.clearCache(schema.name);

        console.log(`🗑️ Schema archived: ${schema.name} v${schema.version}`);
        return schema;
    }

    /**
     * Compare two schema versions
     */
    compareVersions(name, version1, version2) {
        const schema1 = this.getSchemaByName(name, version1);
        const schema2 = this.getSchemaByName(name, version2);

        if (!schema1 || !schema2) {
            throw new Error('One or both schemas not found');
        }

        const diff = {
            added: [],
            removed: [],
            changed: []
        };

        const props1 = this.extractProperties(schema1.schema);
        const props2 = this.extractProperties(schema2.schema);

        // Find added properties
        for (const prop of Object.keys(props2)) {
            if (!props1[prop]) {
                diff.added.push(prop);
            }
        }

        // Find removed properties
        for (const prop of Object.keys(props1)) {
            if (!props2[prop]) {
                diff.removed.push(prop);
            }
        }

        // Find changed properties
        for (const prop of Object.keys(props1)) {
            if (props2[prop] && JSON.stringify(props1[prop]) !== JSON.stringify(props2[prop])) {
                diff.changed.push({
                    property: prop,
                    old: props1[prop],
                    new: props2[prop]
                });
            }
        }

        return diff;
    }

    /**
     * Generate schema from example
     */
    generateSchemaFromExample(example, name, options = {}) {
        const { type = 'object', additionalProperties = false } = options;

        const schema = {
            $schema: 'http://json-schema.org/draft-07/schema#',
            type,
            properties: {},
            additionalProperties,
            required: []
        };

        if (type === 'object') {
            for (const [key, value] of Object.entries(example)) {
                schema.properties[key] = this.inferType(value);
                if (value !== undefined && value !== null) {
                    schema.required.push(key);
                }
            }
        }

        return schema;
    }

    /**
     * Infer JSON Schema type from value
     */
    inferType(value) {
        if (value === null) {
            return { type: 'null' };
        }

        const type = typeof value;

        switch (type) {
            case 'string':
                if (this.isDate(value)) {
                    return { type: 'string', format: 'date-time' };
                }
                if (this.isEmail(value)) {
                    return { type: 'string', format: 'email' };
                }
                return { type: 'string' };
            case 'number':
                return { type: 'number' };
            case 'boolean':
                return { type: 'boolean' };
            case 'object':
                if (Array.isArray(value)) {
                    return {
                        type: 'array',
                        items: value.length > 0 ? this.inferType(value[0]) : { type: 'string' }
                    };
                }
                return {
                    type: 'object',
                    properties: Object.entries(value).reduce((acc, [k, v]) => {
                        acc[k] = this.inferType(v);
                        return acc;
                    }, {})
                };
            default:
                return { type: 'string' };
        }
    }

    /**
     * Extract properties from schema
     */
    extractProperties(schema) {
        if (schema.properties) {
            return schema.properties;
        }
        if (schema.items && schema.items.properties) {
            return schema.items.properties;
        }
        return {};
    }

    /**
     * Check if value is a date
     */
    isDate(value) {
        return !isNaN(Date.parse(value));
    }

    /**
     * Check if value is an email
     */
    isEmail(value) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
    }

    /**
     * Validate schema definition
     */
    validateSchemaDefinition(schema) {
        // Check if schema is valid JSON Schema
        try {
            const compiled = this.ajv.compile(schema.schema);
            return true;
        } catch (error) {
            throw new Error(`Invalid JSON Schema: ${error.message}`);
        }
    }

    /**
     * Generate schema ID
     */
    generateSchemaId() {
        return `SCH_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    }

    /**
     * Clear cache
     */
    clearCache(name) {
        for (const key of this.schemaCache.keys()) {
            if (key.startsWith(name)) {
                this.schemaCache.delete(key);
            }
        }
    }

    // ============================================
    // FILE SYSTEM OPERATIONS
    // ============================================

    async loadSchemaFiles() {
        try {
            if (!fs.existsSync(this.schemasPath)) {
                fs.mkdirSync(this.schemasPath, { recursive: true });
                await this.createDefaultSchemas();
                return;
            }

            const files = fs.readdirSync(this.schemasPath);

            for (const file of files) {
                if (file.endsWith('.json')) {
                    const filePath = path.join(this.schemasPath, file);
                    const content = fs.readFileSync(filePath, 'utf8');
                    const schemaData = JSON.parse(content);

                    // Check if schema already exists
                    const existing = this.getSchemaByName(schemaData.name, schemaData.version);
                    if (!existing) {
                        await this.registerSchema(schemaData);
                    }
                }
            }
        } catch (error) {
            console.error('Load schema files error:', error);
        }
    }

    async createDefaultSchemas() {
        const defaultSchemas = [
            {
                name: 'product',
                type: SCHEMA_TYPES.API_RESPONSE,
                version: '1.0.0',
                description: 'Product response schema',
                schema: {
                    type: 'object',
                    properties: {
                        id: { type: 'string' },
                        name: { type: 'string' },
                        description: { type: 'string' },
                        price: { type: 'number' },
                        category: { type: 'string' },
                        stock: { type: 'integer' },
                        images: {
                            type: 'array',
                            items: { type: 'string' }
                        },
                        created_at: { type: 'string', format: 'date-time' },
                        updated_at: { type: 'string', format: 'date-time' }
                    },
                    required: ['id', 'name', 'price']
                },
                examples: [{
                    id: 'prod_123',
                    name: 'Sample Product',
                    price: 99.99,
                    category: 'Electronics'
                }]
            },
            {
                name: 'order',
                type: SCHEMA_TYPES.API_RESPONSE,
                version: '1.0.0',
                description: 'Order response schema',
                schema: {
                    type: 'object',
                    properties: {
                        id: { type: 'string' },
                        user_id: { type: 'string' },
                        items: {
                            type: 'array',
                            items: {
                                type: 'object',
                                properties: {
                                    product_id: { type: 'string' },
                                    name: { type: 'string' },
                                    quantity: { type: 'integer' },
                                    price: { type: 'number' }
                                },
                                required: ['product_id', 'quantity', 'price']
                            }
                        },
                        total: { type: 'number' },
                        status: { type: 'string', enum: ['pending', 'processing', 'completed', 'cancelled'] },
                        created_at: { type: 'string', format: 'date-time' }
                    },
                    required: ['id', 'user_id', 'items', 'total']
                }
            },
            {
                name: 'order_created',
                type: SCHEMA_TYPES.DOMAIN_EVENT,
                version: '1.0.0',
                description: 'Order created domain event',
                schema: {
                    type: 'object',
                    properties: {
                        event_id: { type: 'string' },
                        event_type: { type: 'string' },
                        aggregate_id: { type: 'string' },
                        aggregate_type: { type: 'string' },
                        data: {
                            type: 'object',
                            properties: {
                                order_id: { type: 'string' },
                                user_id: { type: 'string' },
                                total: { type: 'number' },
                                items: {
                                    type: 'array',
                                    items: {
                                        type: 'object',
                                        properties: {
                                            product_id: { type: 'string' },
                                            quantity: { type: 'integer' }
                                        }
                                    }
                                }
                            },
                            required: ['order_id', 'user_id', 'total']
                        },
                        timestamp: { type: 'string', format: 'date-time' }
                    },
                    required: ['event_id', 'event_type', 'aggregate_id', 'data', 'timestamp']
                }
            }
        ];

        for (const schema of defaultSchemas) {
            const existing = this.getSchemaByName(schema.name, schema.version);
            if (!existing) {
                await this.registerSchema(schema);
            }
        }
    }

    // ============================================
    // DATABASE OPERATIONS
    // ============================================

    async loadSchemas() {
        try {
            const [rows] = await db.query(
                'SELECT * FROM schema_registry WHERE status != ?',
                [SCHEMA_STATUS.ARCHIVED]
            );

            for (const row of rows) {
                const schema = {
                    id: row.schema_id,
                    name: row.name,
                    type: row.type,
                    version: row.version,
                    description: row.description,
                    schema: JSON.parse(row.schema_def),
                    status: row.status,
                    createdAt: row.created_at,
                    updatedAt: row.updated_at,
                    examples: JSON.parse(row.examples || '[]'),
                    metadata: JSON.parse(row.metadata || '{}')
                };

                // Compile validator
                const validator = this.ajv.compile(schema.schema);

                this.schemas.set(schema.id, schema);
                this.validators.set(schema.id, validator);
            }

            console.log(`📋 Loaded ${this.schemas.size} schemas from database`);
        } catch (error) {
            console.error('Load schemas error:', error);
        }
    }

    async storeSchema(schema) {
        try {
            await db.query(
                `INSERT INTO schema_registry 
                 (schema_id, name, type, version, description, schema_def,
                  status, examples, metadata, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE
                 name = VALUES(name), type = VALUES(type),
                 version = VALUES(version), description = VALUES(description),
                 schema_def = VALUES(schema_def), status = VALUES(status),
                 examples = VALUES(examples), metadata = VALUES(metadata),
                 updated_at = VALUES(updated_at)`,
                [
                    schema.id,
                    schema.name,
                    schema.type,
                    schema.version,
                    schema.description,
                    JSON.stringify(schema.schema),
                    schema.status,
                    JSON.stringify(schema.examples),
                    JSON.stringify(schema.metadata),
                    schema.createdAt,
                    schema.updatedAt
                ]
            );
        } catch (error) {
            console.error('Store schema error:', error);
        }
    }

    // ============================================
    // STATISTICS
    // ============================================

    async getStatistics() {
        const schemas = Array.from(this.schemas.values());

        return {
            totalSchemas: schemas.length,
            byType: schemas.reduce((acc, s) => {
                acc[s.type] = (acc[s.type] || 0) + 1;
                return acc;
            }, {}),
            byStatus: schemas.reduce((acc, s) => {
                acc[s.status] = (acc[s.status] || 0) + 1;
                return acc;
            }, {}),
            activeSchemas: schemas.filter(s => s.status === 'active').length,
            deprecatedSchemas: schemas.filter(s => s.status === 'deprecated').length,
            validatorCache: this.validators.size,
            timestamp: new Date().toISOString()
        };
    }

    getStatus() {
        return {
            schemas: this.schemas.size,
            validators: this.validators.size,
            cache: this.schemaCache.size,
            types: Object.values(SCHEMA_TYPES),
            statuses: Object.values(SCHEMA_STATUS)
        };
    }
}

// ============================================
// EXPORT
// ============================================

module.exports = {
    SchemaRegistryService,
    SCHEMA_TYPES,
    SCHEMA_STATUS,
    schemaRegistryService: new SchemaRegistryService()
};