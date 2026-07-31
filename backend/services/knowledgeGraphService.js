// backend/services/knowledgeGraphService.js
const fs = require('fs');
const path = require('path');
const db = require('../config/db').promise;
const EventEmitter = require('events');

// ============================================
// KNOWLEDGE GRAPH CONFIGURATION
// ============================================

const NODE_TYPES = {
    SERVICE: 'service',
    CONTROLLER: 'controller',
    API: 'api',
    MODEL: 'model',
    EVENT: 'event',
    QUEUE: 'queue',
    JOB: 'job',
    UTILITY: 'utility',
    CONFIG: 'config',
    MIDDLEWARE: 'middleware',
    REPOSITORY: 'repository',
    VALIDATOR: 'validator',
    ROUTE: 'route'
};

const RELATIONSHIP_TYPES = {
    CALLS: 'calls',
    DEPENDS_ON: 'depends_on',
    PUBLISHES: 'publishes',
    CONSUMES: 'consumes',
    OWNS: 'owns',
    UPDATES: 'updates',
    REFERENCES: 'references',
    EXTENDS: 'extends',
    IMPLEMENTS: 'implements',
    HANDLES: 'handles',
    RETURNS: 'returns',
    USES: 'uses'
};

// ============================================
// KNOWLEDGE GRAPH SERVICE
// ============================================

class KnowledgeGraphService extends EventEmitter {
    constructor() {
        super();
        this.graph = {
            nodes: [],
            edges: []
        };
        this.nodeIndex = new Map();
        this.edgeIndex = new Map();
        this.graphVersions = [];
        this.isBuilding = false;
        this.projectRoot = path.join(__dirname, '..');
    }

    /**
     * Initialize knowledge graph service
     */
    async initialize() {
        // Build initial graph
        await this.buildGraph();

        // Load historical versions
        await this.loadHistoricalVersions();

        console.log('✅ Knowledge Graph Service initialized');
        return this;
    }

    /**
     * Build knowledge graph
     */
    async buildGraph() {
        if (this.isBuilding) return;

        this.isBuilding = true;
        console.log('📊 Building system knowledge graph...');

        try {
            // Clear existing graph
            this.graph = { nodes: [], edges: [] };
            this.nodeIndex.clear();
            this.edgeIndex.clear();

            // Find and add all components
            await this.addServices();
            await this.addControllers();
            await this.addAPIs();
            await this.addModels();
            await this.addEvents();
            await this.addQueues();
            await this.addJobs();
            await this.addUtilities();
            await this.addRoutes();
            await this.addMiddleware();
            await this.addRepositories();
            await this.addValidators();

            // Build relationships
            await this.buildRelationships();

            // Store version
            const version = {
                version: this.graphVersions.length + 1,
                timestamp: new Date().toISOString(),
                nodeCount: this.graph.nodes.length,
                edgeCount: this.graph.edges.length
            };

            this.graphVersions.push(version);

            // Store in database
            await this.storeGraph();

            this.emit('graph.built', version);
            console.log(`✅ Graph built: ${this.graph.nodes.length} nodes, ${this.graph.edges.length} edges`);

            return this.graph;

        } catch (error) {
            console.error('Build graph error:', error);
            this.emit('graph.error', { error });
            throw error;
        } finally {
            this.isBuilding = false;
        }
    }

    /**
     * Add services to graph
     */
    async addServices() {
        const services = this.findServices();
        for (const servicePath of services) {
            const node = this.createNode(
                servicePath,
                NODE_TYPES.SERVICE,
                {
                    name: path.basename(servicePath, '.js'),
                    path: servicePath,
                    dependencies: this.extractDependencies(servicePath)
                }
            );
            this.addNode(node);
        }
    }

    /**
     * Add controllers to graph
     */
    async addControllers() {
        const controllers = this.findControllers();
        for (const controllerPath of controllers) {
            const node = this.createNode(
                controllerPath,
                NODE_TYPES.CONTROLLER,
                {
                    name: path.basename(controllerPath, '.js'),
                    path: controllerPath,
                    routes: this.extractRoutes(controllerPath)
                }
            );
            this.addNode(node);
        }
    }

    /**
     * Add APIs to graph
     */
    async addAPIs() {
        const apis = this.findAPIs();
        for (const apiPath of apis) {
            const node = this.createNode(
                apiPath,
                NODE_TYPES.API,
                {
                    name: path.basename(apiPath, '.js'),
                    path: apiPath,
                    endpoints: this.extractEndpoints(apiPath)
                }
            );
            this.addNode(node);
        }
    }

    /**
     * Add models to graph
     */
    async addModels() {
        const models = this.findModels();
        for (const modelPath of models) {
            const node = this.createNode(
                modelPath,
                NODE_TYPES.MODEL,
                {
                    name: path.basename(modelPath, '.js'),
                    path: modelPath,
                    schema: this.extractSchema(modelPath)
                }
            );
            this.addNode(node);
        }
    }

    /**
     * Add events to graph
     */
    async addEvents() {
        const events = this.findEvents();
        for (const eventPath of events) {
            const node = this.createNode(
                eventPath,
                NODE_TYPES.EVENT,
                {
                    name: path.basename(eventPath, '.js'),
                    path: eventPath,
                    eventTypes: this.extractEventTypes(eventPath)
                }
            );
            this.addNode(node);
        }
    }

    /**
     * Add queues to graph
     */
    async addQueues() {
        const queues = this.findQueues();
        for (const queuePath of queues) {
            const node = this.createNode(
                queuePath,
                NODE_TYPES.QUEUE,
                {
                    name: path.basename(queuePath, '.js'),
                    path: queuePath,
                    queueNames: this.extractQueueNames(queuePath)
                }
            );
            this.addNode(node);
        }
    }

    /**
     * Add jobs to graph
     */
    async addJobs() {
        const jobs = this.findJobs();
        for (const jobPath of jobs) {
            const node = this.createNode(
                jobPath,
                NODE_TYPES.JOB,
                {
                    name: path.basename(jobPath, '.js'),
                    path: jobPath,
                    schedule: this.extractSchedule(jobPath)
                }
            );
            this.addNode(node);
        }
    }

    /**
     * Add utilities to graph
     */
    async addUtilities() {
        const utilities = this.findUtilities();
        for (const utilityPath of utilities) {
            const node = this.createNode(
                utilityPath,
                NODE_TYPES.UTILITY,
                {
                    name: path.basename(utilityPath, '.js'),
                    path: utilityPath,
                    functions: this.extractFunctions(utilityPath)
                }
            );
            this.addNode(node);
        }
    }

    /**
     * Add routes to graph
     */
    async addRoutes() {
        const routes = this.findRoutes();
        for (const routePath of routes) {
            const node = this.createNode(
                routePath,
                NODE_TYPES.ROUTE,
                {
                    name: path.basename(routePath, '.js'),
                    path: routePath,
                    routes: this.extractRoutes(routePath)
                }
            );
            this.addNode(node);
        }
    }

    /**
     * Add middleware to graph
     */
    async addMiddleware() {
        const middleware = this.findMiddleware();
        for (const middlewarePath of middleware) {
            const node = this.createNode(
                middlewarePath,
                NODE_TYPES.MIDDLEWARE,
                {
                    name: path.basename(middlewarePath, '.js'),
                    path: middlewarePath,
                    usage: this.extractMiddlewareUsage(middlewarePath)
                }
            );
            this.addNode(node);
        }
    }

    /**
     * Add repositories to graph
     */
    async addRepositories() {
        const repositories = this.findRepositories();
        for (const repoPath of repositories) {
            const node = this.createNode(
                repoPath,
                NODE_TYPES.REPOSITORY,
                {
                    name: path.basename(repoPath, '.js'),
                    path: repoPath,
                    methods: this.extractRepositoryMethods(repoPath)
                }
            );
            this.addNode(node);
        }
    }

    /**
     * Add validators to graph
     */
    async addValidators() {
        const validators = this.findValidators();
        for (const validatorPath of validators) {
            const node = this.createNode(
                validatorPath,
                NODE_TYPES.VALIDATOR,
                {
                    name: path.basename(validatorPath, '.js'),
                    path: validatorPath,
                    validations: this.extractValidations(validatorPath)
                }
            );
            this.addNode(node);
        }
    }

    /**
     * Build relationships between nodes
     */
    async buildRelationships() {
        // Build dependency relationships
        for (const [id, node] of this.nodeIndex) {
            if (node.metadata.dependencies) {
                for (const dep of node.metadata.dependencies) {
                    const depNode = this.findNodeByName(dep);
                    if (depNode) {
                        this.addEdge(node.id, depNode.id, RELATIONSHIP_TYPES.DEPENDS_ON);
                    }
                }
            }
        }

        // Build call relationships from controllers to services
        const controllers = this.getNodesByType(NODE_TYPES.CONTROLLER);
        const services = this.getNodesByType(NODE_TYPES.SERVICE);

        for (const controller of controllers) {
            const content = fs.readFileSync(controller.metadata.path, 'utf8');
            for (const service of services) {
                const serviceName = service.metadata.name;
                if (content.includes(serviceName) || content.includes(`require('${serviceName}')`)) {
                    this.addEdge(controller.id, service.id, RELATIONSHIP_TYPES.CALLS);
                }
            }
        }

        // Build API to controller relationships
        const apis = this.getNodesByType(NODE_TYPES.API);
        for (const api of apis) {
            const content = fs.readFileSync(api.metadata.path, 'utf8');
            for (const controller of controllers) {
                const controllerName = controller.metadata.name;
                if (content.includes(controllerName)) {
                    this.addEdge(api.id, controller.id, RELATIONSHIP_TYPES.HANDLES);
                }
            }
        }

        // Build event relationships
        const events = this.getNodesByType(NODE_TYPES.EVENT);
        for (const event of events) {
            const content = fs.readFileSync(event.metadata.path, 'utf8');
            for (const node of this.graph.nodes) {
                if (node.id === event.id) continue;
                const nodeContent = fs.existsSync(node.metadata.path) 
                    ? fs.readFileSync(node.metadata.path, 'utf8') 
                    : '';
                if (nodeContent.includes(event.metadata.name)) {
                    if (nodeContent.includes('emit') || nodeContent.includes('publish')) {
                        this.addEdge(node.id, event.id, RELATIONSHIP_TYPES.PUBLISHES);
                    } else if (nodeContent.includes('on') || nodeContent.includes('subscribe')) {
                        this.addEdge(node.id, event.id, RELATIONSHIP_TYPES.CONSUMES);
                    }
                }
            }
        }

        // Build model relationships
        const models = this.getNodesByType(NODE_TYPES.MODEL);
        for (const model of models) {
            for (const node of this.graph.nodes) {
                if (node.id === model.id) continue;
                const content = fs.existsSync(node.metadata.path) 
                    ? fs.readFileSync(node.metadata.path, 'utf8') 
                    : '';
                if (content.includes(model.metadata.name) || 
                    content.includes(`require('${model.metadata.name}')`)) {
                    this.addEdge(node.id, model.id, RELATIONSHIP_TYPES.REFERENCES);
                }
            }
        }
    }

    /**
     * Create a node
     */
    createNode(path, type, metadata) {
        const id = `node_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
        return {
            id,
            type,
            metadata: {
                ...metadata,
                path,
                created: new Date().toISOString()
            }
        };
    }

    /**
     * Add node to graph
     */
    addNode(node) {
        this.graph.nodes.push(node);
        this.nodeIndex.set(node.id, node);
    }

    /**
     * Add edge to graph
     */
    addEdge(source, target, type) {
        const edge = {
            source,
            target,
            type,
            timestamp: new Date().toISOString()
        };
        this.graph.edges.push(edge);
        this.edgeIndex.set(`${source}-${target}-${type}`, edge);
    }

    /**
     * Get node by ID
     */
    getNode(id) {
        return this.nodeIndex.get(id) || null;
    }

    /**
     * Find node by name
     */
    findNodeByName(name) {
        return this.graph.nodes.find(n => n.metadata.name === name) || null;
    }

    /**
     * Get nodes by type
     */
    getNodesByType(type) {
        return this.graph.nodes.filter(n => n.type === type);
    }

    /**
     * Get neighbors of a node
     */
    getNeighbors(nodeId) {
        const neighbors = [];
        for (const edge of this.graph.edges) {
            if (edge.source === nodeId) {
                const node = this.getNode(edge.target);
                if (node) neighbors.push({ node, relationship: edge.type });
            } else if (edge.target === nodeId) {
                const node = this.getNode(edge.source);
                if (node) neighbors.push({ node, relationship: edge.type });
            }
        }
        return neighbors;
    }

    /**
     * Get path between two nodes
     */
    getPath(sourceId, targetId) {
        const visited = new Set();
        const queue = [[sourceId]];
        const paths = [];

        while (queue.length > 0) {
            const path = queue.shift();
            const last = path[path.length - 1];

            if (last === targetId) {
                paths.push(path);
                continue;
            }

            if (visited.has(last)) continue;
            visited.add(last);

            const neighbors = this.getNeighbors(last);
            for (const neighbor of neighbors) {
                if (!visited.has(neighbor.node.id)) {
                    queue.push([...path, neighbor.node.id]);
                }
            }
        }

        return paths;
    }

    /**
     * Get graph statistics
     */
    getStatistics() {
        return {
            totalNodes: this.graph.nodes.length,
            totalEdges: this.graph.edges.length,
            nodeTypes: this.graph.nodes.reduce((acc, n) => {
                acc[n.type] = (acc[n.type] || 0) + 1;
                return acc;
            }, {}),
            relationshipTypes: this.graph.edges.reduce((acc, e) => {
                acc[e.type] = (acc[e.type] || 0) + 1;
                return acc;
            }, {}),
            versions: this.graphVersions.length,
            lastVersion: this.graphVersions[this.graphVersions.length - 1]?.timestamp || null
        };
    }

    /**
     * Export graph as JSON
     */
    exportGraph() {
        return {
            version: this.graphVersions.length,
            timestamp: new Date().toISOString(),
            ...this.graph
        };
    }

    /**
     * Get graph for visualization
     */
    getVisualizationGraph() {
        return {
            nodes: this.graph.nodes.map(n => ({
                id: n.id,
                label: n.metadata.name,
                type: n.type,
                ...n.metadata
            })),
            edges: this.graph.edges.map(e => ({
                source: e.source,
                target: e.target,
                label: e.type
            }))
        };
    }

    /**
     * Find services
     */
    findServices() {
        const services = [];
        const root = this.projectRoot;
        const walkDir = (dir) => {
            const items = fs.readdirSync(dir);
            for (const item of items) {
                const fullPath = path.join(dir, item);
                const stats = fs.statSync(fullPath);
                if (stats.isDirectory() && !['node_modules', '.git', 'logs'].includes(item)) {
                    walkDir(fullPath);
                } else if (stats.isFile() && fullPath.includes('/services/') && fullPath.endsWith('.js')) {
                    services.push(fullPath);
                }
            }
        };
        walkDir(root);
        return services;
    }

    findControllers() {
        const controllers = [];
        const root = this.projectRoot;
        const walkDir = (dir) => {
            const items = fs.readdirSync(dir);
            for (const item of items) {
                const fullPath = path.join(dir, item);
                const stats = fs.statSync(fullPath);
                if (stats.isDirectory() && !['node_modules', '.git', 'logs'].includes(item)) {
                    walkDir(fullPath);
                } else if (stats.isFile() && fullPath.includes('/controllers/') && fullPath.endsWith('.js')) {
                    controllers.push(fullPath);
                }
            }
        };
        walkDir(root);
        return controllers;
    }

    findAPIs() {
        const apis = [];
        const root = this.projectRoot;
        const walkDir = (dir) => {
            const items = fs.readdirSync(dir);
            for (const item of items) {
                const fullPath = path.join(dir, item);
                const stats = fs.statSync(fullPath);
                if (stats.isDirectory() && !['node_modules', '.git', 'logs'].includes(item)) {
                    walkDir(fullPath);
                } else if (stats.isFile() && fullPath.includes('/api/') && fullPath.endsWith('.js')) {
                    apis.push(fullPath);
                }
            }
        };
        walkDir(root);
        return apis;
    }

    findModels() {
        const models = [];
        const root = this.projectRoot;
        const walkDir = (dir) => {
            const items = fs.readdirSync(dir);
            for (const item of items) {
                const fullPath = path.join(dir, item);
                const stats = fs.statSync(fullPath);
                if (stats.isDirectory() && !['node_modules', '.git', 'logs'].includes(item)) {
                    walkDir(fullPath);
                } else if (stats.isFile() && fullPath.includes('/models/') && fullPath.endsWith('.js')) {
                    models.push(fullPath);
                }
            }
        };
        walkDir(root);
        return models;
    }

    findEvents() {
        const events = [];
        const root = this.projectRoot;
        const walkDir = (dir) => {
            const items = fs.readdirSync(dir);
            for (const item of items) {
                const fullPath = path.join(dir, item);
                const stats = fs.statSync(fullPath);
                if (stats.isDirectory() && !['node_modules', '.git', 'logs'].includes(item)) {
                    walkDir(fullPath);
                } else if (stats.isFile() && fullPath.includes('/events/') && fullPath.endsWith('.js')) {
                    events.push(fullPath);
                }
            }
        };
        walkDir(root);
        return events;
    }

    findQueues() {
        const queues = [];
        const root = this.projectRoot;
        const walkDir = (dir) => {
            const items = fs.readdirSync(dir);
            for (const item of items) {
                const fullPath = path.join(dir, item);
                const stats = fs.statSync(fullPath);
                if (stats.isDirectory() && !['node_modules', '.git', 'logs'].includes(item)) {
                    walkDir(fullPath);
                } else if (stats.isFile() && fullPath.includes('/queues/') && fullPath.endsWith('.js')) {
                    queues.push(fullPath);
                }
            }
        };
        walkDir(root);
        return queues;
    }

    findJobs() {
        const jobs = [];
        const root = this.projectRoot;
        const walkDir = (dir) => {
            const items = fs.readdirSync(dir);
            for (const item of items) {
                const fullPath = path.join(dir, item);
                const stats = fs.statSync(fullPath);
                if (stats.isDirectory() && !['node_modules', '.git', 'logs'].includes(item)) {
                    walkDir(fullPath);
                } else if (stats.isFile() && fullPath.includes('/jobs/') && fullPath.endsWith('.js')) {
                    jobs.push(fullPath);
                }
            }
        };
        walkDir(root);
        return jobs;
    }

    findUtilities() {
        const utilities = [];
        const root = this.projectRoot;
        const walkDir = (dir) => {
            const items = fs.readdirSync(dir);
            for (const item of items) {
                const fullPath = path.join(dir, item);
                const stats = fs.statSync(fullPath);
                if (stats.isDirectory() && !['node_modules', '.git', 'logs'].includes(item)) {
                    walkDir(fullPath);
                } else if (stats.isFile() && fullPath.includes('/utils/') && fullPath.endsWith('.js')) {
                    utilities.push(fullPath);
                }
            }
        };
        walkDir(root);
        return utilities;
    }

    findRoutes() {
        const routes = [];
        const root = this.projectRoot;
        const walkDir = (dir) => {
            const items = fs.readdirSync(dir);
            for (const item of items) {
                const fullPath = path.join(dir, item);
                const stats = fs.statSync(fullPath);
                if (stats.isDirectory() && !['node_modules', '.git', 'logs'].includes(item)) {
                    walkDir(fullPath);
                } else if (stats.isFile() && fullPath.includes('/routes/') && fullPath.endsWith('.js')) {
                    routes.push(fullPath);
                }
            }
        };
        walkDir(root);
        return routes;
    }

    findMiddleware() {
        const middleware = [];
        const root = this.projectRoot;
        const walkDir = (dir) => {
            const items = fs.readdirSync(dir);
            for (const item of items) {
                const fullPath = path.join(dir, item);
                const stats = fs.statSync(fullPath);
                if (stats.isDirectory() && !['node_modules', '.git', 'logs'].includes(item)) {
                    walkDir(fullPath);
                } else if (stats.isFile() && fullPath.includes('/middleware/') && fullPath.endsWith('.js')) {
                    middleware.push(fullPath);
                }
            }
        };
        walkDir(root);
        return middleware;
    }

    findRepositories() {
        const repositories = [];
        const root = this.projectRoot;
        const walkDir = (dir) => {
            const items = fs.readdirSync(dir);
            for (const item of items) {
                const fullPath = path.join(dir, item);
                const stats = fs.statSync(fullPath);
                if (stats.isDirectory() && !['node_modules', '.git', 'logs'].includes(item)) {
                    walkDir(fullPath);
                } else if (stats.isFile() && fullPath.includes('/repositories/') && fullPath.endsWith('.js')) {
                    repositories.push(fullPath);
                }
            }
        };
        walkDir(root);
        return repositories;
    }

    findValidators() {
        const validators = [];
        const root = this.projectRoot;
        const walkDir = (dir) => {
            const items = fs.readdirSync(dir);
            for (const item of items) {
                const fullPath = path.join(dir, item);
                const stats = fs.statSync(fullPath);
                if (stats.isDirectory() && !['node_modules', '.git', 'logs'].includes(item)) {
                    walkDir(fullPath);
                } else if (stats.isFile() && fullPath.includes('/validators/') && fullPath.endsWith('.js')) {
                    validators.push(fullPath);
                }
            }
        };
        walkDir(root);
        return validators;
    }

    extractDependencies(filePath) {
        try {
            const content = fs.readFileSync(filePath, 'utf8');
            const deps = [];
            const patterns = [
                /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
                /import\s+.*\s+from\s+['"]([^'"]+)['"]/g
            ];
            for (const pattern of patterns) {
                let match;
                while ((match = pattern.exec(content)) !== null) {
                    if (match[1]) {
                        const name = match[1].split('/').pop();
                        deps.push(name.replace(/\.js$/, ''));
                    }
                }
            }
            return deps;
        } catch (error) {
            return [];
        }
    }

    extractRoutes(filePath) {
        try {
            const content = fs.readFileSync(filePath, 'utf8');
            const routes = [];
            const pattern = /router\.(get|post|put|delete|patch)\s*\(\s*['"]([^'"]+)['"]/g;
            let match;
            while ((match = pattern.exec(content)) !== null) {
                routes.push(`${match[1].toUpperCase()} ${match[2]}`);
            }
            return routes;
        } catch (error) {
            return [];
        }
    }

    extractEndpoints(filePath) {
        try {
            const content = fs.readFileSync(filePath, 'utf8');
            const endpoints = [];
            const pattern = /app\.(get|post|put|delete|patch)\s*\(\s*['"]([^'"]+)['"]/g;
            let match;
            while ((match = pattern.exec(content)) !== null) {
                endpoints.push(`${match[1].toUpperCase()} ${match[2]}`);
            }
            return endpoints;
        } catch (error) {
            return [];
        }
    }

    extractSchema(filePath) {
        try {
            const content = fs.readFileSync(filePath, 'utf8');
            const schemaMatch = content.match(/schema\s*:\s*{([^}]*)}/s);
            return schemaMatch ? schemaMatch[0].trim() : '{}';
        } catch (error) {
            return '{}';
        }
    }

    extractEventTypes(filePath) {
        try {
            const content = fs.readFileSync(filePath, 'utf8');
            const events = [];
            const pattern = /['"]([^'"]+)['"]/g;
            let match;
            while ((match = pattern.exec(content)) !== null) {
                if (match[1].includes('event') || match[1].includes('notification')) {
                    events.push(match[1]);
                }
            }
            return events;
        } catch (error) {
            return [];
        }
    }

    extractQueueNames(filePath) {
        try {
            const content = fs.readFileSync(filePath, 'utf8');
            const queues = [];
            const pattern = /queue\s*:\s*['"]([^'"]+)['"]/g;
            let match;
            while ((match = pattern.exec(content)) !== null) {
                queues.push(match[1]);
            }
            return queues;
        } catch (error) {
            return [];
        }
    }

    extractSchedule(filePath) {
        try {
            const content = fs.readFileSync(filePath, 'utf8');
            const scheduleMatch = content.match(/schedule\s*:\s*['"]([^'"]+)['"]/);
            return scheduleMatch ? scheduleMatch[1] : null;
        } catch (error) {
            return null;
        }
    }

    extractFunctions(filePath) {
        try {
            const content = fs.readFileSync(filePath, 'utf8');
            const functions = [];
            const pattern = /function\s+(\w+)\s*\(/g;
            let match;
            while ((match = pattern.exec(content)) !== null) {
                functions.push(match[1]);
            }
            return functions;
        } catch (error) {
            return [];
        }
    }

    extractMiddlewareUsage(filePath) {
        try {
            const content = fs.readFileSync(filePath, 'utf8');
            const usage = [];
            const pattern = /app\.use\s*\(\s*['"]([^'"]+)['"]/g;
            let match;
            while ((match = pattern.exec(content)) !== null) {
                usage.push(match[1]);
            }
            return usage;
        } catch (error) {
            return [];
        }
    }

    extractRepositoryMethods(filePath) {
        try {
            const content = fs.readFileSync(filePath, 'utf8');
            const methods = [];
            const pattern = /async\s+(\w+)\s*\(/g;
            let match;
            while ((match = pattern.exec(content)) !== null) {
                methods.push(match[1]);
            }
            return methods;
        } catch (error) {
            return [];
        }
    }

    extractValidations(filePath) {
        try {
            const content = fs.readFileSync(filePath, 'utf8');
            const validations = [];
            const pattern = /validate\s*\(\s*['"]([^'"]+)['"]/g;
            let match;
            while ((match = pattern.exec(content)) !== null) {
                validations.push(match[1]);
            }
            return validations;
        } catch (error) {
            return [];
        }
    }

    // ============================================
    // DATABASE OPERATIONS
    // ============================================

    async storeGraph() {
        try {
            await db.query(
                `INSERT INTO knowledge_graph_versions 
                 (version_number, node_count, edge_count, graph_data, timestamp)
                 VALUES (?, ?, ?, ?, NOW())`,
                [
                    this.graphVersions.length,
                    this.graph.nodes.length,
                    this.graph.edges.length,
                    JSON.stringify(this.graph)
                ]
            );
        } catch (error) {
            console.error('Store graph error:', error);
        }
    }

    async loadHistoricalVersions() {
        try {
            const [rows] = await db.query(
                `SELECT * FROM knowledge_graph_versions 
                 ORDER BY version_number DESC 
                 LIMIT 10`
            );

            for (const row of rows) {
                this.graphVersions.push({
                    version: row.version_number,
                    timestamp: row.timestamp,
                    nodeCount: row.node_count,
                    edgeCount: row.edge_count
                });
            }

            console.log(`📊 Loaded ${rows.length} historical graph versions`);
        } catch (error) {
            console.error('Load historical versions error:', error);
        }
    }

    // ============================================
    // STATISTICS
    // ============================================

    async getStatistics() {
        return {
            ...this.getStatistics(),
            versionHistory: this.graphVersions.slice(-10)
        };
    }

    getStatus() {
        return {
            isBuilding: this.isBuilding,
            nodes: this.graph.nodes.length,
            edges: this.graph.edges.length,
            nodeTypes: this.graph.nodes.reduce((acc, n) => {
                acc[n.type] = (acc[n.type] || 0) + 1;
                return acc;
            }, {}),
            versions: this.graphVersions.length,
            lastBuild: this.graphVersions[this.graphVersions.length - 1]?.timestamp || null
        };
    }
}

// ============================================
// EXPORT
// ============================================

module.exports = {
    KnowledgeGraphService,
    NODE_TYPES,
    RELATIONSHIP_TYPES,
    knowledgeGraphService: new KnowledgeGraphService()
};