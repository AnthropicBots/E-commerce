// backend/index.js
const app = require('./server');
const { init } = require('./bootstrap');
const appConfig = require('./config/appConfig');

const server = app.server || app;

init().then(() => {
    console.log("Starting HTTP server...");
    const { logServerStartup } = require('./utils/serverStartupLogger');
    server.listen(appConfig.port, "0.0.0.0", () => {
        logServerStartup({
            port: appConfig.port,
            environment: process.env.NODE_ENV || "development",
            frontendUrl: appConfig.frontendUrl,
            logsDir: appConfig.logDir,
            healthUrl: `http://localhost:${appConfig.port}/health`,
            mcpSecurity: true,
            rateLimiting: true,
            helmet: true,
        });
    });
}).catch((err) => {
    console.error("Bootstrap initialization failed:", err);
    process.exit(1);
});
