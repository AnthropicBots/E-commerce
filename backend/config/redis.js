// backend/config/redis.js
//
// The single Redis client for the whole backend.
//
// Six modules used to each do their own `new Redis({ ... })` --
// promo.service, promo.controller, chat.service, courierWebhookService,
// agentLiabilityService and socketManager -- so a single process opened seven
// connections to the same server, each with slightly different options (one
// omitted `maxRetriesPerRequest`, none set `db`) and each with its own
// independent reconnect loop. When Redis was down that meant seven concurrent
// retry storms and seven copies of every error line.
//
// It also made the backend untestable offline: because the clients were
// constructed at module scope, merely *requiring* promo.service opened a
// socket, and `jest.mock('../config/redis')` could not intercept a client the
// module had built for itself (#1341).
//
// Everything now shares this instance. Callers that need their own connection
// -- pub/sub clients must not share with a command client -- should call
// `redis.duplicate()`, which inherits this configuration.

const Redis = require('ioredis');
const logger = require('./logger');

const isTest = process.env.NODE_ENV === 'test';

const REDIS_OPTIONS = {
    host: process.env.REDIS_HOST || 'localhost',
    port: Number(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    db: Number(process.env.REDIS_DB) || 0,
    retryStrategy: (times) => Math.min(times * 50, 2000),
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,

    // Under Jest the module graph is loaded but Redis is not running. Connecting
    // eagerly produced an endless ECONNREFUSED loop that both drowned the test
    // output and held the event loop open, so suites that touched any of the
    // modules above timed out instead of failing with a useful message.
    lazyConnect: isTest
};

const redis = new Redis(REDIS_OPTIONS);

redis.on('connect', () => {
    logger.info('Redis connected successfully');
});

redis.on('error', (error) => {
    // ioredis emits `error` on every reconnect attempt. Logging each one turns a
    // Redis outage into a log flood, so repeats of the same code are collapsed.
    if (redis.__lastErrorCode !== error.code) {
        redis.__lastErrorCode = error.code;
        logger.error(`Redis connection error: ${error.message}`);
    }
});

redis.on('ready', () => {
    redis.__lastErrorCode = null;
    logger.info('Redis ready');
});

module.exports = redis;
module.exports.REDIS_OPTIONS = REDIS_OPTIONS;
