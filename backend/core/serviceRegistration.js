// backend/core/serviceRegistration.js
const { container, LIFETIME } = require('./diContainer');

// Import services
// Note: These would be your actual service classes
// For demonstration, we'll show the registration pattern

/**
 * Register all services with the DI container
 */
function registerServices() {
    // ============================================
    // REPOSITORY SERVICES
    // ============================================
    
    // Register repositories (singletons)
    container.register('ProductRepository', null, {
        lifetime: LIFETIME.SINGLETON,
        factory: () => require('../repositories/productRepository')
    });

    container.register('OrderRepository', null, {
        lifetime: LIFETIME.SINGLETON,
        factory: () => require('../repositories/orderRepository')
    });

    container.register('UserRepository', null, {
        lifetime: LIFETIME.SINGLETON,
        factory: () => require('../repositories/userRepository')
    });

    container.register('WishlistRepository', null, {
        lifetime: LIFETIME.SINGLETON,
        factory: () => require('../repositories/wishlistRepository')
    });

    // ============================================
    // SERVICE LAYER
    // ============================================

    container.register('ProductService', null, {
        lifetime: LIFETIME.SINGLETON,
        dependencies: ['ProductRepository'],
        factory: (productRepo) => {
            const ProductService = require('../services/productService');
            return new ProductService(productRepo);
        }
    });

    container.register('OrderService', null, {
        lifetime: LIFETIME.SINGLETON,
        dependencies: ['OrderRepository', 'ProductRepository'],
        factory: (orderRepo, productRepo) => {
            const OrderService = require('../services/orderService');
            return new OrderService(orderRepo, productRepo);
        }
    });

    container.register('UserService', null, {
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

    container.register('CatalogService', null, {
        lifetime: LIFETIME.SINGLETON,
        dependencies: ['ProductRepository', 'CategoryRepository'],
        factory: (productRepo, categoryRepo) => {
            const { CatalogService } = require('../modules/catalog');
            return new CatalogService(productRepo, categoryRepo);
        }
    });

    container.register('OrderDomainService', null, {
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

    container.register('OrderValidator', null, {
        lifetime: LIFETIME.SINGLETON,
        factory: () => require('../validators/orderValidator')
    });

    container.register('ProductValidator', null, {
        lifetime: LIFETIME.SINGLETON,
        factory: () => require('../validators/productValidator')
    });

    container.register('UserValidator', null, {
        lifetime: LIFETIME.SINGLETON,
        factory: () => require('../validators/userValidator')
    });

    container.register('CouponValidator', null, {
        lifetime: LIFETIME.SINGLETON,
        factory: () => require('../validators/couponValidator')
    });

    // ============================================
    // OTHER SERVICES
    // ============================================

    // Cache service
    container.register('CacheService', null, {
        lifetime: LIFETIME.SINGLETON,
        factory: () => require('../services/cacheService')
    });

    // Notification service
    container.register('NotificationService', null, {
        lifetime: LIFETIME.SINGLETON,
        factory: () => require('../services/notificationService')
    });

    // Analytics service
    container.register('AnalyticsService', null, {
        lifetime: LIFETIME.SINGLETON,
        factory: () => require('../services/analyticsService')
    });

    // Recommendation service
    container.register('RecommendationService', null, {
        lifetime: LIFETIME.SINGLETON,
        dependencies: ['ProductService', 'CacheService'],
        factory: (productService, cacheService) => {
            const RecommendationService = require('../services/recommendationService');
            return new RecommendationService(productService, cacheService);
        }
    });

    // Payment service
    container.register('PaymentService', null, {
        lifetime: LIFETIME.SINGLETON,
        factory: () => require('../services/paymentService')
    });

    // Config service
    container.register('ConfigService', null, {
        lifetime: LIFETIME.SINGLETON,
        factory: () => require('../services/configService').configService
    });

    // Auth service
    container.register('AuthService', null, {
        lifetime: LIFETIME.SINGLETON,
        dependencies: ['UserRepository', 'ConfigService'],
        factory: (userRepo, configService) => {
            const AuthService = require('../services/authService');
            return new AuthService(userRepo, configService);
        }
    });

    console.log('✅ All services registered with DI container');
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