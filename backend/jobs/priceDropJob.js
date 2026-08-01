/**
 * Wishlist price-drop notification cron worker (#1394).
 *
 * Periodically syncs wishlist baselines, detects price drops, and enqueues
 * notifications through wishlistNotifyService (broker + email + dedupe).
 */

"use strict";

const cron = require("node-cron");
const logger = require("../utils/logger");
const wishlistNotifyService = require("../services/wishlistNotifyService");

// Every 15 minutes — frequent enough for sale windows, cheap on the DB.
const PRICE_DROP_CRON = process.env.PRICE_DROP_CRON || "*/15 * * * *";

let scheduledTask = null;

async function runPriceDropJob() {
    logger.info("Price-drop job: starting scan…");
    try {
        const result = await wishlistNotifyService.runPriceDropScan();
        logger.info(
            `Price-drop job: candidates=${result.candidates} notified=${result.notified} skipped=${result.skipped}`
        );
        return result;
    } catch (error) {
        logger.error(`Price-drop job failed: ${error.message}`);
        throw error;
    }
}

function startPriceDropJob() {
    if (process.env.NODE_ENV === "test") {
        return null;
    }
    if (process.env.PRICE_DROP_JOB_ENABLED === "false") {
        logger.info("Price-drop job disabled via PRICE_DROP_JOB_ENABLED=false");
        return null;
    }
    if (scheduledTask) {
        return scheduledTask;
    }

    scheduledTask = cron.schedule(PRICE_DROP_CRON, () => {
        runPriceDropJob().catch(() => {});
    });
    logger.info(`Price-drop job scheduled (${PRICE_DROP_CRON})`);
    return scheduledTask;
}

function stopPriceDropJob() {
    if (scheduledTask) {
        scheduledTask.stop();
        scheduledTask = null;
    }
}

module.exports = {
    runPriceDropJob,
    startPriceDropJob,
    stopPriceDropJob,
    PRICE_DROP_CRON
};
