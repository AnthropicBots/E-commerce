// backend/services/sagaOrchestratorService.js
const db = require('../config/db').promise;
const crypto = require('crypto');
const EventEmitter = require('events');

// ============================================
// SAGA CONFIGURATION
// ============================================

const SAGA_STATUS = {
    INITIATED: 'initiated',
    RUNNING: 'running',
    COMPLETED: 'completed',
    FAILED: 'failed',
    COMPENSATING: 'compensating',
    COMPENSATED: 'compensated',
    PARTIAL: 'partial'
};

const STEP_STATUS = {
    PENDING: 'pending',
    RUNNING: 'running',
    COMPLETED: 'completed',
    FAILED: 'failed',
    COMPENSATED: 'compensated',
    SKIPPED: 'skipped'
};

// ============================================
// SAGA ORCHESTRATOR
// ============================================

class SagaOrchestrator extends EventEmitter {
    constructor() {
        super();
        this.sagas = new Map();
        this.activeSagas = new Map();
        this.sagaHistory = [];
        this.compensationQueue = [];
        this.isProcessingCompensations = false;
    }

    /**
     * Create a new saga
     */
    async createSaga(workflow, context = {}) {
        const saga = {
            id: this.generateSagaId(),
            workflow: workflow.name || 'checkout',
            steps: workflow.steps || [],
            context,
            status: SAGA_STATUS.INITIATED,
            currentStep: 0,
            results: {},
            errors: [],
            compensations: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            completedAt: null
        };

        // Validate workflow
        this.validateWorkflow(saga);

        this.sagas.set(saga.id, saga);
        this.activeSagas.set(saga.id, saga);

        await this.storeSaga(saga);

        console.log(`🔄 Saga created: ${saga.id}`);
        this.emit('saga.created', saga);

        return saga;
    }

    /**
     * Execute a saga
     */
    async executeSaga(sagaId) {
        const saga = this.sagas.get(sagaId);
        if (!saga) {
            throw new Error(`Saga not found: ${sagaId}`);
        }

        if (saga.status === SAGA_STATUS.COMPLETED) {
            return saga;
        }

        saga.status = SAGA_STATUS.RUNNING;
        saga.updatedAt = new Date().toISOString();

        try {
            for (let i = saga.currentStep; i < saga.steps.length; i++) {
                const step = saga.steps[i];
                saga.currentStep = i;

                try {
                    const result = await this.executeStep(saga, step);
                    saga.results[step.name] = result;
                    this.emit('step.completed', { sagaId, step: step.name, result });

                    // Store progress
                    await this.updateSagaProgress(saga);

                } catch (error) {
                    saga.errors.push({
                        step: step.name,
                        error: error.message,
                        timestamp: new Date().toISOString()
                    });

                    this.emit('step.failed', { sagaId, step: step.name, error: error.message });

                    // Start compensation
                    await this.compensateSaga(saga, i);
                    throw error;
                }
            }

            // All steps completed
            saga.status = SAGA_STATUS.COMPLETED;
            saga.completedAt = new Date().toISOString();
            saga.updatedAt = new Date().toISOString();

            this.emit('saga.completed', { sagaId, results: saga.results });

        } catch (error) {
            console.error(`Saga execution failed: ${sagaId}`, error);
            saga.status = SAGA_STATUS.FAILED;
            saga.updatedAt = new Date().toISOString();
            this.emit('saga.failed', { sagaId, error: error.message });
        }

        // Clean up
        this.activeSagas.delete(sagaId);
        await this.storeSaga(saga);

        return saga;
    }

    /**
     * Execute a single step
     */
    async executeStep(saga, step) {
        console.log(`⚡ Executing step: ${step.name}`);

        // Check if step should be skipped
        if (step.skipIf && step.skipIf(saga.context)) {
            console.log(`⏭️ Step skipped: ${step.name}`);
            return { skipped: true };
        }

        // Execute step with timeout and AbortController
        const timeout = step.timeout || 30000;
        const controller = new AbortController();
        const signal = controller.signal;
        
        let timeoutId;
        const timeoutPromise = new Promise((_, reject) => {
            timeoutId = setTimeout(() => {
                controller.abort();
                reject(new Error(`Step timeout: ${step.name}`));
            }, timeout);
        });

        // Get step handler
        const handler = step.handler;
        if (!handler) {
            throw new Error(`No handler for step: ${step.name}`);
        }

        // Execute step
        let result;
        try {
            result = await Promise.race([
                handler(saga.context, saga.results, signal),
                timeoutPromise
            ]);
        } finally {
            clearTimeout(timeoutId);
        }

        // Store compensation if available
        if (step.compensation) {
            saga.compensations.push({
                step: step.name,
                handler: step.compensation,
                data: result,
                executed: false
            });
        }

        return result;
    }

    /**
     * Compensate a saga (rollback)
     */
    async compensateSaga(saga, failedStepIndex) {
        console.log(`🔄 Compensating saga: ${saga.id}`);

        saga.status = SAGA_STATUS.COMPENSATING;
        saga.updatedAt = new Date().toISOString();

        // Execute compensations in reverse order
        const compensationSteps = saga.compensations.reverse();

        for (const compensation of compensationSteps) {
            try {
                console.log(`🔄 Executing compensation for: ${compensation.step}`);
                await compensation.handler(saga.context, compensation.data);
                compensation.executed = true;

                this.emit('compensation.executed', {
                    sagaId: saga.id,
                    step: compensation.step
                });

            } catch (error) {
                console.error(`Compensation failed for step: ${compensation.step}`, error);
                // Log compensation failure but continue
                this.emit('compensation.failed', {
                    sagaId: saga.id,
                    step: compensation.step,
                    error: error.message
                });
            }
        }

        saga.status = SAGA_STATUS.COMPENSATED;
        saga.updatedAt = new Date().toISOString();

        this.emit('saga.compensated', { sagaId: saga.id });

        await this.storeSaga(saga);
    }

    /**
     * Get saga status
     */
    getSagaStatus(sagaId) {
        const saga = this.sagas.get(sagaId);
        if (!saga) return null;

        return {
            id: saga.id,
            status: saga.status,
            workflow: saga.workflow,
            currentStep: saga.currentStep,
            totalSteps: saga.steps.length,
            progress: (saga.currentStep / saga.steps.length) * 100,
            createdAt: saga.createdAt,
            updatedAt: saga.updatedAt,
            completedAt: saga.completedAt,
            errors: saga.errors
        };
    }

    /**
     * Get saga results
     */
    getSagaResults(sagaId) {
        const saga = this.sagas.get(sagaId);
        if (!saga) return null;

        return {
            id: saga.id,
            results: saga.results,
            errors: saga.errors,
            status: saga.status,
            compensations: saga.compensations.filter(c => c.executed)
        };
    }

    /**
     * Validate workflow
     */
    validateWorkflow(saga) {
        if (!saga.steps || saga.steps.length === 0) {
            throw new Error('Workflow must have at least one step');
        }

        for (const step of saga.steps) {
            if (!step.name) {
                throw new Error('Step must have a name');
            }
            if (!step.handler) {
                throw new Error(`Step ${step.name} must have a handler`);
            }
            if (typeof step.handler !== 'function') {
                throw new Error(`Step ${step.name} handler must be a function`);
            }
        }
    }

    /**
     * Get saga statistics
     */
    async getStatistics() {
        try {
            const [stats] = await db.query(
                `SELECT 
                    COUNT(*) as total_sagas,
                    SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
                    SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
                    SUM(CASE WHEN status = 'compensated' THEN 1 ELSE 0 END) as compensated,
                    AVG(JSON_LENGTH(steps)) as avg_steps
                 FROM sagas
                 WHERE created_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)`
            );

            return {
                ...stats[0],
                activeSagas: this.activeSagas.size,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            console.error('Statistics error:', error);
            return null;
        }
    }

    // ============================================
    // HELPER FUNCTIONS
    // ============================================

    generateSagaId() {
        return `SAGA_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    }

    // ============================================
    // DATABASE OPERATIONS
    // ============================================

    async storeSaga(saga) {
        try {
            await db.query(
                `INSERT INTO sagas 
                 (saga_id, workflow, steps, context, status, current_step,
                  results, errors, compensations, created_at, updated_at, completed_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE
                 status = VALUES(status), current_step = VALUES(current_step),
                 results = VALUES(results), errors = VALUES(errors),
                 compensations = VALUES(compensations), updated_at = VALUES(updated_at),
                 completed_at = VALUES(completed_at)`,
                [
                    saga.id,
                    saga.workflow,
                    JSON.stringify(saga.steps.map(s => ({ name: s.name }))),
                    JSON.stringify(saga.context),
                    saga.status,
                    saga.currentStep,
                    JSON.stringify(saga.results),
                    JSON.stringify(saga.errors),
                    JSON.stringify(saga.compensations),
                    saga.createdAt,
                    saga.updatedAt,
                    saga.completedAt || null
                ]
            );
        } catch (error) {
            console.error('Store saga error:', error);
        }
    }

    async updateSagaProgress(saga) {
        await this.storeSaga(saga);
    }
}

// ============================================
// CHECKOUT SAGA WORKFLOW
// ============================================

/**
 * Create checkout saga workflow
 */
function createCheckoutWorkflow() {
    return {
        name: 'checkout',
        steps: [
            {
                name: 'reserve_inventory',
                skipIf: (context) => !context.items || context.items.length === 0,
                timeout: 10000,
                handler: async (context) => {
                    console.log('📦 Reserving inventory...');
                    // Simulate inventory reservation
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    return { reserved: true, items: context.items };
                },
                compensation: async (context, data) => {
                    console.log('↩️ Releasing inventory...');
                    // Simulate inventory release
                    await new Promise(resolve => setTimeout(resolve, 500));
                    return { released: true };
                }
            },
            {
                name: 'create_order',
                timeout: 15000,
                handler: async (context, results) => {
                    console.log('📝 Creating order...');
                    const order = {
                        id: `ORD_${Date.now()}`,
                        userId: context.userId,
                        items: context.items,
                        total: context.total,
                        status: 'pending'
                    };
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    return order;
                },
                compensation: async (context, data) => {
                    console.log(`↩️ Cancelling order: ${data.id}`);
                    await new Promise(resolve => setTimeout(resolve, 500));
                    return { cancelled: true };
                }
            },
            {
                name: 'process_payment',
                timeout: 20000,
                handler: async (context, results) => {
                    console.log('💳 Processing payment...');
                    const payment = {
                        id: `PAY_${Date.now()}`,
                        orderId: results.create_order.id,
                        amount: context.total,
                        status: 'completed'
                    };
                    await new Promise(resolve => setTimeout(resolve, 1500));
                    return payment;
                },
                compensation: async (context, data) => {
                    console.log(`↩️ Refunding payment: ${data.id}`);
                    await new Promise(resolve => setTimeout(resolve, 500));
                    return { refunded: true };
                }
            },
            {
                name: 'send_notification',
                timeout: 10000,
                handler: async (context, results) => {
                    console.log('📧 Sending notification...');
                    await new Promise(resolve => setTimeout(resolve, 500));
                    return { sent: true, type: 'order_confirmation' };
                }
            },
            {
                name: 'update_analytics',
                timeout: 10000,
                handler: async (context, results) => {
                    console.log('📊 Updating analytics...');
                    await new Promise(resolve => setTimeout(resolve, 500));
                    return { updated: true };
                }
            },
            {
                name: 'generate_recommendations',
                timeout: 15000,
                handler: async (context, results) => {
                    console.log('🎯 Generating recommendations...');
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    return { generated: true };
                }
            }
        ]
    };
}

// ============================================
// EXPORT
// ============================================

module.exports = {
    SagaOrchestrator,
    SAGA_STATUS,
    STEP_STATUS,
    createCheckoutWorkflow,
    sagaOrchestrator: new SagaOrchestrator()
};