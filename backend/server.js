const express = require("express");
const helmetMiddleware = require("./middleware/helmetMiddleware");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const compression = require("compression");
const morgan = require("morgan");
const timeout = require("connect-timeout");
const fs = require("fs");
const path = require("path");
// Add with other imports
const multiAgentRoutes = require('./routes/multiAgentRoutes');
const { multiAgentCoordinationService } = require('./services/multiAgentCoordinationService');

// Initialize service
await multiAgentCoordinationService.initialize();

// Add routes
app.use('/api/multi-agent', multiAgentRoutes);
const dotenv = require("dotenv");
const rateLimit = require("express-rate-limit");
const helmet = require("helmet");
const corsMiddleware = require("./middleware/corsMiddleware");

const routes = require("./routes/index");
const authLimiter = require("./middleware/authLimiter");
const mcpRoutes = require("./routes/mcpRoutes"); // ✅ MCP Routes added

// Add with other route imports

const copywriterRoutes = require('./routes/copywriterRoutes');

// Add copywriter routes
app.use('/api/copywriter', copywriterRoutes);

const aiRoutes = require('./routes/aiRoutes');

// Add AI routes
app.use('/api/ai', aiRoutes);

// load environment
dotenv.config();
const { validateEnv } = require('./config/envValidator');
validateEnv();

// database
require("./config/db");

// init app
const app = express();
const http = require("http");
const server = http.createServer(app);
const { initSocket } = require("./utils/socketManager");

// constants
const PORT = Number(process.env.PORT) || 5000;
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5500";

// create logs directory
const logDir = path.join(__dirname, "logs");
if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
}

// request logging with morgan
const accessLogStream = fs.createWriteStream(
    path.join(logDir, "access.log"),
    { flags: "a" }
);

const errorLogStream = fs.createWriteStream(
    path.join(logDir, "errors.log"),
    { flags: "a" }
);

// custom morgan tokens
morgan.token("user-id", (req) => req.user?.id || "anonymous");
morgan.token("user-email", (req) => req.user?.email || "anonymous");

// log all requests to access.log
app.use(morgan("combined", { stream: accessLogStream }));

// log errors to error.log
app.use(morgan("combined", {
    stream: errorLogStream,
    skip: (req, res) => res.statusCode < 400
}));

// console logging in development
if (process.env.NODE_ENV !== "production") {
    app.use(morgan("dev"));
}

// trust proxy
app.set("trust proxy", 1);

// security
app.disable("x-powered-by");

// security headers
app.use(helmetMiddleware);

// compression - gzip/brotli
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

// request timeout
app.use(timeout("30s"));

// extend timeout for specific routes
app.use((req, res, next) => {
    if (req.path.startsWith("/api/admin") || 
        req.path === "/api/upload" || 
        req.path === "/api/export" ||
        req.path.startsWith("/api/mcp")) { // ✅ MCP timeout extended
        req.setTimeout(60000);
    }
    next();
});

// cors - allowed origins
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
    "https://www.bhuvansh.xyz"
];

// initialize websocket server with CORS
initSocket(server, allowedOrigins);

// cors
app.use(corsMiddleware);

// body parsers
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

// ✅ Security headers for MCP endpoints
app.use('/api/mcp/*', (req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    next();
});

// request logger
if (process.env.NODE_ENV !== "production") {
    app.use((req, res, next) => {
        console.log(`${req.method} ${req.originalUrl} - ${req.ip}`);
        next();
    });
}

// rate limiting
// global api limiter - 120 requests per minute
const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        success: false,
        errorCode: "API_RATE_LIMIT_EXCEEDED",
        message: "Too many API requests. Please slow down.",
    },
});

// admin limiter - 100 requests per 15 minutes
const adminLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        success: false,
        errorCode: "ADMIN_RATE_LIMIT_EXCEEDED",
        message: "Too many admin requests. Please try again after 15 minutes.",
    },
});

// ✅ MCP specific rate limiter - stricter
const mcpLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 10, // 10 requests per minute
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        success: false,
        errorCode: "MCP_RATE_LIMIT_EXCEEDED",
        message: "Too many MCP requests. Please try again after 1 minute.",
    },
});

// apply rate limiting
app.use("/api", apiLimiter);

// auth routes rate limiting
app.use("/api/auth/login", authLimiter);
app.use("/api/auth/signup", authLimiter);
app.use("/api/auth/forgot-password", authLimiter);
app.use("/api/auth/reset-password", authLimiter);
app.use("/api/auth/refresh-token", authLimiter);

// admin routes rate limiting
app.use("/api/admin", adminLimiter);

// ✅ MCP routes rate limiting
app.use("/api/mcp", mcpLimiter);

// health check
app.get("/health", (req, res) => {
    return res.status(200).json({
        success: true,
        status: "OK",
        environment: process.env.NODE_ENV || "development",
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        message: "Server is healthy",
    });
});

// root route
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
            mcp: "/api/mcp", // ✅ MCP endpoint added
        },
        security: {
            rateLimiting: "Enabled",
            helmet: "Enabled",
            cors: "Configured",
            mcpSecurity: "Enabled",
        }
    });
});

// api routes
app.use("/api", routes);

// ✅ MCP routes - must be after auth routes but before 404
app.use("/api/mcp", mcpRoutes);

// 404 handler
app.use((req, res) => {
    return res.status(404).json({
        success: false,
        errorCode: "ROUTE_NOT_FOUND",
        message: `Route ${req.method} ${req.originalUrl} not found`,
    });
});

// global error handler
app.use((err, req, res, next) => {
    // log error
    const errorLog = {
        timestamp: new Date().toISOString(),
        status: err.status || 500,
        message: err.message,
        stack: process.env.NODE_ENV === "development" ? err.stack : undefined,
        path: req.path,
        method: req.method,
        ip: req.ip,
        userAgent: req.headers["user-agent"],
        userId: req.user?.id || "anonymous",
        errorCode: err.errorCode || "INTERNAL_SERVER_ERROR",
    };

    // write to error log file
    errorLogStream.write(JSON.stringify(errorLog) + "\n");

    if (process.env.NODE_ENV !== "production") {
        console.error("SERVER ERROR:", err);
    } else {
        console.error("SERVER ERROR:", err.message);
    }

    if (res.headersSent) {
        return next(err);
    }

    // handle timeout errors
    if (err.code === "ETIMEDOUT" || err.timeout) {
        return res.status(408).json({
            success: false,
            errorCode: "REQUEST_TIMEOUT",
            message: "Request timeout. Please try again.",
        });
    }

    // handle rate limit errors
    if (err.code === "RATE_LIMIT_EXCEEDED") {
        return res.status(429).json({
            success: false,
            errorCode: "RATE_LIMIT_EXCEEDED",
            message: "Too many requests. Please try again later.",
        });
    }

    // ✅ Handle MCP specific errors
    if (err.code === "MCP_SECURITY_ERROR") {
        return res.status(403).json({
            success: false,
            errorCode: "MCP_SECURITY_ERROR",
            message: err.message || "MCP security validation failed",
        });
    }

    // default error response
    return res.status(err.status || 500).json({
        success: false,
        errorCode: err.errorCode || "INTERNAL_SERVER_ERROR",
        message: process.env.NODE_ENV === "production"
            ? "Internal server error"
            : err.message,
        ...(process.env.NODE_ENV === "development" && { stack: err.stack }),
    });
});

// unhandled rejection
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

// uncaught exception
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

// graceful shutdown
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

// start server
server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || "development"}`);
    console.log(`Frontend URL: ${FRONTEND_URL}`);
    console.log(`Logs directory: ${logDir}`);
    console.log(`Health check: http://localhost:${PORT}/health`);
    console.log(`🔒 MCP Security: Enabled`);
    console.log(`🔒 Rate Limiting: Enabled`);
    console.log(`🔒 Helmet: Enabled`);
});

module.exports = app;