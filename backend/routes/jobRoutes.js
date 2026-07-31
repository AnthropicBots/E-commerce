// backend/routes/jobRoutes.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { jobQueue, JOB_STATUS, JOB_TYPES } = require('../services/jobQueueService');

/**
 * POST /api/jobs
 * Create a new job
 */
router.post('/', authMiddleware, async (req, res) => {
    try {
        const { type, data, priority, scheduledAt } = req.body;

        if (!type) {
            return res.status(400).json({
                success: false,
                error: 'Job type is required'
            });
        }

        const job = await jobQueue.enqueue(type, data, {
            priority,
            scheduledAt
        });

        res.json({
            success: true,
            data: job
        });
    } catch (error) {
        console.error('Create job error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to create job'
        });
    }
});

/**
 * GET /api/jobs
 * Get all jobs
 */
router.get('/', authMiddleware, async (req, res) => {
    try {
        const { status, type, fromDate, toDate } = req.query;
        const jobs = jobQueue.getAllJobs({ status, type, fromDate, toDate });

        res.json({
            success: true,
            data: jobs,
            count: jobs.length
        });
    } catch (error) {
        console.error('Get jobs error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get jobs'
        });
    }
});

/**
 * GET /api/jobs/:id
 * Get job by ID
 */
router.get('/:id', authMiddleware, async (req, res) => {
    try {
        const job = jobQueue.getJob(req.params.id);

        if (!job) {
            return res.status(404).json({
                success: false,
                error: 'Job not found'
            });
        }

        res.json({
            success: true,
            data: job
        });
    } catch (error) {
        console.error('Get job error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get job'
        });
    }
});

/**
 * DELETE /api/jobs/:id
 * Cancel a job
 */
router.delete('/:id', authMiddleware, async (req, res) => {
    try {
        const job = await jobQueue.cancelJob(req.params.id);

        res.json({
            success: true,
            data: job
        });
    } catch (error) {
        console.error('Cancel job error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to cancel job'
        });
    }
});

/**
 * GET /api/jobs/statistics
 * Get job statistics
 */
router.get('/statistics', authMiddleware, async (req, res) => {
    try {
        const stats = jobQueue.getStatistics();

        res.json({
            success: true,
            data: stats
        });
    } catch (error) {
        console.error('Statistics error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get statistics'
        });
    }
});

/**
 * GET /api/jobs/types
 * Get job types
 */
router.get('/types', authMiddleware, (req, res) => {
    res.json({
        success: true,
        data: JOB_TYPES
    });
});

/**
 * GET /api/jobs/statuses
 * Get job statuses
 */
router.get('/statuses', authMiddleware, (req, res) => {
    res.json({
        success: true,
        data: JOB_STATUS
    });
});

module.exports = router;