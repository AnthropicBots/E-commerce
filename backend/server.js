const express = require("express");

const cors = require("cors");
const cookieParser = require("cookie-parser");

const dotenv = require("dotenv");

const rateLimit = require("express-rate-limit");

const helmet = require("helmet");

// load environment
dotenv.config();

// validate critical env
const requiredEnv = [
  "JWT_SECRET",

  "DB_HOST",

  "DB_USER",

  "DB_PASSWORD",

  "DB_NAME",
];

requiredEnv.forEach((key) => {
  if (!process.env[key]) {
    console.error(`Missing environment variable: ${key}`);

    process.exit(1);
  }
});

// database
require("./config/db");

// routes
const productRoutes = require("./routes/productRoutes");

const authRoutes = require("./routes/authRoutes");

const orderRoutes = require("./routes/orderRoutes");

const promoRoutes = require("./routes/promoRoutes");
const adminRoutes = require("./routes/adminRoutes");
const chatRoutes = require("./routes/chatRoutes");

const wishlistRoutes =
    require(
        "./routes/wishlistRoutes"
    );
const recommendationRoutes = require("./routes/recommendationRoutes");

const cartRoutes =
    require(
        "./routes/cartRoutes"
    );

const pincodeRoutes = require("./routes/pincodeRoutes");

// init app
const app = express();
const http = require("http");
const server = http.createServer(app);
const { initSocket } = require("./utils/socketManager");
initSocket(server);

// constants
const PORT = Number(process.env.PORT) || 5000;

const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5500";

// trust proxy
app.set("trust proxy", 1);

// security
app.disable("x-powered-by");

// security headers
app.use(
  helmet({
    crossOriginEmbedderPolicy: false,

    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],

        scriptSrc: [
          "'self'",

          "'unsafe-inline'",

          "https://www.gstatic.com",

          "https://apis.google.com",
        ],

        styleSrc: [
          "'self'",

          "'unsafe-inline'",

          "https://fonts.googleapis.com",

          "https://cdnjs.cloudflare.com",
        ],

        fontSrc: [
          "'self'",

          "https://fonts.gstatic.com",

          "https://cdnjs.cloudflare.com",
        ],

        imgSrc: ["'self'", "data:", "https:"],

        connectSrc: ["'self'", FRONTEND_URL],
      },
    },
  }),
);

// allowed origins
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

// cors
app.use(
  cors({
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

    methods: ["GET", "POST", "PUT", "PATCH", "DeleteE"],

    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);

// body parsers
app.use(
  express.json({
    limit: "1mb",
  }),
);

app.use(cookieParser());

app.use(
  express.urlencoded({
    extended: true,

    limit: "1mb",
  }),
);

// request logger
if (process.env.NODE_ENV !== "production") {
  app.use((req, res, next) => {
    console.log(`${req.method} ${req.originalUrl}`);

    next();
  });
}

// auth limiter
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,

  max: 20,

  standardHeaders: true,

  legacyHeaders: false,

  message: {
    success: false,

    message: "Too many requests. Please try again later.",
  },
});

// api limiter
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,

  max: 120,

  standardHeaders: true,

  legacyHeaders: false,

  message: {
    success: false,

    message: "Too many API requests",
  },
});

// apply rate limiting
app.use("/api", apiLimiter);

app.use("/api/auth/login", authLimiter);

app.use("/api/auth/signup", authLimiter);

// health route
app.get("/health", (req, res) => {
  return res.status(200).json({
    success: true,

    environment: process.env.NODE_ENV || "development",

    message: "Server is healthy",
  });
});

// root route
app.get("/", (req, res) => {
  return res.status(200).json({
    success: true,

    message: "E-Commerce Backend Running 🚀",
  });
});

// api routes
app.use("/api/products", productRoutes);

app.use("/api/auth", authRoutes);

app.use("/api/orders", orderRoutes);
app.use("/api/promos", promoRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/chat", chatRoutes);

app.use(
    "/api/wishlist",
    wishlistRoutes
);

app.use("/api/recommendations", recommendationRoutes);
app.use("/api/pincode", pincodeRoutes);
// 404 handler
app.use((req, res) => {
  return res.status(404).json({
    success: false,

    message: "Route not found",
  });
});

// global error handler
app.use((err, req, res, next) => {
  if (process.env.NODE_ENV !== "production") {
    console.error("SERVER ERROR:", err);
  } else {
    console.error("SERVER ERROR:", err.message);
  }

  if (res.headersSent) {
    return next(err);
  }

  return res.status(err.status || 500).json({
    success: false,

    message:
      process.env.NODE_ENV === "production"
        ? "Internal server error"
        : err.message,
  });
});

// unhandled promise rejection
process.on("unhandledRejection", (reason) => {
  console.error("UNHANDLED REJECTION:", reason);
  process.exit(1);
});

// uncaught exception
process.on("uncaughtException", (error) => {
  console.error("UNCAUGHT EXCEPTION:", error);

  process.exit(1);
});

// graceful shutdown
function shutdown() {
  console.log("\nShutting down server...");

  process.exit(0);
}

process.on("SIGINT", shutdown);

process.on("SIGTERM", shutdown);

// start server
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);

  console.log(`Environment: ${process.env.NODE_ENV || "development"}`);

  console.log(`Frontend URL: ${FRONTEND_URL}`);
});
