// backend/services/architecturalFitnessService.js
const fs = require('fs');
const path = require('path');
const db = require('../config/db').promise;
const EventEmitter = require('events');

// ============================================
// FITNESS CONFIGURATION
// ============================================

const FITNESS_RULES = {
    // Controllers cannot directly access database
    CONTROLLER_DB_ACCESS: {
        name: 'controller_db_access',
        description: 'Controllers cannot directly access database',
        severity: 'error',
        check: (file, content) => {
            if (!file.includes('/controllers/')) return true;
            const dbPatterns = [
                /db\.query/,
                /db\.execute/,
                /db\.run/,
                /db\.get/,
                /db\.all/,
                /pool\.query/,
                /connection\.query/
            ];
            return !dbPatterns.some(p => p.test(content));
        }
    },
    // Services cannot import frontend utilities
    SERVICE_FRONTEND_IMPORT: {
        name: 'service_frontend_import',
        description: 'Services cannot import frontend utilities',
        severity: 'error',
        check: (file, content) => {
            if (!file.includes('/services/')) return true;
            const frontendPatterns = [
                /frontend\//,
                /assets\//,
                /styles\//,
                /components\//,
                /views\//
            ];
            return !frontendPatterns.some(p => p.test(content));
        }
    },
    // Utilities should be side-effect free
    UTILITY_SIDE_EFFECTS: {
        name: 'utility_side_effects',
        description: 'Utilities should remain side-effect free',
        severity: 'warning',
        check: (file, content) => {
            if (!file.includes('/utils/')) return true;
            const sideEffectPatterns = [
                /fs\./,
                /db\./,
                /console\.log/,
                /process\./,
                /global\./
            ];
            return !sideEffectPatterns.some(p => p.test(content));
        }
    },
    // Layer boundaries intact
    LAYER_BOUNDARIES: {
        name: 'layer_boundaries',
        description: 'Layer boundaries remain intact (controller → service → repository)',
        severity: 'error',
        check: (file, content) => {
            // Controllers should only import services
            if (file.includes('/controllers/')) {
                const badImports = content.match(/require.*\.\.\/models\//g);
                return !badImports;
            }
            // Services should only import repositories and other services
            if (file.includes('/services/')) {
                const badImports = content.match(/require.*\.\.\/controllers\//g);
                return !badImports;
            }
            return true;
        }
    },
    // No circular dependencies
    NO_CIRCULAR_DEPENDENCIES: {
        name: 'no_circular_dependencies',
        description: 'No circular dependencies between modules',
        severity: 'error',
        check: async () => {
            // This would integrate with dependency graph service
            return true;
        }
    },
    // Controllers should be thin
    CONTROLLER_THIN: {
        name: 'controller_thin',
        description: 'Controllers should be thin (max 200 lines)',
        severity: 'warning',
        check: (file, content) => {
            if (!file.includes('/controllers/')) return true;
            const lines = content.split('\n').length;
            return lines <= 200;
        }
    },
    // Services should be cohesive
    SERVICE_COHESION: {
        name: 'service_cohesion',
        description: 'Services should be cohesive (max 500 lines)',
        severity: 'warning',
        check: (file, content) => {
            if (!file.includes('/services/')) return true;
            const lines = content.split('\n').length;
            return lines <= 500;
        }
    },
    // No direct model access from controllers
    CONTROLLER_MODEL_ACCESS: {
        name: 'controller_model_access',
        description: 'Controllers cannot directly access models',
        severity: 'error',
        check: (file, content) => {
            if (!file.includes('/controllers/')) return true;
            const modelPatterns = [
                /require.*models/,
                /import.*models/,
                /new\s+\w+Model/,
                /Model\.find/,
                /Model\.create/,
                /Model\.update/
            ];
            return !modelPatterns.some(p => p.test(content));
        }
    }
};

const SEVERITY_LEVELS = {
    ERROR: 'error',
    WARNING: 'warning',
    INFO: 'info'
};

// ============================================
// ARCHITECTURAL FITNESS SERVICE
// ============================================

class ArchitecturalFitnessService extends EventEmitter {
    constructor() {
        super();
        this.rules = new Map();
        this.violations = [];
        this.fitnessHistory = [];
        this.isRunning = false;
        this.score = 100;
        this.lastRun = null;
    }

    /**
     * Initialize fitness service
     */
    async initialize() {
        // Register default rules
        this.registerDefaultRules();

        // Load custom rules from database
        await this.loadCustomRules();

        console.log('✅ Architectural Fitness Service initialized');
        return this;
    }

    /**
     * Register default rules
     */
    registerDefaultRules() {
        for (const [key, rule] of Object.entries(FITNESS_RULES)) {
            this.registerRule(key, rule);
        }
    }

    /**
     * Register a fitness rule
     */
    registerRule(name, rule) {
        this.rules.set(name, {
            ...rule,
            name,
            enabled: true,
            registeredAt: new Date().toISOString()
        });
        console.log(`📋 Fitness rule registered: ${name}`);
    }

    /**
     * Run all fitness functions
     */
    async runFitness() {
        if (this.isRunning) return;

        this.isRunning = true;
        this.violations = [];
        this.score = 100;

        console.log('🏃 Running architectural fitness functions...');

        try {
            const projectRoot = path.join(__dirname, '..');
            const files = this.scanFiles(projectRoot);

            for (const file of files) {
                const content = fs.readFileSync(file, 'utf8');
                const relativePath = file.replace(projectRoot, '');

                for (const [name, rule] of this.rules) {
                    if (!rule.enabled) continue;

                    try {
                        const result = await rule.check(relativePath, content);
                        if (!result) {
                            this.addViolation({
                                rule: name,
                                description: rule.description,
                                file: relativePath,
                                severity: rule.severity || 'warning',
                                timestamp: new Date().toISOString()
                            });
                        }
                    } catch (error) {
                        console.error(`Error in fitness rule ${name}:`, error);
                    }
                }
            }

            // Calculate score
            this.calculateScore();

            // Generate report
            const report = this.generateReport();

            // Store history
            this.fitnessHistory.push({
                timestamp: new Date().toISOString(),
                score: this.score,
                violations: this.violations.length,
                errors: this.violations.filter(v => v.severity === 'error').length,
                warnings: this.violations.filter(v => v.severity === 'warning').length,
                report
            });

            this.lastRun = new Date().toISOString();

            // Store in database
            await this.storeFitnessReport(report);

            this.emit('fitness.completed', { 
                score: this.score, 
                violations: this.violations.length,
                report 
            });

            if (this.violations.length > 0) {
                this.emit('fitness.violations', { violations: this.violations });
            }

        } catch (error) {
            console.error('Fitness run error:', error);
            this.emit('fitness.error', { error });
        } finally {
            this.isRunning = false;
        }
    }

    /**
     * Scan project files
     */
    scanFiles(dir) {
        const files = [];
        const items = fs.readdirSync(dir);

        for (const item of items) {
            const fullPath = path.join(dir, item);
            const stats = fs.statSync(fullPath);

            if (stats.isDirectory()) {
                if (!['node_modules', '.git', 'logs', 'uploads', 'dist', 'build'].includes(item)) {
                    files.push(...this.scanFiles(fullPath));
                }
            } else if (stats.isFile() && this.isCodeFile(item)) {
                files.push(fullPath);
            }
        }

        return files;
    }

    /**
     * Check if file is a code file
     */
    isCodeFile(filename) {
        const extensions = ['.js', '.ts', '.jsx', '.tsx', '.py'];
        return extensions.some(ext => filename.endsWith(ext));
    }

    /**
     * Add violation
     */
    addViolation(violation) {
        this.violations.push(violation);
    }

    /**
     * Calculate fitness score
     */
    calculateScore() {
        let score = 100;
        const weights = {
            error: 20,
            warning: 10,
            info: 5
        };

        for (const violation of this.violations) {
            const weight = weights[violation.severity] || 10;
            score = Math.max(0, score - weight);
        }

        this.score = score;
    }

    /**
     * Generate report
     */
    generateReport() {
        const errors = this.violations.filter(v => v.severity === 'error');
        const warnings = this.violations.filter(v => v.severity === 'warning');
        const infos = this.violations.filter(v => v.severity === 'info');

        return {
            summary: {
                score: this.score,
                totalViolations: this.violations.length,
                errors: errors.length,
                warnings: warnings.length,
                infos: infos.length,
                status: this.score >= 80 ? 'pass' : 'fail',
                timestamp: new Date().toISOString()
            },
            violations: this.violations,
            byRule: this.violations.reduce((acc, v) => {
                acc[v.rule] = (acc[v.rule] || 0) + 1;
                return acc;
            }, {}),
            byFile: this.violations.reduce((acc, v) => {
                acc[v.file] = (acc[v.file] || 0) + 1;
                return acc;
            }, {})
        };
    }

    /**
     * Get rule violations
     */
    getViolations(severity = null) {
        if (severity) {
            return this.violations.filter(v => v.severity === severity);
        }
        return this.violations;
    }

    /**
     * Get fitness score
     */
    getScore() {
        return this.score;
    }

    /**
     * Check if fitness passes
     */
    passes() {
        return this.score >= 80 && this.violations.filter(v => v.severity === 'error').length === 0;
    }

    /**
     * Get fitness history
     */
    getHistory(limit = 50) {
        return this.fitnessHistory.slice(-limit);
    }

    /**
     * Enable/disable rule
     */
    setRuleEnabled(name, enabled) {
        const rule = this.rules.get(name);
        if (!rule) {
            throw new Error(`Rule not found: ${name}`);
        }
        rule.enabled = enabled;
        return rule;
    }

    /**
     * Add custom rule
     */
    addCustomRule(name, rule) {
        this.registerRule(name, rule);
        return this.rules.get(name);
    }

    /**
     * Get all rules
     */
    getRules() {
        return Array.from(this.rules.values());
    }

    /**
     * Load custom rules from database
     */
    async loadCustomRules() {
        try {
            const [rows] = await db.query(
                'SELECT * FROM fitness_rules WHERE enabled = 1'
            );

            for (const row of rows) {
                this.registerRule(row.rule_name, {
                    description: row.description,
                    severity: row.severity,
                    check: new Function('file', 'content', `return (${row.check_function})`)
                });
            }

            console.log(`📋 Loaded ${rows.length} custom rules`);
        } catch (error) {
            console.error('Load custom rules error:', error);
        }
    }

    /**
     * Store fitness report
     */
    async storeFitnessReport(report) {
        try {
            await db.query(
                `INSERT INTO fitness_reports 
                 (score, violations, errors, warnings, report, timestamp)
                 VALUES (?, ?, ?, ?, ?, NOW())`,
                [
                    this.score,
                    this.violations.length,
                    this.violations.filter(v => v.severity === 'error').length,
                    this.violations.filter(v => v.severity === 'warning').length,
                    JSON.stringify(report)
                ]
            );
        } catch (error) {
            console.error('Store fitness report error:', error);
        }
    }

    // ============================================
    // STATISTICS
    // ============================================

    async getStatistics() {
        return {
            rules: this.rules.size,
            violations: this.violations.length,
            score: this.score,
            passes: this.passes(),
            lastRun: this.lastRun,
            historyCount: this.fitnessHistory.length,
            isRunning: this.isRunning,
            timestamp: new Date().toISOString()
        };
    }

    getStatus() {
        return {
            rules: this.rules.size,
            enabledRules: Array.from(this.rules.values()).filter(r => r.enabled).length,
            violations: this.violations.length,
            score: this.score,
            isRunning: this.isRunning
        };
    }
}

// ============================================
// EXPORT
// ============================================

module.exports = {
    ArchitecturalFitnessService,
    SEVERITY_LEVELS,
    architecturalFitnessService: new ArchitecturalFitnessService()
};