// backend/services/capabilityMappingService.js
const db = require('../config/db').promise;
const crypto = require('crypto');
const EventEmitter = require('events');

// ============================================
// CAPABILITY MAPPING CONFIGURATION
// ============================================

const CAPABILITY_TYPES = {
    CORE: 'core',
    SUPPORTING: 'supporting',
    GENERIC: 'generic',
    STRATEGIC: 'strategic'
};

const CAPABILITY_STATUS = {
    ACTIVE: 'active',
    DEPRECATED: 'deprecated',
    PLANNED: 'planned',
    UNDER_DEVELOPMENT: 'under_development'
};

const DATA_OWNERSHIP = {
    PRIMARY: 'primary',
    SECONDARY: 'secondary',
    REFERENCE: 'reference',
    NONE: 'none'
};

// ============================================
// CAPABILITY MAPPING SERVICE
// ============================================

class CapabilityMappingService extends EventEmitter {
    constructor() {
        super();
        this.capabilities = new Map();
        this.modules = new Map();
        this.dependencies = new Map();
        this.dataOwnership = new Map();
        this.consumerMap = new Map();
        this.mappingHistory = [];
        this.isInitialized = false;
    }

    /**
     * Initialize capability mapping
     */
    async initialize() {
        if (this.isInitialized) return;

        await this.loadCapabilities();
        await this.loadModules();
        await this.loadDependencies();

        this.isInitialized = true;
        console.log('✅ Capability Mapping Service initialized');
        return this;
    }

    /**
     * Register a business capability
     */
    async registerCapability(data) {
        const capability = {
            id: this.generateCapabilityId(),
            name: data.name,
            description: data.description || '',
            type: data.type || CAPABILITY_TYPES.SUPPORTING,
            status: data.status || CAPABILITY_STATUS.ACTIVE,
            ownerModule: data.ownerModule || null,
            dependencies: data.dependencies || [],
            apis: data.apis || [],
            dataOwnership: data.dataOwnership || {},
            consumers: data.consumers || [],
            metrics: data.metrics || {},
            metadata: data.metadata || {},
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        // Validate capability
        this.validateCapability(capability);

        // Store in memory
        this.capabilities.set(capability.id, capability);

        // Update module capabilities
        if (capability.ownerModule) {
            const module = this.modules.get(capability.ownerModule);
            if (module) {
                if (!module.capabilities) {
                    module.capabilities = [];
                }
                module.capabilities.push(capability.id);
            }
        }

        // Update dependencies
        for (const dep of capability.dependencies) {
            this.addDependency(capability.id, dep);
        }

        // Update data ownership
        for (const [data, ownership] of Object.entries(capability.dataOwnership)) {
            this.addDataOwnership(capability.id, data, ownership);
        }

        // Update consumers
        for (const consumer of capability.consumers) {
            this.addConsumer(capability.id, consumer);
        }

        // Store in database
        await this.storeCapability(capability);

        this.emit('capability.registered', { 
            id: capability.id, 
            name: capability.name 
        });

        console.log(`📋 Capability registered: ${capability.name} (${capability.id})`);
        return capability;
    }

    /**
     * Register a module
     */
    async registerModule(data) {
        const module = {
            id: this.generateModuleId(),
            name: data.name,
            description: data.description || '',
            type: data.type || 'service',
            owner: data.owner || 'unknown',
            capabilities: data.capabilities || [],
            dependencies: data.dependencies || [],
            apis: data.apis || [],
            metadata: data.metadata || {},
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        this.modules.set(module.id, module);
        await this.storeModule(module);

        this.emit('module.registered', { 
            id: module.id, 
            name: module.name 
        });

        console.log(`📦 Module registered: ${module.name} (${module.id})`);
        return module;
    }

    /**
     * Get capability by ID
     */
    getCapability(id) {
        return this.capabilities.get(id) || null;
    }

    /**
     * Get all capabilities
     */
    getAllCapabilities(filters = {}) {
        let capabilities = Array.from(this.capabilities.values());

        if (filters.type) {
            capabilities = capabilities.filter(c => c.type === filters.type);
        }

        if (filters.status) {
            capabilities = capabilities.filter(c => c.status === filters.status);
        }

        if (filters.ownerModule) {
            capabilities = capabilities.filter(c => c.ownerModule === filters.ownerModule);
        }

        if (filters.search) {
            const search = filters.search.toLowerCase();
            capabilities = capabilities.filter(c => 
                c.name.toLowerCase().includes(search) ||
                c.description.toLowerCase().includes(search)
            );
        }

        return capabilities;
    }

    /**
     * Get module by ID
     */
    getModule(id) {
        return this.modules.get(id) || null;
    }

    /**
     * Get all modules
     */
    getAllModules() {
        return Array.from(this.modules.values());
    }

    /**
     * Get capabilities by module
     */
    getCapabilitiesByModule(moduleId) {
        const capabilities = [];
        for (const [id, cap] of this.capabilities) {
            if (cap.ownerModule === moduleId) {
                capabilities.push(cap);
            }
        }
        return capabilities;
    }

    /**
     * Get data ownership map
     */
    getDataOwnershipMap() {
        return Array.from(this.dataOwnership.entries()).map(([data, owners]) => ({
            data,
            owners: Array.from(owners.values())
        }));
    }

    /**
     * Get dependency graph
     */
    getDependencyGraph() {
        const graph = {};
        for (const [id, deps] of this.dependencies) {
            graph[id] = Array.from(deps);
        }
        return graph;
    }

    /**
     * Get consumer map
     */
    getConsumerMap() {
        return Array.from(this.consumerMap.entries()).map(([capability, consumers]) => ({
            capability,
            consumers: Array.from(consumers)
        }));
    }

    /**
     * Get impact analysis for a capability
     */
    getImpactAnalysis(capabilityId) {
        const capability = this.capabilities.get(capabilityId);
        if (!capability) {
            throw new Error(`Capability not found: ${capabilityId}`);
        }

        const impact = {
            capability: capability.name,
            id: capability.id,
            dependencies: this.getCapabilityDependencies(capabilityId),
            dependents: this.getCapabilityDependents(capabilityId),
            consumers: this.getCapabilityConsumers(capabilityId),
            dataOwned: this.getCapabilityDataOwnership(capabilityId),
            impactLevel: 'low'
        };

        // Calculate impact level
        const totalImpact = impact.dependencies.length + 
                           impact.dependents.length + 
                           impact.consumers.length + 
                           impact.dataOwned.length;

        if (totalImpact > 10) impact.impactLevel = 'high';
        else if (totalImpact > 5) impact.impactLevel = 'medium';
        else impact.impactLevel = 'low';

        return impact;
    }

    /**
     * Get capability dependencies
     */
    getCapabilityDependencies(capabilityId) {
        const deps = this.dependencies.get(capabilityId) || new Set();
        return Array.from(deps);
    }

    /**
     * Get capability dependents (reverse dependencies)
     */
    getCapabilityDependents(capabilityId) {
        const dependents = [];
        for (const [id, deps] of this.dependencies) {
            if (deps.has(capabilityId)) {
                dependents.push(id);
            }
        }
        return dependents;
    }

    /**
     * Get capability consumers
     */
    getCapabilityConsumers(capabilityId) {
        const consumers = this.consumerMap.get(capabilityId) || new Set();
        return Array.from(consumers);
    }

    /**
     * Get capability data ownership
     */
    getCapabilityDataOwnership(capabilityId) {
        const ownership = {};
        for (const [data, owners] of this.dataOwnership) {
            if (owners.has(capabilityId)) {
                ownership[data] = 'primary';
            }
        }
        return ownership;
    }

    /**
     * Add dependency
     */
    addDependency(capabilityId, dependency) {
        if (!this.dependencies.has(capabilityId)) {
            this.dependencies.set(capabilityId, new Set());
        }
        this.dependencies.get(capabilityId).add(dependency);
    }

    /**
     * Add data ownership
     */
    addDataOwnership(capabilityId, data, ownership) {
        if (!this.dataOwnership.has(data)) {
            this.dataOwnership.set(data, new Map());
        }
        this.dataOwnership.get(data).set(capabilityId, ownership);
    }

    /**
     * Add consumer
     */
    addConsumer(capabilityId, consumer) {
        if (!this.consumerMap.has(capabilityId)) {
            this.consumerMap.set(capabilityId, new Set());
        }
        this.consumerMap.get(capabilityId).add(consumer);
    }

    /**
     * Validate capability
     */
    validateCapability(capability) {
        if (!capability.name) {
            throw new Error('Capability name is required');
        }
        if (!capability.type || !Object.values(CAPABILITY_TYPES).includes(capability.type)) {
            throw new Error(`Invalid capability type: ${capability.type}`);
        }
        if (!capability.status || !Object.values(CAPABILITY_STATUS).includes(capability.status)) {
            throw new Error(`Invalid capability status: ${capability.status}`);
        }
    }

    // ============================================
    // GENERATE IDS
    // ============================================

    generateCapabilityId() {
        return `CAP_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    }

    generateModuleId() {
        return `MOD_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    }

    // ============================================
    // DATABASE OPERATIONS
    // ============================================

    async loadCapabilities() {
        try {
            const [rows] = await db.query(
                'SELECT * FROM business_capabilities WHERE status != "deprecated"'
            );

            for (const row of rows) {
                const capability = {
                    id: row.capability_id,
                    name: row.name,
                    description: row.description,
                    type: row.type,
                    status: row.status,
                    ownerModule: row.owner_module,
                    dependencies: JSON.parse(row.dependencies || '[]'),
                    apis: JSON.parse(row.apis || '[]'),
                    dataOwnership: JSON.parse(row.data_ownership || '{}'),
                    consumers: JSON.parse(row.consumers || '[]'),
                    metrics: JSON.parse(row.metrics || '{}'),
                    metadata: JSON.parse(row.metadata || '{}'),
                    createdAt: row.created_at,
                    updatedAt: row.updated_at
                };

                this.capabilities.set(capability.id, capability);

                // Update dependencies
                for (const dep of capability.dependencies) {
                    this.addDependency(capability.id, dep);
                }

                // Update data ownership
                for (const [data, ownership] of Object.entries(capability.dataOwnership)) {
                    this.addDataOwnership(capability.id, data, ownership);
                }

                // Update consumers
                for (const consumer of capability.consumers) {
                    this.addConsumer(capability.id, consumer);
                }
            }

            console.log(`📋 Loaded ${this.capabilities.size} capabilities`);
        } catch (error) {
            console.error('Load capabilities error:', error);
        }
    }

    async loadModules() {
        try {
            const [rows] = await db.query('SELECT * FROM business_modules');

            for (const row of rows) {
                const module = {
                    id: row.module_id,
                    name: row.name,
                    description: row.description,
                    type: row.type,
                    owner: row.owner,
                    capabilities: JSON.parse(row.capabilities || '[]'),
                    dependencies: JSON.parse(row.dependencies || '[]'),
                    apis: JSON.parse(row.apis || '[]'),
                    metadata: JSON.parse(row.metadata || '{}'),
                    createdAt: row.created_at,
                    updatedAt: row.updated_at
                };

                this.modules.set(module.id, module);
            }

            console.log(`📦 Loaded ${this.modules.size} modules`);
        } catch (error) {
            console.error('Load modules error:', error);
        }
    }

    async loadDependencies() {
        // Dependencies are already loaded through capabilities
        console.log(`🔗 Loaded ${this.dependencies.size} dependency relationships`);
    }

    async storeCapability(capability) {
        try {
            await db.query(
                `INSERT INTO business_capabilities 
                 (capability_id, name, description, type, status, owner_module,
                  dependencies, apis, data_ownership, consumers, metrics, metadata,
                  created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE
                 name = VALUES(name), description = VALUES(description),
                 type = VALUES(type), status = VALUES(status),
                 owner_module = VALUES(owner_module),
                 dependencies = VALUES(dependencies), apis = VALUES(apis),
                 data_ownership = VALUES(data_ownership), 
                 consumers = VALUES(consumers), metrics = VALUES(metrics),
                 metadata = VALUES(metadata), updated_at = VALUES(updated_at)`,
                [
                    capability.id,
                    capability.name,
                    capability.description,
                    capability.type,
                    capability.status,
                    capability.ownerModule,
                    JSON.stringify(capability.dependencies),
                    JSON.stringify(capability.apis),
                    JSON.stringify(capability.dataOwnership),
                    JSON.stringify(capability.consumers),
                    JSON.stringify(capability.metrics),
                    JSON.stringify(capability.metadata),
                    capability.createdAt,
                    capability.updatedAt
                ]
            );
        } catch (error) {
            console.error('Store capability error:', error);
        }
    }

    async storeModule(module) {
        try {
            await db.query(
                `INSERT INTO business_modules 
                 (module_id, name, description, type, owner,
                  capabilities, dependencies, apis, metadata,
                  created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE
                 name = VALUES(name), description = VALUES(description),
                 type = VALUES(type), owner = VALUES(owner),
                 capabilities = VALUES(capabilities),
                 dependencies = VALUES(dependencies), apis = VALUES(apis),
                 metadata = VALUES(metadata), updated_at = VALUES(updated_at)`,
                [
                    module.id,
                    module.name,
                    module.description,
                    module.type,
                    module.owner,
                    JSON.stringify(module.capabilities),
                    JSON.stringify(module.dependencies),
                    JSON.stringify(module.apis),
                    JSON.stringify(module.metadata),
                    module.createdAt,
                    module.updatedAt
                ]
            );
        } catch (error) {
            console.error('Store module error:', error);
        }
    }

    // ============================================
    // STATISTICS
    // ============================================

    async getStatistics() {
        return {
            totalCapabilities: this.capabilities.size,
            totalModules: this.modules.size,
            byType: Array.from(this.capabilities.values()).reduce((acc, c) => {
                acc[c.type] = (acc[c.type] || 0) + 1;
                return acc;
            }, {}),
            byStatus: Array.from(this.capabilities.values()).reduce((acc, c) => {
                acc[c.status] = (acc[c.status] || 0) + 1;
                return acc;
            }, {}),
            dependencies: this.dependencies.size,
            dataOwnership: this.dataOwnership.size,
            consumers: this.consumerMap.size,
            timestamp: new Date().toISOString()
        };
    }

    getStatus() {
        return {
            capabilities: this.capabilities.size,
            modules: this.modules.size,
            dependencies: this.dependencies.size,
            dataOwnership: this.dataOwnership.size,
            consumers: this.consumerMap.size,
            types: Object.values(CAPABILITY_TYPES),
            statuses: Object.values(CAPABILITY_STATUS)
        };
    }
}

// ============================================
// EXPORT
// ============================================

module.exports = {
    CapabilityMappingService,
    CAPABILITY_TYPES,
    CAPABILITY_STATUS,
    DATA_OWNERSHIP,
    capabilityMappingService: new CapabilityMappingService()
};