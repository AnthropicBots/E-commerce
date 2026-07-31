// backend/core/serviceRegistration.js
const { container, LIFETIME } = require('./diContainer');

// Six of the services registered below do not exist on disk:
// orderService, userService, authService, paymentService, notificationService
// and analyticsService. The header of this file has always described it as
// showing "the registration pattern" for services that "would be your actual
// service classes", so they are placeholders rather than something that was
// lost.
//
// That was still a live hazard. The requires sit inside `factory` closures, so
// they do not fire during registration -- they fire the first time something
// resolves the token, which middleware/diMiddleware.js does per request. The
// result was a MODULE_NOT_FOUND thrown from inside a request handler, far from
// the registration that caused it.
//
// Rather than inventing six domain services, registration now skips any token
// whose module cannot be resolved and reports them once at startup. Resolving
// an unregistered token then fails with the container's own clear error
// instead of a stack trace pointing at a require deep inside a factory.

/**
 * Can this module path be resolved from this file?
 *
 * @param {string} modulePath
 * @returns {boolean}
 */
function isResolvable(modulePath) {
    try {
        require.resolve(modulePath);
        return true;
    } catch (error) {
        if (error.code === 'MODULE_NOT_FOUND') return false;
        throw error;
    }
}

/**
 * Register a token only when the module backing it is present.
 *
 * @param {string[]} missing - Accumulator for skipped tokens.
 * @param {string} token - Container token.
 * @param {string} modulePath - Module the factory requires.
 * @param {object} options - Passed straight through to container.register.
 * @returns {boolean} Whether the token was registered.
 */
function registerIfAvailable(missing, token, modulePath, options) {
    if (!isResolvable(modulePath)) {
        missing.push(`${token} -> ${modulePath}`);
        return false;
    }

    container.register(token, null, options);
    return true;
}

/**
 * Register all services with the DI container
 */
function registerServices() {
    // Tokens skipped because their module is absent; reported once below.
    const missing = [];
    // ============================================
    // REPOSITORY SERVICES
    // ============================================
    
    // Register repositories (singletons)
    registerIfAvailable(missing, 'ProductRepository', '../repositories/productRepository', {
        lifetime: LIFETIME.SINGLETON,
        factory: () => require('../repositories/productRepository')
    });

    registerIfAvailable(missing, 'OrderRepository', '../repositories/orderRepository', {
        lifetime: LIFETIME.SINGLETON,
        factory: () => require('../repositories/orderRepository')
    });

    registerIfAvailable(missing, 'UserRepository', '../repositories/userRepository', {
        lifetime: LIFETIME.SINGLETON,
        factory: () => require('../repositories/userRepository')
    });

    registerIfAvailable(missing, 'WishlistRepository', '../repositories/wishlistRepository', {
        lifetime: LIFETIME.SINGLETON,
        factory: () => require('../repositories/wishlistRepository')
    });

    // ============================================
    // SERVICE LAYER
    // ============================================

    registerIfAvailable(missing, 'ProductService', '../services/productService', {
        lifetime: LIFETIME.SINGLETON,
        dependencies: ['ProductRepository'],
        factory: (productRepo) => {
            const ProductService = require('../services/productService');
            return new ProductService(productRepo);
        }
    });

    registerIfAvailable(missing, 'OrderService', '../services/orderService', {
        lifetime: LIFETIME.SINGLETON,
        dependencies: ['OrderRepository', 'ProductRepository'],
        factory: (orderRepo, productRepo) => {
            const OrderService = require('../services/orderService');
            return new OrderService(orderRepo, productRepo);
        }
    });

    registerIfAvailable(missing, 'UserService', '../services/userService', {
        lifetime: LIFETIME.SINGLETON,
        dependencies: ['UserRepository'],
        factory: (userRepo) => {
            const UserService = require('../services/userService');
            return new UserService(userRepo);
        }
    });

    // ============================================
    // DOMAIN SERVICES
    // ============================================

    registerIfAvailable(missing, 'CatalogService', '../modules/catalog', {
        lifetime: LIFETIME.SINGLETON,
        dependencies: ['ProductRepository', 'CategoryRepository'],
        factory: (productRepo, categoryRepo) => {
            const { CatalogService } = require('../modules/catalog');
            return new CatalogService(productRepo, categoryRepo);
        }
    });

    registerIfAvailable(missing, 'OrderDomainService', '../modules/orders', {
        lifetime: LIFETIME.SINGLETON,
        dependencies: ['OrderRepository'],
        factory: (orderRepo) => {
            const { OrderService } = require('../modules/orders');
            return new OrderService(orderRepo);
        }
    });

    // ============================================
    // VALIDATORS
    // ============================================

    registerIfAvailable(missing, 'OrderValidator', '../validators/orderValidator', {
        lifetime: LIFETIME.SINGLETON,
        factory: () => require('../validators/orderValidator')
    });

    registerIfAvailable(missing, 'ProductValidator', '../validators/productValidator', {
        lifetime: LIFETIME.SINGLETON,
        factory: () => require('../validators/productValidator')
    });

    registerIfAvailable(missing, 'UserValidator', '../validators/userValidator', {
        lifetime: LIFETIME.SINGLETON,
        factory: () => require('../validators/userValidator')
    });

    registerIfAvailable(missing, 'CouponValidator', '../validators/couponValidator', {
        lifetime: LIFETIME.SINGLETON,
        factory: () => require('../validators/couponValidator')
    });

    // ============================================
    // OTHER SERVICES
    // ============================================

    // Cache service
    registerIfAvailable(missing, 'CacheService', '../services/cacheService', {
        lifetime: LIFETIME.SINGLETON,
        factory: () => require('../services/cacheService')
    });

    // Notification service
    registerIfAvailable(missing, 'NotificationService', '../services/notificationService', {
        lifetime: LIFETIME.SINGLETON,
        factory: () => require('../services/notificationService')
    });

    // Analytics service
    registerIfAvailable(missing, 'AnalyticsService', '../services/analyticsService', {
        lifetime: LIFETIME.SINGLETON,
        factory: () => require('../services/analyticsService')
    });

    // Recommendation service
    registerIfAvailable(missing, 'RecommendationService', '../services/recommendationService', {
        lifetime: LIFETIME.SINGLETON,
        dependencies: ['ProductService', 'CacheService'],
        factory: (productService, cacheService) => {
            const RecommendationService = require('../services/recommendationService');
            return new RecommendationService(productService, cacheService);
        }
    });

    // Payment service
    registerIfAvailable(missing, 'PaymentService', '../services/paymentService', {
        lifetime: LIFETIME.SINGLETON,
        factory: () => require('../services/paymentService')
    });

    // Config service
    registerIfAvailable(missing, 'ConfigService', '../services/configService', {
        lifetime: LIFETIME.SINGLETON,
        factory: () => require('../services/configService').configService
    });

    // Auth service
    registerIfAvailable(missing, 'AuthService', '../services/authService', {
        lifetime: LIFETIME.SINGLETON,
        dependencies: ['UserRepository', 'ConfigService'],
        factory: (userRepo, configService) => {
            const AuthService = require('../services/authService');
            return new AuthService(userRepo, configService);
        }
    });

    if (missing.length > 0) {
        console.warn(
            `⚠️  DI container: ${missing.length} service(s) skipped — module not found on disk:`
        );
        for (const entry of missing) {
            console.warn(`     - ${entry}`);
        }
        console.warn(
            '     Resolving these tokens will fail until the modules are added.'
        );
    }

    console.log(
        `✅ DI container: registered services (${missing.length} skipped)`
    );

    return { missing };
}

/**
 * Register default services
 */
function registerDefaultServices() {
    // Register core services that don't depend on others
    container.register('Database', null, {
        lifetime: LIFETIME.SINGLETON,
        factory: () => require('../config/db')
    });

    container.register('Logger', null, {
        lifetime: LIFETIME.SINGLETON,
        factory: () => console
    });

    // Register config
    container.register('Config', null, {
        lifetime: LIFETIME.SINGLETON,
        factory: () => require('dotenv').config()
    });
}

/**
 * Initialize container with all services
 */
function initializeContainer() {
    registerDefaultServices();
    registerServices();
    container.initialize();
    console.log('✅ DI Container fully initialized');
    return container;
}

module.exports = {
    container,
    registerServices,
    registerDefaultServices,
    initializeContainer
};