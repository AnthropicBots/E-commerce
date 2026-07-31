// backend/routes/aiProtectedRoutes.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { promptInjectionGuard } = require('../services/promptInjectionDetector');

// Apply both middlewares
router.use(authMiddleware);
router.use(promptInjectionGuard);

// Your protected AI routes here
router.post('/chat', async (req, res) => {
    return res.status(501).json({
        success: false,
        message: 'AI protected chat endpoint is not implemented yet'
    });
});

module.exports = router;