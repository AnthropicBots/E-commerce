// backend/middleware/errorHandler.js

/**
 * Global Error Handler Middleware
 * @param {fs.WriteStream} errorLogStream - The stream to write error logs to.
 * @returns {Function} Express error handling middleware.
 */
const globalErrorHandler = (errorLogStream) => {
  return (err, req, res, next) => {
    // Log error details
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

    // Write to error log file
    errorLogStream.write(JSON.stringify(errorLog) + "\n");

    if (process.env.NODE_ENV !== "production") {
      console.error("SERVER ERROR:", err);
    } else {
      console.error("SERVER ERROR:", err.message);
    }

    // If headers have already been sent, delegate to the default error handler
    if (res.headersSent) {
      return next(err);
    }

    // Handle timeout errors
    if (err.code === "ETIMEDOUT" || err.timeout) {
      return res.status(408).json({
        success: false,
        errorCode: "REQUEST_TIMEOUT",
        message: "Request timeout. Please try again.",
      });
    }

    // Handle rate limit errors
    if (err.code === "RATE_LIMIT_EXCEEDED") {
      return res.status(429).json({
        success: false,
        errorCode: "RATE_LIMIT_EXCEEDED",
        message: "Too many requests. Please try again later.",
      });
    }

    // Handle MCP specific errors
    if (err.code === "MCP_SECURITY_ERROR") {
      return res.status(403).json({
        success: false,
        errorCode: "MCP_SECURITY_ERROR",
        message: err.message || "MCP security validation failed",
      });
    }

    // Default error response
    return res.status(err.status || 500).json({
      success: false,
      errorCode: err.errorCode || "INTERNAL_SERVER_ERROR",
      message: process.env.NODE_ENV === "production"
        ? "Internal server error"
        : err.message,
      ...(process.env.NODE_ENV === "development" && { stack: err.stack }),
    });
  };
};

module.exports = globalErrorHandler;