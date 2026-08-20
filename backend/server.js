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
const identityRoutes = require('./routes/identityRoutes');
const { verifyIdentityClaims } = require('./services/aiIdentityVerificationService');
// `dotenv` is already required on line 3; a second `const` declaration here was
// a SyntaxError that took the whole module down. The identity middleware and
// router that used to sit between the two declarations referenced `app` before
// `const app = express()` ran, so even with the duplicate removed this file
// threw `ReferenceError: Cannot access 'app' before initialization`. Both are
// now mounted alongside the other routers, below.
const rateLimit = require("express-rate-limit");

const setupProcessEventHandlers = require('./utils/processEventHandlers');
const setupGracefulShutdown = require('./utils/gracefulShutdown');

const { apiLimiter, adminLimiter, mcpLimiter } = require('./config/rateLimiters');
const { resolveTrustProxy } = require('./config/trustProxy');

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

const aiFeedRoutes = require('./routes/aiFeedRoutes');
const agentRoutes = require('./routes/agentRoutes');
const legalRoutes = require('./routes/legalRoutes');
const aiLegalRoutes = require('./routes/aiLegalRoutes');
const mcpRoutes = require("./routes/mcpRoutes"); // ✅ MCP Routes added
// Add with other imports
const socialEngineeringRoutes = require('./routes/socialEngineeringRoutes');
const { protectAgainstSocialEngineering } = require('./services/socialEngineeringProtectionService');

// Add social engineering protection middleware AFTER auth but BEFORE routes
app.use(protectAgainstSocialEngineering);

// Add social engineering routes
app.use('/api/social-engineering', socialEngineeringRoutes);

const { authLimiter } = require("./middleware/authLimiter");
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

const loyaltyRoutes = require('./routes/loyaltyRoutes');
const { loyaltyService } = require('./services/loyaltyService');


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

// Add liability routes
app.use('/api/liability', liabilityRoutes);

// Add with other route imports
const recentlyViewedRoutes = require('./routes/recentlyViewedRoutes');
const complexityRoutes = require('./routes/complexityRoutes');
const { architectureComplexityService } = require('./services/architectureComplexityService');

// The subscription renewal job is required where it is started, in bootstrap()
// alongside the other three background jobs, rather than at module load.
const flagRoutes = require('./routes/flagRoutes');
const { featureFlagService } = require('./services/featureFlagService');

const correlationRoutes = require('./routes/correlationRoutes');
const { correlationIdMiddleware, logCompletionMiddleware } = require('./middleware/correlationMiddleware');

(async () => {
  await moduleMaturityService.initialize();
  app.use('/api/maturity', maturityRoutes);

  await slaService.initialize();
  app.use('/api/sla', slaRoutes);

  await jaggedFrontierService.initialize();
  app.use('/api/jagged-frontier', jaggedFrontierRoutes);
})();

// Add with other route imports
// Add with other imports
const provenanceRoutes = require('./routes/provenanceRoutes');
// provenanceMiddleware is exported by the service alongside provenanceService;
// there is no ./middleware/provenanceMiddleware module on disk.
const { provenanceService, provenanceMiddleware } = require('./services/provenanceService');

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

// Both of these were mounted further down (`app.use('/api/experiments', ...)`
// and `app.use('/api/copywriter', ...)`) but never imported, so startup died
// with `ReferenceError: experimentRoutes is not defined`. Both route files
// exist on disk; only the require lines were missing.
const experimentRoutes = require('./routes/experimentRoutes');
const copywriterRoutes = require('./routes/copywriterRoutes');

const { detectAgenticFraud } = require('./middleware/agenticFraudMiddleware');
const { detectBot, addBotDetectionHeaders } = require('./middleware/botProtectionMiddleware');
const { verifyAICrawler } = require('./middleware/aiCrawlerMiddleware');
const fraudRoutes = require('./routes/fraudRoutes');
const aiRoutes = require('./routes/aiRoutes');
const giftCardRoutes = require('./routes/giftCardRoutes');

// Back-in-stock & price-drop alerts (#1233)
const stockAlertRoutes = require('./routes/stockAlertRoutes');
const { startStockAlertScheduler } = require('./services/stockAlertScheduler');

// 6. Connect to database configuration (runs pool initialization side-effects)
require("./config/db");

const http = require("node:http");
const server = http.createServer(app);
const { initSocket } = require("./utils/socketManager");
const { accessLogger, errorLogger, devLogger } = require('./config/morganConfig');

const appConfig = require('./config/appConfig');
const logDir = appConfig.logDir;

// Create logs directory if it does not exist
if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir);
}
const errorLogStream = fs.createWriteStream(path.join(logDir, "error.log"), { flags: "a" });

// 7. Express App Configuration & Global Middlewares
// `trust proxy` decides what req.ip resolves to and therefore what the rate
// limiters count against, so it is a deployment setting rather than a constant.
// The default is unchanged (one trusted hop); see config/trustProxy.js.
app.set("trust proxy", resolveTrustProxy(process.env.TRUST_PROXY));
app.disable("x-powered-by");

// Add correlation ID middleware before any other middlewares
app.use(correlationIdMiddleware);
app.use(logCompletionMiddleware);

// Add response standardization middleware before routes
app.use(standardizeResponse);

// Security, tracing, and logging middlewares
app.use(corsMiddleware);
app.use(helmetMiddleware);
app.use(traceRequest);
app.use(accessLogger);
app.use(errorLogger);

if (process.env.NODE_ENV !== "production") {
    app.use(devLogger);
}

// Request Compression
app.use(compression({
    level: appConfig.compression.level,
    threshold: appConfig.compression.threshold,
    filter: (req, res) => {
        if (req.headers["x-no-compression"]) {
            return false;
        }
        return compression.filter(req, res);
    }
}));

// Request Timeout
app.use(timeout(appConfig.requestTimeout));
app.use((req, res, next) => {
    if (req.path.startsWith("/api/admin") ||
        req.path === "/api/upload" ||
        req.path === "/api/export" ||
        req.path.startsWith("/api/mcp")) {
        req.setTimeout(appConfig.longRequestTimeoutMs);
    }
    next();
});

// Webhook routes must come BEFORE global body parsers to receive raw body
const webhookRoutes = require('./routes/webhookRoutes');
app.use('/api/webhooks', webhookRoutes);

// Static asset serving with filename whitelist & path-traversal security check
const assetSecurityMiddleware = require('./middleware/assetSecurityMiddleware');
app.use('/assets', assetSecurityMiddleware);

// JSON and URL-encoded body parsers
app.use(express.json({ limit: appConfig.bodyLimit }));
app.use(cookieParser());
app.use(express.urlencoded({ extended: true, limit: appConfig.bodyLimit }));

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
app.use("/api/auth", authLimiter);
app.use("/api/admin", adminLimiter);
app.use("/api/mcp", mcpLimiter);

// Initialize Socket.IO server
initSocket(server, appConfig.allowedOrigins);

// AI identity-claim verification. This ran as a global middleware pair that had
// been pasted above `const app = express()`, so it never executed and
// `/api/identity` was never reachable. It belongs with the other request-scoped
// guards, after the body parsers (it inspects the parsed body) and before the
// routers it protects.
app.use(verifyIdentityClaims);
app.use('/api/identity', identityRoutes);

// 9. Application Routes Setup
const routes = require('./routes');
Object.entries(routes).forEach(([path, router]) => app.use(path, router));

// Refuse to start with a commerce route that declares no authorization policy
// and is not on the public allowlist. Opt-in via ROUTE_POLICY_AUDIT=enforce (or
// =warn to see the report without blocking a deploy); see
// middleware/routeAudit.js. Runs here, after the routers are attached, and is a
// pure inspection of the router stacks -- no requests, no I/O.
require("./middleware/routeAudit").runStartupAudit();

// Health check endpoint
app.get("/health", (req, res) => {
    const { buildHealthResponse } = require("./utils/healthResponseBuilder");
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

app.server = server;

module.exports = app;