/**
 * Abandoned-cart recovery cron worker (#1429).
 *
 * Runs the recovery sweep on a schedule: which baskets are due a message, and
 * which are suppressed, is decided entirely by cartRecoveryService. This is the
 * clock and nothing else.
 */

'use strict';

const cron = require('node-cron');
const logger = require('../utils/logger');
const cartRecoveryService = require('../services/cartRecoveryService');

// Every twenty minutes. The stage delays are measured in hours, so the run
// interval only decides how late a due message can be, and a tighter schedule
// buys punctuality nobody would notice at the cost of a scan nobody needs.
const CART_RECOVERY_CRON = process.env.CART_RECOVERY_CRON || '*/20 * * * *';

let scheduledTask = null;

async function runCartRecoveryJob() {
    logger.info('Cart recovery job: starting sweep…');

    try {
        const result = await cartRecoveryService.runRecoverySweep();

        logger.info(
            `Cart recovery job: candidates=${result.candidates} sent=${result.sent}`
        );

        return result;
    } catch (error) {
        logger.error(`Cart recovery job failed: ${error.message}`);
        throw error;
    }
}

function startCartRecoveryJob() {
    if (process.env.NODE_ENV === 'test') {
        return null;
    }
    if (process.env.CART_RECOVERY_JOB_ENABLED === 'false') {
        logger.info('Cart recovery job disabled via CART_RECOVERY_JOB_ENABLED=false');
        return null;
    }
    if (scheduledTask) {
        return scheduledTask;
    }

    scheduledTask = cron.schedule(CART_RECOVERY_CRON, () => {
        runCartRecoveryJob().catch(() => {});
    });
    logger.info(`Cart recovery job scheduled (${CART_RECOVERY_CRON})`);

    return scheduledTask;
}

function stopCartRecoveryJob() {
    if (scheduledTask) {
        scheduledTask.stop();
        scheduledTask = null;
    }
}

module.exports = {
    runCartRecoveryJob,
    startCartRecoveryJob,
    stopCartRecoveryJob,
    CART_RECOVERY_CRON
};
