// backend/middleware/mcpSecurity.js

// ============================================
// CONFIGURATION
// ============================================

const ALLOWED_MODULES = [
    'productService',
    'orderService',
    'inventoryService',
    'userService',
    'cartService'
];

const ALLOWED_FUNCTIONS = {
    productService: ['getProduct', 'listProducts', 'searchProducts', 'getProductById'],
    orderService: ['getOrder', 'listOrders', 'getOrderStatus'],
    inventoryService: ['checkStock', 'getInventory', 'updateStock'],
    userService: ['getUser', 'getUserProfile'],
    cartService: ['getCart', 'addToCart', 'removeFromCart']
};

// Security Limits
const MAX_ARG_DEPTH = 3;
const MAX_ARG_LENGTH = 1000;
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const RATE_LIMIT_MAX = 10; // 10 requests per minute

// In-memory rate limiter
const rateLimiter = new Map();

// Periodic garbage collection to prevent memory leaks (OOM/DoS)
const cleanupInterval = setInterval(() => {
    const windowStart = Date.now() - RATE_LIMIT_WINDOW;
    for (const [ip, requests] of rateLimiter.entries()) {
        const recentRequests = requests.filter(time => time > windowStart);
        if (recentRequests.length === 0) {
            rateLimiter.delete(ip);
        } else {
            rateLimiter.set(ip, recentRequests);
        }
    }
}, RATE_LIMIT_WINDOW);
cleanupInterval.unref();

// ============================================
// VALIDATION FUNCTIONS
// ============================================

/**
 * Validate function arguments recursively
 */
function validateArguments(args, depth = 0, path = '') {
    if (depth > MAX_ARG_DEPTH) {
        throw new Error(`Argument depth exceeded at ${path}`);
    }

    if (typeof args === 'string') {
        if (args.length > MAX_ARG_LENGTH) {
            throw new Error(`Argument too long at ${path}`);
        }
        // Block dangerous patterns
        const dangerousPatterns = [
            /require\s*\(/,
            /eval\s*\(/,
            /exec\s*\(/,
            /child_process/,
            /process\./,
            /global\./
        ];
        for (const pattern of dangerousPatterns) {
            if (pattern.test(args)) {
                throw new Error(`Dangerous pattern detected at ${path}`);
            }
        }
        return args;
    }

    if (Array.isArray(args)) {
        return args.map((arg, index) => 
            validateArguments(arg, depth + 1, `${path}[${index}]`)
        );
    }

    if (typeof args === 'object' && args !== null) {
        // Block prototype pollution
        if (args.__proto__ || args.constructor?.prototype) {
            throw new Error(`Prototype pollution attempt at ${path}`);
        }

        const validated = {};
        for (const [key, value] of Object.entries(args)) {
            if (['__proto__', 'constructor', 'prototype'].includes(key)) {
                throw new Error(`Dangerous key detected: ${key} at ${path}`);
            }
            validated[key] = validateArguments(value, depth + 1, `${path}.${key}`);
        }
        return validated;
    }

    // Allow primitives
    if (typeof args === 'number' || 
        typeof args === 'boolean' ||
        args === null ||
        args === undefined) {
        return args;
    }

    throw new Error(`Invalid argument type: ${typeof args} at ${path}`);
}

/**
 * Rate limiter for MCP endpoints
 */
function mcpRateLimiter(req, res, next) {
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    const now = Date.now();
    const windowStart = now - RATE_LIMIT_WINDOW;

    if (!rateLimiter.has(ip)) {
        rateLimiter.set(ip, []);
    }

    const requests = rateLimiter.get(ip).filter(time => time > windowStart);
    
    if (requests.length >= RATE_LIMIT_MAX) {
        const retryAfter = Math.ceil(RATE_LIMIT_WINDOW / 1000);
        return res.status(429).json({
            success: false,
            error: 'Rate limit exceeded',
            retryAfter: retryAfter
        });
    }

    requests.push(now);
    rateLimiter.set(ip, requests);
    next();
}

// ============================================
// MAIN SECURITY MIDDLEWARE
// ============================================

function mcpSecurityMiddleware(req, res, next) {
    try {
        const { module, function: func, args } = req.body;

        // 1. Validate module
        if (!module || !ALLOWED_MODULES.includes(module)) {
            console.warn(`⚠️ Blocked unauthorized module: ${module}`);
            return res.status(403).json({
                success: false,
                error: 'Module not permitted',
                allowedModules: ALLOWED_MODULES
            });
        }

        // 2. Validate function
        const allowedFuncs = ALLOWED_FUNCTIONS[module] || [];
        if (!func || !allowedFuncs.includes(func)) {
            console.warn(`⚠️ Blocked unauthorized function: ${module}.${func}`);
            return res.status(403).json({
                success: false,
                error: 'Function not permitted',
                allowedFunctions: allowedFuncs
            });
        }

        // 3. Validate arguments
        try {
            const validatedArgs = validateArguments(args || []);
            req.mcpValidated = {
                module,
                function: func,
                args: validatedArgs
            };
        } catch (error) {
            console.warn(`⚠️ Invalid arguments: ${error.message}`);
            return res.status(400).json({
                success: false,
                error: 'Invalid arguments',
                details: error.message
            });
        }

        console.log(`✅ MCP Allowed: ${module}.${func}`);

        next();
    } catch (error) {
        console.error('❌ MCP Security Error:', error);
        return res.status(500).json({
            success: false,
            error: 'Security validation failed'
        });
    }
}

module.exports = {
    mcpSecurityMiddleware,
    mcpRateLimiter,
    ALLOWED_MODULES,
    ALLOWED_FUNCTIONS,
    validateArguments
};