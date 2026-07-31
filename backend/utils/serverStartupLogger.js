// src/utils/serverStartupLogger.js

/**
 * Logs server startup information.
 * @param {Object} options
 * @param {number|string} options.port - The port the server is listening on.
 * @param {string} options.environment - The current NODE_ENV.
 * @param {string} options.frontendUrl - The frontend URL.
 * @param {string} options.logsDir - The logs directory path.
 * @param {string} options.healthUrl - The health check URL.
 * @param {boolean} options.mcpSecurity - Whether MCP security is enabled.
 * @param {boolean} options.rateLimiting - Whether rate limiting is enabled.
 * @param {boolean} options.helmet - Whether Helmet is enabled.
 */
const logServerStartup = ({
  port,
  environment,
  frontendUrl,
  logsDir,
  healthUrl,
  mcpSecurity,
  rateLimiting,
  helmet,
}) => {
  console.log(`Server running on port ${port}`);
  console.log(`Environment: ${environment}`);
  console.log(`Frontend URL: ${frontendUrl}`);
  console.log(`Logs directory: ${logsDir}`);
  console.log(`Health check: ${healthUrl}`);
  console.log(`🔒 MCP Security: ${mcpSecurity ? 'Enabled' : 'Disabled'}`);
  console.log(`🔒 Rate Limiting: ${rateLimiting ? 'Enabled' : 'Disabled'}`);
  console.log(`🔒 Helmet: ${helmet ? 'Enabled' : 'Disabled'}`);
};

module.exports = { logServerStartup };