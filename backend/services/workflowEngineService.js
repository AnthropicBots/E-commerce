// backend/services/workflowEngineService.js
const db = require('../config/db').promise;
const crypto = require('crypto');
const EventEmitter = require('events');

// ============================================
// WORKFLOW CONFIGURATION
// ============================================

const WORKFLOW_STATUS = {
    PENDING: 'pending',
    RUNNING: 'running',
    WAITING: 'waiting',
    COMPLETED: 'completed',
    FAILED: 'failed',
    CANCELLED: 'cancelled',
    PAUSED: 'paused'
};

const STEP_STATUS = {
    PENDING: 'pending',
    RUNNING: 'running',
    COMPLETED: 'completed',
    FAILED: 'failed',
    SKIPPED: 'skipped',
    RETRY: 'retry'
};

const STEP_TYPES = {
    TASK: 'task',
    CONDITION: 'condition',
    PARALLEL: 'parallel',
    SUB_WORKFLOW: 'sub_workflow',
    DELAY: 'delay'
};

// ============================================
// WORKFLOW ENGINE
// ============================================

class WorkflowEngine extends EventEmitter {
    constructor() {
        super();
        this.workflows = new Map();
        this.activeWorkflows = new Map();
        this.workflowDefinitions = new Map();
        this.executionHistory = [];
        this.pendingTasks = new Map();
        this.retryQueue = [];
        this.isProcessing = false;
        this.workflowTimeouts = new Map();
    }

    /**
     * Register a workflow definition
     */
    registerWorkflow(name, definition) {
        // Validate workflow definition
        this.validateWorkflow(definition);

        this.workflowDefinitions.set(name, definition);
        console.log(`📋 Workflow registered: ${name}`);
        return this;
    }

    /**
     * Start a workflow
     */
    async startWorkflow(workflowName, context = {}) {
        const definition = this.workflowDefinitions.get(workflowName);
        if (!definition) {
            throw new Error(`Workflow not found: ${workflowName}`);
        }

        const workflow = {
            id: this.generateWorkflowId(),
            name: workflowName,
            definition,
            context,
            status: WORKFLOW_STATUS.PENDING,
            currentStep: 0,
            steps: [],
            results: {},
            errors: [],
            startedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            completedAt: null,
            metadata: {
                attempts: 0,
                retries: 0,
                version: definition.version || '1.0.0'
            }
        };

        // Initialize steps
        workflow.steps = definition.steps.map(step => ({
            ...step,
            status: STEP_STATUS.PENDING,
            startedAt: null,
            completedAt: null,
            result: null,
            error: null,
            retries: 0
        }));

        this.workflows.set(workflow.id, workflow);
        this.activeWorkflows.set(workflow.id, workflow);

        await this.storeWorkflow(workflow);

        console.log(`🚀 Workflow started: ${workflowName} (${workflow.id})`);
        this.emit('workflow.started', { workflowId: workflow.id, name: workflowName });

        // Start execution
        this.executeWorkflow(workflow.id);

        return workflow;
    }

    /**
     * Execute a workflow
     */
    async executeWorkflow(workflowId) {
        const workflow = this.workflows.get(workflowId);
        if (!workflow) {
            throw new Error(`Workflow not found: ${workflowId}`);
        }

        if (workflow.status === WORKFLOW_STATUS.COMPLETED || 
            workflow.status === WORKFLOW_STATUS.CANCELLED ||
            workflow.status === WORKFLOW_STATUS.FAILED) {
            return;
        }

        workflow.status = WORKFLOW_STATUS.RUNNING;
        workflow.updatedAt = new Date().toISOString();

        try {
            for (let i = workflow.currentStep; i < workflow.steps.length; i++) {
                const step = workflow.steps[i];
                workflow.currentStep = i;

                // Check if step should be skipped
                if (step.skipIf && step.skipIf(workflow.context, workflow.results)) {
                    step.status = STEP_STATUS.SKIPPED;
                    continue;
                }

                // Execute step
                await this.executeStep(workflow, step);

                // Check if workflow should pause
                if (step.pauseAfter) {
                    workflow.status = WORKFLOW_STATUS.PAUSED;
                    await this.storeWorkflow(workflow);
                    this.emit('workflow.paused', { workflowId, step: i });
                    return;
                }

                // Check if workflow is waiting
                if (step.waitFor) {
                    workflow.status = WORKFLOW_STATUS.WAITING;
                    await this.storeWorkflow(workflow);
                    this.emit('workflow.waiting', { workflowId, step: i, waitFor: step.waitFor });
                    return;
                }
            }

            // All steps completed
            workflow.status = WORKFLOW_STATUS.COMPLETED;
            workflow.completedAt = new Date().toISOString();
            workflow.updatedAt = new Date().toISOString();

            this.emit('workflow.completed', { workflowId, results: workflow.results });

        } catch (error) {
            console.error(`Workflow failed: ${workflowId}`, error);
            workflow.status = WORKFLOW_STATUS.FAILED;
            workflow.errors.push({
                step: workflow.currentStep,
                error: error.message,
                timestamp: new Date().toISOString()
            });
            workflow.updatedAt = new Date().toISOString();

            this.emit('workflow.failed', { workflowId, error: error.message });

            // Handle retry
            if (workflow.metadata.attempts < 3) {
                workflow.metadata.attempts++;
                this.retryQueue.push(workflowId);
                setTimeout(() => this.processRetries(), 5000);
            }
        }

        this.activeWorkflows.delete(workflowId);
        await this.storeWorkflow(workflow);
    }

    /**
     * Execute a single step
     */
    async executeStep(workflow, step) {
        console.log(`⚡ Executing step: ${step.name} (${step.type})`);

        step.status = STEP_STATUS.RUNNING;
        step.startedAt = new Date().toISOString();

        try {
            // Handle different step types
            let result;

            switch (step.type) {
                case STEP_TYPES.TASK:
                    result = await this.executeTask(step, workflow);
                    break;

                case STEP_TYPES.CONDITION:
                    result = await this.executeCondition(step, workflow);
                    break;

                case STEP_TYPES.PARALLEL:
                    result = await this.executeParallel(step, workflow);
                    break;

                case STEP_TYPES.SUB_WORKFLOW:
                    result = await this.executeSubWorkflow(step, workflow);
                    break;

                case STEP_TYPES.DELAY:
                    result = await this.executeDelay(step, workflow);
                    break;

                default:
                    throw new Error(`Unknown step type: ${step.type}`);
            }

            step.status = STEP_STATUS.COMPLETED;
            step.result = result;
            step.completedAt = new Date().toISOString();

            // Store result
            if (step.outputKey) {
                workflow.results[step.outputKey] = result;
            }

            this.emit('step.completed', {
                workflowId: workflow.id,
                step: step.name,
                result
            });

        } catch (error) {
            step.status = STEP_STATUS.FAILED;
            step.error = error.message;
            step.completedAt = new Date().toISOString();

            // Handle retry
            if (step.retries && step.retries > 0 && step.retries < 3) {
                step.retries++;
                step.status = STEP_STATUS.RETRY;
                // Re-add to workflow
                throw new Error(`Step failed, retrying: ${error.message}`);
            }

            throw error;
        }
    }

    /**
     * Execute a task step
     */
    async executeTask(step, workflow) {
        const handler = step.handler;
        if (!handler) {
            throw new Error('No handler for task step');
        }

        // Execute with timeout
        const timeout = step.timeout || 30000;
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error(`Task timeout: ${step.name}`)), timeout);
        });

        return Promise.race([
            handler(workflow.context, workflow.results),
            timeoutPromise
        ]);
    }

    /**
     * Execute a condition step
     */
    async executeCondition(step, workflow) {
        const condition = step.condition;
        if (!condition) {
            throw new Error('No condition for condition step');
        }

        const result = await condition(workflow.context, workflow.results);

        // Determine next step based on condition result
        if (result && step.onTrue) {
            // Skip to onTrue step
            const targetIndex = workflow.steps.findIndex(s => s.id === step.onTrue);
            if (targetIndex > -1) {
                workflow.currentStep = targetIndex - 1;
            }
        } else if (!result && step.onFalse) {
            const targetIndex = workflow.steps.findIndex(s => s.id === step.onFalse);
            if (targetIndex > -1) {
                workflow.currentStep = targetIndex - 1;
            }
        }

        return result;
    }

    /**
     * Execute parallel steps
     */
    async executeParallel(step, workflow) {
        const tasks = step.tasks || [];
        if (tasks.length === 0) {
            return [];
        }

        const results = await Promise.allSettled(
            tasks.map(task => {
                const taskStep = {
                    ...task,
                    type: STEP_TYPES.TASK
                };
                return this.executeTask(taskStep, workflow);
            })
        );

        return results.map(r => ({
            success: r.status === 'fulfilled',
            value: r.status === 'fulfilled' ? r.value : null,
            error: r.status === 'rejected' ? r.reason : null
        }));
    }

    /**
     * Execute sub-workflow
     */
    async executeSubWorkflow(step, workflow) {
        const subWorkflowName = step.workflow;
        if (!subWorkflowName) {
            throw new Error('No sub-workflow specified');
        }

        const subContext = {
            ...workflow.context,
            parentWorkflow: workflow.id,
            parentStep: step.name
        };

        // Start sub-workflow synchronously
        const subWorkflow = await this.startWorkflow(subWorkflowName, subContext);
        
        // Wait for sub-workflow to complete
        return new Promise((resolve, reject) => {
            const checkStatus = setInterval(() => {
                const status = this.getWorkflowStatus(subWorkflow.id);
                if (status === WORKFLOW_STATUS.COMPLETED) {
                    clearInterval(checkStatus);
                    resolve(this.getWorkflowResults(subWorkflow.id));
                } else if (status === WORKFLOW_STATUS.FAILED || status === WORKFLOW_STATUS.CANCELLED) {
                    clearInterval(checkStatus);
                    reject(new Error(`Sub-workflow failed: ${subWorkflow.id}`));
                }
            }, 1000);
        });
    }

    /**
     * Execute delay step
     */
    async executeDelay(step, workflow) {
        const duration = step.duration || 1000;
        await new Promise(resolve => setTimeout(resolve, duration));
        return { delayed: true, duration };
    }

    /**
     * Get workflow status
     */
    getWorkflowStatus(workflowId) {
        const workflow = this.workflows.get(workflowId);
        return workflow ? workflow.status : null;
    }

    /**
     * Get workflow results
     */
    getWorkflowResults(workflowId) {
        const workflow = this.workflows.get(workflowId);
        return workflow ? workflow.results : null;
    }

    /**
     * Pause a workflow
     */
    async pauseWorkflow(workflowId) {
        const workflow = this.workflows.get(workflowId);
        if (!workflow) {
            throw new Error(`Workflow not found: ${workflowId}`);
        }

        if (workflow.status !== WORKFLOW_STATUS.RUNNING) {
            throw new Error(`Cannot pause workflow in status: ${workflow.status}`);
        }

        workflow.status = WORKFLOW_STATUS.PAUSED;
        workflow.updatedAt = new Date().toISOString();

        await this.storeWorkflow(workflow);
        this.emit('workflow.paused', { workflowId });

        return workflow;
    }

    /**
     * Resume a workflow
     */
    async resumeWorkflow(workflowId) {
        const workflow = this.workflows.get(workflowId);
        if (!workflow) {
            throw new Error(`Workflow not found: ${workflowId}`);
        }

        if (workflow.status !== WORKFLOW_STATUS.PAUSED && 
            workflow.status !== WORKFLOW_STATUS.WAITING) {
            throw new Error(`Cannot resume workflow in status: ${workflow.status}`);
        }

        workflow.status = WORKFLOW_STATUS.RUNNING;
        workflow.updatedAt = new Date().toISOString();

        await this.storeWorkflow(workflow);
        this.emit('workflow.resumed', { workflowId });

        // Continue execution
        this.executeWorkflow(workflowId);

        return workflow;
    }

    /**
     * Cancel a workflow
     */
    async cancelWorkflow(workflowId) {
        const workflow = this.workflows.get(workflowId);
        if (!workflow) {
            throw new Error(`Workflow not found: ${workflowId}`);
        }

        if (workflow.status === WORKFLOW_STATUS.COMPLETED) {
            throw new Error('Cannot cancel completed workflow');
        }

        workflow.status = WORKFLOW_STATUS.CANCELLED;
        workflow.updatedAt = new Date().toISOString();

        this.activeWorkflows.delete(workflowId);
        await this.storeWorkflow(workflow);

        this.emit('workflow.cancelled', { workflowId });

        return workflow;
    }

    /**
     * Process retries
     */
    async processRetries() {
        if (this.isProcessing) return;
        this.isProcessing = true;

        while (this.retryQueue.length > 0) {
            const workflowId = this.retryQueue.shift();
            const workflow = this.workflows.get(workflowId);
            
            if (workflow && workflow.status === WORKFLOW_STATUS.FAILED) {
                await this.executeWorkflow(workflowId);
            }
        }

        this.isProcessing = false;
    }

    /**
     * Validate workflow definition
     */
    validateWorkflow(definition) {
        if (!definition.name) {
            throw new Error('Workflow definition must have a name');
        }

        if (!definition.steps || definition.steps.length === 0) {
            throw new Error('Workflow must have at least one step');
        }

        for (const step of definition.steps) {
            if (!step.name) {
                throw new Error('Each step must have a name');
            }
            if (!step.type || !Object.values(STEP_TYPES).includes(step.type)) {
                throw new Error(`Invalid step type: ${step.type}`);
            }
        }
    }

    // ============================================
    // HELPER FUNCTIONS
    // ============================================

    generateWorkflowId() {
        return `WF_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    }

    // ============================================
    // DATABASE OPERATIONS
    // ============================================

    async storeWorkflow(workflow) {
        try {
            await db.query(
                `INSERT INTO workflows 
                 (workflow_id, name, definition, context, status, current_step,
                  steps, results, errors, started_at, updated_at, completed_at, metadata)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE
                 status = VALUES(status), current_step = VALUES(current_step),
                 steps = VALUES(steps), results = VALUES(results),
                 errors = VALUES(errors), updated_at = VALUES(updated_at),
                 completed_at = VALUES(completed_at)`,
                [
                    workflow.id,
                    workflow.name,
                    JSON.stringify(workflow.definition),
                    JSON.stringify(workflow.context),
                    workflow.status,
                    workflow.currentStep,
                    JSON.stringify(workflow.steps),
                    JSON.stringify(workflow.results),
                    JSON.stringify(workflow.errors),
                    workflow.startedAt,
                    workflow.updatedAt,
                    workflow.completedAt || null,
                    JSON.stringify(workflow.metadata)
                ]
            );
        } catch (error) {
            console.error('Store workflow error:', error);
        }
    }

    // ============================================
    // STATISTICS
    // ============================================

    async getStatistics() {
        const workflows = Array.from(this.workflows.values());

        return {
            totalWorkflows: workflows.length,
            byStatus: workflows.reduce((acc, w) => {
                acc[w.status] = (acc[w.status] || 0) + 1;
                return acc;
            }, {}),
            activeWorkflows: workflows.filter(w => w.status === 'running').length,
            completedWorkflows: workflows.filter(w => w.status === 'completed').length,
            failedWorkflows: workflows.filter(w => w.status === 'failed').length,
            pendingRetries: this.retryQueue.length,
            timestamp: new Date().toISOString()
        };
    }

    getStatus() {
        return {
            activeWorkflows: this.activeWorkflows.size,
            definitions: this.workflowDefinitions.size,
            retryQueue: this.retryQueue.length,
            statuses: Object.values(WORKFLOW_STATUS),
            stepTypes: Object.values(STEP_TYPES)
        };
    }
}

// ============================================
// CHECKOUT WORKFLOW DEFINITION
// ============================================

const checkoutWorkflow = {
    name: 'checkout',
    version: '1.0.0',
    steps: [
        {
            id: 'step1',
            name: 'Validate Cart',
            type: STEP_TYPES.TASK,
            timeout: 10000,
            handler: async (context) => {
                if (!context.items || context.items.length === 0) {
                    throw new Error('Cart is empty');
                }
                return { valid: true, items: context.items };
            },
            outputKey: 'cartValidation'
        },
        {
            id: 'step2',
            name: 'Check Inventory',
            type: STEP_TYPES.TASK,
            timeout: 15000,
            handler: async (context, results) => {
                // Check if all items are in stock
                const items = results.cartValidation?.items || context.items;
                // Simulate inventory check
                return { available: true, items };
            },
            outputKey: 'inventoryCheck'
        },
        {
            id: 'step3',
            name: 'Process Payment',
            type: STEP_TYPES.TASK,
            timeout: 30000,
            handler: async (context, results) => {
                // Process payment
                const payment = {
                    id: `pay_${Date.now()}`,
                    amount: context.total,
                    status: 'completed'
                };
                return payment;
            },
            outputKey: 'payment',
            retries: 2
        },
        {
            id: 'step4',
            name: 'Create Order',
            type: STEP_TYPES.TASK,
            timeout: 15000,
            handler: async (context, results) => {
                const order = {
                    id: `ord_${Date.now()}`,
                    userId: context.userId,
                    items: context.items,
                    total: context.total,
                    paymentId: results.payment.id,
                    status: 'confirmed'
                };
                return order;
            },
            outputKey: 'order'
        },
        {
            id: 'step5',
            name: 'Send Confirmation',
            type: STEP_TYPES.TASK,
            timeout: 10000,
            handler: async (context, results) => {
                // Send confirmation email
                return { sent: true, userId: context.userId };
            },
            outputKey: 'notification'
        }
    ]
};

// ============================================
// EXPORT
// ============================================

module.exports = {
    WorkflowEngine,
    WORKFLOW_STATUS,
    STEP_STATUS,
    STEP_TYPES,
    checkoutWorkflow,
    workflowEngine: new WorkflowEngine()
};