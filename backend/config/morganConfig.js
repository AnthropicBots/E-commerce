// src/config/morganConfig.js
const morgan = require('morgan');
const { accessLogStream, errorLogStream } = require('../utils/logStreams');

// Register custom morgan tokens (Moved from app.js)
morgan.token("user-id", (req) => req.user?.id || "anonymous");
morgan.token("user-email", (req) => req.user?.email || "anonymous");

// Middleware to log all requests to access.log (combined format)
const accessLogger = morgan("combined", { stream: accessLogStream });

// Middleware to log errors to errors.log (skip successful requests)
const errorLogger = morgan("combined", {
  stream: errorLogStream,
  skip: (req, res) => res.statusCode < 400
});

// Middleware to log to console in development
const devLogger = process.env.NODE_ENV !== "production"
  ? morgan("dev")
  : (req, res, next) => next(); // No-op in production

module.exports = {
  accessLogger,
  errorLogger,
  devLogger
};