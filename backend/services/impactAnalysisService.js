// backend/services/impactAnalysisService.js
const fs = require('fs');
const path = require('path');
const db = require('../config/db').promise;
const EventEmitter = require('events');

// ============================================
// IMPACT ANALYSIS CONFIGURATION
// ============================================

const IMPACT_TYPES = {
    DIRECT: 'direct',
    INDIRECT: 'indirect',
    TRANSITIVE: 'transitive',
    API: 'api',
    EVENT: 'event',
    DATABASE: 'database',
    CONFIG: 'config'
};

const IMPACT_SEVERITY = {
    CRITICAL: 'critical',
    HIGH: 'high',
    MEDIUM: 'medium',
    LOW: 'low'
};

// ============================================
// IMPACT ANALYSIS SERVICE
// ============================================

class ImpactAnalysisService extends EventEmitter {
    constructor() {
        super();
        this.dependencyGraph = new Map();
        this.impactReports = [];
        this.isAnalyzing = false;
        this.projectRoot = path.join(__dirname, '..');
        this.fileDependencies = new Map();
        this.serviceDependencies = new Map();
        this.apiDependencies = new Map();
        this.eventDependencies = new Map();
    }

    /**
     * Initialize impact analysis service
     */
    async initialize() {
        // Build dependency graph
        await this.buildDependencyGraph();
        console.log('✅ Impact Analysis Service initialized');
        return this;
    }

    /**
     * Analyze impact of file changes
     */
    async analyzeImpact(changedFiles, context = {}) {
        if (this.isAnalyzing) return;

        this.isAnalyzing = true;
        console.log('🔍 Analyzing architectural impact...');

        try {
            const impact = {
                timestamp: new Date().toISOString(),
                changedFiles,
                affectedFiles: [],
                affectedServices: [],
                affectedAPIs: [],
                affectedEvents: [],
                recommendations: [],
                severity: IMPACT_SEVERITY.LOW,
                summary: {}
            };

            // Analyze each changed file
            for (const file of changedFiles) {
                const fileImpacts = await this.analyzeFileImpact(file);
                impact.affectedFiles.push(...fileImpacts.files);
                impact.affectedServices.push(...fileImpacts.services);
                impact.affectedAPIs.push(...fileImpacts.apis);
                impact.affectedEvents.push(...fileImpacts.events);
            }

            // Deduplicate
            impact.affectedFiles = [...new Set(impact.affectedFiles)];
            impact.affectedServices = [...new Set(impact.affectedServices)];
            impact.affectedAPIs = [...new Set(impact.affectedAPIs)];
            impact.affectedEvents = [...new Set(impact.affectedEvents)];

            // Calculate severity
            impact.severity = this.calculateSeverity(impact);

            // Generate recommendations
            impact.recommendations = this.generateRecommendations(impact, context);

            // Generate summary
            impact.summary = this.generateSummary(impact);

            // Store report
            this.impactReports.push(impact);
            if (this.impactReports.length > 100) {
                this.impactReports.shift();
            }

            // Store in database
            await this.storeImpactReport(impact);

            this.emit('analysis.completed', impact);
            console.log(`✅ Impact analysis complete: ${impact.affectedFiles.length} files affected`);

            return impact;

        } catch (error) {
            console.error('Impact analysis error:', error);
            this.emit('analysis.error', { error });
            throw error;
        } finally {
            this.isAnalyzing = false;
        }
    }

    /**
     * Analyze impact of a single file
     */
    async analyzeFileImpact(filePath) {
        const impacts = {
            files: [],
            services: [],
            apis: [],
            events: []
        };

        // Get direct dependencies
        const deps = this.getFileDependencies(filePath);
        impacts.files.push(...deps);

        // Get transitive dependencies (2 levels deep)
        for (const dep of deps) {
            const transitiveDeps = this.getFileDependencies(dep);
            impacts.files.push(...transitiveDeps);
        }

        // Check if any dependency is a service
        for (const dep of impacts.files) {
            if (this.isServiceFile(dep)) {
                impacts.services.push(this.extractServiceName(dep));
            }
        }

        // Check for API dependencies
        for (const dep of impacts.files) {
            const apis = this.getAPIDependencies(dep);
            impacts.apis.push(...apis);
        }

        // Check for event dependencies
        for (const dep of impacts.files) {
            const events = this.getEventDependencies(dep);
            impacts.events.push(...events);
        }

        // Deduplicate
        impacts.files = [...new Set(impacts.files)];
        impacts.services = [...new Set(impacts.services)];
        impacts.apis = [...new Set(impacts.apis)];
        impacts.events = [...new Set(impacts.events)];

        return impacts;
    }

    /**
     * Build dependency graph
     */
    async buildDependencyGraph() {
        const files = this.findCodeFiles();
        const fileDeps = new Map();

        for (const file of files) {
            const deps = this.extractDependencies(file);
            fileDeps.set(file, deps);
            
            // Build reverse dependencies
            for (const dep of deps) {
                if (!this.dependencyGraph.has(dep)) {
                    this.dependencyGraph.set(dep, new Set());
                }
                this.dependencyGraph.get(dep).add(file);
            }
        }

        this.fileDependencies = fileDeps;

        // Build service dependencies
        const services = this.findServices();
        for (const service of services) {
            const deps = this.getServiceDependencies(service);
            this.serviceDependencies.set(service, deps);
        }

        // Build API dependencies
        const apis = this.findAPIs();
        for (const api of apis) {
            const deps = this.getAPIDependencies(api);
            this.apiDependencies.set(api, deps);
        }

        // Build event dependencies
        const events = this.findEvents();
        for (const event of events) {
            const deps = this.getEventDependencies(event);
            this.eventDependencies.set(event, deps);
        }

        console.log(`📊 Built dependency graph with ${fileDeps.size} files, ${services.length} services`);
    }

    /**
     * Extract dependencies from a file
     */
    extractDependencies(filePath) {
        try {
            const content = fs.readFileSync(filePath, 'utf8');
            const dependencies = [];
            const patterns = [
                /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
                /import\s+.*\s+from\s+['"]([^'"]+)['"]/g,
                /from\s+['"]([^'"]+)['"]/g
            ];

            for (const pattern of patterns) {
                let match;
                while ((match = pattern.exec(content)) !== null) {
                    if (match[1]) {
                        // Resolve relative paths
                        const resolvedPath = this.resolvePath(filePath, match[1]);
                        if (resolvedPath) {
                            dependencies.push(resolvedPath);
                        }
                    }
                }
            }

            return dependencies;
        } catch (error) {
            return [];
        }
    }

    /**
     * Get file dependencies
     */
    getFileDependencies(filePath) {
        return this.fileDependencies.get(filePath) || [];
    }

    /**
     * Get reverse dependencies (files that depend on this file)
     */
    getReverseDependencies(filePath) {
        return this.dependencyGraph.get(filePath) || new Set();
    }

    /**
     * Check if file is a service
     */
    isServiceFile(filePath) {
        return filePath.includes('/services/') || 
               filePath.includes('/service/') ||
               filePath.endsWith('Service.js');
    }

    /**
     * Extract service name from file path
     */
    extractServiceName(filePath) {
        const basename = path.basename(filePath, '.js');
        return basename.replace('Service', '');
    }

    /**
     * Get service dependencies
     */
    getServiceDependencies(servicePath) {
        const deps = this.getFileDependencies(servicePath);
        return deps.filter(d => this.isServiceFile(d));
    }

    /**
     * Get API dependencies
     */
    getAPIDependencies(filePath) {
        const apis = [];
        try {
            const content = fs.readFileSync(filePath, 'utf8');
            const apiPatterns = [
                /\/api\/[^\s'"]+/g,
                /router\.(get|post|put|delete|patch)\s*\(\s*['"]([^'"]+)['"]/g
            ];

            for (const pattern of apiPatterns) {
                let match;
                while ((match = pattern.exec(content)) !== null) {
                    if (match[1] && match[2]) {
                        apis.push(`${match[1].toUpperCase()} ${match[2]}`);
                    } else if (match[0]) {
                        apis.push(match[0]);
                    }
                }
            }
        } catch (error) {
            // Ignore
        }
        return apis;
    }

    /**
     * Get event dependencies
     */
    getEventDependencies(filePath) {
        const events = [];
        try {
            const content = fs.readFileSync(filePath, 'utf8');
            const eventPatterns = [
                /emit\s*\(\s*['"]([^'"]+)['"]/g,
                /publish\s*\(\s*['"]([^'"]+)['"]/g,
                /on\s*\(\s*['"]([^'"]+)['"]/g,
                /addEventListener\s*\(\s*['"]([^'"]+)['"]/g
            ];

            for (const pattern of eventPatterns) {
                let match;
                while ((match = pattern.exec(content)) !== null) {
                    if (match[1]) {
                        events.push(match[1]);
                    }
                }
            }
        } catch (error) {
            // Ignore
        }
        return events;
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
                } else if (stats.isFile() && this.isServiceFile(fullPath)) {
                    services.push(fullPath);
                }
            }
        };
        walkDir(root);
        return services;
    }

    /**
     * Find APIs
     */
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
                } else if (stats.isFile() && (fullPath.includes('/routes/') || fullPath.includes('/api/'))) {
                    apis.push(fullPath);
                }
            }
        };
        walkDir(root);
        return apis;
    }

    /**
     * Find event definitions
     */
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
                } else if (stats.isFile() && fullPath.includes('event')) {
                    events.push(fullPath);
                }
            }
        };
        walkDir(root);
        return events;
    }

    /**
     * Resolve path
     */
    resolvePath(fromFile, importPath) {
        if (importPath.startsWith('.')) {
            const dir = path.dirname(fromFile);
            let resolved = path.resolve(dir, importPath);
            
            // Try adding .js extension
            if (!fs.existsSync(resolved)) {
                const withJs = resolved + '.js';
                if (fs.existsSync(withJs)) {
                    return withJs;
                }
                const withIndex = path.join(resolved, 'index.js');
                if (fs.existsSync(withIndex)) {
                    return withIndex;
                }
            }
            return resolved;
        }
        return null;
    }

    /**
     * Calculate severity
     */
    calculateSeverity(impact) {
        const totalAffected = impact.affectedFiles.length + 
                             impact.affectedServices.length + 
                             impact.affectedAPIs.length + 
                             impact.affectedEvents.length;

        if (totalAffected > 20) return IMPACT_SEVERITY.CRITICAL;
        if (totalAffected > 10) return IMPACT_SEVERITY.HIGH;
        if (totalAffected > 5) return IMPACT_SEVERITY.MEDIUM;
        return IMPACT_SEVERITY.LOW;
    }

    /**
     * Generate recommendations
     */
    generateRecommendations(impact, context) {
        const recommendations = [];

        if (impact.affectedServices.length > 0) {
            recommendations.push({
                priority: 'high',
                message: `Review ${impact.affectedServices.length} affected services: ${impact.affectedServices.join(', ')}`,
                details: 'These services may need to be updated or tested'
            });
        }

        if (impact.affectedAPIs.length > 0) {
            recommendations.push({
                priority: 'high',
                message: `Review ${impact.affectedAPIs.length} affected APIs: ${impact.affectedAPIs.join(', ')}`,
                details: 'API consumers may be impacted by these changes'
            });
        }

        if (impact.affectedEvents.length > 0) {
            recommendations.push({
                priority: 'medium',
                message: `Review ${impact.affectedEvents.length} affected events: ${impact.affectedEvents.join(', ')}`,
                details: 'Event listeners may need to be updated'
            });
        }

        if (impact.affectedFiles.length > 10) {
            recommendations.push({
                priority: 'medium',
                message: `Large number of files affected (${impact.affectedFiles.length})`,
                details: 'Consider breaking changes into smaller PRs'
            });
        }

        if (context.isBreakingChange) {
            recommendations.push({
                priority: 'critical',
                message: 'Breaking change detected',
                details: 'Ensure proper version bump and migration guides'
            });
        }

        return recommendations;
    }

    /**
     * Generate summary
     */
    generateSummary(impact) {
        return {
            totalAffected: impact.affectedFiles.length + 
                           impact.affectedServices.length + 
                           impact.affectedAPIs.length + 
                           impact.affectedEvents.length,
            files: impact.affectedFiles.length,
            services: impact.affectedServices.length,
            apis: impact.affectedAPIs.length,
            events: impact.affectedEvents.length,
            severity: impact.severity,
            criticalRecommendations: impact.recommendations.filter(r => r.priority === 'critical').length
        };
    }

    /**
     * Find code files
     */
    findCodeFiles() {
        const files = [];
        const root = this.projectRoot;
        const walkDir = (dir) => {
            const items = fs.readdirSync(dir);
            for (const item of items) {
                const fullPath = path.join(dir, item);
                const stats = fs.statSync(fullPath);
                if (stats.isDirectory() && !['node_modules', '.git', 'logs', 'uploads', 'dist', 'build'].includes(item)) {
                    walkDir(fullPath);
                } else if (stats.isFile() && this.isCodeFile(item)) {
                    files.push(fullPath);
                }
            }
        };
        walkDir(root);
        return files;
    }

    /**
     * Check if file is code file
     */
    isCodeFile(filename) {
        const extensions = ['.js', '.ts', '.jsx', '.tsx'];
        return extensions.some(ext => filename.endsWith(ext));
    }

    /**
     * Store impact report
     */
    async storeImpactReport(impact) {
        try {
            await db.query(
                `INSERT INTO impact_analysis_reports 
                 (affected_files, affected_services, affected_apis, affected_events,
                  severity, recommendations, summary, timestamp)
                 VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
                [
                    JSON.stringify(impact.affectedFiles),
                    JSON.stringify(impact.affectedServices),
                    JSON.stringify(impact.affectedAPIs),
                    JSON.stringify(impact.affectedEvents),
                    impact.severity,
                    JSON.stringify(impact.recommendations),
                    JSON.stringify(impact.summary)
                ]
            );
        } catch (error) {
            console.error('Store impact report error:', error);
        }
    }

    /**
     * Get statistics
     */
    async getStatistics() {
        const [stats] = await db.query(
            `SELECT 
                COUNT(*) as total_reports,
                AVG(JSON_LENGTH(affected_files)) as avg_files_affected,
                SUM(CASE WHEN severity = 'critical' THEN 1 ELSE 0 END) as critical_reports,
                SUM(CASE WHEN severity = 'high' THEN 1 ELSE 0 END) as high_reports,
                MAX(timestamp) as last_report
             FROM impact_analysis_reports
             WHERE timestamp > DATE_SUB(NOW(), INTERVAL 30 DAY)`
        );

        return {
            ...stats[0],
            dependencyGraphSize: this.dependencyGraph.size,
            fileDependencies: this.fileDependencies.size,
            serviceDependencies: this.serviceDependencies.size,
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Get status
     */
    getStatus() {
        return {
            isAnalyzing: this.isAnalyzing,
            dependencyGraphSize: this.dependencyGraph.size,
            reportsCount: this.impactReports.length,
            lastReport: this.impactReports[this.impactReports.length - 1]?.timestamp || null
        };
    }
}

// ============================================
// EXPORT
// ============================================

module.exports = {
    ImpactAnalysisService,
    IMPACT_TYPES,
    IMPACT_SEVERITY,
    impactAnalysisService: new ImpactAnalysisService()
};