// backend/config/logger.js
const winston = require('winston');
const { ElasticsearchTransport } = require('winston-elasticsearch');

const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
    ),
    defaultMeta: { service: 'ai-audit-trail' },
    transports: [
        new winston.transports.File({
            filename: 'logs/error.log',
            level: 'error'
        }),
        new winston.transports.File({
            filename: 'logs/combined.log'
        })
    ]
});

// If we're not in production, also log to console
if (process.env.NODE_ENV !== 'production') {
    logger.add(new winston.transports.Console({
        format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple()
        )
    }));
}

// Elasticsearch transport if configured
if (process.env.ELASTICSEARCH_URL) {
    const esTransport = new ElasticsearchTransport({
        level: 'info',
        index: 'audit-logs',
        clientOpts: {
            node: process.env.ELASTICSEARCH_URL,
            auth: {
                username: process.env.ELASTICSEARCH_USERNAME,
                password: process.env.ELASTICSEARCH_PASSWORD
            }
        }
    });
    logger.add(esTransport);
}

module.exports = logger;