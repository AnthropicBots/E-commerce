// src/utils/logStreams.js
const fs = require('fs');
const path = require('path');

// Create the logs directory in the project root (process.cwd ensures root path, not src/utils path)
const logDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

// Initialize the log streams with append mode ('a' flag)
const accessLogStream = fs.createWriteStream(path.join(logDir, 'access.log'), { flags: 'a' });
const errorLogStream = fs.createWriteStream(path.join(logDir, 'errors.log'), { flags: 'a' });

module.exports = {
  accessLogStream,
  errorLogStream
};