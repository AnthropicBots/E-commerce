// backend/index.js
const app = require('./server');
const { init } = require('./bootstrap');

const server = app.server || app;
const PORT = Number(process.env.PORT) || 5000;
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5500";
const path = require('path');
const logDir = path.join(process.cwd(), "logs");

init().then(() => {
    console.log("Starting HTTP server...");
    const { logServerStartup } = require('./utils/serverStartupLogger');
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
}).catch((err) => {
    console.error("Bootstrap initialization failed:", err);
    process.exit(1);
});
