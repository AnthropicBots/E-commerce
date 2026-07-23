// backend/services/capabilityDiscoveryService.js
const db = require('../config/db').promise;
const crypto = require('crypto');
const EventEmitter = require('events');

// ============================================
// CAPABILITY CONFIGURATION
// ============================================

const CAPABILITY_STATUS = {
    ACTIVE: 'active',
    DEPRECATED: 'deprecated',
    BETA: 'beta',
    EXPERIMENTAL: 'experimental',
    DISABLED: 'disabled'
};

const CAPABILITY_CATEGORIES = {
    AUTHENTICATION: 'authentication',
    CATALOG: 'catalog',
    ORDERS: 'orders',
    PAYMENTS: 'payments',
    RECOMMENDATIONS: 'recommendations',
    NOTIFICATIONS: 'notifications',
    ANALYTICS: 'analytics',
    INVENTORY: 'inventory',
    PROMOTIONS: 'promotions',
    USER_MANAGEMENT: 'user_management'
};

const DEPENDENCY_TYPES = {
    REQUIRED: 'required',
    OPTIONAL: 'optional',
    RECOMMENDED: 'recommended'
};

// ============================================
// CAPABILITY DISCOVERY SERVICE
// ============================================

class CapabilityDiscoveryService extends EventEmitter {
    constructor() {
        super();
        this.capabilities = new Map();
        this.services = new Map();
        this.dependencyGraph = new Map();
        this.discoveryCache = new Map();
        this.cacheTTL = 300; // 5 minutes
        this.isInitialized = false;
    }

    /**
     * Initialize capability discovery
     */
    async initialize() {
        if (this.isInitialized) return;

        // Load capabilities from database
        await this.loadCapabilities();

        // Load services
        await this.loadServices();

        // Build dependency graph
        this.buildDependencyGraph();

        this.isInitialized = true;
        console.log('✅ Capability Discovery Service initialized');
        return this;
    }

    /**
     * Register a service
     */
    async registerService(serviceData) {
        const service = {
            id: this.generateServiceId(),
            name: serviceData.name,
            version: serviceData.version || '1.0.0',
            description: serviceData.description || '',
            category: serviceData.category || CAPABILITY_CATEGORIES.USER_MANAGEMENT,
            capabilities: serviceData.capabilities || [],
            dependencies: serviceData.dependencies || [],
            permissions: serviceData.permissions || [],
            endpoints: serviceData.endpoints || [],
            metadata: serviceData.metadata || {},
            status: serviceData.status || CAPABILITY_STATUS.ACTIVE,
            registeredAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        // Validate service
        this.validateService(service);

        const connection = await db.getConnection();
        await connection.beginTransaction();

        try {
            this.services.set(service.id, service);
            await this.storeService(service, connection);

            // Register capabilities
            for (const capability of service.capabilities) {
                await this.registerCapability(service.id, capability, connection);
            }

            await connection.commit();

            // Rebuild dependency graph
            this.buildDependencyGraph();

            console.log(`📦 Service registered: ${service.name} (${service.id})`);
            this.emit('service.registered', { serviceId: service.id, name: service.name });

            return service;
        } catch (error) {
            await connection.rollback();
            this.services.delete(service.id);
            for (const capability of service.capabilities) {
                const existing = this.getCapabilityByName(capability.name);
                if (existing && existing.serviceId === service.id) {
                    this.capabilities.delete(existing.id);
                }
            }
            throw error;
        } finally {
            connection.release();
        }
    }

    /**
     * Register a capability
     */
    async registerCapability(serviceId, capabilityData, connection = null) {
        const service = this.services.get(serviceId);
        if (!service) {
            throw new Error(`Service not found: ${serviceId}`);
        }

        const capability = {
            id: this.generateCapabilityId(),
            serviceId,
            serviceName: service.name,
            name: capabilityData.name,
            description: capabilityData.description || '',
            version: capabilityData.version || service.version,
            category: capabilityData.category || service.category,
            operations: capabilityData.operations || [],
            parameters: capabilityData.parameters || {},
            returns: capabilityData.returns || null,
            dependencies: capabilityData.dependencies || [],
            permissions: capabilityData.permissions || [],
            status: capabilityData.status || CAPABILITY_STATUS.ACTIVE,
            metadata: capabilityData.metadata || {},
            registeredAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        // Validate capability
        this.validateCapability(capability);

        // Check for duplicates
        const existing = this.getCapabilityByName(capability.name);
        if (existing) {
            throw new Error(`Capability already exists: ${capability.name}`);
        }

        this.capabilities.set(capability.id, capability);
        await this.storeCapability(capability, connection || db);

        // Clear cache
        this.clearCache();

        console.log(`⚡ Capability registered: ${capability.name} (${capability.id})`);
        this.emit('capability.registered', { 
            capabilityId: capability.id, 
            name: capability.name,
            serviceId 
        });

        return capability;
    }

    /**
     * Discover capabilities by category
     */
    async discoverByCategory(category) {
        const cacheKey = `category:${category}`;
        const cached = this.getFromCache(cacheKey);
        if (cached) return cached;

        const capabilities = Array.from(this.capabilities.values())
            .filter(c => c.category === category && c.status !== CAPABILITY_STATUS.DISABLED);

        const result = {
            category,
            count: capabilities.length,
            capabilities,
            timestamp: new Date().toISOString()
        };

        this.setCache(cacheKey, result);
        return result;
    }

    /**
     * Discover capabilities by service
     */
    async discoverByService(serviceId) {
        const cacheKey = `service:${serviceId}`;
        const cached = this.getFromCache(cacheKey);
        if (cached) return cached;

        const service = this.services.get(serviceId);
        if (!service) {
            throw new Error(`Service not found: ${serviceId}`);
        }

        const capabilities = Array.from(this.capabilities.values())
            .filter(c => c.serviceId === serviceId && c.status !== CAPABILITY_STATUS.DISABLED);

        const result = {
            service: service.name,
            serviceId,
            count: capabilities.length,
            capabilities,
            dependencies: service.dependencies,
            timestamp: new Date().toISOString()
        };

        this.setCache(cacheKey, result);
        return result;
    }

    /**
     * Get capability by name
     */
    getCapabilityByName(name) {
        return Array.from(this.capabilities.values())
            .find(c => c.name === name) || null;
    }

    /**
     * Get service by name
     */
    getServiceByName(name) {
        return Array.from(this.services.values())
            .find(s => s.name === name) || null;
    }

    /**
     * Get dependencies for a service
     */
    getDependencies(serviceId) {
        const service = this.services.get(serviceId);
        if (!service) {
            throw new Error(`Service not found: ${serviceId}`);
        }

        const dependencies = [];
        for (const dep of service.dependencies) {
            const depService = this.getServiceByName(dep.name);
            if (depService) {
                dependencies.push({
                    ...dep,
                    service: depService,
                    capabilities: Array.from(this.capabilities.values())
                        .filter(c => c.serviceId === depService.id)
                });
            }
        }

        return dependencies;
    }

    /**
     * Get dependency graph
     */
    getDependencyGraph() {
        return this.dependencyGraph;
    }

    /**
     * Check if service has capability
     */
    hasCapability(serviceId, capabilityName) {
        const capabilities = Array.from(this.capabilities.values())
            .filter(c => c.serviceId === serviceId);
        return capabilities.some(c => c.name === capabilityName);
    }

    /**
     * Get service capabilities
     */
    getServiceCapabilities(serviceId) {
        return Array.from(this.capabilities.values())
            .filter(c => c.serviceId === serviceId);
    }

    /**
     * Update service status
     */
    async updateServiceStatus(serviceId, status) {
        const service = this.services.get(serviceId);
        if (!service) {
            throw new Error(`Service not found: ${serviceId}`);
        }

        service.status = status;
        service.updatedAt = new Date().toISOString();

        await this.storeService(service);

        // Update related capabilities
        const capabilities = Array.from(this.capabilities.values())
            .filter(c => c.serviceId === serviceId);
        
        for (const cap of capabilities) {
            cap.status = status;
            cap.updatedAt = new Date().toISOString();
            await this.storeCapability(cap);
        }

        this.clearCache();
        this.emit('service.status.updated', { serviceId, status });

        return service;
    }

    /**
     * Update capability status
     */
    async updateCapabilityStatus(capabilityId, status) {
        const capability = this.capabilities.get(capabilityId);
        if (!capability) {
            throw new Error(`Capability not found: ${capabilityId}`);
        }

        capability.status = status;
        capability.updatedAt = new Date().toISOString();

        await this.storeCapability(capability);
        this.clearCache();

        this.emit('capability.status.updated', { capabilityId, status });

        return capability;
    }

    /**
     * Search capabilities
     */
    searchCapabilities(query) {
        const results = [];
        const lowerQuery = query.toLowerCase();

        for (const capability of this.capabilities.values()) {
            if (capability.status === CAPABILITY_STATUS.DISABLED) continue;

            if (capability.name.toLowerCase().includes(lowerQuery) ||
                capability.description.toLowerCase().includes(lowerQuery) ||
                capability.category.toLowerCase().includes(lowerQuery)) {
                results.push(capability);
            }
        }

        return results;
    }

    /**
     * Get service health
     */
    getServiceHealth(serviceId) {
        const service = this.services.get(serviceId);
        if (!service) {
            throw new Error(`Service not found: ${serviceId}`);
        }

        const capabilities = Array.from(this.capabilities.values())
            .filter(c => c.serviceId === serviceId);

        const healthy = capabilities.filter(c => c.status === CAPABILITY_STATUS.ACTIVE).length;
        const total = capabilities.length;

        return {
            serviceId,
            serviceName: service.name,
            healthy,
            total,
            healthScore: total > 0 ? (healthy / total) * 100 : 0,
            status: healthy === total ? 'healthy' : 'degraded'
        };
    }

    // ============================================
    // VALIDATION FUNCTIONS
    // ============================================

    validateService(service) {
        if (!service.name) {
            throw new Error('Service name is required');
        }
        if (!service.category) {
            throw new Error('Service category is required');
        }
        if (!Object.values(CAPABILITY_CATEGORIES).includes(service.category)) {
            throw new Error(`Invalid category: ${service.category}`);
        }
    }

    validateCapability(capability) {
        if (!capability.name) {
            throw new Error('Capability name is required');
        }
        if (!capability.serviceId) {
            throw new Error('Capability service ID is required');
        }
        if (!capability.operations || capability.operations.length === 0) {
            throw new Error('Capability must have at least one operation');
        }
        if (!Object.values(CAPABILITY_STATUS).includes(capability.status)) {
            throw new Error(`Invalid status: ${capability.status}`);
        }
    }

    // ============================================
    // GRAPH BUILDING
    // ============================================

    buildDependencyGraph() {
        this.dependencyGraph.clear();

        for (const [serviceId, service] of this.services) {
            const node = {
                serviceId,
                name: service.name,
                category: service.category,
                dependencies: [],
                dependents: [],
                capabilities: Array.from(this.capabilities.values())
                    .filter(c => c.serviceId === serviceId)
                    .map(c => c.name)
            };

            // Add dependencies
            for (const dep of service.dependencies) {
                const depService = this.getServiceByName(dep.name);
                if (depService) {
                    node.dependencies.push({
                        serviceId: depService.id,
                        name: depService.name,
                        type: dep.type || DEPENDENCY_TYPES.REQUIRED
                    });
                }
            }

            this.dependencyGraph.set(serviceId, node);
        }

        // Build reverse dependencies (dependents)
        for (const [serviceId, node] of this.dependencyGraph) {
            for (const dep of node.dependencies) {
                const depNode = this.dependencyGraph.get(dep.serviceId);
                if (depNode) {
                    depNode.dependents.push({
                        serviceId,
                        name: node.name
                    });
                }
            }
        }
    }

    // ============================================
    // GENERATE IDS
    // ============================================

    generateServiceId() {
        return `SVC_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    }

    generateCapabilityId() {
        return `CAP_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    }

    // ============================================
    // CACHE MANAGEMENT
    // ============================================

    getFromCache(key) {
        const cached = this.discoveryCache.get(key);
        if (cached && cached.expiresAt > Date.now()) {
            return cached.data;
        }
        this.discoveryCache.delete(key);
        return null;
    }

    setCache(key, data) {
        this.discoveryCache.set(key, {
            data,
            expiresAt: Date.now() + this.cacheTTL * 1000
        });
    }

    clearCache() {
        this.discoveryCache.clear();
    }

    // ============================================
    // DATABASE OPERATIONS
    // ============================================

    async loadCapabilities() {
        try {
            const [rows] = await db.query(
                'SELECT * FROM capabilities WHERE status != ?',
                [CAPABILITY_STATUS.DISABLED]
            );

            for (const row of rows) {
                const capability = {
                    id: row.capability_id,
                    serviceId: row.service_id,
                    serviceName: row.service_name,
                    name: row.name,
                    description: row.description,
                    version: row.version,
                    category: row.category,
                    operations: JSON.parse(row.operations || '[]'),
                    parameters: JSON.parse(row.parameters || '{}'),
                    returns: JSON.parse(row.returns || 'null'),
                    dependencies: JSON.parse(row.dependencies || '[]'),
                    permissions: JSON.parse(row.permissions || '[]'),
                    status: row.status,
                    metadata: JSON.parse(row.metadata || '{}'),
                    registeredAt: row.registered_at,
                    updatedAt: row.updated_at
                };

                this.capabilities.set(capability.id, capability);
            }

            console.log(`📦 Loaded ${this.capabilities.size} capabilities`);
        } catch (error) {
            console.error('Load capabilities error:', error);
        }
    }

    async loadServices() {
        try {
            const [rows] = await db.query(
                'SELECT * FROM services WHERE status != ?',
                [CAPABILITY_STATUS.DISABLED]
            );

            for (const row of rows) {
                const service = {
                    id: row.service_id,
                    name: row.name,
                    version: row.version,
                    description: row.description,
                    category: row.category,
                    capabilities: JSON.parse(row.capabilities || '[]'),
                    dependencies: JSON.parse(row.dependencies || '[]'),
                    permissions: JSON.parse(row.permissions || '[]'),
                    endpoints: JSON.parse(row.endpoints || '[]'),
                    metadata: JSON.parse(row.metadata || '{}'),
                    status: row.status,
                    registeredAt: row.registered_at,
                    updatedAt: row.updated_at
                };

                this.services.set(service.id, service);
            }

            console.log(`📦 Loaded ${this.services.size} services`);
        } catch (error) {
            console.error('Load services error:', error);
        }
    }

    async storeService(service, connection = db) {
        try {
            await connection.query(
                `INSERT INTO services 
                 (service_id, name, version, description, category,
                  capabilities, dependencies, permissions, endpoints,
                  metadata, status, registered_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE
                 name = VALUES(name), version = VALUES(version),
                 description = VALUES(description), category = VALUES(category),
                 capabilities = VALUES(capabilities), 
                 dependencies = VALUES(dependencies),
                 permissions = VALUES(permissions), 
                 endpoints = VALUES(endpoints),
                 metadata = VALUES(metadata), status = VALUES(status),
                 updated_at = VALUES(updated_at)`,
                [
                    service.id,
                    service.name,
                    service.version,
                    service.description,
                    service.category,
                    JSON.stringify(service.capabilities),
                    JSON.stringify(service.dependencies),
                    JSON.stringify(service.permissions),
                    JSON.stringify(service.endpoints),
                    JSON.stringify(service.metadata),
                    service.status,
                    service.registeredAt,
                    service.updatedAt
                ]
            );
        } catch (error) {
            console.error('Store service error:', error);
            throw error;
        }
    }

    async storeCapability(capability, connection = db) {
        try {
            await connection.query(
                `INSERT INTO capabilities 
                 (capability_id, service_id, service_name, name, description,
                  version, category, operations, parameters, returns,
                  dependencies, permissions, status, metadata,
                  registered_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE
                 service_id = VALUES(service_id), 
                 service_name = VALUES(service_name),
                 name = VALUES(name), description = VALUES(description),
                 version = VALUES(version), category = VALUES(category),
                 operations = VALUES(operations), 
                 parameters = VALUES(parameters),
                 returns = VALUES(returns), 
                 dependencies = VALUES(dependencies),
                 permissions = VALUES(permissions), status = VALUES(status),
                 metadata = VALUES(metadata), updated_at = VALUES(updated_at)`,
                [
                    capability.id,
                    capability.serviceId,
                    capability.serviceName,
                    capability.name,
                    capability.description,
                    capability.version,
                    capability.category,
                    JSON.stringify(capability.operations),
                    JSON.stringify(capability.parameters),
                    JSON.stringify(capability.returns),
                    JSON.stringify(capability.dependencies),
                    JSON.stringify(capability.permissions),
                    capability.status,
                    JSON.stringify(capability.metadata),
                    capability.registeredAt,
                    capability.updatedAt
                ]
            );
        } catch (error) {
            console.error('Store capability error:', error);
            throw error;
        }
    }

    // ============================================
    // STATISTICS
    // ============================================

    async getStatistics() {
        const services = Array.from(this.services.values());
        const capabilities = Array.from(this.capabilities.values());

        return {
            totalServices: services.length,
            totalCapabilities: capabilities.length,
            byCategory: capabilities.reduce((acc, c) => {
                acc[c.category] = (acc[c.category] || 0) + 1;
                return acc;
            }, {}),
            byStatus: capabilities.reduce((acc, c) => {
                acc[c.status] = (acc[c.status] || 0) + 1;
                return acc;
            }, {}),
            cacheSize: this.discoveryCache.size,
            dependencyGraphSize: this.dependencyGraph.size,
            timestamp: new Date().toISOString()
        };
    }

    getStatus() {
        return {
            services: this.services.size,
            capabilities: this.capabilities.size,
            dependencyGraph: this.dependencyGraph.size,
            cacheSize: this.discoveryCache.size,
            categories: Object.values(CAPABILITY_CATEGORIES),
            statuses: Object.values(CAPABILITY_STATUS)
        };
    }
}

// ============================================
// EXPORT
// ============================================

module.exports = {
    CapabilityDiscoveryService,
    CAPABILITY_STATUS,
    CAPABILITY_CATEGORIES,
    DEPENDENCY_TYPES,
    capabilityDiscoveryService: new CapabilityDiscoveryService()
};