// src/utils/healthResponseBuilder.js

/**
 * Builds the standard health check response object.
 * @param {Object} options - The input data for the response.
 * @param {string} [options.environment] - The current NODE_ENV.
 * @param {number} [options.uptime] - Process uptime in seconds.
 * @param {Object} [options.memoryUsage] - Process memory usage object.
 * @returns {Object} - The formatted health check response.
 */
const buildHealthResponse = ({ environment, uptime, memoryUsage }) => {
  return {
    success: true,
    status: "OK",
    environment: environment || "development",
    timestamp: new Date().toISOString(),
    uptime: uptime,
    memory: memoryUsage,
    message: "Server is healthy",
  };
};

module.exports = { buildHealthResponse };