// backend/services/architectureDriftService.js
const fs = require('fs');
const path = require('path');
const db = require('../config/db').promise;
const EventEmitter = require('events');

// ============================================
// DRIFT CONFIGURATION
// ============================================

const DRIFT_TYPES = {
    MISSING_MODULE: 'missing_module',
    EXTRA_MODULE: 'extra_module',
    MODIFIED_MODULE: 'modified_module',
    MISSING_SERVICE: 'missing_service',
    EXTRA_SERVICE: 'extra_service',
    MODIFIED_SERVICE: 'modified_service',
    MISSING_API: 'missing_api',
    EXTRA_API: 'extra_api',
    MODIFIED_API: 'modified_api',
    MISSING_DEPENDENCY: 'missing_dependency',
    EXTRA_DEPENDENCY: 'extra_dependency'
};

const SEVERITY_LEVELS = {
    CRITICAL: 'critical',
    HIGH: 'high',
    MEDIUM: 'medium',
    LOW: 'low'
};

// ============================================
// ARCHITECTURE DRIFT SERVICE
// ============================================

class ArchitectureDriftService extends EventEmitter {
    constructor() {
        super();
        this.driftReports = [];
        this.currentDrift = [];
        this.documentationPaths = {
            modules: path.join(__dirname, '../docs/modules.json'),
            services: path.join(__dirname, '../docs/services.json'),
            api: path.join(__dirname, '../docs/api.json'),
            architecture: path.join(__dirname, '../docs/architecture.md')
        };
        this.isAnalyzing = false;
    }

    /**
     * Initialize drift detection
     */
    async initialize() {
        // Ensure documentation directory exists
        const docsDir = path.join(__dirname, '../docs');
        if (!fs.existsSync(docsDir)) {
            fs.mkdirSync(docsDir, { recursive: true });
        }

        // Create default documentation if not exists
        await this.createDefaultDocumentation();

        console.log('✅ Architecture Drift Service initialized');
        return this;
    }

    /**
     * Create default documentation
     */
    async createDefaultDocumentation() {
        // Create modules.json
        if (!fs.existsSync(this.documentationPaths.modules)) {
            const defaultModules = {
                version: '1.0.0',
                modules: [
                    {
                        name: 'auth',
                        description: 'Authentication and authorization',
                        services: ['auth-service'],
                        dependencies: ['database', 'cache']
                    },
                    {
                        name: 'catalog',
                        description: 'Product catalog management',
                        services: ['product-service', 'category-service'],
                        dependencies: ['database', 'search']
                    },
                    {
                        name: 'orders',
                        description: 'Order processing and management',
                        services: ['order-service', 'payment-service'],
                        dependencies: ['catalog', 'auth', 'inventory']
                    },
                    {
                        name: 'inventory',
                        description: 'Inventory and stock management',
                        services: ['inventory-service'],
                        dependencies: ['database']
                    },
                    {
                        name: 'recommendations',
                        description: 'Product recommendations',
                        services: ['recommendation-service'],
                        dependencies: ['catalog', 'analytics']
                    }
                ]
            };
            fs.writeFileSync(
                this.documentationPaths.modules,
                JSON.stringify(defaultModules, null, 2)
            );
        }

        // Create services.json
        if (!fs.existsSync(this.documentationPaths.services)) {
            const defaultServices = {
                version: '1.0.0',
                services: [
                    {
                        name: 'auth-service',
                        description: 'Handles authentication and JWT',
                        endpoints: ['/auth/login', '/auth/register', '/auth/verify'],
                        dependencies: ['database']
                    },
                    {
                        name: 'product-service',
                        description: 'Product CRUD operations',
                        endpoints: ['/products', '/products/:id', '/products/search'],
                        dependencies: ['database', 'cache']
                    },
                    {
                        name: 'order-service',
                        description: 'Order processing',
                        endpoints: ['/orders', '/orders/:id', '/orders/status'],
                        dependencies: ['database', 'payment-service']
                    }
                ]
            };
            fs.writeFileSync(
                this.documentationPaths.services,
                JSON.stringify(defaultServices, null, 2)
            );
        }

        // Create api.json
        if (!fs.existsSync(this.documentationPaths.api)) {
            const defaultApi = {
                version: '1.0.0',
                endpoints: [
                    {
                        path: '/api/auth/login',
                        method: 'POST',
                        description: 'User login',
                        auth: false
                    },
                    {
                        path: '/api/auth/register',
                        method: 'POST',
                        description: 'User registration',
                        auth: false
                    },
                    {
                        path: '/api/products',
                        method: 'GET',
                        description: 'Get products',
                        auth: true
                    },
                    {
                        path: '/api/orders',
                        method: 'POST',
                        description: 'Create order',
                        auth: true
                    }
                ]
            };
            fs.writeFileSync(
                this.documentationPaths.api,
                JSON.stringify(defaultApi, null, 2)
            );
        }
    }

    /**
     * Analyze drift between documentation and codebase
     */
    async analyzeDrift() {
        if (this.isAnalyzing) return;

        this.isAnalyzing = true;
        console.log('🔍 Analyzing architecture drift...');

        try {
            const driftResults = [];

            // Analyze modules
            const moduleDrift = await this.analyzeModules();
            driftResults.push(...moduleDrift);

            // Analyze services
            const serviceDrift = await this.analyzeServices();
            driftResults.push(...serviceDrift);

            // Analyze API endpoints
            const apiDrift = await this.analyzeAPI();
            driftResults.push(...apiDrift);

            // Analyze dependencies
            const dependencyDrift = await this.analyzeDependencies();
            driftResults.push(...dependencyDrift);

            this.currentDrift = driftResults;

            // Generate report
            const report = this.generateReport(driftResults);

            // Store in database
            await this.storeDriftReport(report);

            // Emit event
            this.emit('drift.analyzed', { 
                report, 
                driftCount: driftResults.length,
                hasDrift: driftResults.length > 0 
            });

            console.log(`✅ Drift analysis complete: ${driftResults.length} drifts found`);
            return report;

        } catch (error) {
            console.error('Drift analysis error:', error);
            this.emit('drift.error', { error });
            throw error;
        } finally {
            this.isAnalyzing = false;
        }
    }

    /**
     * Analyze module drift
     */
    async analyzeModules() {
        const drifts = [];
        const documentedModules = this.loadDocumentedModules();
        const actualModules = this.scanActualModules();

        // Check for missing modules
        for (const docModule of documentedModules) {
            if (!actualModules.find(m => m.name === docModule.name)) {
                drifts.push({
                    type: DRIFT_TYPES.MISSING_MODULE,
                    severity: SEVERITY_LEVELS.HIGH,
                    description: `Module '${docModule.name}' is documented but not found in codebase`,
                    documented: docModule,
                    actual: null,
                    file: this.documentationPaths.modules
                });
            }
        }

        // Check for extra modules
        for (const actualModule of actualModules) {
            if (!documentedModules.find(m => m.name === actualModule.name)) {
                drifts.push({
                    type: DRIFT_TYPES.EXTRA_MODULE,
                    severity: SEVERITY_LEVELS.MEDIUM,
                    description: `Module '${actualModule.name}' exists in codebase but is not documented`,
                    documented: null,
                    actual: actualModule,
                    file: this.documentationPaths.modules
                });
            }
        }

        // Check for modified modules
        for (const docModule of documentedModules) {
            const actualModule = actualModules.find(m => m.name === docModule.name);
            if (actualModule) {
                const diff = this.compareModule(docModule, actualModule);
                if (diff) {
                    drifts.push({
                        type: DRIFT_TYPES.MODIFIED_MODULE,
                        severity: SEVERITY_LEVELS.MEDIUM,
                        description: `Module '${docModule.name}' has changed: ${diff}`,
                        documented: docModule,
                        actual: actualModule,
                        file: this.documentationPaths.modules
                    });
                }
            }
        }

        return drifts;
    }

    /**
     * Analyze service drift
     */
    async analyzeServices() {
        const drifts = [];
        const documentedServices = this.loadDocumentedServices();
        const actualServices = this.scanActualServices();

        // Check for missing services
        for (const docService of documentedServices) {
            if (!actualServices.find(s => s.name === docService.name)) {
                drifts.push({
                    type: DRIFT_TYPES.MISSING_SERVICE,
                    severity: SEVERITY_LEVELS.CRITICAL,
                    description: `Service '${docService.name}' is documented but not found`,
                    documented: docService,
                    actual: null,
                    file: this.documentationPaths.services
                });
            }
        }

        // Check for extra services
        for (const actualService of actualServices) {
            if (!documentedServices.find(s => s.name === actualService.name)) {
                drifts.push({
                    type: DRIFT_TYPES.EXTRA_SERVICE,
                    severity: SEVERITY_LEVELS.MEDIUM,
                    description: `Service '${actualService.name}' exists but is not documented`,
                    documented: null,
                    actual: actualService,
                    file: this.documentationPaths.services
                });
            }
        }

        // Check for modified services
        for (const docService of documentedServices) {
            const actualService = actualServices.find(s => s.name === docService.name);
            if (actualService) {
                const diff = this.compareService(docService, actualService);
                if (diff) {
                    drifts.push({
                        type: DRIFT_TYPES.MODIFIED_SERVICE,
                        severity: SEVERITY_LEVELS.MEDIUM,
                        description: `Service '${docService.name}' has changed: ${diff}`,
                        documented: docService,
                        actual: actualService,
                        file: this.documentationPaths.services
                    });
                }
            }
        }

        return drifts;
    }

    /**
     * Analyze API drift
     */
    async analyzeAPI() {
        const drifts = [];
        const documentedEndpoints = this.loadDocumentedAPI();
        const actualEndpoints = this.scanActualAPI();

        // Check for missing endpoints
        for (const docEndpoint of documentedEndpoints) {
            if (!actualEndpoints.find(e => 
                e.path === docEndpoint.path && e.method === docEndpoint.method
            )) {
                drifts.push({
                    type: DRIFT_TYPES.MISSING_API,
                    severity: SEVERITY_LEVELS.HIGH,
                    description: `API endpoint ${docEndpoint.method} ${docEndpoint.path} is documented but not found`,
                    documented: docEndpoint,
                    actual: null,
                    file: this.documentationPaths.api
                });
            }
        }

        // Check for extra endpoints
        for (const actualEndpoint of actualEndpoints) {
            if (!documentedEndpoints.find(e => 
                e.path === actualEndpoint.path && e.method === actualEndpoint.method
            )) {
                drifts.push({
                    type: DRIFT_TYPES.EXTRA_API,
                    severity: SEVERITY_LEVELS.MEDIUM,
                    description: `API endpoint ${actualEndpoint.method} ${actualEndpoint.path} exists but is not documented`,
                    documented: null,
                    actual: actualEndpoint,
                    file: this.documentationPaths.api
                });
            }
        }

        // Check for modified endpoints
        for (const docEndpoint of documentedEndpoints) {
            const actualEndpoint = actualEndpoints.find(e => 
                e.path === docEndpoint.path && e.method === docEndpoint.method
            );
            if (actualEndpoint) {
                const diff = this.compareEndpoint(docEndpoint, actualEndpoint);
                if (diff) {
                    drifts.push({
                        type: DRIFT_TYPES.MODIFIED_API,
                        severity: SEVERITY_LEVELS.MEDIUM,
                        description: `API endpoint ${docEndpoint.method} ${docEndpoint.path} has changed: ${diff}`,
                        documented: docEndpoint,
                        actual: actualEndpoint,
                        file: this.documentationPaths.api
                    });
                }
            }
        }

        return drifts;
    }

    /**
     * Analyze dependency drift
     */
    async analyzeDependencies() {
        const drifts = [];
        const documentedDeps = this.loadDocumentedDependencies();
        const actualDeps = this.scanActualDependencies();

        // Check for missing dependencies
        for (const [module, deps] of Object.entries(documentedDeps)) {
            const actualModuleDeps = actualDeps[module] || [];
            for (const dep of deps) {
                if (!actualModuleDeps.includes(dep)) {
                    drifts.push({
                        type: DRIFT_TYPES.MISSING_DEPENDENCY,
                        severity: SEVERITY_LEVELS.HIGH,
                        description: `Dependency '${dep}' is documented but not found for module '${module}'`,
                        documented: { module, dependency: dep },
                        actual: null,
                        file: this.documentationPaths.modules
                    });
                }
            }
        }

        // Check for extra dependencies
        for (const [module, deps] of Object.entries(actualDeps)) {
            const documentedModuleDeps = documentedDeps[module] || [];
            for (const dep of deps) {
                if (!documentedModuleDeps.includes(dep)) {
                    drifts.push({
                        type: DRIFT_TYPES.EXTRA_DEPENDENCY,
                        severity: SEVERITY_LEVELS.MEDIUM,
                        description: `Dependency '${dep}' exists but is not documented for module '${module}'`,
                        documented: null,
                        actual: { module, dependency: dep },
                        file: this.documentationPaths.modules
                    });
                }
            }
        }

        return drifts;
    }

    // ============================================
    // DOCUMENTATION LOADERS
    // ============================================

    loadDocumentedModules() {
        try {
            const content = fs.readFileSync(this.documentationPaths.modules, 'utf8');
            const data = JSON.parse(content);
            return data.modules || [];
        } catch (error) {
            console.error('Load documented modules error:', error);
            return [];
        }
    }

    loadDocumentedServices() {
        try {
            const content = fs.readFileSync(this.documentationPaths.services, 'utf8');
            const data = JSON.parse(content);
            return data.services || [];
        } catch (error) {
            console.error('Load documented services error:', error);
            return [];
        }
    }

    loadDocumentedAPI() {
        try {
            const content = fs.readFileSync(this.documentationPaths.api, 'utf8');
            const data = JSON.parse(content);
            return data.endpoints || [];
        } catch (error) {
            console.error('Load documented API error:', error);
            return [];
        }
    }

    loadDocumentedDependencies() {
        const modules = this.loadDocumentedModules();
        const deps = {};
        for (const module of modules) {
            deps[module.name] = module.dependencies || [];
        }
        return deps;
    }

    // ============================================
    // CODEBASE SCANNERS
    // ============================================

    scanActualModules() {
        const modules = [];
        const projectRoot = path.join(__dirname, '..');
        const scanDir = (dir) => {
            const items = fs.readdirSync(dir);
            for (const item of items) {
                const fullPath = path.join(dir, item);
                const stats = fs.statSync(fullPath);
                if (stats.isDirectory()) {
                    if (['node_modules', '.git', 'logs', 'uploads'].includes(item)) continue;
                    if (item.endsWith('-module') || item.includes('service')) {
                        modules.push({
                            name: item,
                            path: fullPath,
                            services: this.findServicesInDirectory(fullPath)
                        });
                    }
                    scanDir(fullPath);
                }
            }
        };
        scanDir(projectRoot);
        return modules;
    }

    scanActualServices() {
        const services = [];
        const projectRoot = path.join(__dirname, '..');
        const scanDir = (dir) => {
            const items = fs.readdirSync(dir);
            for (const item of items) {
                const fullPath = path.join(dir, item);
                const stats = fs.statSync(fullPath);
                if (stats.isFile() && item.endsWith('Service.js')) {
                    services.push({
                        name: item.replace('.js', ''),
                        path: fullPath
                    });
                } else if (stats.isDirectory() && !['node_modules', '.git', 'logs'].includes(item)) {
                    scanDir(fullPath);
                }
            }
        };
        scanDir(projectRoot);
        return services;
    }

    scanActualAPI() {
        const endpoints = [];
        const projectRoot = path.join(__dirname, '..');
        const routesDir = path.join(projectRoot, 'routes');
        
        if (fs.existsSync(routesDir)) {
            const files = fs.readdirSync(routesDir);
            for (const file of files) {
                if (file.endsWith('.js')) {
                    const content = fs.readFileSync(path.join(routesDir, file), 'utf8');
                    const endpointMatches = content.match(/router\.(get|post|put|delete|patch)\s*\(\s*['"]([^'"]+)['"]/g) || [];
                    for (const match of endpointMatches) {
                        const methodMatch = match.match(/router\.(get|post|put|delete|patch)/);
                        const pathMatch = match.match(/['"]([^'"]+)['"]/);
                        if (methodMatch && pathMatch) {
                            endpoints.push({
                                method: methodMatch[1].toUpperCase(),
                                path: pathMatch[1]
                            });
                        }
                    }
                }
            }
        }
        return endpoints;
    }

    scanActualDependencies() {
        const deps = {};
        const modules = this.scanActualModules();
        for (const module of modules) {
            const packagePath = path.join(module.path, 'package.json');
            if (fs.existsSync(packagePath)) {
                const content = fs.readFileSync(packagePath, 'utf8');
                const data = JSON.parse(content);
                deps[module.name] = Object.keys(data.dependencies || {});
            }
        }
        return deps;
    }

    findServicesInDirectory(dir) {
        const services = [];
        const items = fs.readdirSync(dir);
        for (const item of items) {
            if (item.endsWith('Service.js') || item.endsWith('service.js')) {
                services.push(item.replace('.js', ''));
            }
        }
        return services;
    }

    // ============================================
    // COMPARISON FUNCTIONS
    // ============================================

    compareModule(docModule, actualModule) {
        const differences = [];
        if (docModule.services && actualModule.services) {
            const missingServices = docModule.services.filter(s => !actualModule.services.includes(s));
            const extraServices = actualModule.services.filter(s => !docModule.services.includes(s));
            if (missingServices.length > 0) {
                differences.push(`Missing services: ${missingServices.join(', ')}`);
            }
            if (extraServices.length > 0) {
                differences.push(`Extra services: ${extraServices.join(', ')}`);
            }
        }
        return differences.length > 0 ? differences.join('; ') : null;
    }

    compareService(docService, actualService) {
        const differences = [];
        // Compare endpoints if available
        if (docService.endpoints && actualService.endpoints) {
            const missing = docService.endpoints.filter(e => !actualService.endpoints.includes(e));
            const extra = actualService.endpoints.filter(e => !docService.endpoints.includes(e));
            if (missing.length > 0) {
                differences.push(`Missing endpoints: ${missing.join(', ')}`);
            }
            if (extra.length > 0) {
                differences.push(`Extra endpoints: ${extra.join(', ')}`);
            }
        }
        return differences.length > 0 ? differences.join('; ') : null;
    }

    compareEndpoint(docEndpoint, actualEndpoint) {
        const differences = [];
        if (docEndpoint.auth !== actualEndpoint.auth) {
            differences.push(`Auth requirement changed: ${docEndpoint.auth} -> ${actualEndpoint.auth}`);
        }
        if (docEndpoint.description !== actualEndpoint.description) {
            differences.push('Description changed');
        }
        return differences.length > 0 ? differences.join('; ') : null;
    }

    // ============================================
    // REPORT GENERATION
    // ============================================

    generateReport(drifts) {
        return {
            timestamp: new Date().toISOString(),
            totalDrifts: drifts.length,
            bySeverity: {
                critical: drifts.filter(d => d.severity === SEVERITY_LEVELS.CRITICAL).length,
                high: drifts.filter(d => d.severity === SEVERITY_LEVELS.HIGH).length,
                medium: drifts.filter(d => d.severity === SEVERITY_LEVELS.MEDIUM).length,
                low: drifts.filter(d => d.severity === SEVERITY_LEVELS.LOW).length
            },
            byType: drifts.reduce((acc, d) => {
                acc[d.type] = (acc[d.type] || 0) + 1;
                return acc;
            }, {}),
            drifts,
            hasCriticalDrift: drifts.some(d => d.severity === SEVERITY_LEVELS.CRITICAL),
            recommendation: drifts.length === 0 
                ? 'No drift detected. Documentation is up to date.'
                : 'Drift detected. Please update documentation to match the codebase.'
        };
    }

    /**
     * Get drift report
     */
    getLatestReport() {
        return this.driftReports[this.driftReports.length - 1] || null;
    }

    /**
     * Get drift history
     */
    getHistory(limit = 50) {
        return this.driftReports.slice(-limit);
    }

    // ============================================
    // DATABASE OPERATIONS
    // ============================================

    async storeDriftReport(report) {
        try {
            await db.query(
                `INSERT INTO architecture_drift_reports 
                 (total_drifts, critical_count, high_count, medium_count, low_count, report, reported_at)
                 VALUES (?, ?, ?, ?, ?, ?, NOW())`,
                [
                    report.totalDrifts,
                    report.bySeverity.critical,
                    report.bySeverity.high,
                    report.bySeverity.medium,
                    report.bySeverity.low,
                    JSON.stringify(report)
                ]
            );
        } catch (error) {
            console.error('Store drift report error:', error);
        }
    }

    // ============================================
    // STATISTICS
    // ============================================

    async getStatistics() {
        const [stats] = await db.query(
            `SELECT 
                COUNT(*) as total_reports,
                AVG(total_drifts) as avg_drifts,
                SUM(CASE WHEN total_drifts > 0 THEN 1 ELSE 0 END) as reports_with_drift,
                MAX(reported_at) as last_report
             FROM architecture_drift_reports
             WHERE reported_at > DATE_SUB(NOW(), INTERVAL 30 DAY)`
        );

        return {
            ...stats[0],
            hasLatestDrift: this.currentDrift.length > 0,
            latestDriftCount: this.currentDrift.length,
            timestamp: new Date().toISOString()
        };
    }

    getStatus() {
        return {
            initialized: true,
            isAnalyzing: this.isAnalyzing,
            documentationPaths: this.documentationPaths,
            driftCount: this.currentDrift.length,
            hasDrift: this.currentDrift.length > 0
        };
    }
}

// ============================================
// EXPORT
// ============================================

module.exports = {
    ArchitectureDriftService,
    DRIFT_TYPES,
    SEVERITY_LEVELS,
    architectureDriftService: new ArchitectureDriftService()
};