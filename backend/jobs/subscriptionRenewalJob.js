/**
 * Subscription renewal worker (#1494).
 *
 * This job has never renewed a subscription. Its one query selected
 * `p.interval` unquoted; INTERVAL is a reserved word, so MySQL read it as the
 * start of an interval literal and refused the statement. The parse error
 * landed in the function's own catch, which logged one line and returned, so
 * the job "ran" daily and did nothing, and every subscription ever created is
 * still `active` with a period end in the past. A monthly plan was a lifetime
 * plan.
 *
 * Four other things had to change with it, because each would have been a bug
 * of its own the moment the query started working:
 *
 *   * the charge was `Math.random() > 0.2`, not behind any flag, so fixing the
 *     SQL alone would have started cancelling roughly one customer in 125
 *     every three days for no reason connected to anything they did;
 *   * a successful renewal advanced the period and took no money, with a
 *     comment saying a saga would handle it -- there is no subscription step
 *     in sagaOrchestratorService;
 *   * a failed renewal left `current_period_end` alone, so the retry cadence
 *     was whatever the sweep interval happened to be;
 *   * the schedule was a bare top-level `setInterval` in server.js, outside
 *     the NODE_ENV guard the other three jobs sit behind, with no unref, and
 *     with the first run 24 hours after boot.
 *
 * What is here now is the clock and the decision about each row. The rules
 * live in subscriptionService, which the controller also uses, so the period
 * arithmetic exists once instead of twice.
 */

'use strict';

const cron = require('node-cron');
const logger = require('../utils/logger');
const subscriptionService = require('../services/subscriptionService');

// Hourly. The periods are measured in days at the shortest, so the interval
// only decides how late a renewal can be; an hourly sweep also means a service
// that restarts twice a day still renews, which a 24-hour timer reset on every
// boot did not.
const SUBSCRIPTION_RENEWAL_CRON =
    process.env.SUBSCRIPTION_RENEWAL_CRON || '0 * * * *';

/** How many lapsed subscriptions one sweep will look at. */
const RENEWAL_BATCH_SIZE = Number(process.env.SUBSCRIPTION_RENEWAL_BATCH) || 500;

let scheduledTask = null;

/**
 * Charge a subscription's renewal.
 *
 * There is no off-session charge available here and it is worth being plain
 * about why rather than papering over it: `payment.service.js` wraps Stripe's
 * PaymentIntents, which need a client to confirm them. Recurring billing needs
 * a saved payment method and an off-session confirmation, and neither exists
 * in this codebase yet.
 *
 * So this returns `configured: false` unless a stand-in is explicitly switched
 * on, and the sweep treats an unconfigured provider as "leave it alone" rather
 * than as a failure. That distinction is the whole point. The previous code
 * had no provider either, and expressed that as a coin flip that cancelled
 * real subscriptions -- a missing integration must not look like a customer
 * whose card was declined.
 *
 * `SUBSCRIPTION_MOCK_PAYMENTS=true` turns on a stand-in that always succeeds.
 * Always, not usually: a development stub that fails at random makes local
 * behaviour unreproducible, and randomness is what this is replacing.
 *
 * @param {object} subscription
 * @returns {Promise<{configured: boolean, success?: boolean, reason?: string}>}
 */
async function chargeRenewal(subscription) {
    if (process.env.SUBSCRIPTION_MOCK_PAYMENTS === 'true') {
        logger.debug(
            `Subscription ${subscription.id}: mock payment accepted ` +
                `(${subscription.currency} ${subscription.price})`
        );
        return { configured: true, success: true };
    }

    return {
        configured: false,
        reason:
            'No recurring payment provider is configured. Set SUBSCRIPTION_MOCK_PAYMENTS=true ' +
            'in development, or wire an off-session charge in before enabling this in production.'
    };
}

/**
 * One pass over everything whose period has lapsed.
 *
 * Each subscription is handled on its own: a row that throws is logged and the
 * sweep continues, because one bad plan must not stop everyone else renewing.
 *
 * @param {object} [options]
 * @param {Date} [options.now] - injectable so tests do not depend on the clock
 * @param {Function} [options.charge] - injectable payment step
 * @returns {Promise<{due: number, renewed: number, canceled: number, pastDue: number, skipped: number, failed: number}>}
 */
async function processRenewals({ now = new Date(), charge = chargeRenewal } = {}) {
    const summary = {
        due: 0,
        renewed: 0,
        canceled: 0,
        pastDue: 0,
        skipped: 0,
        failed: 0
    };

    let due;

    try {
        due = await subscriptionService.findDueForRenewal(now, RENEWAL_BATCH_SIZE);
    } catch (error) {
        // This is where the parse error used to land, silently.
        logger.error(`Subscription renewal sweep could not read due rows: ${error.message}`);
        throw error;
    }

    summary.due = due.length;

    if (!due.length) {
        logger.debug('Subscription renewal sweep: nothing due');
        return summary;
    }

    logger.info(`Subscription renewal sweep: ${due.length} due`);

    let warnedUnconfigured = false;

    for (const subscription of due) {
        try {
            // Asked to end, and the period it was to end at has passed.
            if (subscription.cancel_at_period_end) {
                await subscriptionService.completeCancellation(subscription, now);
                summary.canceled += 1;
                continue;
            }

            const payment = await charge(subscription);

            if (!payment.configured) {
                // Leave the row exactly as it is. It stays due, and the next
                // sweep will pick it up once a provider exists. Cancelling
                // somebody because *we* have not built billing is not a
                // customer outcome anyone would defend.
                summary.skipped += 1;

                if (!warnedUnconfigured) {
                    logger.warn(`Subscription renewal skipped: ${payment.reason}`);
                    warnedUnconfigured = true;
                }
                continue;
            }

            if (payment.success) {
                const result = await subscriptionService.recordRenewal(subscription, now);
                summary.renewed += 1;

                logger.info(
                    `Subscription ${subscription.id} renewed to ` +
                        `${result.periodEnd.toISOString()} (${result.periodsBilled} period(s))`
                );
                continue;
            }

            const result = await subscriptionService.recordDunningFailure(subscription, now);

            if (result.outcome === 'canceled') {
                summary.canceled += 1;
            } else {
                summary.pastDue += 1;
            }
        } catch (error) {
            summary.failed += 1;
            logger.error(
                `Subscription ${subscription.id} could not be processed: ${error.message}`
            );
        }
    }

    logger.info(
        `Subscription renewal sweep finished: renewed=${summary.renewed} ` +
            `canceled=${summary.canceled} pastDue=${summary.pastDue} ` +
            `skipped=${summary.skipped} failed=${summary.failed}`
    );

    return summary;
}

/**
 * Put the sweep on a schedule.
 *
 * Shaped like startCartRecoveryJob: a no-op under test, disableable by
 * environment, and idempotent so a double call does not schedule twice.
 *
 * @returns {object|null} the scheduled task, or null if it was not scheduled
 */
function startSubscriptionRenewalJob() {
    if (process.env.NODE_ENV === 'test') {
        return null;
    }

    if (process.env.SUBSCRIPTION_RENEWAL_JOB_ENABLED === 'false') {
        logger.info(
            'Subscription renewal job disabled via SUBSCRIPTION_RENEWAL_JOB_ENABLED=false'
        );
        return null;
    }

    if (scheduledTask) {
        return scheduledTask;
    }

    scheduledTask = cron.schedule(SUBSCRIPTION_RENEWAL_CRON, () => {
        processRenewals().catch((error) => {
            logger.error(`Subscription renewal job failed: ${error.message}`);
        });
    });

    logger.info(`Subscription renewal job scheduled (${SUBSCRIPTION_RENEWAL_CRON})`);

    return scheduledTask;
}

function stopSubscriptionRenewalJob() {
    if (scheduledTask) {
        scheduledTask.stop();
        scheduledTask = null;
    }
}

// `processRenewals` stays the default export: server.js and anything else that
// required this file got the function directly, and changing that shape is not
// part of fixing the query.
module.exports = processRenewals;
module.exports.processRenewals = processRenewals;
module.exports.chargeRenewal = chargeRenewal;
module.exports.startSubscriptionRenewalJob = startSubscriptionRenewalJob;
module.exports.stopSubscriptionRenewalJob = stopSubscriptionRenewalJob;
module.exports.SUBSCRIPTION_RENEWAL_CRON = SUBSCRIPTION_RENEWAL_CRON;
