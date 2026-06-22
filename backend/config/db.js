const mysql = require("mysql2");

require("dotenv").config();

const requiredEnvVars = ["DB_HOST", "DB_USER", "DB_PASSWORD", "DB_NAME"];

requiredEnvVars.forEach((key) => {
  if (!process.env[key]) {
    console.error(`Missing environment variable: ${key}`);
    process.exit(1);
  }
});

// Enable TLS when DB_SSL=true (required by TiDB Cloud and most managed MySQL hosts)
const useSSL = process.env.DB_SSL === "true";

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: useSSL ? { minVersion: "TLSv1.2", rejectUnauthorized: true } : undefined,
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_CONNECTION_LIMIT) || 10,
  queueLimit: 0,
  connectTimeout: 10000,
  charset: "utf8mb4",
  supportBigNumbers: true,
  multipleStatements: false,
});

const promisePool = pool.promise();

let dbConnected = false;

async function testConnection(retryInterval = 5000) {
  try {
    const connection = await promisePool.getConnection();
    console.log("MySQL Connected Successfully");
    connection.release();
    dbConnected = true;
  } catch (error) {
    dbConnected = false;
    console.error("Database Connection Failed:");
    console.error(error.message);
    console.error(`Retrying DB connection in ${retryInterval / 1000}s...`);
    setTimeout(
      () => testConnection(Math.min(retryInterval * 2, 30000)),
      retryInterval,
    );
  }
}

testConnection();

async function shutdown() {
  try {
    console.log("\nClosing MySQL connections...");
    await promisePool.end();
    console.log("MySQL pool closed");
    process.exit(0);
  } catch (error) {
    console.error("Error closing MySQL pool:", error.message);
    process.exit(1);
  }
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

pool.on("error", (error) => {
  console.error("MySQL Pool Error:", error.message);

  if (error.code === "PROTOCOL_CONNECTION_LOST") {
    console.error("Database connection lost.");
  }
  if (error.code === "ER_CON_COUNT_ERROR") {
    console.error("Database has too many connections.");
  }
  if (error.code === "ECONNREFUSED") {
    console.error("Database connection refused.");
  }
});

module.exports = promisePool;
module.exports.rawPool = pool;
module.exports.isConnected = () => dbConnected;
