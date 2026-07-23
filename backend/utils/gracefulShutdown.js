// src/utils/gracefulShutdown.js

let isShutdownSetup = false;  // Flag to track if already set up

/**
 * Sets up graceful shutdown handlers for SIGINT and SIGTERM signals.
 * @param {http.Server} server - The HTTP server instance to shut down.
 */
const setupGracefulShutdown = (server) => {
  // Check if already set up
  if (isShutdownSetup) {
    console.warn(' Graceful shutdown already set up, skipping duplicate registration');
    return;
  }

  const shutdown = () => {
    console.log("\n Shutting down server gracefully...");
    server.close(() => {
      console.log("HTTP server closed");
      process.exit(0);
    });
    setTimeout(() => {
      console.error(" Force shutdown after timeout");
      process.exit(1);
    }, 10000);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  
  isShutdownSetup = true;  // Mark as set up
  console.log(" Graceful shutdown handlers registered");
};

module.exports = setupGracefulShutdown;