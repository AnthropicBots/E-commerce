// backend/services/jobQueueService.js
const EventEmitter = require('events');
const db = require('../config/db').promise;
const crypto = require('crypto');

// ============================================
// JOB QUEUE CONFIGURATION
// ============================================

const JOB_STATUS = {
    PENDING: 'pending',
    PROCESSING: 'processing',
    COMPLETED: 'completed',
    FAILED: 'failed',
    RETRY: 'retry',
    CANCELLED: 'cancelled'
};

const JOB_PRIORITY = {
    HIGH: 1,
    MEDIUM: 2,
    LOW: 3
};

const JOB_TYPES = {
    RECOMMENDATION_REFRESH: 'recommendation_refresh',
    EMAIL_NOTIFICATIONS: 'email_notifications',
    ANALYTICS_PROCESSING: 'analytics_processing',
    CART_CLEANUP: 'cart_cleanup',
    INVENTORY_SYNC: 'inventory_sync',
    SCHEDULED_MAINTENANCE: 'scheduled_maintenance',
    ORDER_PROCESSING: 'order_processing',
    REPORT_GENERATION: 'report_generation',
    DATA_EXPORT: 'data_export',
    CLEANUP_TASKS: 'cleanup_tasks'
};

const DEFAULT_CONFIG = {
    maxConcurrentJobs: 5,
    retryAttempts: 3,
    retryDelay: 5000,
    jobTimeout: 300000, // 5 minutes
    cleanupInterval: 3600000 // 1 hour
};

// ============================================
// JOB QUEUE CLASS
// ============================================

class JobQueue extends EventEmitter {
    constructor(config = {}) {
        super();
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.jobs = new Map();
        this.activeJobs = new Map();
        this.jobHandlers = new Map();
        this.isProcessing = false;
        this.processingQueue = [];
        this.initialized = false;
        this.cleanupInterval = null;
    }

    /**
     * Initialize job queue
     */
    async initialize() {
        if (this.initialized) return;

        // Load pending jobs from database
        await this.loadPendingJobs();

        // Start processing
        this.startProcessing();

        // Start cleanup
        this.startCleanup();

        this.initialized = true;
        console.log('✅ Job Queue initialized');
        this.emit('initialized');

        return this;
    }

    /**
     * Register a job handler
     */
    registerHandler(jobType, handler) {
        if (this.jobHandlers.has(jobType)) {
            throw new Error(`Handler already registered for: ${jobType}`);
        }

        this.jobHandlers.set(jobType, handler);
        console.log(`✅ Handler registered for: ${jobType}`);
        return this;
    }

    /**
     * Enqueue a new job
     */
    async enqueue(jobType, data, options = {}) {
        const job = {
            id: this.generateJobId(),
            type: jobType,
            data,
            priority: options.priority || JOB_PRIORITY.MEDIUM,
            status: JOB_STATUS.PENDING,
            attempts: 0,
            maxAttempts: options.maxAttempts || this.config.retryAttempts,
            createdAt: new Date().toISOString(),
            scheduledAt: options.scheduledAt || new Date().toISOString(),
            timeout: options.timeout || this.config.jobTimeout,
            metadata: options.metadata || {}
        };

        // Validate job type
        if (!this.jobHandlers.has(jobType)) {
            throw new Error(`No handler registered for job type: ${jobType}`);
        }

        this.jobs.set(job.id, job);
        await this.storeJob(job);

        // Add to processing queue
        this.processingQueue.push(job.id);

        console.log(`📦 Job enqueued: ${jobType} (${job.id})`);
        this.emit('job_enqueued', job);

        return job;
    }

    /**
     * Schedule a job for later
     */
    async schedule(jobType, data, scheduledAt, options = {}) {
        return this.enqueue(jobType, data, {
            ...options,
            scheduledAt
        });
    }

    /**
     * Start processing jobs
     */
    startProcessing() {
        if (this.isProcessing) return;

        this.isProcessing = true;
        this.processJobs();

        console.log('🔄 Job processing started');
    }

    /**
     * Stop processing jobs
     */
    stopProcessing() {
        this.isProcessing = false;
        console.log('⏹️ Job processing stopped');
    }

    /**
     * Process jobs
     */
    async processJobs() {
        if (!this.isProcessing) return;

        // Check if we can process more jobs
        if (this.activeJobs.size >= this.config.maxConcurrentJobs) {
            setTimeout(() => this.processJobs(), 1000);
            return;
        }

        // Get next job
        const jobId = this.getNextJob();
        if (!jobId) {
            setTimeout(() => this.processJobs(), 1000);
            return;
        }

        const job = this.jobs.get(jobId);
        if (!job) {
            setTimeout(() => this.processJobs(), 1000);
            return;
        }

        // Check if job is scheduled for later
        if (new Date(job.scheduledAt) > new Date()) {
            setTimeout(() => this.processJobs(), 1000);
            return;
        }

        // Process job
        await this.processJob(jobId);

        // Continue processing
        setTimeout(() => this.processJobs(), 100);
    }

    /**
     * Process a single job
     */
    async processJob(jobId) {
        const job = this.jobs.get(jobId);
        if (!job) return;

        // Update job status
        job.status = JOB_STATUS.PROCESSING;
        job.attempts++;
        job.startedAt = new Date().toISOString();

        this.activeJobs.set(jobId, job);
        await this.updateJob(job);

        console.log(`🔄 Processing job: ${job.type} (${jobId})`);

        try {
            const handler = this.jobHandlers.get(job.type);
            if (!handler) {
                throw new Error(`No handler for job type: ${job.type}`);
            }

            // Execute job with timeout
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Job timeout')), job.timeout);
            });

            const result = await Promise.race([
                handler(job.data, job),
                timeoutPromise
            ]);

            // Job completed successfully
            job.status = JOB_STATUS.COMPLETED;
            job.completedAt = new Date().toISOString();
            job.result = result;

            console.log(`✅ Job completed: ${job.type} (${jobId})`);
            this.emit('job_completed', { jobId, result });

        } catch (error) {
            console.error(`❌ Job failed: ${job.type} (${jobId})`, error);

            // Check if we should retry
            if (job.attempts < job.maxAttempts) {
                job.status = JOB_STATUS.RETRY;
                job.error = error.message;
                job.nextRetryAt = new Date(Date.now() + this.config.retryDelay * job.attempts);

                console.log(`🔄 Job will retry: ${job.type} (${jobId}) attempt ${job.attempts + 1}/${job.maxAttempts}`);
                this.emit('job_retry', { jobId, attempt: job.attempts, error: error.message });
            } else {
                job.status = JOB_STATUS.FAILED;
                job.error = error.message;

                console.error(`💀 Job failed permanently: ${job.type} (${jobId})`);
                this.emit('job_failed', { jobId, error: error.message });
            }
        } finally {
            // Remove from active jobs
            this.activeJobs.delete(jobId);

            // Update job in database
            await this.updateJob(job);

            // If job is retry, re-add to queue
            if (job.status === JOB_STATUS.RETRY) {
                // Re-add to processing queue
                this.processingQueue.push(jobId);

                // Store in database
                await this.storeJob(job);
            }

            // Update processing status
            this.emit('job_processed', { jobId, status: job.status });
        }
    }

    /**
     * Get next job from queue
     */
    getNextJob() {
        // Sort by priority and creation time
        const queue = this.processingQueue
            .map(id => this.jobs.get(id))
            .filter(job => job && job.status === JOB_STATUS.PENDING || job.status === JOB_STATUS.RETRY)
            .filter(job => new Date(job.scheduledAt) <= new Date())
            .sort((a, b) => {
                // Higher priority first
                if (a.priority !== b.priority) {
                    return a.priority - b.priority;
                }
                // Older jobs first
                return new Date(a.createdAt) - new Date(b.createdAt);
            });

        if (queue.length === 0) return null;

        const job = queue[0];
        const index = this.processingQueue.indexOf(job.id);
        if (index > -1) {
            this.processingQueue.splice(index, 1);
        }

        return job.id;
    }

    /**
     * Cancel a job
     */
    async cancelJob(jobId) {
        const job = this.jobs.get(jobId);
        if (!job) {
            throw new Error(`Job not found: ${jobId}`);
        }

        if (job.status === JOB_STATUS.COMPLETED || job.status === JOB_STATUS.FAILED) {
            throw new Error(`Cannot cancel job with status: ${job.status}`);
        }

        job.status = JOB_STATUS.CANCELLED;
        job.cancelledAt = new Date().toISOString();

        await this.updateJob(job);

        // Remove from processing queue
        const index = this.processingQueue.indexOf(jobId);
        if (index > -1) {
            this.processingQueue.splice(index, 1);
        }

        console.log(`⏹️ Job cancelled: ${job.type} (${jobId})`);
        this.emit('job_cancelled', { jobId });

        return job;
    }

    /**
     * Get job by ID
     */
    getJob(jobId) {
        return this.jobs.get(jobId) || null;
    }

    /**
     * Get jobs by status
     */
    getJobsByStatus(status) {
        return Array.from(this.jobs.values())
            .filter(job => job.status === status);
    }

    /**
     * Get jobs by type
     */
    getJobsByType(type) {
        return Array.from(this.jobs.values())
            .filter(job => job.type === type);
    }

    /**
     * Get all jobs
     */
    getAllJobs(filters = {}) {
        let jobs = Array.from(this.jobs.values());

        if (filters.status) {
            jobs = jobs.filter(j => j.status === filters.status);
        }

        if (filters.type) {
            jobs = jobs.filter(j => j.type === filters.type);
        }

        if (filters.fromDate) {
            jobs = jobs.filter(j => new Date(j.createdAt) >= new Date(filters.fromDate));
        }

        if (filters.toDate) {
            jobs = jobs.filter(j => new Date(j.createdAt) <= new Date(filters.toDate));
        }

        return jobs;
    }

    /**
     * Get job statistics
     */
    getStatistics() {
        const total = this.jobs.size;
        const active = this.activeJobs.size;
        const pending = this.getJobsByStatus(JOB_STATUS.PENDING).length;
        const completed = this.getJobsByStatus(JOB_STATUS.COMPLETED).length;
        const failed = this.getJobsByStatus(JOB_STATUS.FAILED).length;

        return {
            total,
            active,
            pending,
            completed,
            failed,
            queueLength: this.processingQueue.length,
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Start cleanup
     */
    startCleanup() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
        }

        this.cleanupInterval = setInterval(() => {
            this.cleanup();
        }, this.config.cleanupInterval);
    }

    /**
     * Cleanup old jobs
     */
    async cleanup() {
        try {
            // Remove completed/failed jobs older than 7 days
            const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

            for (const [id, job] of this.jobs) {
                if ((job.status === JOB_STATUS.COMPLETED || job.status === JOB_STATUS.FAILED) &&
                    new Date(job.createdAt) < cutoff) {
                    this.jobs.delete(id);
                    await this.deleteJob(id);
                }
            }

            console.log(`🧹 Cleaned up old jobs`);
        } catch (error) {
            console.error('Cleanup error:', error);
        }
    }

    // ============================================
    // GENERATE IDS
    // ============================================

    generateJobId() {
        return `JOB_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
    }

    // ============================================
    // DATABASE OPERATIONS
    // ============================================

    async loadPendingJobs() {
        try {
            const [jobs] = await db.query(
                `SELECT * FROM jobs 
                 WHERE status IN ('pending', 'retry', 'processing')
                 ORDER BY priority ASC, created_at ASC`
            );

            for (const row of jobs) {
                const job = {
                    id: row.job_id,
                    type: row.type,
                    data: JSON.parse(row.data),
                    priority: row.priority,
                    status: row.status,
                    attempts: row.attempts,
                    maxAttempts: row.max_attempts,
                    createdAt: row.created_at,
                    scheduledAt: row.scheduled_at,
                    startedAt: row.started_at,
                    completedAt: row.completed_at,
                    error: row.error,
                    result: row.result ? JSON.parse(row.result) : null,
                    timeout: row.timeout,
                    metadata: row.metadata ? JSON.parse(row.metadata) : {}
                };

                this.jobs.set(job.id, job);
                this.processingQueue.push(job.id);
            }

            console.log(`📦 Loaded ${jobs.length} pending jobs from database`);
        } catch (error) {
            console.error('Load pending jobs error:', error);
        }
    }

    async storeJob(job) {
        try {
            await db.query(
                `INSERT INTO jobs 
                 (job_id, type, data, priority, status, attempts, max_attempts,
                  created_at, scheduled_at, started_at, completed_at, error, result,
                  timeout, metadata)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE
                 status = VALUES(status), attempts = VALUES(attempts),
                 started_at = VALUES(started_at), completed_at = VALUES(completed_at),
                 error = VALUES(error), result = VALUES(result)`,
                [
                    job.id,
                    job.type,
                    JSON.stringify(job.data),
                    job.priority,
                    job.status,
                    job.attempts,
                    job.maxAttempts,
                    job.createdAt,
                    job.scheduledAt,
                    job.startedAt || null,
                    job.completedAt || null,
                    job.error || null,
                    job.result ? JSON.stringify(job.result) : null,
                    job.timeout,
                    JSON.stringify(job.metadata)
                ]
            );
        } catch (error) {
            console.error('Store job error:', error);
        }
    }

    async updateJob(job) {
        await this.storeJob(job);
    }

    async deleteJob(jobId) {
        try {
            await db.query(
                'DELETE FROM jobs WHERE job_id = ?',
                [jobId]
            );
        } catch (error) {
            console.error('Delete job error:', error);
        }
    }
}

// ============================================
// JOB HANDLERS
// ============================================

// Example job handlers
const jobHandlers = {
    [JOB_TYPES.RECOMMENDATION_REFRESH]: async (data) => {
        console.log('🔄 Refreshing recommendations for user:', data.userId);
        // Simulate processing
        await new Promise(resolve => setTimeout(resolve, 2000));
        return { refreshed: true, userId: data.userId };
    },

    [JOB_TYPES.EMAIL_NOTIFICATIONS]: async (data) => {
        console.log('📧 Sending email to:', data.email);
        await new Promise(resolve => setTimeout(resolve, 1000));
        return { sent: true, email: data.email };
    },

    [JOB_TYPES.ANALYTICS_PROCESSING]: async (data) => {
        console.log('📊 Processing analytics for:', data.date);
        await new Promise(resolve => setTimeout(resolve, 3000));
        return { processed: true, date: data.date };
    },

    [JOB_TYPES.CART_CLEANUP]: async (data) => {
        console.log('🧹 Cleaning up abandoned carts');
        await new Promise(resolve => setTimeout(resolve, 2000));
        return { cleaned: true, count: data.count || 0 };
    },

    [JOB_TYPES.INVENTORY_SYNC]: async (data) => {
        console.log('📦 Syncing inventory for:', data.productId);
        await new Promise(resolve => setTimeout(resolve, 1500));
        return { synced: true, productId: data.productId };
    },

    [JOB_TYPES.SCHEDULED_MAINTENANCE]: async (data) => {
        console.log('🔧 Performing maintenance:', data.task);
        await new Promise(resolve => setTimeout(resolve, 5000));
        return { maintained: true, task: data.task };
    },

    [JOB_TYPES.ORDER_PROCESSING]: async (data) => {
        console.log('📦 Processing order:', data.orderId);
        await new Promise(resolve => setTimeout(resolve, 2000));
        return { processed: true, orderId: data.orderId };
    },

    [JOB_TYPES.REPORT_GENERATION]: async (data) => {
        console.log('📊 Generating report:', data.reportType);
        await new Promise(resolve => setTimeout(resolve, 3000));
        return { generated: true, reportType: data.reportType };
    },

    [JOB_TYPES.DATA_EXPORT]: async (data) => {
        console.log('📤 Exporting data:', data.exportType);
        await new Promise(resolve => setTimeout(resolve, 4000));
        return { exported: true, exportType: data.exportType };
    },

    [JOB_TYPES.CLEANUP_TASKS]: async (data) => {
        console.log('🧹 Running cleanup tasks');
        await new Promise(resolve => setTimeout(resolve, 2000));
        return { cleaned: true };
    }
};

// ============================================
// EXPORT
// ============================================

module.exports = {
    JobQueue,
    JOB_STATUS,
    JOB_PRIORITY,
    JOB_TYPES,
    jobHandlers,
    jobQueue: new JobQueue()
};