// backend/services/dataOwnershipService.js
const db = require('../config/db').promise;
const EventEmitter = require('events');

// ============================================
// DATA OWNERSHIP CONFIGURATION
// ============================================

const DOMAINS = {
    ORDERS: 'orders',
    INVENTORY: 'inventory',
    PAYMENTS: 'payments',
    RECOMMENDATIONS: 'recommendations',
    PROMOTIONS: 'promotions',
    ANALYTICS: 'analytics',
    USER_MANAGEMENT: 'user_management',
    CATALOG: 'catalog',
    CART: 'cart',
    NOTIFICATIONS: 'notifications'
};

const OWNERSHIP_TYPES = {
    PRIMARY: 'primary',
    SECONDARY: 'secondary',
    REFERENCE: 'reference',
    DERIVED: 'derived',
    AGGREGATED: 'aggregated'
};

const ACCESS_LEVELS = {
    FULL: 'full',
    READ: 'read',
    WRITE: 'write',
    ADMIN: 'admin',
    NONE: 'none'
};

// ============================================
// DATA OWNERSHIP SERVICE
// ============================================

class DataOwnershipService extends EventEmitter {
    constructor() {
        super();
        this.ownershipContracts = new Map();
        this.domainEntities = new Map();
        this.crossDomainDependencies = new Map();
        this.accessRules = new Map();
        this.contractViolations = [];
        this.isInitialized = false;
    }

    /**
     * Initialize data ownership service
     */
    async initialize() {
        if (this.isInitialized) return;

        // Load contracts from database
        await this.loadContracts();

        // Load domain entities
        await this.loadDomainEntities();

        this.isInitialized = true;
        console.log('✅ Data Ownership Service initialized');
        return this;
    }

    /**
     * Register a domain
     */
    async registerDomain(domainData) {
        const domain = {
            id: domainData.id || domainData.name,
            name: domainData.name,
            description: domainData.description || '',
            owner: domainData.owner || 'unknown',
            entities: domainData.entities || [],
            dependencies: domainData.dependencies || [],
            interfaces: domainData.interfaces || [],
            events: domainData.events || [],
            metadata: domainData.metadata || {},
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        // Validate domain
        this.validateDomain(domain);

        this.domainEntities.set(domain.id, domain);
        await this.storeDomain(domain);

        console.log(`📦 Domain registered: ${domain.name} (${domain.id})`);
        return domain;
    }

    /**
     * Define ownership contract
     */
    async defineContract(contractData) {
        const contract = {
            id: this.generateContractId(),
            entityName: contractData.entityName,
            entityType: contractData.entityType,
            owningDomain: contractData.owningDomain,
            ownershipType: contractData.ownershipType || OWNERSHIP_TYPES.PRIMARY,
            allowedOperations: contractData.allowedOperations || [],
            publicInterfaces: contractData.publicInterfaces || [],
            dependencies: contractData.dependencies || [],
            consumers: contractData.consumers || [],
            accessRules: contractData.accessRules || {},
            metadata: contractData.metadata || {},
            status: 'active',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        // Validate contract
        this.validateContract(contract);

        this.ownershipContracts.set(contract.id, contract);

        // Update domain entities
        const domain = this.domainEntities.get(contract.owningDomain);
        if (domain && !domain.entities.includes(contract.entityName)) {
            domain.entities.push(contract.entityName);
            await this.storeDomain(domain);
        }

        // Store in database
        await this.storeContract(contract);

        console.log(`📋 Contract defined: ${contract.entityName} owned by ${contract.owningDomain}`);
        this.emit('contract.defined', { contractId: contract.id, entity: contract.entityName });

        return contract;
    }

    /**
     * Get ownership contract for an entity
     */
    getContract(entityName) {
        for (const contract of this.ownershipContracts.values()) {
            if (contract.entityName === entityName) {
                return contract;
            }
        }
        return null;
    }

    /**
     * Get all contracts
     */
    getAllContracts(filters = {}) {
        let contracts = Array.from(this.ownershipContracts.values());

        if (filters.owningDomain) {
            contracts = contracts.filter(c => c.owningDomain === filters.owningDomain);
        }

        if (filters.ownershipType) {
            contracts = contracts.filter(c => c.ownershipType === filters.ownershipType);
        }

        return contracts;
    }

    /**
     * Get domain by ID
     */
    getDomain(domainId) {
        return this.domainEntities.get(domainId) || null;
    }

    /**
     * Get all domains
     */
    getAllDomains() {
        return Array.from(this.domainEntities.values());
    }

    /**
     * Check if domain owns entity
     */
    isOwner(domainId, entityName) {
        const contract = this.getContract(entityName);
        return contract && contract.owningDomain === domainId;
    }

    /**
     * Check if operation is allowed
     */
    isOperationAllowed(domainId, entityName, operation) {
        const contract = this.getContract(entityName);
        if (!contract) return false;

        // Check if domain is the owner
        if (contract.owningDomain === domainId) {
            return true; // Owner can perform all operations
        }

        // Check allowed operations for consumers
        return contract.allowedOperations.includes(operation);
    }

    /**
     * Get entity owners
     */
    getEntityOwners(entityName) {
        const owners = [];
        for (const contract of this.ownershipContracts.values()) {
            if (contract.entityName === entityName) {
                owners.push({
                    domain: contract.owningDomain,
                    ownershipType: contract.ownershipType,
                    accessLevel: contract.accessRules.default || ACCESS_LEVELS.READ
                });
            }
        }
        return owners;
    }

    /**
     * Get domain dependencies
     */
    getDomainDependencies(domainId) {
        const domain = this.domainEntities.get(domainId);
        if (!domain) return [];

        const dependencies = [];
        for (const dep of domain.dependencies) {
            const depDomain = this.domainEntities.get(dep);
            if (depDomain) {
                dependencies.push({
                    domain: dep,
                    contracts: this.getAllContracts({ owningDomain: dep })
                });
            }
        }
        return dependencies;
    }

    /**
     * Get cross-domain dependencies
     */
    getCrossDomainDependencies() {
        const dependencies = [];

        for (const contract of this.ownershipContracts.values()) {
            if (contract.dependencies && contract.dependencies.length > 0) {
                for (const dep of contract.dependencies) {
                    dependencies.push({
                        entity: contract.entityName,
                        owner: contract.owningDomain,
                        dependsOn: dep,
                        type: contract.ownershipType
                    });
                }
            }
        }

        return dependencies;
    }

    /**
     * Check for circular dependencies
     */
    checkCircularDependencies() {
        const visited = new Set();
        const recursionStack = new Set();
        const cycles = [];

        const dfs = (domainId, path = []) => {
            if (recursionStack.has(domainId)) {
                cycles.push([...path, domainId]);
                return;
            }

            if (visited.has(domainId)) return;

            visited.add(domainId);
            recursionStack.add(domainId);
            path.push(domainId);

            const domain = this.domainEntities.get(domainId);
            if (domain && domain.dependencies) {
                for (const dep of domain.dependencies) {
                    dfs(dep, [...path]);
                }
            }

            recursionStack.delete(domainId);
        };

        for (const domainId of this.domainEntities.keys()) {
            if (!visited.has(domainId)) {
                dfs(domainId);
            }
        }

        if (cycles.length > 0) {
            this.emit('circular.dependencies', { cycles });
        }

        return cycles;
    }

    /**
     * Validate domain
     */
    validateDomain(domain) {
        if (!domain.name) {
            throw new Error('Domain name is required');
        }
        if (!domain.owner) {
            throw new Error('Domain owner is required');
        }
    }

    /**
     * Validate contract
     */
    validateContract(contract) {
        if (!contract.entityName) {
            throw new Error('Entity name is required');
        }
        if (!contract.owningDomain) {
            throw new Error('Owning domain is required');
        }
        if (!this.domainEntities.has(contract.owningDomain)) {
            throw new Error(`Domain not found: ${contract.owningDomain}`);
        }
        if (!Object.values(OWNERSHIP_TYPES).includes(contract.ownershipType)) {
            throw new Error(`Invalid ownership type: ${contract.ownershipType}`);
        }
    }

    /**
     * Generate contract ID
     */
    generateContractId() {
        return `CONTRACT_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    }

    // ============================================
    // DATABASE OPERATIONS
    // ============================================

    async loadContracts() {
        try {
            const [rows] = await db.query(
                'SELECT * FROM data_ownership_contracts WHERE status != "archived"'
            );

            for (const row of rows) {
                const contract = {
                    id: row.contract_id,
                    entityName: row.entity_name,
                    entityType: row.entity_type,
                    owningDomain: row.owning_domain,
                    ownershipType: row.ownership_type,
                    allowedOperations: JSON.parse(row.allowed_operations || '[]'),
                    publicInterfaces: JSON.parse(row.public_interfaces || '[]'),
                    dependencies: JSON.parse(row.dependencies || '[]'),
                    consumers: JSON.parse(row.consumers || '[]'),
                    accessRules: JSON.parse(row.access_rules || '{}'),
                    metadata: JSON.parse(row.metadata || '{}'),
                    status: row.status,
                    createdAt: row.created_at,
                    updatedAt: row.updated_at
                };

                this.ownershipContracts.set(contract.id, contract);
            }

            console.log(`📋 Loaded ${this.ownershipContracts.size} contracts`);
        } catch (error) {
            console.error('Load contracts error:', error);
        }
    }

    async loadDomainEntities() {
        try {
            const [rows] = await db.query(
                'SELECT * FROM data_ownership_domains'
            );

            for (const row of rows) {
                const domain = {
                    id: row.domain_id,
                    name: row.name,
                    description: row.description,
                    owner: row.owner,
                    entities: JSON.parse(row.entities || '[]'),
                    dependencies: JSON.parse(row.dependencies || '[]'),
                    interfaces: JSON.parse(row.interfaces || '[]'),
                    events: JSON.parse(row.events || '[]'),
                    metadata: JSON.parse(row.metadata || '{}'),
                    createdAt: row.created_at,
                    updatedAt: row.updated_at
                };

                this.domainEntities.set(domain.id, domain);
            }

            console.log(`📦 Loaded ${this.domainEntities.size} domains`);
        } catch (error) {
            console.error('Load domains error:', error);
        }
    }

    async storeDomain(domain) {
        try {
            await db.query(
                `INSERT INTO data_ownership_domains 
                 (domain_id, name, description, owner, entities,
                  dependencies, interfaces, events, metadata,
                  created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE
                 name = VALUES(name), description = VALUES(description),
                 owner = VALUES(owner), entities = VALUES(entities),
                 dependencies = VALUES(dependencies), 
                 interfaces = VALUES(interfaces),
                 events = VALUES(events), metadata = VALUES(metadata),
                 updated_at = VALUES(updated_at)`,
                [
                    domain.id,
                    domain.name,
                    domain.description,
                    domain.owner,
                    JSON.stringify(domain.entities),
                    JSON.stringify(domain.dependencies),
                    JSON.stringify(domain.interfaces),
                    JSON.stringify(domain.events),
                    JSON.stringify(domain.metadata),
                    domain.createdAt,
                    domain.updatedAt
                ]
            );
        } catch (error) {
            console.error('Store domain error:', error);
        }
    }

    async storeContract(contract) {
        try {
            await db.query(
                `INSERT INTO data_ownership_contracts 
                 (contract_id, entity_name, entity_type, owning_domain,
                  ownership_type, allowed_operations, public_interfaces,
                  dependencies, consumers, access_rules, metadata,
                  status, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE
                 entity_name = VALUES(entity_name), 
                 entity_type = VALUES(entity_type),
                 owning_domain = VALUES(owning_domain),
                 ownership_type = VALUES(ownership_type),
                 allowed_operations = VALUES(allowed_operations),
                 public_interfaces = VALUES(public_interfaces),
                 dependencies = VALUES(dependencies), 
                 consumers = VALUES(consumers),
                 access_rules = VALUES(access_rules), 
                 metadata = VALUES(metadata),
                 status = VALUES(status), updated_at = VALUES(updated_at)`,
                [
                    contract.id,
                    contract.entityName,
                    contract.entityType,
                    contract.owningDomain,
                    contract.ownershipType,
                    JSON.stringify(contract.allowedOperations),
                    JSON.stringify(contract.publicInterfaces),
                    JSON.stringify(contract.dependencies),
                    JSON.stringify(contract.consumers),
                    JSON.stringify(contract.accessRules),
                    JSON.stringify(contract.metadata),
                    contract.status,
                    contract.createdAt,
                    contract.updatedAt
                ]
            );
        } catch (error) {
            console.error('Store contract error:', error);
        }
    }

    // ============================================
    // STATISTICS
    // ============================================

    async getStatistics() {
        const contracts = Array.from(this.ownershipContracts.values());
        const domains = Array.from(this.domainEntities.values());

        return {
            totalContracts: contracts.length,
            totalDomains: domains.length,
            byOwnershipType: contracts.reduce((acc, c) => {
                acc[c.ownershipType] = (acc[c.ownershipType] || 0) + 1;
                return acc;
            }, {}),
            byDomain: contracts.reduce((acc, c) => {
                acc[c.owningDomain] = (acc[c.owningDomain] || 0) + 1;
                return acc;
            }, {}),
            crossDomainDependencies: this.getCrossDomainDependencies().length,
            circularDependencies: this.checkCircularDependencies().length,
            timestamp: new Date().toISOString()
        };
    }

    getStatus() {
        return {
            contracts: this.ownershipContracts.size,
            domains: this.domainEntities.size,
            dependencies: this.crossDomainDependencies.size,
            violations: this.contractViolations.length,
            initialized: this.isInitialized
        };
    }
}

// ============================================
// DATA OWNERSHIP MIDDLEWARE
// ============================================

/**
 * Middleware to enforce data ownership
 */
function enforceDataOwnership(entityName, operation) {
    return async (req, res, next) => {
        try {
            const dataOwnershipService = require('./dataOwnershipService').dataOwnershipService;
            const domainId = req.user?.domain || req.headers['x-domain'] || 'unknown';

            if (!dataOwnershipService.isOperationAllowed(domainId, entityName, operation)) {
                return res.status(403).json({
                    success: false,
                    error: 'Access denied: Operation not allowed on this entity',
                    entity: entityName,
                    operation,
                    domain: domainId
                });
            }

            next();
        } catch (error) {
            console.error('Data ownership enforcement error:', error);
            res.status(500).json({
                success: false,
                error: 'Authorization failed'
            });
        }
    };
}

// ============================================
// EXPORT
// ============================================

module.exports = {
    DataOwnershipService,
    DOMAINS,
    OWNERSHIP_TYPES,
    ACCESS_LEVELS,
    enforceDataOwnership,
    dataOwnershipService: new DataOwnershipService()
};