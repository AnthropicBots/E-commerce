// backend/services/stockAlertScheduler.js
//
// Periodic scan that drives the stock-alert evaluation engine (#1233). On a
// cron interval it runs evaluateRestocks() and evaluatePriceDrops(); each run
// is wrapped so a single failing scan (or broker hiccup) never crashes the
// process or stops future ticks.

const cron = require("node-cron");
const logger = require("../utils/logger");
const stockAlertService = require("../services/stockAlertService");

// Every 5 minutes. Frequent enough that restocks/price drops surface quickly,
// infrequent enough to stay cheap against the DB.
const SCAN_CRON_EXPRESSION = "*/5 * * * *";

async function runScan() {
    try {
        const restocked = await stockAlertService.evaluateRestocks();
        logger.info(`Stock-alert scan: dispatched ${restocked} back-in-stock alert(s)`);
    } catch (error) {
        logger.error(`Stock-alert scan (restocks) failed: ${error.message}`);
    }

    try {
        const priceDrops = await stockAlertService.evaluatePriceDrops();
        logger.info(`Stock-alert scan: dispatched ${priceDrops} price-drop alert(s)`);
    } catch (error) {
        logger.error(`Stock-alert scan (price drops) failed: ${error.message}`);
    }
}

let scheduledTask = null;

// Start the recurring scan. No-op under the test environment so unit runs don't
// spin up a live cron timer, and idempotent so repeated calls don't stack tasks.
function startStockAlertScheduler() {
    if (process.env.NODE_ENV === "test") {
        return null;
    }
    if (scheduledTask) {
        return scheduledTask;
    }

    scheduledTask = cron.schedule(SCAN_CRON_EXPRESSION, runScan);
    logger.info(`Stock-alert scheduler started (${SCAN_CRON_EXPRESSION})`);
    return scheduledTask;
}

module.exports = {
    startStockAlertScheduler,
    runScan,
    SCAN_CRON_EXPRESSION
};
