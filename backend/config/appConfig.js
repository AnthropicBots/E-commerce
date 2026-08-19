// backend/config/appConfig.js
const path = require("path");

const PORT = Number(process.env.PORT) || 5000;
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5500";
const LOG_DIR = path.join(process.cwd(), "logs");

const ALLOWED_ORIGINS = [
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
    "https://ecommerce.vercel.app",
    "https://e-commerce-git-main-bhuvanshs-projects.vercel.app",
    "https://www.bhuvansh.xyz",
    "https://e-commerce-production-d546.up.railway.app"
];

module.exports = {
    port: PORT,
    frontendUrl: FRONTEND_URL,
    logDir: LOG_DIR,
    allowedOrigins: ALLOWED_ORIGINS,
    bodyLimit: "10mb",
    requestTimeout: "30s",
    longRequestTimeoutMs: 60000,
    compression: {
        level: 6,
        threshold: 1024
    }
};
