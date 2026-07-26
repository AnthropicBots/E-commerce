// backend/services/dependencyGraphService.js
const fs = require('fs');
const path = require('path');
const db = require('../config/db').promise;
const EventEmitter = require('events');

// ============================================
// DEPENDENCY GRAPH CONFIGURATION
// ============================================

const DEPENDENCY_TYPES = {
    IMPORT: 'import',
    SERVICE: 'service',
    DATABASE: 'database',
    API: 'api',
    EVENT: 'event'
};

const COUPLING_METRICS = {
    AFFERRANCE: 'afferent', // incoming dependencies
    EFFERRANCE: 'efferent', // outgoing dependencies
    INSTABILITY: 'instability',
    ABSTRACTNESS: 'abstractness',
    DISTANCE: 'distance' // from main sequence
};

// ============================================
// DEPENDENCY GRAPH SERVICE
// ============================================

class DependencyGraphService extends EventEmitter {
    constructor() {
        super();
        this.graph = new Map();
        this.nodes = new Map();
        this.edges = new Map();
        this.cycles = [];
        this.metrics = {};
        this.analysisHistory = [];
        this.isAnalyzing = false;
    }

    /**
     * Initialize dependency graph service
     */
    async initialize() {
        // Load existing graph from database
        await this.loadGraph();

        // Start periodic analysis
        setInterval(() => this.analyzeDependencies(), 3600000); // 1 hour

        console.log('✅ Dependency Graph Service initialized');
        return this;
    }

    /**
     * Analyze dependencies from codebase
     */
    async analyzeDependencies() {
        if (this.isAnalyzing) return;

        this.isAnalyzing = true;
        console.log('🔍 Analyzing dependencies...');

        try {
            // Clear existing graph
            this.graph.clear();
            this.nodes.clear();
            this.edges.clear();

            // Scan project files
            const files = await this.scanProjectFiles();

            // Build dependency graph
            await this.buildGraph(files);

            // Detect cycles
            this.detectCycles();

            // Calculate metrics
            this.calculateMetrics();

            // Check for circular dependencies
            const hasCycles = this.cycles.length > 0;

            // Generate report
            const report = this.generateReport();

            // Store analysis
            this.analysisHistory.push({
                timestamp: new Date().toISOString(),
                hasCycles,
                cycleCount: this.cycles.length,
                nodeCount: this.nodes.size,
                edgeCount: this.edges.size,
                metrics: this.metrics,
                report
            });

            // Keep only last 100 analyses
            if (this.analysisHistory.length > 100) {
                this.analysisHistory.shift();
            }

            // Store in database
            await this.storeAnalysis(report);

            // Emit events
            this.emit('analysis.completed', { 
                hasCycles, 
                cycleCount: this.cycles.length,
                report 
            });

            if (hasCycles) {
                this.emit('cycles.detected', { cycles: this.cycles });
                console.warn(`⚠️ Circular dependencies detected: ${this.cycles.length} cycles`);
            }

        } catch (error) {
            console.error('Dependency analysis error:', error);
            this.emit('analysis.error', { error });
        } finally {
            this.isAnalyzing = false;
        }
    }

    /**
     * Scan project files for dependencies
     */
    async scanProjectFiles() {
        const files = [];
        const projectRoot = path.join(__dirname, '..');

        const walkDir = (dir) => {
            const items = fs.readdirSync(dir);
            for (const item of items) {
                const fullPath = path.join(dir, item);
                const stats = fs.statSync(fullPath);

                if (stats.isDirectory()) {
                    if (!['node_modules', '.git', 'logs', 'uploads'].includes(item)) {
                        walkDir(fullPath);
                    }
                } else if (stats.isFile() && this.isCodeFile(item)) {
                    files.push(fullPath);
                }
            }
        };

        walkDir(projectRoot);
        return files;
    }

    /**
     * Check if file is a code file
     */
    isCodeFile(filename) {
        const extensions = ['.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.go', '.rb'];
        return extensions.some(ext => filename.endsWith(ext));
    }

    /**
     * Build dependency graph from files
     */
    async buildGraph(files) {
        for (const file of files) {
            const content = fs.readFileSync(file, 'utf8');
            const dependencies = this.extractDependencies(content);

            const nodeId = this.getNodeId(file);
            this.addNode(nodeId, {
                path: file,
                name: path.basename(file),
                type: this.getNodeType(file),
                dependencies: []
            });

            for (const dep of dependencies) {
                const depId = this.getNodeId(dep);
                this.addEdge(nodeId, depId, {
                    type: this.getDependencyType(content, dep),
                    file: file,
                    line: this.findDependencyLine(content, dep)
                });
            }
        }
    }

    /**
     * Extract dependencies from file content
     */
    extractDependencies(content) {
        const dependencies = [];
        const patterns = [
            /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
            /import\s+.*\s+from\s+['"]([^'"]+)['"]/g,
            /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
            /from\s+['"]([^'"]+)['"]/g,
            /using\s+['"]([^'"]+)['"]/g,
            /include\s+['"]([^'"]+)['"]/g
        ];

        for (const pattern of patterns) {
            let match;
            while ((match = pattern.exec(content)) !== null) {
                if (match[1]) {
                    dependencies.push(match[1]);
                }
            }
        }

        // Filter out node_modules and relative paths
        return dependencies.filter(d => 
            !d.startsWith('.') && 
            !d.startsWith('@') &&
            !d.includes('node_modules')
        );
    }

    /**
     * Add node to graph
     */
    addNode(id, data) {
        if (!this.graph.has(id)) {
            this.graph.set(id, {
                ...data,
                incoming: [],
                outgoing: [],
                metrics: {
                    afferent: 0,
                    efferent: 0,
                    instability: 0,
                    abstractness: 0
                }
            });
            this.nodes.set(id, data);
        }
    }

    /**
     * Add edge to graph
     */
    addEdge(from, to, data) {
        const edgeId = `${from}->${to}`;
        if (!this.edges.has(edgeId)) {
            this.edges.set(edgeId, {
                from,
                to,
                ...data
            });

            // Update node relationships
            const fromNode = this.graph.get(from);
            const toNode = this.graph.get(to);

            if (fromNode) {
                fromNode.outgoing.push(to);
                fromNode.metrics.efferent++;
            }
            if (toNode) {
                toNode.incoming.push(from);
                toNode.metrics.afferent++;
            }
        }
    }

    /**
     * Detect cycles in graph
     */
    detectCycles() {
        this.cycles = [];
        const visited = new Set();
        const stack = new Set();

        const dfs = (nodeId, path = []) => {
            if (stack.has(nodeId)) {
                // Cycle detected
                const cycleStart = path.indexOf(nodeId);
                const cycle = path.slice(cycleStart);
                this.cycles.push({
                    nodes: cycle,
                    length: cycle.length,
                    timestamp: new Date().toISOString()
                });
                return;
            }

            if (visited.has(nodeId)) return;

            visited.add(nodeId);
            stack.add(nodeId);
            path.push(nodeId);

            const node = this.graph.get(nodeId);
            if (node) {
                for (const neighbor of node.outgoing) {
                    dfs(neighbor, [...path]);
                }
            }

            stack.delete(nodeId);
        };

        for (const nodeId of this.graph.keys()) {
            if (!visited.has(nodeId)) {
                dfs(nodeId);
            }
        }
    }

    /**
     * Calculate coupling metrics
     */
    calculateMetrics() {
        for (const [nodeId, node] of this.graph) {
            const afferent = node.incoming.length;
            const efferent = node.outgoing.length;
            const total = afferent + efferent;

            node.metrics = {
                afferent,
                efferent,
                instability: total > 0 ? efferent / total : 0,
                abstractness: 0, // Would require class analysis
                distance: 0
            };

            // Calculate distance from main sequence
            const D = node.metrics.instability;
            const A = node.metrics.abstractness;
            node.metrics.distance = Math.abs(A + D - 1);
        }

        // Aggregate metrics
        const totalInstability = Array.from(this.graph.values())
            .reduce((sum, n) => sum + n.metrics.instability, 0);
        const totalAbstractness = Array.from(this.graph.values())
            .reduce((sum, n) => sum + n.metrics.abstractness, 0);

        this.metrics = {
            totalNodes: this.graph.size,
            totalEdges: this.edges.size,
            averageInstability: this.graph.size > 0 ? totalInstability / this.graph.size : 0,
            averageAbstractness: this.graph.size > 0 ? totalAbstractness / this.graph.size : 0,
            mostUnstable: this.getMostUnstableNode(),
            mostStable: this.getMostStableNode(),
            cycleCount: this.cycles.length,
            coupling: {
                tight: this.getTightlyCoupledNodes(),
                loose: this.getLooseNodes()
            }
        };
    }

    /**
     * Get most unstable node
     */
    getMostUnstableNode() {
        let max = -1;
        let node = null;
        for (const [id, n] of this.graph) {
            if (n.metrics.instability > max) {
                max = n.metrics.instability;
                node = { id, ...n };
            }
        }
        return node;
    }

    /**
     * Get most stable node
     */
    getMostStableNode() {
        let min = Infinity;
        let node = null;
        for (const [id, n] of this.graph) {
            if (n.metrics.instability < min) {
                min = n.metrics.instability;
                node = { id, ...n };
            }
        }
        return node;
    }

    /**
     * Get tightly coupled nodes
     */
    getTightlyCoupledNodes() {
        const threshold = 3; // More than 3 dependencies
        const nodes = [];
        for (const [id, n] of this.graph) {
            if (n.outgoing.length > threshold) {
                nodes.push({
                    id,
                    name: n.name,
                    dependencies: n.outgoing.length
                });
            }
        }
        return nodes.sort((a, b) => b.dependencies - a.dependencies);
    }

    /**
     * Get loose nodes (no dependencies)
     */
    getLooseNodes() {
        const nodes = [];
        for (const [id, n] of this.graph) {
            if (n.outgoing.length === 0 && n.incoming.length === 0) {
                nodes.push({
                    id,
                    name: n.name
                });
            }
        }
        return nodes;
    }

    /**
     * Generate report
     */
    generateReport() {
        return {
            summary: {
                totalNodes: this.graph.size,
                totalEdges: this.edges.size,
                cycles: this.cycles.length,
                timestamp: new Date().toISOString()
            },
            metrics: this.metrics,
            cycles: this.cycles,
            hotspots: this.getHotspots(),
            recommendations: this.generateRecommendations()
        };
    }

    /**
     * Get architectural hotspots
     */
    getHotspots() {
        const hotspots = [];
        const threshold = 5;

        for (const [id, node] of this.graph) {
            const score = node.incoming.length + node.outgoing.length;
            if (score > threshold) {
                hotspots.push({
                    id,
                    name: node.name,
                    score,
                    incoming: node.incoming.length,
                    outgoing: node.outgoing.length,
                    type: node.type
                });
            }
        }

        return hotspots.sort((a, b) => b.score - a.score);
    }

    /**
     * Generate recommendations
     */
    generateRecommendations() {
        const recommendations = [];

        if (this.cycles.length > 0) {
            recommendations.push(`Break circular dependencies (${this.cycles.length} cycles detected)`);
            
            for (const cycle of this.cycles) {
                recommendations.push(`  - Cycle: ${cycle.nodes.join(' → ')}`);
            }
        }

        const hotspots = this.getHotspots();
        if (hotspots.length > 0) {
            recommendations.push(`Reduce coupling in hotspots: ${hotspots.map(h => h.name).join(', ')}`);
        }

        if (this.metrics.averageInstability > 0.6) {
            recommendations.push('High average instability - consider refactoring');
        }

        if (this.metrics.averageAbstractness > 0.7) {
            recommendations.push('High average abstractness - consider adding concrete implementations');
        }

        if (this.edges.size > this.graph.size * 2) {
            recommendations.push('High coupling density - consider splitting modules');
        }

        return recommendations;
    }

    /**
     * Get node ID from path
     */
    getNodeId(path) {
        return path.replace(/\\/g, '/').replace(/^.*?\/backend\//, '');
    }

    /**
     * Get node type
     */
    getNodeType(file) {
        if (file.includes('/services/')) return 'service';
        if (file.includes('/controllers/')) return 'controller';
        if (file.includes('/models/')) return 'model';
        if (file.includes('/repositories/')) return 'repository';
        if (file.includes('/middleware/')) return 'middleware';
        if (file.includes('/routes/')) return 'route';
        if (file.includes('/validators/')) return 'validator';
        if (file.includes('/config/')) return 'config';
        return 'unknown';
    }

    /**
     * Get dependency type
     */
    getDependencyType(content, dep) {
        if (content.includes(`require('${dep}')`)) return DEPENDENCY_TYPES.IMPORT;
        if (content.includes(`import ${dep}`)) return DEPENDENCY_TYPES.IMPORT;
        if (content.includes(`api.${dep}`)) return DEPENDENCY_TYPES.API;
        if (content.includes(`event.${dep}`)) return DEPENDENCY_TYPES.EVENT;
        if (content.includes('db.') || content.includes('database.')) return DEPENDENCY_TYPES.DATABASE;
        return DEPENDENCY_TYPES.SERVICE;
    }

    /**
     * Find dependency line number
     */
    findDependencyLine(content, dep) {
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes(dep)) {
                return i + 1;
            }
        }
        return 0;
    }

    // ============================================
    // DATABASE OPERATIONS
    // ============================================

    async loadGraph() {
        try {
            const [rows] = await db.query(
                'SELECT * FROM dependency_analysis ORDER BY analyzed_at DESC LIMIT 1'
            );

            if (rows.length > 0) {
                const analysis = rows[0];
                this.cycles = JSON.parse(analysis.cycles || '[]');
                this.metrics = JSON.parse(analysis.metrics || '{}');
                this.analysisHistory.push({
                    timestamp: analysis.analyzed_at,
                    hasCycles: this.cycles.length > 0,
                    cycleCount: this.cycles.length,
                    nodeCount: analysis.node_count,
                    edgeCount: analysis.edge_count,
                    metrics: this.metrics,
                    report: JSON.parse(analysis.report || '{}')
                });

                console.log(`📊 Loaded dependency analysis from ${analysis.analyzed_at}`);
            }
        } catch (error) {
            console.error('Load graph error:', error);
        }
    }

    async storeAnalysis(report) {
        try {
            await db.query(
                `INSERT INTO dependency_analysis 
                 (node_count, edge_count, cycles, metrics, report, analyzed_at)
                 VALUES (?, ?, ?, ?, ?, NOW())`,
                [
                    this.graph.size,
                    this.edges.size,
                    JSON.stringify(this.cycles),
                    JSON.stringify(this.metrics),
                    JSON.stringify(report)
                ]
            );
        } catch (error) {
            console.error('Store analysis error:', error);
        }
    }

    // ============================================
    // STATISTICS
    // ============================================

    async getStatistics() {
        return {
            nodes: this.graph.size,
            edges: this.edges.size,
            cycles: this.cycles.length,
            metrics: this.metrics,
            analysisCount: this.analysisHistory.length,
            lastAnalysis: this.analysisHistory[this.analysisHistory.length - 1]?.timestamp || null,
            isAnalyzing: this.isAnalyzing,
            timestamp: new Date().toISOString()
        };
    }

    getStatus() {
        return {
            graphSize: this.graph.size,
            edgeCount: this.edges.size,
            cycleCount: this.cycles.length,
            isAnalyzing: this.isAnalyzing,
            analysisHistory: this.analysisHistory.length
        };
    }
}

// ============================================
// EXPORT
// ============================================

module.exports = {
    DependencyGraphService,
    DEPENDENCY_TYPES,
    COUPLING_METRICS,
    dependencyGraphService: new DependencyGraphService()
};