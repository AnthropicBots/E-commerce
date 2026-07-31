// backend/routes/responseExampleRoutes.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const {
    sendSuccess,
    sendError,
    sendCreated,
    sendPaginated,
    sendValidationError,
    sendNotFound,
    sendServerError,
    sendUnauthorized,
    sendForbidden,
    sendTooManyRequests,
    validateBody,
    validateQuery
} = require('../middleware/responseStandardizer');

// ============================================
// SUCCESS RESPONSES
// ============================================

/**
 * GET /api/response-example/success
 * Example success response with data
 */
router.get('/success', (req, res) => {
    sendSuccess(res, {
        id: 1,
        name: 'Example Product',
        price: 99.99,
        category: 'Electronics',
        inStock: true,
        createdAt: new Date().toISOString()
    }, 'Product retrieved successfully');
});

/**
 * GET /api/response-example/success-with-meta
 * Success response with metadata
 */
router.get('/success-with-meta', (req, res) => {
    sendSuccess(res, 
        { id: 1, name: 'Product' },
        'Product retrieved successfully',
        200,
        { 
            source: 'cache',
            cacheDuration: '5m',
            requestId: req.requestId
        }
    );
});

/**
 * GET /api/response-example/empty
 * Success response with no data
 */
router.get('/empty', (req, res) => {
    sendSuccess(res, null, 'Operation completed successfully');
});

// ============================================
// PAGINATED RESPONSES
// ============================================

/**
 * GET /api/response-example/paginated
 * Example paginated response
 */
router.get('/paginated', (req, res) => {
    const data = [
        { id: 1, name: 'Product 1', price: 29.99 },
        { id: 2, name: 'Product 2', price: 49.99 },
        { id: 3, name: 'Product 3', price: 99.99 }
    ];

    sendPaginated(res, data, {
        page: 1,
        limit: 10,
        total: 25,
        pages: 3,
        hasNext: true,
        hasPrevious: false
    }, 'Products retrieved successfully');
});

/**
 * GET /api/response-example/paginated-with-filters
 * Paginated response with filter metadata
 */
router.get('/paginated-with-filters', (req, res) => {
    const data = [
        { id: 1, name: 'Laptop', price: 999.99 },
        { id: 2, name: 'Mouse', price: 29.99 }
    ];

    sendPaginated(res, data, {
        page: 1,
        limit: 20,
        total: 2,
        pages: 1,
        filters: {
            category: 'Electronics',
            minPrice: 10,
            maxPrice: 1000
        }
    }, 'Filtered products retrieved');
});

// ============================================
// CREATED RESPONSES
// ============================================

/**
 * POST /api/response-example/create
 * Example created response
 */
router.post('/create', (req, res) => {
    sendCreated(res, {
        id: 123,
        name: 'New Product',
        price: 49.99,
        category: req.body.category || 'General',
        createdAt: new Date().toISOString()
    }, 'Product created successfully');
});

/**
 * POST /api/response-example/create-bulk
 * Bulk create response
 */
router.post('/create-bulk', (req, res) => {
    sendCreated(res, {
        created: 3,
        ids: [101, 102, 103],
        message: 'Products created successfully'
    }, 'Bulk products created');
});

// ============================================
// ERROR RESPONSES
// ============================================

/**
 * GET /api/response-example/error
 * Example error response
 */
router.get('/error', (req, res) => {
    sendError(res, 'Invalid request parameter', 400, [
        { field: 'id', message: 'ID must be a valid number' },
        { field: 'type', message: 'Type must be one of: product, service' }
    ]);
});

/**
 * GET /api/response-example/validation-error
 * Example validation error
 */
router.get('/validation-error', (req, res) => {
    sendValidationError(res, [
        { field: 'email', message: 'Email is required', code: 'REQUIRED' },
        { field: 'email', message: 'Email format is invalid', code: 'INVALID_FORMAT' },
        { field: 'password', message: 'Password must be at least 6 characters', code: 'MIN_LENGTH' },
        { field: 'age', message: 'Age must be between 18 and 100', code: 'RANGE' }
    ], 'Validation failed');
});

/**
 * GET /api/response-example/not-found
 * Example not found response
 */
router.get('/not-found', (req, res) => {
    sendNotFound(res, 'Product with ID 123 not found');
});

/**
 * GET /api/response-example/unauthorized
 * Example unauthorized response
 */
router.get('/unauthorized', (req, res) => {
    sendUnauthorized(res, 'Authentication required to access this resource');
});

/**
 * GET /api/response-example/forbidden
 * Example forbidden response
 */
router.get('/forbidden', (req, res) => {
    sendForbidden(res, 'You do not have permission to access this resource');
});

/**
 * GET /api/response-example/too-many-requests
 * Example rate limit response
 */
router.get('/too-many-requests', (req, res) => {
    sendTooManyRequests(res, 'Too many requests. Please try again after 60 seconds');
});

/**
 * GET /api/response-example/server-error
 * Example server error
 */
router.get('/server-error', (req, res) => {
    sendServerError(res, 'Database connection failed', [
        { code: 'DB_CONNECTION_ERROR', message: 'Unable to connect to database' },
        { code: 'TIMEOUT', message: 'Query timed out after 30 seconds' }
    ]);
});

/**
 * GET /api/response-example/conflict
 * Example conflict response
 */
router.get('/conflict', (req, res) => {
    const { StandardResponse } = require('../middleware/responseStandardizer');
    StandardResponse.conflict('Product with this SKU already exists', [
        { field: 'sku', message: 'SKU-123 already exists' }
    ]).send(res);
});

// ============================================
// VALIDATION EXAMPLES
// ============================================

/**
 * POST /api/response-example/validate-body
 * Example of body validation
 */
router.post('/validate-body',
    validateBody({
        name: { required: true, type: 'string', min: 2, max: 100 },
        email: { 
            required: true, 
            type: 'string', 
            pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ 
        },
        age: { required: false, type: 'number', min: 18, max: 100 },
        role: { required: false, enum: ['user', 'admin', 'moderator'] },
        termsAccepted: { required: true, type: 'boolean' }
    }),
    (req, res) => {
        sendSuccess(res, {
            validated: true,
            data: req.body
        }, 'Validation passed');
    }
);

/**
 * GET /api/response-example/validate-query
 * Example of query validation
 */
router.get('/validate-query',
    validateQuery({
        page: { required: false, type: 'number', min: 1, max: 100 },
        limit: { required: false, type: 'number', min: 1, max: 50 },
        sort: { required: false, enum: ['asc', 'desc'] },
        category: { required: false, type: 'string' }
    }),
    (req, res) => {
        sendSuccess(res, {
            validated: true,
            query: req.query
        }, 'Query validation passed');
    }
);

// ============================================
// STANDARDIZED RESPONSE EXAMPLES
// ============================================

/**
 * GET /api/response-example/standardized
 * Example of already standardized response
 */
router.get('/standardized', (req, res) => {
    res.json({
        success: true,
        message: 'This is already standardized',
        data: { 
            test: 'data',
            timestamp: new Date().toISOString()
        },
        meta: {
            version: '1.0.0',
            source: 'example'
        }
    });
});

/**
 * GET /api/response-example/unstandardized
 * Example of unstandardized response (will be wrapped by middleware)
 */
router.get('/unstandardized', (req, res) => {
    // This will be automatically wrapped by the middleware
    res.json({
        id: 1,
        name: 'Unstandardized Response',
        price: 29.99,
        status: 'active'
    });
});

/**
 * GET /api/response-example/mixed
 * Mixed response with some standardized fields
 */
router.get('/mixed', (req, res) => {
    res.json({
        success: true,
        data: {
            users: [
                { id: 1, name: 'User 1' },
                { id: 2, name: 'User 2' }
            ]
        },
        // Missing message field - middleware will add it
        timestamp: new Date().toISOString()
    });
});

// ============================================
// REAL-WORLD EXAMPLES
// ============================================

/**
 * GET /api/response-example/order-details
 * Real-world order details response
 */
router.get('/order-details/:orderId', (req, res) => {
    const { orderId } = req.params;

    // Simulate order data
    const order = {
        id: orderId,
        userId: 12345,
        items: [
            { id: 1, name: 'Product A', quantity: 2, price: 29.99 },
            { id: 2, name: 'Product B', quantity: 1, price: 99.99 }
        ],
        subtotal: 159.97,
        tax: 12.80,
        shipping: 5.99,
        total: 178.76,
        status: 'processing',
        createdAt: new Date().toISOString()
    };

    sendSuccess(res, order, 'Order details retrieved successfully');
});

/**
 * POST /api/response-example/order
 * Real-world order creation response
 */
router.post('/order', (req, res) => {
    const { items, shippingAddress } = req.body;

    // Validate required fields
    if (!items || !Array.isArray(items) || items.length === 0) {
        return sendValidationError(res, [
            { field: 'items', message: 'At least one item is required' }
        ]);
    }

    // Simulate order creation
    const order = {
        id: `ORD-${Date.now()}`,
        items,
        shippingAddress,
        total: items.reduce((sum, item) => sum + (item.price * item.quantity), 0),
        status: 'confirmed',
        createdAt: new Date().toISOString()
    };

    sendCreated(res, order, 'Order created successfully');
});

/**
 * GET /api/response-example/dashboard-stats
 * Admin dashboard statistics
 */
router.get('/dashboard-stats', authMiddleware, (req, res) => {
    // Check admin role
    if (req.user?.role !== 'admin') {
        return sendForbidden(res, 'Admin access required');
    }

    const stats = {
        totalUsers: 1542,
        totalOrders: 3289,
        totalRevenue: 456789.50,
        averageOrderValue: 138.87,
        recentOrders: 12,
        topProducts: [
            { id: 1, name: 'Product X', sales: 345 },
            { id: 2, name: 'Product Y', sales: 267 }
        ],
        period: 'last_30_days'
    };

    sendSuccess(res, stats, 'Dashboard statistics retrieved');
});

// ============================================
// STREAMING RESPONSES
// ============================================

/**
 * GET /api/response-example/stream
 * Example of streaming response
 */
router.get('/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    let count = 0;
    const interval = setInterval(() => {
        count++;
        res.write(`data: ${JSON.stringify({ count, timestamp: new Date().toISOString() })}\n\n`);

        if (count >= 5) {
            clearInterval(interval);
            res.end();
        }
    }, 1000);
});

module.exports = router;