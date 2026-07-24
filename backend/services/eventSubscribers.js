// backend/services/eventSubscribers.js
const { domainEventService, DOMAIN_EVENTS } = require('./domainEventService');
const db = require('../config/db').promise;

/**
 * Notification subscriber - sends notifications for events
 */
function setupNotificationSubscriber() {
    domainEventService.subscribe(
        DOMAIN_EVENTS.ORDER_CREATED,
        async (data) => {
            console.log(`📧 Notification: Order ${data.orderId} created for user ${data.userId}`);
            // Send email/SMS notification
        },
        { async: true, name: 'notification' }
    );

    domainEventService.subscribe(
        DOMAIN_EVENTS.ORDER_PAYMENT_SUCCESS,
        async (data) => {
            console.log(`📧 Notification: Payment success for order ${data.orderId}`);
            // Send payment confirmation
        },
        { async: true, name: 'notification' }
    );
}

/**
 * Analytics subscriber - tracks events for analytics
 */
function setupAnalyticsSubscriber() {
    domainEventService.subscribe(
        DOMAIN_EVENTS.PRODUCT_VIEWED,
        async (data) => {
            console.log(`📊 Analytics: Product ${data.productId} viewed by user ${data.userId}`);
            // Track product view
            await db.query(
                `INSERT INTO product_views (product_id, user_id, viewed_at)
                 VALUES (?, ?, NOW())`,
                [data.productId, data.userId]
            );
        },
        { async: true, name: 'analytics' }
    );

    domainEventService.subscribe(
        DOMAIN_EVENTS.ORDER_COMPLETED,
        async (data) => {
            console.log(`📊 Analytics: Order ${data.orderId} completed`);
            // Track conversion
        },
        { async: true, name: 'analytics' }
    );
}

/**
 * Promotions subscriber - handles promo-related events
 */
function setupPromotionsSubscriber() {
    domainEventService.subscribe(
        DOMAIN_EVENTS.USER_REGISTERED,
        async (data) => {
            console.log(`🎉 Promotions: Welcome offer for user ${data.userId}`);
            // Apply welcome coupon
        },
        { async: true, name: 'promotions' }
    );

    domainEventService.subscribe(
        DOMAIN_EVENTS.ORDER_CREATED,
        async (data) => {
            console.log(`🎉 Promotions: Check loyalty points for order ${data.orderId}`);
            // Update loyalty points
        },
        { async: true, name: 'promotions' }
    );
}

/**
 * Recommendations subscriber - updates recommendations
 */
function setupRecommendationsSubscriber() {
    domainEventService.subscribe(
        DOMAIN_EVENTS.PRODUCT_VIEWED,
        async (data) => {
            console.log(`🔍 Recommendations: Update for user ${data.userId} based on product ${data.productId}`);
            // Update recommendations
        },
        { async: true, name: 'recommendations' }
    );

    domainEventService.subscribe(
        DOMAIN_EVENTS.WISHLIST_ITEM_ADDED,
        async (data) => {
            console.log(`🔍 Recommendations: Wishlist update for user ${data.userId}`);
            // Update recommendations based on wishlist
        },
        { async: true, name: 'recommendations' }
    );
}

/**
 * Order events subscriber
 */
function setupOrderSubscriber() {
    domainEventService.subscribe(
        DOMAIN_EVENTS.ORDER_CREATED,
        async (data) => {
            console.log(`📦 Order: Processing order ${data.orderId}`);
            // Process order
        },
        { async: true, name: 'order' }
    );
}

/**
 * Setup all subscribers
 */
function setupAllSubscribers() {
    setupNotificationSubscriber();
    setupAnalyticsSubscriber();
    setupPromotionsSubscriber();
    setupRecommendationsSubscriber();
    setupOrderSubscriber();

    console.log('✅ All event subscribers registered');
}

module.exports = {
    setupAllSubscribers,
    setupNotificationSubscriber,
    setupAnalyticsSubscriber,
    setupPromotionsSubscriber,
    setupRecommendationsSubscriber,
    setupOrderSubscriber
};