// backend/services/technicalDebtService.js
const fs = require('fs');
const path = require('path');
const db = require('../config/db').promise;
const EventEmitter = require('events');

// ============================================
// TECHNICAL DEBT CONFIGURATION
// ============================================

const DEBT_CATEGORIES = {
    ARCHITECTURE: 'architecture',
    CODE_QUALITY: 'code_quality',
    TESTING: 'testing',
    DOCUMENTATION: 'documentation',
    DEPENDENCIES: 'dependencies',
    SECURITY: 'security',
    PERFORMANCE: 'performance'
};

const DEBT_WEIGHTS = {
    architecture: 0.25,
    code_quality: 0.20,
    testing: 0.15,
    documentation: 0.15,
    dependencies: 0.10,
    security: 0.10,
    performance: 0.05
};

// ============================================
// TECHNICAL DEBT SERVICE
// ============================================

class TechnicalDebtService extends EventEmitter {
    constructor() {
        super();
        this.debtIndex = {
            overall: 0,
            categories: {},
            metrics: {},
            recommendations: [],
            timestamp: null
        };
        this.debtHistory = [];
        this.analysisResults = [];
        this.isAnalyzing = false;
        this.projectRoot = path.join(__dirname, '..');
        this.lastAnalysis = null;
        this.todoItems = [];
        this.deadCodeItems = [];
    }

    /**
     * Initialize technical debt service
     */
    async initialize() {
        // Load historical data
        await this.loadHistoricalData();
        console.log('✅ Technical Debt Service initialized');
        return this;
    }

    /**
     * Analyze technical debt
     */
    async analyzeDebt() {
        if (this.isAnalyzing) return;

        this.isAnalyzing = true;
        console.log('📊 Analyzing technical debt...');

        // Clear per-run state before starting
        this.todoItems = [];
        this.deadCodeItems = [];

        try {
            const results = {
                timestamp: new Date().toISOString(),
                categories: {},
                metrics: {},
                recommendations: [],
                overallScore: 0
            };

            // Analyze architecture debt
            results.categories.architecture = await this.analyzeArchitectureDebt();
            
            // Analyze code quality
            results.categories.code_quality = await this.analyzeCodeQuality();
            
            // Analyze testing debt
            results.categories.testing = await this.analyzeTestingDebt();
            
            // Analyze documentation debt
            results.categories.documentation = await this.analyzeDocumentationDebt();
            
            // Analyze dependencies
            results.categories.dependencies = await this.analyzeDependencies();
            
            // Analyze security
            results.categories.security = await this.analyzeSecurity();
            
            // Analyze performance
            results.categories.performance = await this.analyzePerformance();

            // Calculate metrics
            results.metrics = this.calculateMetrics(results);

            // Generate recommendations
            results.recommendations = this.generateRecommendations(results);

            // Calculate overall score
            results.overallScore = this.calculateOverallScore(results);

            this.debtIndex = results;
            this.debtHistory.push(results);
            
            // Keep only last 100
            if (this.debtHistory.length > 100) {
                this.debtHistory.shift();
            }

            this.lastAnalysis = new Date().toISOString();

            // Store in database
            await this.storeAnalysis(results);

            this.emit('analysis.completed', results);
            console.log(`✅ Technical debt analysis complete: Score ${results.overallScore}%`);

            return results;

        } catch (error) {
            console.error('Technical debt analysis error:', error);
            this.emit('analysis.error', { error });
            throw error;
        } finally {
            this.isAnalyzing = false;
        }
    }

    /**
     * Analyze architecture debt
     */
    async analyzeArchitectureDebt() {
        let debtScore = 0;
        const issues = [];

        // Check for architectural violations
        const files = this.findCodeFiles();
        let violations = 0;
        let totalFiles = files.length;

        for (const file of files) {
            const content = fs.readFileSync(file, 'utf8');
            
            // Check for tight coupling
            if (this.hasTightCoupling(content)) {
                violations++;
                issues.push({
                    file: path.relative(this.projectRoot, file),
                    type: 'tight_coupling'
                });
            }

            // Check for circular dependencies
            if (this.hasCircularDependency(content)) {
                violations++;
                issues.push({
                    file: path.relative(this.projectRoot, file),
                    type: 'circular_dependency'
                });
            }

            // Check for large files
            const lines = content.split('\n').length;
            if (lines > 500) {
                violations++;
                issues.push({
                    file: path.relative(this.projectRoot, file),
                    type: 'large_file',
                    lines
                });
            }
        }

        debtScore = totalFiles > 0 ? (violations / totalFiles) * 100 : 0;
        debtScore = Math.min(100, debtScore);

        return {
            score: debtScore,
            issues: issues.slice(0, 20),
            totalFiles,
            violations,
            severity: this.getSeverity(debtScore)
        };
    }

    /**
     * Analyze code quality
     */
    async analyzeCodeQuality() {
        let debtScore = 0;
        const issues = [];
        const files = this.findCodeFiles();

        let totalIssues = 0;
        let totalFiles = files.length;

        for (const file of files) {
            const content = fs.readFileSync(file, 'utf8');
            
            // Check for code duplication (simplified)
            if (this.hasDuplication(content)) {
                totalIssues++;
                issues.push({
                    file: path.relative(this.projectRoot, file),
                    type: 'duplication'
                });
            }

            // Check for complex methods
            if (this.hasComplexMethod(content)) {
                totalIssues++;
                issues.push({
                    file: path.relative(this.projectRoot, file),
                    type: 'complex_method'
                });
            }

            // Check for long methods
            if (this.hasLongMethod(content)) {
                totalIssues++;
                issues.push({
                    file: path.relative(this.projectRoot, file),
                    type: 'long_method'
                });
            }

            // Check for TODO comments
            const todoMatches = content.match(/\/\/\s*TODO|#\s*TODO/g) || [];
            if (todoMatches.length > 0) {
                totalIssues += todoMatches.length;
                this.todoItems.push({
                    file: path.relative(this.projectRoot, file),
                    count: todoMatches.length,
                    content: todoMatches.join(', ')
                });
            }
        }

        debtScore = totalFiles > 0 ? (totalIssues / totalFiles) * 10 : 0;
        debtScore = Math.min(100, debtScore);

        return {
            score: debtScore,
            issues: issues.slice(0, 20),
            totalFiles,
            totalIssues,
            todoCount: this.todoItems.length,
            severity: this.getSeverity(debtScore)
        };
    }

    /**
     * Analyze testing debt
     */
    async analyzeTestingDebt() {
        let debtScore = 0;
        const issues = [];

        const testFiles = this.findTestFiles();
        const sourceFiles = this.findCodeFiles();

        const testCount = testFiles.length;
        const sourceCount = sourceFiles.length;

        // Calculate test coverage ratio
        const coverageRatio = sourceCount > 0 ? testCount / sourceCount : 0;
        
        // Ideal ratio: 1 test per 2 source files
        const idealRatio = 0.5;
        const ratioDeviation = Math.max(0, idealRatio - coverageRatio);
        debtScore = Math.min(100, ratioDeviation * 100);

        // Check for missing tests for critical files
        const criticalFiles = sourceFiles.filter(f => 
            f.includes('/services/') || 
            f.includes('/controllers/') ||
            f.includes('/repositories/')
        );

        const untestedCritical = criticalFiles.filter(f => {
            const testFile = f.replace('.js', '.test.js').replace('/services/', '/tests/services/');
            return !testFiles.some(t => t.includes(path.basename(testFile)));
        });

        for (const file of untestedCritical) {
            issues.push({
                file: path.relative(this.projectRoot, file),
                type: 'untested_critical'
            });
        }

        return {
            score: debtScore,
            issues: issues.slice(0, 20),
            testCount,
            sourceCount,
            coverageRatio: coverageRatio * 100,
            untestedCritical: untestedCritical.length,
            severity: this.getSeverity(debtScore)
        };
    }

    /**
     * Analyze documentation debt
     */
    async analyzeDocumentationDebt() {
        let debtScore = 0;
        const issues = [];

        const docFiles = this.findDocFiles();
        const sourceFiles = this.findCodeFiles();

        // Check documentation coverage
        const docCount = docFiles.length;
        const sourceCount = sourceFiles.length;

        const coverageRatio = sourceCount > 0 ? docCount / sourceCount : 0;
        const idealRatio = 0.3; // 1 doc per 3 source files
        const ratioDeviation = Math.max(0, idealRatio - coverageRatio);
        debtScore = Math.min(100, ratioDeviation * 100);

        // Check for undocumented APIs
        const apiFiles = sourceFiles.filter(f => f.includes('/routes/') || f.includes('/controllers/'));
        const undocumentedAPIs = apiFiles.filter(f => {
            const docFile = f.replace('.js', '.md').replace('/routes/', '/docs/api/');
            return !docFiles.some(d => d.includes(path.basename(docFile)));
        });

        for (const file of undocumentedAPIs) {
            issues.push({
                file: path.relative(this.projectRoot, file),
                type: 'undocumented_api'
            });
        }

        return {
            score: debtScore,
            issues: issues.slice(0, 20),
            docCount,
            sourceCount,
            coverageRatio: coverageRatio * 100,
            undocumentedAPIs: undocumentedAPIs.length,
            severity: this.getSeverity(debtScore)
        };
    }

    /**
     * Analyze dependencies
     */
    async analyzeDependencies() {
        let debtScore = 0;
        const issues = [];

        const packagePath = path.join(this.projectRoot, 'package.json');
        if (!fs.existsSync(packagePath)) {
            return { score: 0, issues: [], severity: 'low' };
        }

        const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
        const deps = packageJson.dependencies || {};
        const devDeps = packageJson.devDependencies || {};

        let outdatedDeps = 0;
        let totalDeps = Object.keys(deps).length + Object.keys(devDeps).length;

        // Check for outdated dependencies (simplified)
        for (const [name, version] of Object.entries(deps)) {
            if (version.includes('^') || version.includes('~')) {
                outdatedDeps++;
                issues.push({
                    dependency: name,
                    version,
                    type: 'outdated'
                });
            }
        }

        debtScore = totalDeps > 0 ? (outdatedDeps / totalDeps) * 100 : 0;
        debtScore = Math.min(100, debtScore);

        return {
            score: debtScore,
            issues: issues.slice(0, 20),
            totalDeps,
            outdatedDeps,
            severity: this.getSeverity(debtScore)
        };
    }

    /**
     * Analyze security
     */
    async analyzeSecurity() {
        let debtScore = 0;
        const issues = [];

        const files = this.findCodeFiles();

        for (const file of files) {
            const content = fs.readFileSync(file, 'utf8');
            
            // Check for security vulnerabilities (simplified)
            const patterns = [
                { pattern: /eval\s*\(/g, type: 'dangerous_eval' },
                { pattern: /exec\s*\(/g, type: 'dangerous_exec' },
                { pattern: /console\.log/g, type: 'console_log' },
                { pattern: /process\.env/g, type: 'env_exposure' },
                { pattern: /password|secret|key/g, type: 'sensitive_data' }
            ];

            let fileIssues = 0;
            for (const { pattern, type } of patterns) {
                const matches = content.match(pattern) || [];
                if (matches.length > 0) {
                    fileIssues += matches.length;
                    issues.push({
                        file: path.relative(this.projectRoot, file),
                        type,
                        count: matches.length
                    });
                }
            }

            debtScore += fileIssues;
        }

        debtScore = debtScore > 0 ? Math.min(100, debtScore * 2) : 0;

        return {
            score: debtScore,
            issues: issues.slice(0, 20),
            totalIssues: issues.length,
            severity: this.getSeverity(debtScore)
        };
    }

    /**
     * Analyze performance
     */
    async analyzePerformance() {
        let debtScore = 0;
        const issues = [];

        const files = this.findCodeFiles();

        for (const file of files) {
            const content = fs.readFileSync(file, 'utf8');
            
            // Check for performance issues
            const patterns = [
                { pattern: /for\s*\(/g, type: 'loop' },
                { pattern: /\.map\(/g, type: 'map' },
                { pattern: /\.filter\(/g, type: 'filter' },
                { pattern: /\.reduce\(/g, type: 'reduce' },
                { pattern: /await/g, type: 'async' },
                { pattern: /new\s+Promise/g, type: 'promise' }
            ];

            let fileIssues = 0;
            for (const { pattern, type } of patterns) {
                const matches = content.match(pattern) || [];
                if (matches.length > 10) { // Too many operations
                    fileIssues++;
                    issues.push({
                        file: path.relative(this.projectRoot, file),
                        type: `excessive_${type}`,
                        count: matches.length
                    });
                }
            }

            debtScore += fileIssues;
        }

        debtScore = debtScore > 0 ? Math.min(100, debtScore * 5) : 0;

        return {
            score: debtScore,
            issues: issues.slice(0, 20),
            totalIssues: issues.length,
            severity: this.getSeverity(debtScore)
        };
    }

    // ============================================
    // HELPER FUNCTIONS
    // ============================================

    findCodeFiles() {
        const files = [];
        const root = this.projectRoot;
        this.walkDirectory(root, files, (file) => this.isCodeFile(file));
        return files;
    }

    findTestFiles() {
        const files = [];
        const root = this.projectRoot;
        this.walkDirectory(root, files, (file) => file.includes('.test.') || file.includes('.spec.'));
        return files;
    }

    findDocFiles() {
        const files = [];
        const root = this.projectRoot;
        this.walkDirectory(root, files, (file) => file.endsWith('.md') || file.endsWith('.txt'));
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

    hasTightCoupling(content) {
        const patterns = [
            /require\s*\(/g,
            /import\s+.*\s+from/g,
            /new\s+\w+\(/g
        ];
        let count = 0;
        for (const pattern of patterns) {
            const matches = content.match(pattern) || [];
            count += matches.length;
        }
        return count > 10;
    }

    hasCircularDependency(content) {
        return content.includes('circular') || content.includes('cycle');
    }

    hasDuplication(content) {
        const lines = content.split('\n');
        const uniqueLines = new Set(lines);
        return lines.length - uniqueLines.size > 10;
    }

    hasComplexMethod(content) {
        const matches = content.match(/if\s*\(/g) || [];
        return matches.length > 10;
    }

    hasLongMethod(content) {
        const methods = content.match(/function\s+\w+\s*\([^)]*\)\s*{[^}]*}/g) || [];
        for (const method of methods) {
            const lines = method.split('\n').length;
            if (lines > 50) return true;
        }
        return false;
    }

    getSeverity(score) {
        if (score < 20) return { level: 'low', color: '#4CAF50', label: 'Low Debt' };
        if (score < 40) return { level: 'moderate', color: '#FFC107', label: 'Moderate Debt' };
        if (score < 60) return { level: 'high', color: '#FF9800', label: 'High Debt' };
        return { level: 'critical', color: '#F44336', label: 'Critical Debt' };
    }

    calculateMetrics(results) {
        const metrics = {
            overall: 0,
            byCategory: {}
        };

        for (const [category, data] of Object.entries(results.categories)) {
            metrics.byCategory[category] = data.score;
        }

        // Weighted average
        let totalWeighted = 0;
        let totalWeight = 0;
        for (const [category, weight] of Object.entries(DEBT_WEIGHTS)) {
            if (metrics.byCategory[category] !== undefined) {
                totalWeighted += metrics.byCategory[category] * weight;
                totalWeight += weight;
            }
        }

        metrics.overall = totalWeight > 0 ? totalWeighted / totalWeight : 0;
        return metrics;
    }

    calculateOverallScore(results) {
        return Math.round(results.metrics.overall);
    }

    generateRecommendations(results) {
        const recommendations = [];
        const categories = results.categories;

        // Architecture debt
        if (categories.architecture.score > 40) {
            recommendations.push({
                priority: 'high',
                category: 'architecture',
                message: 'Reduce architectural debt by refactoring tight coupling and large files',
                impact: 'Improves maintainability and reduces complexity'
            });
        }

        // Code quality
        if (categories.code_quality.score > 40) {
            recommendations.push({
                priority: 'high',
                category: 'code_quality',
                message: 'Improve code quality by reducing duplication and complex methods',
                impact: 'Makes code easier to understand and maintain'
            });
        }

        // Testing
        if (categories.testing.score > 40) {
            recommendations.push({
                priority: 'medium',
                category: 'testing',
                message: 'Increase test coverage for critical files',
                impact: 'Improves reliability and reduces regression risk'
            });
        }

        // Documentation
        if (categories.documentation.score > 40) {
            recommendations.push({
                priority: 'medium',
                category: 'documentation',
                message: 'Add documentation for APIs and critical modules',
                impact: 'Improves onboarding and reduces knowledge silos'
            });
        }

        // Dependencies
        if (categories.dependencies.score > 30) {
            recommendations.push({
                priority: 'medium',
                category: 'dependencies',
                message: 'Update outdated dependencies and remove unused ones',
                impact: 'Reduces security vulnerabilities and improves compatibility'
            });
        }

        // Security
        if (categories.security.score > 30) {
            recommendations.push({
                priority: 'critical',
                category: 'security',
                message: 'Fix security vulnerabilities identified in the analysis',
                impact: 'Protects against potential attacks and data breaches'
            });
        }

        // Performance
        if (categories.performance.score > 30) {
            recommendations.push({
                priority: 'medium',
                category: 'performance',
                message: 'Optimize performance-critical code paths',
                impact: 'Improves user experience and reduces resource usage'
            });
        }

        return recommendations;
    }

    // ============================================
    // DATABASE OPERATIONS
    // ============================================

    async storeAnalysis(results) {
        try {
            await db.query(
                `INSERT INTO technical_debt_analysis 
                 (overall_score, categories, metrics, recommendations, timestamp)
                 VALUES (?, ?, ?, ?, NOW())`,
                [
                    results.overallScore,
                    JSON.stringify(results.categories),
                    JSON.stringify(results.metrics),
                    JSON.stringify(results.recommendations)
                ]
            );
        } catch (error) {
            console.error('Store analysis error:', error);
        }
    }

    async loadHistoricalData() {
        try {
            const [rows] = await db.query(
                `SELECT * FROM technical_debt_analysis 
                 ORDER BY timestamp DESC 
                 LIMIT 50`
            );

            for (const row of rows) {
                this.debtHistory.push({
                    timestamp: row.timestamp,
                    overallScore: row.overall_score,
                    categories: JSON.parse(row.categories),
                    metrics: JSON.parse(row.metrics),
                    recommendations: JSON.parse(row.recommendations)
                });
            }

            console.log(`📊 Loaded ${rows.length} historical debt analyses`);
        } catch (error) {
            console.error('Load historical data error:', error);
        }
    }

    // ============================================
    // STATISTICS
    // ============================================

    async getStatistics() {
        return {
            currentScore: this.debtIndex.overallScore,
            lastAnalysis: this.lastAnalysis,
            historyCount: this.debtHistory.length,
            trends: this.calculateTrends(),
            todoCount: this.todoItems.length,
            timestamp: new Date().toISOString()
        };
    }

    calculateTrends() {
        if (this.debtHistory.length < 2) return null;

        const recent = this.debtHistory.slice(-10);
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

    getStatus() {
        return {
            isAnalyzing: this.isAnalyzing,
            currentScore: this.debtIndex.overallScore,
            lastAnalysis: this.lastAnalysis,
            historyCount: this.debtHistory.length,
            todoCount: this.todoItems.length
        };
    }
}

// ============================================
// EXPORT
// ============================================

module.exports = {
    TechnicalDebtService,
    DEBT_CATEGORIES,
    DEBT_WEIGHTS,
    technicalDebtService: new TechnicalDebtService()
};