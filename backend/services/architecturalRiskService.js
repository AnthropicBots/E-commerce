// backend/services/architecturalRiskService.js
const fs = require('fs');
const path = require('path');
const db = require('../config/db').promise;
const EventEmitter = require('events');

// ============================================
// RISK SCORING CONFIGURATION
// ============================================

const RISK_WEIGHTS = {
    coupling: 0.20,
    cohesion: 0.15,
    dependencyDensity: 0.15,
    instability: 0.15,
    cyclomaticComplexity: 0.15,
    importFanIn: 0.10,
    importFanOut: 0.10
};

const RISK_LEVELS = {
    LOW: { label: 'Low Risk', color: '#4CAF50', threshold: 20 },
    MODERATE: { label: 'Moderate Risk', color: '#FFC107', threshold: 40 },
    HIGH: { label: 'High Risk', color: '#FF9800', threshold: 60 },
    CRITICAL: { label: 'Critical Risk', color: '#F44336', threshold: 80 }
};

// ============================================
// ARCHITECTURAL RISK SERVICE
// ============================================

class ArchitecturalRiskService extends EventEmitter {
    constructor() {
        super();
        this.moduleScores = new Map();
        this.riskHistory = [];
        this.analysisResults = [];
        this.isAnalyzing = false;
        this.projectRoot = path.join(__dirname, '..');
        this.lastAnalysis = null;
        this.overallScore = 0;
    }

    /**
     * Initialize risk service
     */
    async initialize() {
        // Load historical data
        await this.loadHistoricalData();
        console.log('✅ Architectural Risk Service initialized');
        return this;
    }

    /**
     * Analyze architectural risk
     */
    async analyzeRisk() {
        if (this.isAnalyzing) return;

        this.isAnalyzing = true;
        console.log('📊 Analyzing architectural risk...');

        try {
            const modules = this.findModules();
            const moduleScores = {};

            for (const module of modules) {
                const score = await this.analyzeModule(module);
                moduleScores[path.basename(module)] = score;
                this.moduleScores.set(module, score);
            }

            // Calculate overall score
            this.overallScore = this.calculateOverallScore(moduleScores);

            // Generate report
            const report = this.generateReport(moduleScores);

            // Store results
            this.analysisResults.push(report);
            if (this.analysisResults.length > 100) {
                this.analysisResults.shift();
            }

            this.lastAnalysis = new Date().toISOString();

            // Store in database
            await this.storeAnalysis(report);

            this.emit('analysis.completed', report);
            console.log(`✅ Risk analysis complete: Overall Score ${this.overallScore}%`);

            return report;

        } catch (error) {
            console.error('Risk analysis error:', error);
            this.emit('analysis.error', { error });
            throw error;
        } finally {
            this.isAnalyzing = false;
        }
    }

    /**
     * Find modules in codebase
     */
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

    /**
     * Analyze a single module
     */
    async analyzeModule(modulePath) {
        const metrics = await this.calculateMetrics(modulePath);
        const riskScore = this.calculateRiskScore(metrics);
        
        return {
            name: path.basename(modulePath),
            path: modulePath,
            metrics,
            riskScore,
            level: this.getRiskLevel(riskScore),
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Calculate metrics for a module
     */
    async calculateMetrics(modulePath) {
        const files = this.findFilesInModule(modulePath);
        let totalComplexity = 0;
        let fileCount = 0;
        let dependencies = new Set();
        let dependents = new Set();

        for (const file of files) {
            const content = fs.readFileSync(file, 'utf8');
            
            // Calculate cyclomatic complexity
            const complexity = this.calculateCyclomaticComplexity(content);
            totalComplexity += complexity;
            fileCount++;

            // Extract dependencies
            const deps = this.extractDependencies(content);
            for (const dep of deps) {
                dependencies.add(dep);
            }
        }

        const avgComplexity = fileCount > 0 ? totalComplexity / fileCount : 0;
        const dependencyCount = dependencies.size;
        
        // Calculate coupling (incoming dependencies)
        const coupling = await this.calculateCoupling(modulePath);
        
        // Calculate cohesion (how related are files in module)
        const cohesion = await this.calculateCohesion(modulePath);

        // Calculate instability (I = efferent / (afferent + efferent))
        const efferent = dependencyCount;
        const afferent = coupling.incoming;
        const instability = (afferent + efferent) > 0 ? efferent / (afferent + efferent) : 0;

        // Calculate import fan-in and fan-out
        const fanIn = afferent;
        const fanOut = efferent;

        // Calculate dependency density
        const totalModules = this.findModules().length;
        const dependencyDensity = totalModules > 0 ? dependencyCount / totalModules : 0;

        return {
            cyclomaticComplexity: avgComplexity,
            coupling: coupling.total,
            couplingIncoming: afferent,
            couplingOutgoing: efferent,
            cohesion: cohesion,
            instability: instability,
            importFanIn: fanIn,
            importFanOut: fanOut,
            dependencyDensity: dependencyDensity,
            fileCount: fileCount,
            dependencyCount: dependencyCount,
            totalComplexity: totalComplexity
        };
    }

    /**
     * Calculate cyclomatic complexity of code
     */
    calculateCyclomaticComplexity(content) {
        let complexity = 1;
        
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
            /\?/g,
            /catch\s*\(/g,
            /finally\s*{/g
        ];

        for (const pattern of patterns) {
            const matches = content.match(pattern) || [];
            complexity += matches.length;
        }

        return complexity;
    }

    /**
     * Extract dependencies from file content
     */
    extractDependencies(content) {
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
                    dependencies.push(match[1]);
                }
            }
        }

        return dependencies;
    }

    /**
     * Calculate coupling for a module
     */
    async calculateCoupling(modulePath) {
        const moduleName = path.basename(modulePath);
        const allModules = this.findModules();
        let incoming = 0;
        let outgoing = 0;

        for (const mod of allModules) {
            if (mod === modulePath) continue;
            
            const files = this.findFilesInModule(mod);
            for (const file of files) {
                const content = fs.readFileSync(file, 'utf8');
                const deps = this.extractDependencies(content);
                
                // Check if this module depends on the target module
                if (deps.some(d => d.includes(moduleName))) {
                    incoming++;
                }
            }
        }
        
        // Calculate outgoing separately
        const targetFiles = this.findFilesInModule(modulePath);
        for (const file of targetFiles) {
            const content = fs.readFileSync(file, 'utf8');
            const deps = this.extractDependencies(content);
            outgoing += deps.length;
        }

        return {
            incoming,
            outgoing,
            total: incoming + outgoing
        };
    }

    /**
     * Calculate cohesion of a module
     */
    async calculateCohesion(modulePath) {
        const files = this.findFilesInModule(modulePath);
        if (files.length <= 1) return 100;

        let relatedPairs = 0;
        let totalPairs = (files.length * (files.length - 1)) / 2;

        for (let i = 0; i < files.length; i++) {
            for (let j = i + 1; j < files.length; j++) {
                const content1 = fs.readFileSync(files[i], 'utf8');
                const content2 = fs.readFileSync(files[j], 'utf8');
                
                // Check if files share similar keywords or functions
                const words1 = content1.match(/\b\w+\b/g) || [];
                const words2Set = new Set(content2.match(/\b\w+\b/g) || []);
                
                const commonWords = words1.filter(w => words2Set.has(w));
                const similarity = commonWords.length / Math.max(words1.length, words2Set.size);
                
                if (similarity > 0.3) {
                    relatedPairs++;
                }
            }
        }

        return totalPairs > 0 ? (relatedPairs / totalPairs) * 100 : 100;
    }

    /**
     * Calculate risk score from metrics
     */
    calculateRiskScore(metrics) {
        let score = 0;

        // Normalize metrics to 0-100 scale
        const normalizedMetrics = {
            coupling: Math.min(100, metrics.coupling * 10),
            cohesion: Math.max(0, 100 - metrics.cohesion),
            dependencyDensity: Math.min(100, metrics.dependencyDensity * 100),
            instability: metrics.instability * 100,
            cyclomaticComplexity: Math.min(100, metrics.cyclomaticComplexity * 5),
            importFanIn: Math.min(100, metrics.importFanIn * 10),
            importFanOut: Math.min(100, metrics.importFanOut * 10)
        };

        // Calculate weighted score
        for (const [key, value] of Object.entries(normalizedMetrics)) {
            const weight = RISK_WEIGHTS[key] || 0.1;
            score += value * weight;
        }

        return Math.round(Math.min(100, score));
    }

    /**
     * Get risk level from score
     */
    getRiskLevel(score) {
        for (const [level, config] of Object.entries(RISK_LEVELS)) {
            if (score <= config.threshold) {
                return { level, ...config };
            }
        }
        return { level: 'CRITICAL', ...RISK_LEVELS.CRITICAL };
    }

    /**
     * Calculate overall score
     */
    calculateOverallScore(moduleScores) {
        const scores = Object.values(moduleScores).map(m => m.riskScore);
        if (scores.length === 0) return 0;
        return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
    }

    /**
     * Generate risk report
     */
    generateReport(moduleScores) {
        const modules = Object.entries(moduleScores).map(([name, data]) => ({
            name,
            ...data
        }));

        const byLevel = {
            low: modules.filter(m => m.level === 'Low Risk'),
            moderate: modules.filter(m => m.level === 'Moderate Risk'),
            high: modules.filter(m => m.level === 'High Risk'),
            critical: modules.filter(m => m.level === 'Critical Risk')
        };

        const recommendations = this.generateRecommendations(modules);

        return {
            timestamp: new Date().toISOString(),
            overallScore: this.overallScore,
            overallLevel: this.getRiskLevel(this.overallScore),
            modules: modules.sort((a, b) => b.riskScore - a.riskScore),
            byLevel,
            summary: {
                totalModules: modules.length,
                lowRisk: byLevel.low.length,
                moderateRisk: byLevel.moderate.length,
                highRisk: byLevel.high.length,
                criticalRisk: byLevel.critical.length,
                averageScore: this.overallScore
            },
            recommendations,
            details: {
                metrics: modules.reduce((acc, m) => {
                    acc[m.name] = m.metrics;
                    return acc;
                }, {})
            }
        };
    }

    /**
     * Generate recommendations
     */
    generateRecommendations(modules) {
        const recommendations = [];

        // Critical risk modules
        const critical = modules.filter(m => m.level === 'Critical Risk');
        if (critical.length > 0) {
            recommendations.push({
                priority: 'critical',
                message: `Refactor ${critical.length} module(s) with critical risk: ${critical.map(m => m.name).join(', ')}`,
                modules: critical.map(m => m.name)
            });
        }

        // High risk modules
        const high = modules.filter(m => m.level === 'High Risk');
        if (high.length > 0) {
            recommendations.push({
                priority: 'high',
                message: `Review ${high.length} module(s) with high risk: ${high.map(m => m.name).join(', ')}`,
                modules: high.map(m => m.name)
            });
        }

        // High coupling modules
        const highCoupling = modules.filter(m => m.metrics.coupling > 50);
        if (highCoupling.length > 0) {
            recommendations.push({
                priority: 'medium',
                message: `Reduce coupling in ${highCoupling.length} module(s) with high coupling`,
                modules: highCoupling.map(m => m.name)
            });
        }

        // High complexity modules
        const highComplexity = modules.filter(m => m.metrics.cyclomaticComplexity > 20);
        if (highComplexity.length > 0) {
            recommendations.push({
                priority: 'medium',
                message: `Simplify ${highComplexity.length} module(s) with high cyclomatic complexity`,
                modules: highComplexity.map(m => m.name)
            });
        }

        return recommendations;
    }

    /**
     * Find files in a module
     */
    findFilesInModule(modulePath) {
        const files = [];
        const walkDir = (dir) => {
            const items = fs.readdirSync(dir);
            for (const item of items) {
                const fullPath = path.join(dir, item);
                const stats = fs.statSync(fullPath);
                if (stats.isDirectory() && !['node_modules'].includes(item)) {
                    walkDir(fullPath);
                } else if (stats.isFile() && this.isCodeFile(item)) {
                    files.push(fullPath);
                }
            }
        };
        walkDir(modulePath);
        return files;
    }

    /**
     * Check if file is a code file
     */
    isCodeFile(filename) {
        const extensions = ['.js', '.ts', '.jsx', '.tsx'];
        return extensions.some(ext => filename.endsWith(ext));
    }

    /**
     * Store analysis in database
     */
    async storeAnalysis(report) {
        try {
            await db.query(
                `INSERT INTO architectural_risk_analysis 
                 (overall_score, overall_level, modules, summary, recommendations, details, analyzed_at)
                 VALUES (?, ?, ?, ?, ?, ?, NOW())`,
                [
                    report.overallScore,
                    report.overallLevel.level,
                    JSON.stringify(report.modules),
                    JSON.stringify(report.summary),
                    JSON.stringify(report.recommendations),
                    JSON.stringify(report.details)
                ]
            );
        } catch (error) {
            console.error('Store analysis error:', error);
        }
    }

    /**
     * Load historical data
     */
    async loadHistoricalData() {
        try {
            const [rows] = await db.query(
                `SELECT * FROM architectural_risk_analysis 
                 ORDER BY analyzed_at DESC 
                 LIMIT 50`
            );

            for (const row of rows) {
                this.riskHistory.push({
                    timestamp: row.analyzed_at,
                    overallScore: row.overall_score,
                    overallLevel: row.overall_level,
                    summary: JSON.parse(row.summary)
                });
            }

            console.log(`📊 Loaded ${rows.length} historical risk analyses`);
        } catch (error) {
            console.error('Load historical data error:', error);
        }
    }

    /**
     * Get risk statistics
     */
    async getStatistics() {
        return {
            currentScore: this.overallScore,
            lastAnalysis: this.lastAnalysis,
            historyCount: this.riskHistory.length,
            trends: this.calculateTrends(),
            moduleCount: this.moduleScores.size,
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Calculate trends
     */
    calculateTrends() {
        if (this.riskHistory.length < 2) return null;

        const recent = this.riskHistory.slice(-10);
        const scores = recent.map(h => h.overallScore);
        const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
        const last = scores[scores.length - 1];
        const trend = ((last - avg) / avg) * 100;

        return {
            direction: trend > 5 ? 'improving' : trend < -5 ? 'declining' : 'stable',
            percentage: Math.abs(trend),
            average: avg,
            current: last
        };
    }

    /**
     * Get risk status
     */
    getStatus() {
        return {
            isAnalyzing: this.isAnalyzing,
            overallScore: this.overallScore,
            lastAnalysis: this.lastAnalysis,
            moduleCount: this.moduleScores.size,
            historyCount: this.riskHistory.length
        };
    }
}

// ============================================
// EXPORT
// ============================================

module.exports = {
    ArchitecturalRiskService,
    RISK_LEVELS,
    RISK_WEIGHTS,
    architecturalRiskService: new ArchitecturalRiskService()
};