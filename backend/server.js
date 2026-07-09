const express = require("express");
const helmetMiddleware = require("./middleware/helmetMiddleware");
const cors = require("cors");
const cookieParser = require("cookie-parser");

const globalErrorHandler = require('./middleware/errorHandler');
const compression = require("compression");
const morgan = require("morgan");
const timeout = require("connect-timeout");
const fs = require("fs");
const path = require("path");
const { apiLimiter, adminLimiter, mcpLimiter } = require('./config/rateLimiters');
const dotenv = require("dotenv");
const helmet = require("helmet");
const corsMiddleware = require("./middleware/corsMiddleware");

// Import all route modules
const aiFeedRoutes = require('./routes/aiFeedRoutes');
const agentRoutes = require('./routes/agentRoutes');
const legalRoutes = require('./routes/legalRoutes');
const aiLegalRoutes = require('./routes/aiLegalRoutes');
const performanceRoutes = require('./routes/performanceRoutes');
const approvalRoutes = require('./routes/approvalRoutes');
const rollbackRoutes = require('./routes/rollbackRoutes');
const securityRoutes = require('./routes/securityRoutes');
const aiFinancialRoutes = require('./routes/aiFinancialRoutes');
const copywriterRoutes = require('./routes/copywriterRoutes');
const fraudRoutes = require('./routes/fraudRoutes');
const aiRoutes = require('./routes/aiRoutes');
const routes = require("./routes/index");
const authLimiter = require("./middleware/authLimiter");
const mcpRoutes = require("./routes/mcpRoutes");

// Import middleware
const { detectAgenticFraud } = require('./middleware/agenticFraudMiddleware');
const { detectBot, addBotDetectionHeaders } = require('./middleware/botProtectionMiddleware');
const { verifyAICrawler } = require('./middleware/aiCrawlerMiddleware');

// Create logs directory
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
}

// Create log streams
const errorLogStream = fs.createWriteStream(
    path.join(logsDir, 'error.log'),
    { flags: 'a' }
);

// Health response builder
function buildHealthResponse(data) {
    return {
        success: true,
        status: 'healthy',
        timestamp: new Date().toISOString(),
        ...data
    };
}

// Server startup logger
function logServerStartup(options) {
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║                    SERVER STARTUP INFO                       ║
╠══════════════════════════════════════════════════════════════╣
║  Status:        ✅ Running                                   ║
║  Port:          ${String(options.port).padEnd(45)}║
║  Environment:   ${String(options.environment).padEnd(45)}║
║  Health Check:  ${String(options.healthUrl).padEnd(45)}║
╠══════════════════════════════════════════════════════════════╣
║                    SECURITY FEATURES                         ║
╠══════════════════════════════════════════════════════════════╣
║  Rate Limiting:  ${String(options.rateLimiting ? '✅ Enabled' : '❌ Disabled').padEnd(44)}║
║  Helmet:         ${String(options.helmet ? '✅ Enabled' : '❌ Disabled').padEnd(44)}║
║  MCP Security:   ${String(options.mcpSecurity ? '✅ Enabled' : '❌ Disabled').padEnd(44)}║
╚══════════════════════════════════════════════════════════════╝
    `);
}

// Load environment
dotenv.config();
const { validateEnv } = require('./config/envValidator');
validateEnv();

// Initialize database
require("./config/db");

// Initialize Express app
const app = express();
const http = require("http");
const server = http.createServer(app);
const { initSocket } = require("./utils/socketManager");
const { accessLogger, errorLogger, devLogger } = require('./config/morganConfig');

// Constants
const PORT = Number(process.env.PORT) || 5000;
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5500";

// Trust proxy
app.set("trust proxy", 1);

// Disable x-powered-by header
app.disable("x-powered-by");

// Security headers
app.use(helmetMiddleware);

// Compression
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

// Request timeout
app.use(timeout("30s"));

// Extend timeout for specific routes
app.use((req, res, next) => {
    if (req.path.startsWith("/api/admin") || 
        req.path === "/api/upload" || 
        req.path === "/api/export" ||
        req.path.startsWith("/api/mcp")) {
        req.setTimeout(60000);
    }
    next();
});

// CORS - allowed origins
const allowedOrigins = [
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
];

// Initialize websocket server with CORS
initSocket(server, allowedOrigins);

// CORS middleware
app.use(corsMiddleware);
app.use(accessLogger);

// Log errors to error.log
app.use(errorLogger);

// Console logging in development
if (process.env.NODE_ENV !== "production") {
    app.use(devLogger);
}

// Body parsers
app.use(
    express.json({
        limit: "10mb",
    }),
);

app.use(cookieParser());

app.use(
    express.urlencoded({
        extended: true,
        limit: "10mb",
    }),
);

// Security headers for MCP endpoints
app.use('/api/mcp/*', (req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    next();
});

// Request logger
if (process.env.NODE_ENV !== "production") {
    app.use((req, res, next) => {
        console.log(`${req.method} ${req.originalUrl} - ${req.ip}`);
        next();
    });
}

// Apply rate limiting
app.use("/api", apiLimiter);
app.use("/api/auth/login", authLimiter);
app.use("/api/auth/signup", authLimiter);
app.use("/api/auth/forgot-password", authLimiter);
app.use("/api/auth/reset-password", authLimiter);
app.use("/api/auth/refresh-token", authLimiter);
app.use("/api/admin", adminLimiter);
app.use("/api/mcp", mcpLimiter);

// Bot detection middleware (only once, not duplicated)
app.use(addBotDetectionHeaders);
app.use(detectBot);

// AI Crawler verification middleware
app.use(verifyAICrawler);

// Agent fraud detection middleware
app.use(detectAgenticFraud);

// Health check endpoint
app.get("/health", (req, res) => {
    const healthData = buildHealthResponse({
        environment: process.env.NODE_ENV || "development",
        uptime: process.uptime(),
        memoryUsage: process.memoryUsage(),
    });
    return res.status(200).json(healthData);
});

// Root route
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
            mcp: "/api/mcp"
        },
        security: {
            rateLimiting: "Enabled",
            helmet: "Enabled",
            cors: "Configured",
            mcpSecurity: "Enabled"
        }
    });
});

// API routes
app.use("/api", routes);
app.use("/api/ai", aiRoutes);
app.use("/api/ai-feed", aiFeedRoutes);
app.use("/api/ai/financial", aiFinancialRoutes);
app.use("/api/ai-legal", aiLegalRoutes);
app.use("/api/legal", legalRoutes);
app.use("/api/agents", agentRoutes);
app.use("/api/performance", performanceRoutes);
app.use("/api/security", securityRoutes);
app.use("/api/approvals", approvalRoutes);
app.use("/api/rollback", rollbackRoutes);
app.use("/api/copywriter", copywriterRoutes);
app.use("/api/fraud", fraudRoutes);
app.use("/api/mcp", mcpRoutes);

// 404 handler
app.use((req, res) => {
    return res.status(404).json({
        success: false,
        errorCode: "ROUTE_NOT_FOUND",
        message: `Route ${req.method} ${req.originalUrl} not found`,
    });
});

// Global error handler
app.use(globalErrorHandler(errorLogStream));

// Process event handlers
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

// Graceful shutdown
function shutdown() {
    console.log("\nShutting down server gracefully...");
    server.close(() => {
        console.log("HTTP server closed");
        process.exit(0);
    });
    setTimeout(() => {
        console.error("Force shutdown after timeout");
        process.exit(1);
    }, 10000);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// Start server
server.listen(PORT, "0.0.0.0", () => {
    logServerStartup({
        port: PORT,
        environment: process.env.NODE_ENV || "development",
        frontendUrl: FRONTEND_URL,
        logsDir: logsDir,
        healthUrl: `http://localhost:${PORT}/health`,
        mcpSecurity: true,
        rateLimiting: true,
        helmet: true,
    });
});

module.exports = app;