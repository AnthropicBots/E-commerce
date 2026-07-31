// backend/services/experimentFrameworkService.js
const crypto = require('crypto');
const db = require('../config/db').promise;

// ============================================
// EXPERIMENT CONFIGURATION
// ============================================

const EXPERIMENT_TYPES = {
    A_B_TEST: 'a_b_test',
    MULTI_ARMED_BANDIT: 'multi_armed_bandit',
    ALGORITHM_SWITCHING: 'algorithm_switching',
    FEATURE_TOGGLE: 'feature_toggle',
    CANARY: 'canary'
};

const METRIC_TYPES = {
    CLICK_THROUGH: 'click_through',
    CONVERSION: 'conversion',
    REVENUE: 'revenue',
    ENGAGEMENT: 'engagement',
    SATISFACTION: 'satisfaction'
};

const VARIANT_STATUS = {
    DRAFT: 'draft',
    ACTIVE: 'active',
    PAUSED: 'paused',
    COMPLETED: 'completed',
    ARCHIVED: 'archived'
};

// ============================================
// EXPERIMENT FRAMEWORK
// ============================================

class ExperimentFramework {
    constructor() {
        this.experiments = new Map();
        this.variants = new Map();
        this.assignments = new Map();
        this.metrics = new Map();
        this.activeExperiments = new Map();
        this.banditState = new Map();
        this.cache = new Map();
    }

    /**
     * Create a new experiment
     */
    async createExperiment(data) {
        const experiment = {
            id: this.generateExperimentId(),
            name: data.name,
            description: data.description || '',
            type: data.type || EXPERIMENT_TYPES.A_B_TEST,
            status: 'draft',
            variants: data.variants || [],
            trafficAllocation: data.trafficAllocation || 100,
            startDate: data.startDate || null,
            endDate: data.endDate || null,
            metrics: data.metrics || [],
            targetAudience: data.targetAudience || {},
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            results: {}
        };

        // Validate experiment
        this.validateExperiment(experiment);

        this.experiments.set(experiment.id, experiment);

        // Store in database
        await this.storeExperiment(experiment);

        console.log(`🧪 Experiment created: ${experiment.name} (${experiment.id})`);
        return experiment;
    }

    /**
     * Start an experiment
     */
    async startExperiment(experimentId) {
        const experiment = this.experiments.get(experimentId);
        if (!experiment) {
            throw new Error('Experiment not found');
        }

        if (experiment.status !== 'draft') {
            throw new Error('Experiment must be in draft state');
        }

        experiment.status = 'active';
        experiment.startDate = new Date().toISOString();
        experiment.updatedAt = new Date().toISOString();

        this.activeExperiments.set(experimentId, experiment);

        // Initialize bandit state for MAB experiments
        if (experiment.type === EXPERIMENT_TYPES.MULTI_ARMED_BANDIT) {
            this.initializeBanditState(experiment);
        }

        await this.storeExperiment(experiment);

        console.log(`▶️ Experiment started: ${experiment.name}`);
        return experiment;
    }

    /**
     * Get variant for a user
     */
    async getVariant(experimentId, userId) {
        const experiment = this.experiments.get(experimentId);
        if (!experiment) {
            throw new Error('Experiment not found');
        }

        if (experiment.status !== 'active') {
            return null;
        }

        // Check if user already assigned
        const assignmentKey = `${experimentId}:${userId}`;
        if (this.assignments.has(assignmentKey)) {
            const variantId = this.assignments.get(assignmentKey);
            return this.getVariantById(experimentId, variantId);
        }

        // Assign variant based on experiment type
        let variantId;

        switch (experiment.type) {
            case EXPERIMENT_TYPES.A_B_TEST:
                variantId = this.assignABTest(experiment, userId);
                break;
            case EXPERIMENT_TYPES.MULTI_ARMED_BANDIT:
                variantId = await this.assignBandit(experiment, userId);
                break;
            case EXPERIMENT_TYPES.ALGORITHM_SWITCHING:
                variantId = this.assignAlgorithmSwitch(experiment, userId);
                break;
            case EXPERIMENT_TYPES.FEATURE_TOGGLE:
                variantId = this.assignFeatureToggle(experiment, userId);
                break;
            default:
                variantId = this.assignDefault(experiment);
        }

        // Store assignment
        this.assignments.set(assignmentKey, variantId);
        await this.logAssignment(experimentId, userId, variantId);

        return this.getVariantById(experimentId, variantId);
    }

    /**
     * Assign A/B test variant
     */
    assignABTest(experiment, userId) {
        const variants = experiment.variants.filter(v => v.status === 'active');
        if (variants.length === 0) {
            return null;
        }

        // Use consistent hashing
        const hash = this.hashUser(userId);
        const totalWeight = variants.reduce((sum, v) => sum + v.weight, 0);
        const normalizedHash = (hash % 100) + 1;

        let cumulative = 0;
        for (const variant of variants) {
            cumulative += (variant.weight / totalWeight) * 100;
            if (normalizedHash <= cumulative) {
                return variant.id;
            }
        }

        return variants[variants.length - 1].id;
    }

    /**
     * Assign multi-armed bandit variant
     */
    async assignBandit(experiment, userId) {
        const banditState = this.banditState.get(experiment.id);
        if (!banditState) {
            return this.assignABTest(experiment, userId);
        }

        // Epsilon-greedy algorithm
        const epsilon = 0.1;
        const variants = experiment.variants.filter(v => v.status === 'active');

        if (Math.random() < epsilon) {
            // Explore: random selection
            const randomVariant = variants[Math.floor(Math.random() * variants.length)];
            return randomVariant.id;
        } else {
            // Exploit: choose best variant
            let bestVariant = null;
            let bestScore = -Infinity;

            for (const variant of variants) {
                const stats = banditState.get(variant.id) || { reward: 0, count: 0 };
                const score = stats.count > 0 ? stats.reward / stats.count : 0;
                if (score > bestScore) {
                    bestScore = score;
                    bestVariant = variant;
                }
            }

            return bestVariant ? bestVariant.id : variants[0]?.id;
        }
    }

    /**
     * Assign algorithm switch variant
     */
    assignAlgorithmSwitch(experiment, userId) {
        // Simple round-robin or based on user segment
        const variants = experiment.variants.filter(v => v.status === 'active');
        if (variants.length === 0) return null;

        const hash = this.hashUser(userId);
        const index = hash % variants.length;
        return variants[index].id;
    }

    /**
     * Assign feature toggle variant
     */
    assignFeatureToggle(experiment, userId) {
        const variants = experiment.variants.filter(v => v.status === 'active');
        if (variants.length === 0) return null;

        // Return the first active variant (on/off)
        return variants[0].id;
    }

    /**
     * Assign default variant
     */
    assignDefault(experiment) {
        const variants = experiment.variants.filter(v => v.status === 'active');
        return variants.length > 0 ? variants[0].id : null;
    }

    /**
     * Initialize bandit state
     */
    initializeBanditState(experiment) {
        const state = new Map();
        for (const variant of experiment.variants) {
            state.set(variant.id, { reward: 0, count: 0 });
        }
        this.banditState.set(experiment.id, state);
    }

    /**
     * Update bandit state with result
     */
    async updateBandit(experimentId, variantId, reward) {
        const state = this.banditState.get(experimentId);
        if (!state) return;

        const stats = state.get(variantId);
        if (stats) {
            stats.reward += reward;
            stats.count++;
            state.set(variantId, stats);
        }
    }

    /**
     * Record metric
     */
    async recordMetric(experimentId, userId, metricType, value) {
        const experiment = this.experiments.get(experimentId);
        if (!experiment) return;

        const assignmentKey = `${experimentId}:${userId}`;
        const variantId = this.assignments.get(assignmentKey);
        if (!variantId) return;

        const metric = {
            id: this.generateMetricId(),
            experimentId,
            userId,
            variantId,
            metricType,
            value,
            timestamp: new Date().toISOString()
        };

        await this.storeMetric(metric);

        // Update bandit if applicable
        if (experiment.type === EXPERIMENT_TYPES.MULTI_ARMED_BANDIT) {
            await this.updateBandit(experimentId, variantId, value);
        }

        this.emit('metric.recorded', metric);
        return metric;
    }

    /**
     * Get experiment results
     */
    async getResults(experimentId) {
        const experiment = this.experiments.get(experimentId);
        if (!experiment) {
            throw new Error('Experiment not found');
        }

        const metrics = await this.getMetrics(experimentId);
        const results = {
            experimentId,
            experimentName: experiment.name,
            type: experiment.type,
            status: experiment.status,
            startDate: experiment.startDate,
            endDate: experiment.endDate,
            variants: [],
            summary: {}
        };

        for (const variant of experiment.variants) {
            const variantMetrics = metrics.filter(m => m.variant_id === variant.id);
            const variantResult = {
                variantId: variant.id,
                name: variant.name,
                weight: variant.weight,
                metrics: this.calculateVariantMetrics(variantMetrics)
            };
            results.variants.push(variantResult);
        }

        // Calculate summary statistics
        results.summary = this.calculateSummary(results.variants);

        return results;
    }

    /**
     * Calculate variant metrics
     */
    calculateVariantMetrics(metrics) {
        const result = {};
        const grouped = {};

        for (const metric of metrics) {
            const type = metric.metric_type;
            if (!grouped[type]) grouped[type] = [];
            grouped[type].push(metric.value);
        }

        for (const [type, values] of Object.entries(grouped)) {
            result[type] = {
                count: values.length,
                sum: values.reduce((a, b) => a + b, 0),
                average: values.reduce((a, b) => a + b, 0) / values.length,
                min: Math.min(...values),
                max: Math.max(...values),
                median: this.calculateMedian(values)
            };
        }

        return result;
    }

    /**
     * Calculate summary statistics
     */
    calculateSummary(variants) {
        const summary = {};
        const metricTypes = new Set();

        for (const variant of variants) {
            for (const type of Object.keys(variant.metrics)) {
                metricTypes.add(type);
            }
        }

        for (const type of metricTypes) {
            const values = variants
                .map(v => v.metrics[type]?.average || 0)
                .filter(v => v > 0);

            if (values.length > 0) {
                const max = Math.max(...values);
                const maxVariant = variants.find(v => (v.metrics[type]?.average || 0) === max);

                summary[type] = {
                    bestVariant: maxVariant ? maxVariant.name : null,
                    bestValue: max,
                    range: Math.max(...values) - Math.min(...values),
                    improvement: max > 0 ? ((max - values[0]) / values[0] * 100).toFixed(2) + '%' : '0%'
                };
            }
        }

        return summary;
    }

    /**
     * Calculate median
     */
    calculateMedian(values) {
        const sorted = [...values].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 === 0
            ? (sorted[mid - 1] + sorted[mid]) / 2
            : sorted[mid];
    }

    /**
     * Hash user for consistent assignment
     */
    hashUser(userId) {
        const hash = crypto.createHash('sha256')
            .update(userId.toString())
            .digest('hex');
        return parseInt(hash.substring(0, 8), 16);
    }

    /**
     * Get variant by ID
     */
    getVariantById(experimentId, variantId) {
        const experiment = this.experiments.get(experimentId);
        if (!experiment) return null;

        return experiment.variants.find(v => v.id === variantId) || null;
    }

    /**
     * Validate experiment
     */
    validateExperiment(experiment) {
        if (!experiment.name) {
            throw new Error('Experiment name is required');
        }

        if (!experiment.variants || experiment.variants.length < 2) {
            throw new Error('Experiment must have at least 2 variants');
        }

        for (const variant of experiment.variants) {
            if (!variant.name) {
                throw new Error('Variant name is required');
            }
            if (variant.weight < 0) {
                throw new Error('Variant weight must be positive');
            }
        }
    }

    // ============================================
    // GENERATE IDS
    // ============================================

    generateExperimentId() {
        return `EXP_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    }

    generateVariantId() {
        return `VAR_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    }

    generateMetricId() {
        return `MET_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    }

    // ============================================
    // DATABASE OPERATIONS
    // ============================================

    async storeExperiment(experiment) {
        try {
            await db.query(
                `INSERT INTO experiments 
                 (experiment_id, name, description, type, status, variants,
                  traffic_allocation, start_date, end_date, metrics,
                  target_audience, results, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE
                 name = VALUES(name), description = VALUES(description),
                 type = VALUES(type), status = VALUES(status),
                 variants = VALUES(variants), traffic_allocation = VALUES(traffic_allocation),
                 start_date = VALUES(start_date), end_date = VALUES(end_date),
                 metrics = VALUES(metrics), target_audience = VALUES(target_audience),
                 results = VALUES(results), updated_at = VALUES(updated_at)`,
                [
                    experiment.id,
                    experiment.name,
                    experiment.description,
                    experiment.type,
                    experiment.status,
                    JSON.stringify(experiment.variants),
                    experiment.trafficAllocation,
                    experiment.startDate,
                    experiment.endDate,
                    JSON.stringify(experiment.metrics),
                    JSON.stringify(experiment.targetAudience),
                    JSON.stringify(experiment.results),
                    experiment.createdAt,
                    experiment.updatedAt
                ]
            );
        } catch (error) {
            console.error('Store experiment error:', error);
        }
    }

    async logAssignment(experimentId, userId, variantId) {
        try {
            await db.query(
                `INSERT INTO experiment_assignments 
                 (experiment_id, user_id, variant_id, assigned_at)
                 VALUES (?, ?, ?, NOW())`,
                [experimentId, userId, variantId]
            );
        } catch (error) {
            console.error('Log assignment error:', error);
        }
    }

    async storeMetric(metric) {
        try {
            await db.query(
                `INSERT INTO experiment_metrics 
                 (metric_id, experiment_id, user_id, variant_id, metric_type, value, timestamp)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [
                    metric.id,
                    metric.experimentId,
                    metric.userId,
                    metric.variantId,
                    metric.metricType,
                    metric.value,
                    metric.timestamp
                ]
            );
        } catch (error) {
            console.error('Store metric error:', error);
        }
    }

    async getMetrics(experimentId) {
        try {
            const [rows] = await db.query(
                'SELECT * FROM experiment_metrics WHERE experiment_id = ?',
                [experimentId]
            );
            return rows;
        } catch (error) {
            console.error('Get metrics error:', error);
            return [];
        }
    }

    // ============================================
    // STATISTICS
    // ============================================

    async getStatistics() {
        try {
            const [stats] = await db.query(
                `SELECT 
                    COUNT(*) as total_experiments,
                    SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_experiments,
                    SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_experiments,
                    COUNT(DISTINCT type) as experiment_types
                 FROM experiments`
            );

            return {
                ...stats[0],
                activeAssignments: this.assignments.size,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            console.error('Statistics error:', error);
            return null;
        }
    }

    getStatus() {
        return {
            experiments: this.experiments.size,
            activeExperiments: this.activeExperiments.size,
            assignments: this.assignments.size,
            metrics: this.metrics.size,
            banditState: this.banditState.size
        };
    }
}

// ============================================
// EXPORT
// ============================================

module.exports = {
    ExperimentFramework,
    EXPERIMENT_TYPES,
    METRIC_TYPES,
    VARIANT_STATUS,
    experimentFramework: new ExperimentFramework()
};