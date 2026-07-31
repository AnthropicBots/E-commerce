// src/utils/processEventHandlers.js

/**
 * Sets up process-level event handlers for unhandledRejection and uncaughtException.
 * @param {fs.WriteStream} errorLogStream - The stream to write error logs to.
 */
const setupProcessEventHandlers = (errorLogStream) => {
  // Unhandled Rejection Handler
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

  // Uncaught Exception Handler
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
};

module.exports = setupProcessEventHandlers;