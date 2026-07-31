// backend/config/redis.js
const Redis = require('ioredis');
const logger = require('./logger');

const redis = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
    password: process.env.REDIS_PASSWORD,
    db: process.env.REDIS_DB || 0,
    retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
    },
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: false
});

redis.on('connect', () => {
    logger.info('Redis connected successfully');
});

redis.on('error', (error) => {
    logger.error('Redis connection error:', error);
});

redis.on('ready', () => {
    logger.info('Redis ready');
});

module.exports = redis;