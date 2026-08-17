// backend/bootstrap.js
const { healthScoreService } = require('./services/healthScoreService');
const { metricsAggregationService } = require('./services/metricsAggregationService');
const { tracingService } = require('./services/tracingService');
const { policyEngine } = require('./services/policyEngineService');
const { outboxService } = require('./services/outboxService');
const { featureFlagService } = require('./services/featureFlagService');
const { slaService } = require('./services/businessSLAService');
const { loyaltyService } = require('./services/loyaltyService');
const { provenanceService } = require('./services/provenanceService');
const { capabilityMappingService } = require('./services/capabilityMappingService');
const { pluginSystem } = require('./services/pluginSystemService');
const { jobQueue } = require('./services/jobQueueService');
const { initializeContainer } = require('./core/serviceRegistration');
const { setupAllSubscribers } = require('./services/eventSubscribers');
const { startStockAlertScheduler } = require('./services/stockAlertScheduler');

/**
 * Initializes core background services, DI container, event subscribers, and background jobs.
 */
async function init() {
    console.log("Initializing core background services...");

    const services = [
        { name: 'HealthScoreService', instance: healthScoreService },
        { name: 'MetricsAggregationService', instance: metricsAggregationService },
        { name: 'TracingService', instance: tracingService },
        { name: 'PolicyEngineService', instance: policyEngine },
        { name: 'OutboxService', instance: outboxService },
        { name: 'FeatureFlagService', instance: featureFlagService },
        { name: 'SLAService', instance: slaService },
        { name: 'LoyaltyService', instance: loyaltyService },
        { name: 'ProvenanceService', instance: provenanceService },
        { name: 'CapabilityMappingService', instance: capabilityMappingService },
        { name: 'PluginSystem', instance: pluginSystem },
        { name: 'JobQueue', instance: jobQueue }
    ];

    for (const s of services) {
        try {
            await s.instance.initialize();
            console.log(`Service '${s.name}' initialized successfully.`);
        } catch (err) {
            console.error(`Warning: Service '${s.name}' failed to initialize:`, err.message);
        }
    }

    try {
        initializeContainer();
        console.log("DI Container initialized successfully.");
    } catch (err) {
        console.error("Warning: DI Container initialization failed:", err.message);
    }

    try {
        setupAllSubscribers();
        console.log("Event subscribers set up successfully.");
    } catch (err) {
        console.error("Warning: Failed to setup event subscribers:", err.message);
    }

    // Periodic back-in-stock / price-drop scan (#1233). No-ops under test.
    if (process.env.NODE_ENV !== "test") {
        try {
            startStockAlertScheduler();
        } catch (err) {
            console.error("Warning: Failed to start stock-alert scheduler:", err.message);
        }

        try {
            const { startPriceDropJob } = require("./jobs/priceDropJob");
            startPriceDropJob();
        } catch (err) {
            console.error("Warning: Failed to start wishlist price-drop job:", err.message);
        }

        // Abandoned-cart recovery (#1429). The lifecycle sweep decides what is
        // abandoned; this decides what to say about it, and to whom.
        try {
            const { startCartRecoveryJob } = require("./jobs/cartRecoveryJob");
            startCartRecoveryJob();
        } catch (err) {
            console.error("Warning: Failed to start cart recovery job:", err.message);
        }

        // Subscription renewals (#1494). Moved here from a bare top-level
        // setInterval so it is guarded, caught and stoppable like the rest.
        try {
            const {
                startSubscriptionRenewalJob
            } = require("./jobs/subscriptionRenewalJob");
            startSubscriptionRenewalJob();
        } catch (err) {
            console.error("Warning: Failed to start subscription renewal job:", err.message);
        }
    }
}

module.exports = { init };
