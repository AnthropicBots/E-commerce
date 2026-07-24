// backend/services/architectureComplexityService.js
const fs = require('fs');
const path = require('path');
const db = require('../config/db').promise;
const EventEmitter = require('events');

// ============================================
// COMPLEXITY CONFIGURATION
// ============================================

const COMPLEXITY_THRESHOLDS = {
    // Coupling scores (0-100)
    coupling: {
        low: 20,
        moderate: 40,
        high: 60,
        critical: 80
    },
    // Cohesion scores (0-100)
    cohesion: {
        critical: 20,
        low: 40,
        moderate: 60,
        high: 80
    },
    // Maintainability Index (0-100)
    maintainability: {
        low: 20,
        moderate: 40,
        good: 60,
        excellent: 80
    },
    // Cyclomatic complexity (0-∞)
    cyclomatic: {
        simple: 10,
        moderate: 20,
        complex: 30,
        very_complex: 50
    },
    // Instability (0-1)
    instability: {
        stable: 0.3,
        moderate: 0.5,
        unstable: 0.7
    }
};

// ============================================
// ARCHITECTURE COMPLEXITY SERVICE
// ============================================

class ArchitectureComplexityService extends EventEmitter {
    constructor() {
        super();
        this.scores = {
            coupling: 0,
            cohesion: 0,
            maintainability: 0,
            cyclomatic: 0,
            instability: 0,
            dependencyDepth: 0,
            overall: 0
        };
        this.details = {};
        this.history = [];
        this.isAnalyzing = false;
        this.projectRoot = path.join(__dirname, '..');
        this.analysisResults = [];
    }

    /**
     * Initialize complexity service
     */
    async initialize() {
        console.log('✅ Architecture Complexity Service initialized');
        return this;
    }

    /**
     * Analyze architecture complexity
     */
    async analyzeComplexity() {
        if (this.isAnalyzing) return;

        this.isAnalyzing = true;
        console.log('📊 Analyzing architecture complexity...');

        try {
            // Analyze coupling
            const coupling = await this.analyzeCoupling();
            
            // Analyze cohesion
            const cohesion = await this.analyzeCohesion();
            
            // Analyze cyclomatic complexity
            const cyclomatic = await this.analyzeCyclomaticComplexity();
            
            // Analyze dependency depth
            const dependencyDepth = await this.analyzeDependencyDepth();
            
            // Analyze instability
            const instability = await this.analyzeInstability();
            
            // Calculate maintainability index
            const maintainability = this.calculateMaintainabilityIndex(
                cyclomatic,
                coupling,
                cohesion
            );

            // Calculate overall score
            const overall = this.calculateOverallScore({
                coupling,
                cohesion,
                cyclomatic,
                dependencyDepth,
                instability,
                maintainability
            });

            const results = {
                timestamp: new Date().toISOString(),
                scores: {
                    coupling,
                    cohesion,
                    cyclomatic,
                    dependencyDepth,
                    instability,
                    maintainability,
                    overall
                },
                details: this.details,
                status: this.getStatus(overall)
            };

            this.scores = results.scores;
            this.details = results.details;

            // Store history
            this.history.push(results);
            if (this.history.length > 100) {
                this.history.shift();
            }

            // Store in database
            await this.storeAnalysis(results);

            this.emit('analysis.completed', results);
            console.log(`✅ Complexity analysis complete: ${overall}/100`);

            return results;

        } catch (error) {
            console.error('Complexity analysis error:', error);
            this.emit('analysis.error', { error });
            throw error;
        } finally {
            this.isAnalyzing = false;
        }
    }

    /**
     * Analyze coupling between modules
     */
    async analyzeCoupling() {
        const modules = this.findModules();
        let totalCoupling = 0;
        let moduleCount = 0;

        for (const module of modules) {
            const dependencies = this.findDependencies(module);
            const outgoing = dependencies.length;
            const incoming = this.findIncomingDependencies(module, modules);
            
            const couplingScore = outgoing + incoming.length;
            totalCoupling += couplingScore;
            moduleCount++;

            // Store details
            if (!this.details.modules) {
                this.details.modules = {};
            }
            this.details.modules[path.basename(module)] = {
                outgoing: outgoing,
                incoming: incoming.length,
                coupling: couplingScore
            };
        }

        const averageCoupling = moduleCount > 0 ? totalCoupling / moduleCount : 0;
        // Normalize to 0-100
        const normalizedCoupling = Math.min(100, (averageCoupling / 20) * 100);
        
        // Invert: high coupling is bad
        const score = 100 - Math.min(100, normalizedCoupling);

        return Math.round(score);
    }

    /**
     * Analyze cohesion within modules
     */
    async analyzeCohesion() {
        const modules = this.findModules();
        let totalCohesion = 0;
        let moduleCount = 0;

        for (const module of modules) {
            const functions = this.findFunctions(module);
            const relatedFunctions = this.findRelatedFunctions(functions);
            const cohesionScore = functions.length > 0 ? 
                (relatedFunctions / functions.length) * 100 : 0;
            
            totalCohesion += cohesionScore;
            moduleCount++;

            // Store details
            if (!this.details.cohesion) {
                this.details.cohesion = {};
            }
            this.details.cohesion[path.basename(module)] = {
                functions: functions.length,
                related: relatedFunctions,
                cohesion: cohesionScore
            };
        }

        const averageCohesion = moduleCount > 0 ? totalCohesion / moduleCount : 0;
        return Math.round(averageCohesion);
    }

    /**
     * Analyze cyclomatic complexity
     */
    async analyzeCyclomaticComplexity() {
        const files = this.findCodeFiles();
        let totalComplexity = 0;
        let fileCount = 0;

        for (const file of files) {
            const complexity = this.calculateFileComplexity(file);
            totalComplexity += complexity;
            fileCount++;

            // Store details
            if (!this.details.cyclomatic) {
                this.details.cyclomatic = {};
            }
            this.details.cyclomatic[path.basename(file)] = complexity;
        }

        const averageComplexity = fileCount > 0 ? totalComplexity / fileCount : 0;
        // Normalize to 0-100
        const normalizedComplexity = Math.min(100, (averageComplexity / 30) * 100);
        // Invert: high complexity is bad
        const score = 100 - Math.min(100, normalizedComplexity);

        return Math.round(score);
    }

    /**
     * Analyze dependency depth
     */
    async analyzeDependencyDepth() {
        const modules = this.findModules();
        let maxDepth = 0;
        const depths = {};

        for (const module of modules) {
            const depth = this.calculateDependencyDepth(module, modules, new Set());
            depths[path.basename(module)] = depth;
            if (depth > maxDepth) {
                maxDepth = depth;
            }
        }

        this.details.dependencyDepth = depths;
        // Normalize to 0-100 (max depth 10 is considered acceptable)
        const normalizedDepth = Math.min(100, (maxDepth / 10) * 100);
        const score = 100 - Math.min(100, normalizedDepth);

        return Math.round(score);
    }

    /**
     * Analyze instability (I = efferent / (afferent + efferent))
     */
    async analyzeInstability() {
        const modules = this.findModules();
        let totalInstability = 0;
        let moduleCount = 0;

        for (const module of modules) {
            const outgoing = this.findDependencies(module).length;
            const incoming = this.findIncomingDependencies(module, modules).length;
            const total = outgoing + incoming;
            const instability = total > 0 ? outgoing / total : 0;
            
            totalInstability += instability;
            moduleCount++;

            // Store details
            if (!this.details.instability) {
                this.details.instability = {};
            }
            this.details.instability[path.basename(module)] = instability;
        }

        const averageInstability = moduleCount > 0 ? totalInstability / moduleCount : 0;
        const score = (1 - averageInstability) * 100;

        return Math.round(score);
    }

    /**
     * Calculate maintainability index
     */
    calculateMaintainabilityIndex(cyclomatic, coupling, cohesion) {
        // MI = 171 - 5.2 * ln(V) - 0.23 * (G) - 16.2 * ln(LOC)
        // Simplified version using our metrics
        const v = cyclomatic || 50;
        const g = coupling || 50;
        const loc = 1000; // Average LOC, would calculate properly
        
        const mi = 171 - 5.2 * Math.log(v) - 0.23 * g - 16.2 * Math.log(loc);
        const normalizedMI = Math.max(0, Math.min(100, (mi / 171) * 100));

        return Math.round(normalizedMI);
    }

    /**
     * Calculate overall score
     */
    calculateOverallScore(metrics) {
        const weights = {
            coupling: 0.25,
            cohesion: 0.20,
            cyclomatic: 0.15,
            dependencyDepth: 0.15,
            instability: 0.10,
            maintainability: 0.15
        };

        let score = 0;
        for (const [key, value] of Object.entries(metrics)) {
            score += (value / 100) * (weights[key] || 0.1);
        }

        return Math.round(score * 100);
    }

    /**
     * Get status based on score
     */
    getStatus(score) {
        if (score >= 80) return { status: 'excellent', color: '#4CAF50', label: 'Excellent' };
        if (score >= 60) return { status: 'good', color: '#8BC34A', label: 'Good' };
        if (score >= 40) return { status: 'fair', color: '#FFC107', label: 'Fair' };
        if (score >= 20) return { status: 'poor', color: '#FF9800', label: 'Poor' };
        return { status: 'critical', color: '#F44336', label: 'Critical' };
    }

    // ============================================
    // HELPER FUNCTIONS
    // ============================================

    findModules() {
        const modules = [];
        const root = this.projectRoot;
        const items = fs.readdirSync(root);
        
        for (const item of items) {
            const fullPath = path.join(root, item);
            const stats = fs.statSync(fullPath);
            
            if (stats.isDirectory() && 
                !['node_modules', '.git', 'logs', 'uploads', 'dist', 'build'].includes(item)) {
                if (fs.existsSync(path.join(fullPath, 'package.json')) ||
                    fs.existsSync(path.join(fullPath, 'index.js'))) {
                    modules.push(fullPath);
                }
            }
        }
        
        return modules;
    }

    findCodeFiles() {
        const files = [];
        const root = this.projectRoot;
        this.walkDirectory(root, files);
        return files;
    }

    walkDirectory(dir, files) {
        const items = fs.readdirSync(dir);
        for (const item of items) {
            const fullPath = path.join(dir, item);
            const stats = fs.statSync(fullPath);
            
            if (stats.isDirectory() && 
                !['node_modules', '.git', 'logs', 'uploads', 'dist', 'build'].includes(item)) {
                this.walkDirectory(fullPath, files);
            } else if (stats.isFile() && this.isCodeFile(item)) {
                files.push(fullPath);
            }
        }
    }

    isCodeFile(filename) {
        const extensions = ['.js', '.ts', '.jsx', '.tsx'];
        return extensions.some(ext => filename.endsWith(ext));
    }

    findDependencies(module) {
        const dependencies = [];
        const packageFile = path.join(module, 'package.json');
        if (fs.existsSync(packageFile)) {
            try {
                const content = fs.readFileSync(packageFile, 'utf8');
                const data = JSON.parse(content);
                return Object.keys(data.dependencies || {});
            } catch (error) {
                // Ignore
            }
        }
        return dependencies;
    }

    findIncomingDependencies(module, modules) {
        const name = path.basename(module);
        const incoming = [];
        for (const mod of modules) {
            const deps = this.findDependencies(mod);
            if (deps.includes(name)) {
                incoming.push(mod);
            }
        }
        return incoming;
    }

    findFunctions(file) {
        const content = fs.readFileSync(file, 'utf8');
        const functionMatches = content.match(/function\s+\w+\s*\(/g) || [];
        const arrowMatches = content.match(/const\s+\w+\s*=\s*\(/g) || [];
        return [...functionMatches, ...arrowMatches];
    }

    findRelatedFunctions(functions) {
        // Simplified: count functions that seem related by name
        const names = functions.map(f => {
            const match = f.match(/function\s+(\w+)/) || f.match(/const\s+(\w+)/);
            return match ? match[1] : '';
        }).filter(Boolean);
        
        const uniqueNames = new Set(names);
        return uniqueNames.size;
    }

    calculateFileComplexity(file) {
        try {
            const content = fs.readFileSync(file, 'utf8');
            const lines = content.split('\n');
            let complexity = 1;

            // Count decision points
            const patterns = [
                /if\s*\(/g,
                /else\s+if\s*\(/g,
                /switch\s*\(/g,
                /case\s+/g,
                /for\s*\(/g,
                /while\s*\(/g,
                /do\s*{/g,
                /&&/g,
                /\|\|/g,
                /\?/g  // Ternary operator
            ];

            for (const pattern of patterns) {
                const matches = content.match(pattern) || [];
                complexity += matches.length;
            }

            return complexity;
        } catch (error) {
            return 1;
        }
    }

    calculateDependencyDepth(module, modules, visited) {
        if (visited.has(module)) return 0;
        visited.add(module);

        const deps = this.findDependencies(module);
        let maxDepth = 0;

        for (const dep of deps) {
            const depModule = modules.find(m => path.basename(m) === dep);
            if (depModule) {
                const depth = this.calculateDependencyDepth(depModule, modules, visited);
                maxDepth = Math.max(maxDepth, depth + 1);
            }
        }

        return maxDepth;
    }

    // ============================================
    // DATABASE OPERATIONS
    // ============================================

    async storeAnalysis(results) {
        try {
            await db.query(
                `INSERT INTO complexity_analysis 
                 (coupling_score, cohesion_score, cyclomatic_score,
                  dependency_depth_score, instability_score,
                  maintainability_score, overall_score, details, status,
                  analyzed_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
                [
                    results.scores.coupling,
                    results.scores.cohesion,
                    results.scores.cyclomatic,
                    results.scores.dependencyDepth,
                    results.scores.instability,
                    results.scores.maintainability,
                    results.scores.overall,
                    JSON.stringify(results.details),
                    results.status.status
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
        const [stats] = await db.query(
            `SELECT 
                COUNT(*) as total_analyses,
                AVG(overall_score) as avg_score,
                MIN(overall_score) as min_score,
                MAX(overall_score) as max_score,
                MAX(analyzed_at) as last_analysis
             FROM complexity_analysis
             WHERE analyzed_at > DATE_SUB(NOW(), INTERVAL 30 DAY)`
        );

        return {
            ...stats[0],
            currentScore: this.scores.overall,
            timestamp: new Date().toISOString()
        };
    }

    getStatus() {
        return {
            isAnalyzing: this.isAnalyzing,
            currentScore: this.scores.overall,
            historyCount: this.history.length,
            lastAnalysis: this.history[this.history.length - 1]?.timestamp || null
        };
    }
}

// ============================================
// EXPORT
// ============================================

module.exports = {
    ArchitectureComplexityService,
    architectureComplexityService: new ArchitectureComplexityService()
};