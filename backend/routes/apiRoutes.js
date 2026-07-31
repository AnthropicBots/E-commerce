// backend/routes/apiRoutes.js
const express = require('express');
const router = express.Router();
const { apiVersioning, deprecateEndpoint } = require('../middleware/apiVersioningMiddleware');

// Import versioned route handlers
const v1Routes = require('./v1');
const v2Routes = require('./v2');
const v3Routes = require('./v3');

// Apply versioning middleware
router.use('/v1', apiVersioning('v1'), v1Routes);
router.use('/v2', apiVersioning('v2'), v2Routes);
router.use('/v3', apiVersioning('v3'), v3Routes);

// Root API info
router.get('/', (req, res) => {
    res.json({
        success: true,
        data: {
            name: 'E-Commerce API',
            currentVersion: 'v3',
            supportedVersions: ['v1', 'v2', 'v3'],
            deprecatedVersions: [],
            documentation: '/api/docs',
            changelog: '/api/changelog'
        }
    });
});

module.exports = router;