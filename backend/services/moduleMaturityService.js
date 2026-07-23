// backend/services/moduleMaturityService.js
const fs = require('fs');
const path = require('path');
const db = require('../config/db').promise;
const EventEmitter = require('events');

// ============================================
// MATURITY CONFIGURATION
// ============================================

const MATURITY_LEVELS = {
    EXPERIMENTAL: {
        id: 'experimental',
        label: 'Experimental',
        color: '#FF9800',
        scoreRange: [0, 30],
        description: 'Module is under active development and may change significantly'
    },
    DEVELOPING: {
        id: 'developing',
        label: 'Developing',
        color: '#2196F3',
        scoreRange: [30, 50],
        description: 'Module is being actively developed but not yet stable'
    },
    STABLE: {
        id: 'stable',
        label: 'Stable',
        color: '#4CAF50',
        scoreRange: [50, 70],
        description: 'Module is stable and production-ready'
    },
    CRITICAL: {
        id: 'critical',
        label: 'Critical',
        color: '#F44336',
        scoreRange: [70, 90],
        description: 'Module is mission-critical with high reliability requirements'
    },
    CORE: {
        id: 'core',
        label: 'Core',
        color: '#9C27B0',
        scoreRange: [90, 100],
        description: 'Module is foundational to the entire application'
    },
    LEGACY: {
        id: 'legacy',
        label: 'Legacy',
        color: '#795548',
        scoreRange: [0, 0],
        description: 'Module is deprecated and should be migrated away from'
    },
    DEPRECATED: {
        id: 'deprecated',
        label: 'Deprecated',
        color: '#9E9E9E',
        scoreRange: [0, 0],
        description: 'Module is deprecated and will be removed'
    }
};

const MATURITY_WEIGHTS = {
    testCoverage: 0.20,
    dependencyCount: 0.15,
    changeFrequency: 0.15,
    productionUsage: 0.15,
    issueFrequency: 0.15,
    prActivity: 0.10,
    documentationCoverage: 0.10
};

// ============================================
// MODULE MATURITY SERVICE
// ============================================

class ModuleMaturityService extends EventEmitter {
    constructor() {
        super();
        this.moduleScores = new Map();
        this.maturityHistory = [];
        this.isAnalyzing = false;
        this.projectRoot = path.join(__dirname, '..');
        this.lastAnalysis = null;
        this.moduleFindings = new Map();
    }

    /**
     * Initialize maturity service
     */
    async initialize() {
        // Load historical data
        await this.loadHistoricalData();
        console.log('✅ Module Maturity Service initialized');
        return this;
    }

    /**
     * Analyze module maturity
     */
    async analyzeMaturity() {
        if (this.isAnalyzing) return;

        this.isAnalyzing = true;
        console.log('📊 Analyzing module maturity...');

        try {
            const modules = this.findModules();
            const results = {};

            for (const modulePath of modules) {
                const maturity = await this.analyzeModule(modulePath);
                results[path.basename(modulePath)] = maturity;
                this.moduleScores.set(modulePath, maturity);
            }

            // Generate report
            const report = this.generateReport(results);

            // Store history
            this.maturityHistory.push(report);
            if (this.maturityHistory.length > 100) {
                this.maturityHistory.shift();
            }

            this.lastAnalysis = new Date().toISOString();

            // Store in database
            await this.storeAnalysis(report);

            this.emit('analysis.completed', report);
            console.log(`✅ Maturity analysis complete: ${Object.keys(results).length} modules analyzed`);

            return report;

        } catch (error) {
            console.error('Maturity analysis error:', error);
            this.emit('analysis.error', { error });
            throw error;
        } finally {
            this.isAnalyzing = false;
        }
    }

    /**
     * Analyze a single module
     */
    async analyzeModule(modulePath) {
        const moduleName = path.basename(modulePath);
        const metrics = await this.calculateMetrics(modulePath);
        const score = this.calculateScore(metrics);
        const level = this.getMaturityLevel(score);
        const findings = this.generateFindings(modulePath, metrics, score);

        this.moduleFindings.set(moduleName, findings);

        return {
            name: moduleName,
            path: modulePath,
            metrics,
            score,
            level,
            findings,
            recommendations: this.generateRecommendations(moduleName, metrics, level)
        };
    }

    /**
     * Calculate metrics for a module
     */
    async calculateMetrics(modulePath) {
        const files = this.findFilesInModule(modulePath);
        const moduleName = path.basename(modulePath);

        // Test coverage
        const testCoverage = await this.calculateTestCoverage(modulePath);

        // Dependency count
        const dependencyCount = await this.calculateDependencyCount(modulePath);

        // Change frequency (simplified)
        const changeFrequency = await this.calculateChangeFrequency(modulePath);

        // Production usage (simplified)
        const productionUsage = await this.calculateProductionUsage(moduleName);

        // Issue frequency (simplified)
        const issueFrequency = await this.calculateIssueFrequency(moduleName);

        // PR activity (simplified)
        const prActivity = await this.calculatePRActivity(moduleName);

        // Documentation coverage
        const documentationCoverage = await this.calculateDocumentationCoverage(modulePath);

        return {
            testCoverage,
            dependencyCount,
            changeFrequency,
            productionUsage,
            issueFrequency,
            prActivity,
            documentationCoverage,
            fileCount: files.length,
            lastUpdated: new Date().toISOString()
        };
    }

    /**
     * Calculate test coverage
     */
    async calculateTestCoverage(modulePath) {
        const testFiles = this.findTestFiles(modulePath);
        const sourceFiles = this.findFilesInModule(modulePath);
        
        const testCount = testFiles.length;
        const sourceCount = sourceFiles.length;

        if (sourceCount === 0) return 0;

        // Simplified coverage calculation
        let coverage = (testCount / sourceCount) * 100;
        
        // Check for test files in test directory
        const testDir = path.join(modulePath, 'test');
        if (fs.existsSync(testDir)) {
            const testDirFiles = fs.readdirSync(testDir).filter(f => f.endsWith('.js'));
            coverage += (testDirFiles.length / sourceCount) * 50;
        }

        return Math.min(100, Math.round(coverage));
    }

    /**
     * Calculate dependency count
     */
    async calculateDependencyCount(modulePath) {
        const packagePath = path.join(modulePath, 'package.json');
        if (!fs.existsSync(packagePath)) return 0;

        try {
            const content = fs.readFileSync(packagePath, 'utf8');
            const data = JSON.parse(content);
            const deps = data.dependencies || {};
            const devDeps = data.devDependencies || {};
            return Object.keys(deps).length + Object.keys(devDeps).length;
        } catch (error) {
            return 0;
        }
    }

    /**
     * Calculate change frequency (simplified)
     */
    async calculateChangeFrequency(modulePath) {
        // In production, would use git history
        // Simplified: check file modification times
        const files = this.findFilesInModule(modulePath);
        const now = Date.now();
        const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;

        let changedFiles = 0;
        for (const file of files) {
            try {
                const stats = fs.statSync(file);
                if (stats.mtimeMs > thirtyDaysAgo) {
                    changedFiles++;
                }
            } catch (error) {
                // Ignore
            }
        }

        return files.length > 0 ? (changedFiles / files.length) * 100 : 0;
    }

    /**
     * Calculate production usage (simplified)
     */
    async calculateProductionUsage(moduleName) {
        // In production, would check usage metrics
        // Simplified: check if module is imported in production code
        const projectRoot = this.projectRoot;
        let usageCount = 0;
        const files = this.findCodeFiles();
        
        for (const file of files) {
            const content = fs.readFileSync(file, 'utf8');
            if (content.includes(`require('${moduleName}')`) || 
                content.includes(`from '${moduleName}'`)) {
                usageCount++;
            }
        }

        return Math.min(100, usageCount * 10);
    }

    /**
     * Calculate issue frequency (simplified)
     */
    async calculateIssueFrequency(moduleName) {
        // In production, would fetch from issue tracker
        // Simplified: count TODO/FIXME comments
        const files = this.findFilesInModule(path.join(this.projectRoot, moduleName));
        let issueCount = 0;

        for (const file of files) {
            const content = fs.readFileSync(file, 'utf8');
            const matches = content.match(/\/\/\s*(TODO|FIXME|BUG|HACK)/g) || [];
            issueCount += matches.length;
        }

        return Math.min(100, issueCount * 5);
    }

    /**
     * Calculate PR activity (simplified)
     */
    async calculatePRActivity(moduleName) {
        // In production, would fetch from GitHub API
        // Simplified: check recent file changes
        const modulePath = path.join(this.projectRoot, moduleName);
        if (!fs.existsSync(modulePath)) return 0;

        const files = this.findFilesInModule(modulePath);
        let activityCount = 0;

        for (const file of files) {
            try {
                const stats = fs.statSync(file);
                if (Date.now() - stats.mtimeMs < 7 * 24 * 60 * 60 * 1000) {
                    activityCount++;
                }
            } catch (error) {
                // Ignore
            }
        }

        return Math.min(100, (activityCount / Math.max(1, files.length)) * 100);
    }

    /**
     * Calculate documentation coverage
     */
    async calculateDocumentationCoverage(modulePath) {
        const docFiles = this.findDocFiles(modulePath);
        const sourceFiles = this.findFilesInModule(modulePath);

        if (sourceFiles.length === 0) return 0;

        const docCount = docFiles.length;
        return Math.min(100, (docCount / sourceFiles.length) * 100);
    }

    /**
     * Calculate overall score
     */
    calculateScore(metrics) {
        let score = 0;

        // Normalize metrics
        const normalizedMetrics = {
            testCoverage: metrics.testCoverage,
            dependencyCount: Math.max(0, 100 - metrics.dependencyCount * 2),
            changeFrequency: metrics.changeFrequency,
            productionUsage: metrics.productionUsage,
            issueFrequency: Math.max(0, 100 - metrics.issueFrequency),
            prActivity: metrics.prActivity,
            documentationCoverage: metrics.documentationCoverage
        };

        // Calculate weighted score
        for (const [key, value] of Object.entries(normalizedMetrics)) {
            const weight = MATURITY_WEIGHTS[key] || 0.1;
            score += value * weight;
        }

        return Math.round(Math.min(100, score));
    }

    /**
     * Get maturity level based on score
     */
    getMaturityLevel(score) {
        if (score >= 90) return MATURITY_LEVELS.CORE;
        if (score >= 70) return MATURITY_LEVELS.CRITICAL;
        if (score >= 50) return MATURITY_LEVELS.STABLE;
        if (score >= 30) return MATURITY_LEVELS.DEVELOPING;
        return MATURITY_LEVELS.EXPERIMENTAL;
    }

    /**
     * Generate findings for module
     */
    generateFindings(modulePath, metrics, score) {
        const findings = [];

        if (metrics.testCoverage < 30) {
            findings.push({
                type: 'test_coverage',
                severity: 'critical',
                message: 'Test coverage is below 30%'
            });
        }

        if (metrics.dependencyCount > 20) {
            findings.push({
                type: 'dependencies',
                severity: 'warning',
                message: `High dependency count: ${metrics.dependencyCount}`
            });
        }

        if (metrics.changeFrequency > 80) {
            findings.push({
                type: 'change_frequency',
                severity: 'warning',
                message: 'Module changes very frequently'
            });
        }

        if (metrics.productionUsage < 30) {
            findings.push({
                type: 'usage',
                severity: 'info',
                message: 'Module is not widely used in production'
            });
        }

        if (metrics.issueFrequency > 50) {
            findings.push({
                type: 'issues',
                severity: 'critical',
                message: 'High number of issues/TODOs'
            });
        }

        if (metrics.documentationCoverage < 30) {
            findings.push({
                type: 'documentation',
                severity: 'warning',
                message: 'Low documentation coverage'
            });
        }

        return findings;
    }

    /**
     * Generate recommendations
     */
    generateRecommendations(moduleName, metrics, level) {
        const recommendations = [];

        if (level.id === 'experimental') {
            recommendations.push('Increase test coverage to improve stability');
            recommendations.push('Add documentation for APIs');
            recommendations.push('Review and refactor code structure');
        }

        if (level.id === 'developing') {
            recommendations.push('Continue adding tests to reach 70% coverage');
            recommendations.push('Reduce dependencies where possible');
            recommendations.push('Monitor issue frequency');
        }

        if (level.id === 'stable') {
            recommendations.push('Maintain test coverage and add integration tests');
            recommendations.push('Document breaking changes');
            recommendations.push('Establish backward compatibility guarantees');
        }

        if (level.id === 'critical') {
            recommendations.push('Implement comprehensive monitoring');
            recommendations.push('Add performance regression tests');
            recommendations.push('Document failure scenarios');
        }

        if (metrics.testCoverage < 50) {
            recommendations.push('Improve test coverage (current: ' + metrics.testCoverage + '%)');
        }

        if (metrics.dependencyCount > 10) {
            recommendations.push('Reduce dependency count (current: ' + metrics.dependencyCount + ')');
        }

        if (metrics.documentationCoverage < 50) {
            recommendations.push('Improve documentation coverage (current: ' + metrics.documentationCoverage + '%)');
        }

        return recommendations;
    }

    /**
     * Generate report
     */
    generateReport(moduleResults) {
        const modules = Object.values(moduleResults);
        const levels = {};

        // Count modules by level
        for (const module of modules) {
            levels[module.level.id] = (levels[module.level.id] || 0) + 1;
        }

        // Get recommendations by level
        const recommendationsByLevel = {};
        for (const module of modules) {
            if (!recommendationsByLevel[module.level.id]) {
                recommendationsByLevel[module.level.id] = [];
            }
            for (const rec of module.recommendations) {
                if (!recommendationsByLevel[module.level.id].includes(rec)) {
                    recommendationsByLevel[module.level.id].push(rec);
                }
            }
        }

        return {
            timestamp: new Date().toISOString(),
            summary: {
                totalModules: modules.length,
                byLevel: levels,
                averageScore: modules.reduce((sum, m) => sum + m.score, 0) / modules.length
            },
            modules: modules.sort((a, b) => b.score - a.score),
            recommendations: recommendationsByLevel,
            details: {
                findings: modules.reduce((acc, m) => {
                    acc[m.name] = m.findings;
                    return acc;
                }, {})
            }
        };
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

    findTestFiles(modulePath) {
        const files = [];
        const testDirs = ['test', '__tests__', 'tests'];
        for (const testDir of testDirs) {
            const testPath = path.join(modulePath, testDir);
            if (fs.existsSync(testPath)) {
                const items = fs.readdirSync(testPath);
                for (const item of items) {
                    if (item.endsWith('.test.js') || item.endsWith('.spec.js')) {
                        files.push(path.join(testPath, item));
                    }
                }
            }
        }
        return files;
    }

    findDocFiles(modulePath) {
        const files = [];
        const docDirs = ['docs', 'doc', 'documentation'];
        for (const docDir of docDirs) {
            const docPath = path.join(modulePath, docDir);
            if (fs.existsSync(docPath)) {
                const items = fs.readdirSync(docPath);
                for (const item of items) {
                    if (item.endsWith('.md') || item.endsWith('.txt')) {
                        files.push(path.join(docPath, item));
                    }
                }
            }
        }
        return files;
    }

    findCodeFiles() {
        const files = [];
        const root = this.projectRoot;
        this.walkDirectory(root, files, (file) => this.isCodeFile(file));
        return files;
    }

    walkDirectory(dir, files, filter) {
        const items = fs.readdirSync(dir);
        for (const item of items) {
            const fullPath = path.join(dir, item);
            const stats = fs.statSync(fullPath);
            if (stats.isDirectory() && !['node_modules', '.git', 'logs', 'uploads', 'dist', 'build'].includes(item)) {
                this.walkDirectory(fullPath, files, filter);
            } else if (stats.isFile() && filter(item)) {
                files.push(fullPath);
            }
        }
    }

    isCodeFile(filename) {
        const extensions = ['.js', '.ts', '.jsx', '.tsx'];
        return extensions.some(ext => filename.endsWith(ext));
    }

    // ============================================
    // DATABASE OPERATIONS
    // ============================================

    async storeAnalysis(report) {
        try {
            await db.query(
                `INSERT INTO module_maturity_analysis 
                 (total_modules, average_score, levels, modules, recommendations, details, timestamp)
                 VALUES (?, ?, ?, ?, ?, ?, NOW())`,
                [
                    report.summary.totalModules,
                    report.summary.averageScore,
                    JSON.stringify(report.summary.byLevel),
                    JSON.stringify(report.modules),
                    JSON.stringify(report.recommendations),
                    JSON.stringify(report.details)
                ]
            );
        } catch (error) {
            console.error('Store analysis error:', error);
        }
    }

    async loadHistoricalData() {
        try {
            const [rows] = await db.query(
                `SELECT * FROM module_maturity_analysis 
                 ORDER BY timestamp DESC 
                 LIMIT 50`
            );

            for (const row of rows) {
                this.maturityHistory.push({
                    timestamp: row.timestamp,
                    totalModules: row.total_modules,
                    averageScore: row.average_score,
                    levels: JSON.parse(row.levels),
                    modules: JSON.parse(row.modules)
                });
            }

            console.log(`📊 Loaded ${rows.length} historical maturity analyses`);
        } catch (error) {
            console.error('Load historical data error:', error);
        }
    }

    // ============================================
    // STATISTICS
    // ============================================

    async getStatistics() {
        return {
            totalModules: this.moduleScores.size,
            lastAnalysis: this.lastAnalysis,
            historyCount: this.maturityHistory.length,
            moduleNames: Array.from(this.moduleScores.keys()).map(p => path.basename(p)),
            timestamp: new Date().toISOString()
        };
    }

    getStatus() {
        return {
            isAnalyzing: this.isAnalyzing,
            moduleCount: this.moduleScores.size,
            lastAnalysis: this.lastAnalysis,
            historyCount: this.maturityHistory.length
        };
    }
}

// ============================================
// EXPORT
// ============================================

module.exports = {
    ModuleMaturityService,
    MATURITY_LEVELS,
    MATURITY_WEIGHTS,
    moduleMaturityService: new ModuleMaturityService()
};