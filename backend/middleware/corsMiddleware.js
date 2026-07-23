// middleware/corsMiddleware.js
const cors = require("cors");

const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5500";

// Allowed Origins List
const allowedOrigins = [
  // localhost
  "http://localhost:5500",
  "http://127.0.0.1:5500",

  "http://localhost:5501",
  "http://127.0.0.1:5501",

  "http://localhost:5502",
  "http://127.0.0.1:5502",

  // local network testing
  "http://172.18.208.1:5500",
  "http://172.18.208.1:5501",
  "http://172.18.208.1:5502",

  FRONTEND_URL,

  // production
  "https://e-commerce-git-main-bhuvanshs-projects.vercel.app",
  "https://www.bhuvansh.xyz",

  // local file execution
  "null"
];

// CORS Configuration
const corsOptions = {
  origin: (origin, callback) => {
    // allow non-browser requests
    if (!origin) {
      return callback(null, true);
    }

    const isAllowed =
      allowedOrigins.includes(origin) ||
      /^http:\/\/172\.\d+\.\d+\.\d+:\d+$/.test(origin);

    if (isAllowed) {
      return callback(null, true);
    }

    return callback(new Error("CORS not allowed"));
  },

  credentials: true,

  methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],

  allowedHeaders: ["Content-Type", "Authorization"],
};

// Export the configured middleware
const corsMiddleware = cors(corsOptions);
module.exports = corsMiddleware;