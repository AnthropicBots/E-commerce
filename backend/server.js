// backend/server.js
// 1. Initialize environment variables immediately
const dotenv = require("dotenv");
dotenv.config();

const { validateEnv } = require('./config/envValidator');
validateEnv();

// 2. Core Dependencies
const express = require("express");
const { helmetMiddleware } = require("./middleware/helmetMiddleware");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const globalErrorHandler = require('./middleware/errorHandler');
const compression = require("compression");
const morgan = require("morgan");
const timeout = require("connect-timeout");
const fs = require("fs");
const path = require("path");
const setupProcessEventHandlers = require('./utils/processEventHandlers');
const setupGracefulShutdown = require('./utils/gracefulShutdown');

const { apiLimiter, adminLimiter, mcpLimiter } = require('./config/rateLimiters');
const helmet = require("helmet");
const corsMiddleware = require("./middleware/corsMiddleware");

// 3. Initialize Express Application
const app = express();

// 4. Missing / Required Service Imports
const { healthScoreService } = require('./services/healthScoreService');
const { capabilityMappingService } = require('./services/capabilityMappingService');
const { jobQueue } = require('./services/jobQueueService');
const { initializeContainer } = require('./core/serviceRegistration');

// 5. Route & Middleware Imports
const responseExampleRoutes = require('./routes/responseExampleRoutes');
const { standardizeResponse } = require('./middleware/responseStandardizer');

const logDir = path.join(process.cwd(), "logs");
const aiFeedRoutes = require('./routes/aiFeedRoutes');
const agentRoutes = require('./routes/agentRoutes');
const legalRoutes = require('./routes/legalRoutes');
const aiLegalRoutes = require('./routes/aiLegalRoutes');
const routes = require("./routes/index");
const { authLimiter } = require("./middleware/authLimiter");
const mcpRoutes = require("./routes/mcpRoutes");
// Add with other imports
const agentCheckoutRoutes = require('./routes/agentCheckoutRoutes');
const { agentCheckoutService } = require('./services/agentCheckoutService');

const jaggedFrontierRoutes = require('./routes/jaggedFrontierRoutes');
const { jaggedFrontierService } = require('./services/jaggedFrontierService');


const liabilityRoutes = require('./routes/liabilityRoutes');
const maturityRoutes = require('./routes/maturityRoutes');
const { moduleMaturityService } = require('./services/moduleMaturityService');


const slaRoutes = require('./routes/slaRoutes');
const { slaService } = require('./services/businessSLAService');


const discoveryRoutes = require('./routes/discoveryRoutes');
const { capabilityDiscoveryService } = require('./services/capabilityDiscoveryService');

const metricsRoutes = require('./routes/metricsRoutes');
const { metricsAggregationService } = require('./services/metricsAggregationService');

const notificationBrokerRoutes = require('./routes/notificationBrokerRoutes');
const {
    notificationBroker,
    inAppChannel,
    emailChannel,
    webhookChannel
} = require('./services/notificationBrokerService');

// Register notification channels
notificationBroker.registerChannel('in_app', inAppChannel.handler);
notificationBroker.registerChannel('email', emailChannel.handler);
notificationBroker.registerChannel('webhook', webhookChannel.handler);

const configRoutes = require('./routes/configRoutes');
const { evaluateRisk } = require('./middleware/riskMiddleware');
const tracingRoutes = require('./routes/tracingRoutes');
const { traceRequest } = require('./middleware/tracingMiddleware');
const { tracingService } = require('./services/tracingService');

const policyRoutes = require('./routes/policyRoutes');
const { policyEngine } = require('./services/policyEngineService');

const outboxRoutes = require('./routes/outboxRoutes');
const { outboxService } = require('./services/outboxService');


// Initialize outbox service asynchronously
outboxService.initialize().catch(err => {
    console.error('Failed to initialize outbox service:', err);
});

// Add outbox routes
app.use('/api/outbox', outboxRoutes);



// Add liability routes
app.use('/api/liability', liabilityRoutes);
// Add with other route imports
const recentlyViewedRoutes = require('./routes/recentlyViewedRoutes');
const complexityRoutes = require('./routes/complexityRoutes');
const { architectureComplexityService } = require('./services/architectureComplexityService');

const processRenewals = require('./jobs/subscriptionRenewalJob');
const flagRoutes = require('./routes/flagRoutes');
const { featureFlagService } = require('./services/featureFlagService');

const correlationRoutes = require('./routes/correlationRoutes');
const { correlationIdMiddleware, logCompletionMiddleware } = require('./middleware/correlationIdMiddleware');

// Add correlation ID middleware BEFORE any other middleware
app.use(correlationIdMiddleware);
app.use(logCompletionMiddleware);

// Add correlation routes
app.use('/api/correlation', correlationRoutes);

(async () => {
  await moduleMaturityService.initialize();
  app.use('/api/maturity', maturityRoutes);

  await slaService.initialize();
  app.use('/api/sla', slaRoutes);

  await jaggedFrontierService.initialize();
  app.use('/api/jagged-frontier', jaggedFrontierRoutes);
})();


// Initialize maturity service
moduleMaturityService.initialize().catch(err => {
    console.error('Failed to initialize maturity service:', err);
});

// Add maturity routes
app.use('/api/maturity', maturityRoutes);

// Initialize SLA service
slaService.initialize().catch(err => {
    console.error('Failed to initialize SLA service:', err);
});

// Add SLA routes
app.use('/api/sla', slaRoutes);


// Initialize service
jaggedFrontierService.initialize().catch(err => {
    console.error('Failed to initialize jagged frontier service:', err);
});

// Add routes
app.use('/api/jagged-frontier', jaggedFrontierRoutes);

// Add with other route imports
// Add with other imports
const provenanceRoutes = require('./routes/provenanceRoutes');
const { provenanceService } = require('./services/provenanceService');
const { provenanceMiddleware } = require('./middleware/provenanceMiddleware');

const recommendationRoutes = require('./routes/recommendationRoutes');
const ruleRoutes = require('./routes/ruleRoutes');

const pluginRoutes = require('./routes/pluginRoutes');
const { pluginSystem } = require('./services/pluginSystemService');

const eventRoutes = require('./routes/eventRoutes');
const { setupAllSubscribers } = require('./services/eventSubscribers');

const performanceRoutes = require('./routes/performanceRoutes');
const approvalRoutes = require('./routes/approvalRoutes');
const rollbackRoutes = require('./routes/rollbackRoutes');
const securityRoutes = require('./routes/securityRoutes');
const aiFinancialRoutes = require('./routes/aiFinancialRoutes');

const { detectAgenticFraud } = require('./middleware/agenticFraudMiddleware');
const { detectBot, addBotDetectionHeaders } = require('./middleware/botProtectionMiddleware');
const { verifyAICrawler } = require('./middleware/aiCrawlerMiddleware');
const fraudRoutes = require('./routes/fraudRoutes');
const aiRoutes = require('./routes/aiRoutes');

// 6. Connect to database configuration (runs pool initialization side-effects)
require("./config/db");

const http = require("node:http");
const server = http.createServer(app);
const { initSocket } = require("./utils/socketManager");
const { accessLogger, errorLogger, devLogger } = require('./config/morganConfig');

const PORT = Number(process.env.PORT) || 5000;
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5500";

// Create logs directory if it does not exist
if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir);
}
const errorLogStream = fs.createWriteStream(path.join(logDir, "error.log"), { flags: "a" });

// 7. Express App Configuration & Global Middlewares
app.set("trust proxy", 1);
app.disable("x-powered-by");

// Add correlation ID middleware before any other middlewares
app.use(correlationIdMiddleware);
app.use(logCompletionMiddleware);

// Add response standardization middleware before routes
app.use(standardizeResponse);

// Security, tracing, and logging middlewares
app.use(helmetMiddleware);
app.use(traceRequest);
app.use(accessLogger);
app.use(errorLogger);

if (process.env.NODE_ENV !== "production") {
    app.use(devLogger);
}

// Request Compression
app.use(compression({
    level: 6,
    threshold: 1024,
    filter: (req, res) => {
        if (req.headers["x-no-compression"]) {
            return false;
        }
        return compression.filter(req, res);
    }
}));

// Request Timeout
app.use(timeout("30s"));
app.use((req, res, next) => {
    if (req.path.startsWith("/api/admin") ||
        req.path === "/api/upload" ||
        req.path === "/api/export" ||
        req.path.startsWith("/api/mcp")) {
        req.setTimeout(60000);
    }
    next();
});

// Webhook routes must come BEFORE global body parsers to receive raw body
const webhookRoutes = require('./routes/webhookRoutes');
app.use('/api/webhooks', webhookRoutes);

// JSON and URL-encoded body parsers
app.use(express.json({ limit: "10mb" }));
app.use(cookieParser());
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Security headers for MCP endpoints
app.use('/api/mcp', (req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    next();
});

// Request logger for development
if (process.env.NODE_ENV !== "production") {
    app.use((req, res, next) => {
        console.log(`${req.method} ${req.originalUrl} - ${req.ip}`);
        next();
    });
}

// Bot protection and agentic fraud detection middlewares
app.use(addBotDetectionHeaders);
app.use(detectBot);
app.use(evaluateRisk);
app.use(provenanceMiddleware);
app.use(detectAgenticFraud);

// 8. Global Rate Limiting
app.use("/api", apiLimiter);
app.use("/api/auth/login", authLimiter);
app.use("/api/auth/signup", authLimiter);
app.use("/api/auth/forgot-password", authLimiter);
app.use("/api/auth/reset-password", authLimiter);
app.use("/api/auth/refresh-token", authLimiter);
app.use("/api/admin", adminLimiter);
app.use("/api/mcp", mcpLimiter);

// Initialize Socket.IO server
initSocket(server, [
    "http://localhost:5500",
    "http://127.0.0.1:5500",
    "http://localhost:5501",
    "http://127.0.0.1:5501",
    "http://localhost:5502",
    "http://127.0.0.1:5502",
    "http://172.18.208.1:5500",
    "http://172.18.208.1:5501",
    "http://172.18.208.1:5502",
    FRONTEND_URL,
    "https://e-commerce-git-main-bhuvanshs-projects.vercel.app",
    "https://www.bhuvansh.xyz",
    "https://e-commerce-production-d546.up.railway.app"
]);

// 9. Application Routes Setup
app.use('/api/response-example', responseExampleRoutes);
app.use('/api/ai-legal', aiLegalRoutes);
app.use('/api/legal', legalRoutes);
app.use('/api/agents', agentRoutes);
app.use('/api/ai-feed', aiFeedRoutes);
app.use('/api/discovery', discoveryRoutes);
app.use('/api/metrics', metricsRoutes);
app.use('/api/notifications', notificationBrokerRoutes);
app.use('/api/config', configRoutes);
app.use('/api/tracing', tracingRoutes);
app.use('/api/policies', policyRoutes);
app.use('/api/outbox', outboxRoutes);
app.use('/api/flags', flagRoutes);
app.use('/api/correlation', correlationRoutes);
app.use('/api/sla', slaRoutes);
app.use('/api/provenance', provenanceRoutes);
app.use('/api/recommendations', recommendationRoutes);
app.use('/api/rules', ruleRoutes);
app.use('/api/plugins', pluginRoutes);
app.use('/api/events', eventRoutes);
app.use('/api/security', securityRoutes);
app.use('/api/approvals', approvalRoutes);
app.use('/api/rollback', rollbackRoutes);
app.use('/api/ai/financial', aiFinancialRoutes);
app.use('/api/performance', performanceRoutes);
app.use('/api/recently-viewed', recentlyViewedRoutes);
app.use('/api/experiments', experimentRoutes);
app.use('/api/copywriter', copywriterRoutes);
app.use('/api/fraud', fraudRoutes);
app.use('/api/ai', aiRoutes);
app.use("/api", routes);
app.use("/api/mcp", mcpRoutes);

// Health check endpoint
app.get("/health", (req, res) => {
    const { buildHealthResponse } = require("./utils/healthBuilder");
    const healthData = buildHealthResponse({
        environment: process.env.NODE_ENV || "development",
        uptime: process.uptime(),
        memoryUsage: process.memoryUsage(),
    });
    return res.status(200).json(healthData);
});

// Root API Endpoint
app.get("/", (req, res) => {
    return res.status(200).json({
        success: true,
        message: "E-Commerce Backend Running",
        version: "2.0.0",
        endpoints: {
            health: "/health",
            api: "/api",
            auth: "/api/auth",
            admin: "/api/admin",
            mcp: "/api/mcp",
        },
        security: {
            rateLimiting: "Enabled",
            helmet: "Enabled",
            cors: "Configured",
            mcpSecurity: "Enabled",
        }
    });
});

// 404 Route Handler
app.use((req, res) => {
    return res.status(404).json({
        success: false,
        errorCode: "ROUTE_NOT_FOUND",
        message: `Route ${req.method} ${req.originalUrl} not found`,
    });
});

// Global Error Middleware
app.use(globalErrorHandler(errorLogStream));

// 10. Process Signal Event Handlers
process.on("unhandledRejection", (reason) => {
    console.error("UNHANDLED REJECTION:", reason);
    errorLogStream.write(JSON.stringify({
        timestamp: new Date().toISOString(),
        type: "UNHANDLED_REJECTION",
        reason: reason?.message || reason,
        stack: reason?.stack,
    }) + "\n");
    setTimeout(() => {
        process.exit(1);
    }, 1000);
});

process.on("uncaughtException", (error) => {
    console.error("UNCAUGHT EXCEPTION:", error);
    errorLogStream.write(JSON.stringify({
        timestamp: new Date().toISOString(),
        type: "UNCAUGHT_EXCEPTION",
        error: error.message,
        stack: error.stack,
    }) + "\n");
    setTimeout(() => {
        process.exit(1);
    }, 1000);
});

// Set up process signals and graceful shutdown
setupProcessEventHandlers();
setupGracefulShutdown(server);

// Register tracing shutdown logic on SIGINT/SIGTERM
process.on('SIGTERM', async () => {
    try {
        await tracingService.shutdown();
    } catch (err) {
        console.error("Error during tracing shutdown:", err.message);
    }
});

process.on('SIGINT', async () => {
    try {
        await tracingService.shutdown();
    } catch (err) {
        console.error("Error during tracing shutdown:", err.message);
    }
});

// Start Subscription Renewals Cron Job
setInterval(processRenewals, 24 * 60 * 60 * 1000); // run daily

// 11. Application Bootstrap Function
async function bootstrap() {
    const { logServerStartup } = require('./config/loggerConfig');
    console.log("Initializing core background services...");

    const services = [
        { name: 'HealthScoreService', instance: healthScoreService },
        { name: 'MetricsAggregationService', instance: metricsAggregationService },
        { name: 'TracingService', instance: tracingService },
        { name: 'PolicyEngineService', instance: policyEngine },
        { name: 'OutboxService', instance: outboxService },
        { name: 'FeatureFlagService', instance: featureFlagService },
        { name: 'SLAService', instance: slaService },
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

    // Start HTTP listening only after services finish initializations
    console.log("Starting HTTP server...");
    server.listen(PORT, "0.0.0.0", () => {
        logServerStartup({
            port: PORT,
            environment: process.env.NODE_ENV || "development",
            frontendUrl: FRONTEND_URL,
            logsDir: logDir,
            healthUrl: `http://localhost:${PORT}/health`,
            mcpSecurity: true,
            rateLimiting: true,
            helmet: true,
        });
    });
}

// Start application
bootstrap();

module.exports = app;