// backend/services/cartRecoveryService.js
//
// Acting on an abandoned cart (#1429).
//
// The lifecycle from #1364 detects the moment a basket is walked away from and
// then discards it: `abandoned_at` is stamped and nothing reads it. This module
// is what reads it.
//
// Almost none of this is new machinery. The preference centre, the broker and
// the record-then-send idiom all arrived with the price-drop worker (#1394) and
// are reused here; what is genuinely new is the policy, and the policy is most
// of the work. Sending mail to somebody who left a basket behind is easy. Not
// sending it to somebody who already bought, or who said no, or who heard from
// us twice this morning already, is the part that decides whether this is a
// recovery programme or a complaint.
//
// So the suppression rules are named, counted and reported rather than being
// implied by the shape of a query:
//
//   * the basket is empty        -- there is nothing left to come back to;
//   * the shopper has bought     -- the sequence stops at the sale, whether or
//                                   not the sale came from this basket;
//   * the shopper opted out      -- preferences, including the global one;
//   * the sequence is finished   -- a basket is chased a fixed number of times;
//   * the next message is not due yet;
//   * the frequency cap is spent -- across every basket, not just this one;
//   * something was already sent for this basket at this step.
//
// The last of those is also a unique key, so it holds when two instances run at
// once. The log row is written *before* the message goes out for exactly that
// reason: a crash between the two loses one message, which is the failure worth
// having.

'use strict';

const crypto = require('crypto');
const db = require('../config/db');
const cartRecoveryConfig = require('../config/cartRecoveryConfig');
const logger = require('../utils/logger');
const { safeInteger, safeUUID } = require('../utils/helpers');
const { sendNotificationEmail } = require('./notificationEmailService');
const { issueRestoreToken, buildRestoreUrl } = require('./cartRestoreService');
const {
    notificationBroker,
    NOTIFICATION_TYPES
} = require('./notificationBrokerService');
const {
    buildStableUnsubscribeToken,
    buildUnsubscribeUrl
} = require('./wishlistNotifyService');

const CART_STATUS_ABANDONED = 'abandoned';

// mysql2's code for a unique-key collision.
const DUPLICATE_ENTRY = 'ER_DUP_ENTRY';

/**
 * Why a candidate basket was passed over.
 *
 * Reported per run so the log says which rule is doing the work. "Sent
 * nothing" for the right reason and "sent nothing" because the query is wrong
 * look identical otherwise, and this programme is one where the quiet failure
 * is the expensive one.
 */
const SUPPRESSION = Object.freeze({
    BASKET_EMPTIED: 'basket-emptied',
    ALREADY_BOUGHT: 'already-bought',
    OPTED_OUT: 'opted-out',
    NO_ADDRESS: 'no-address',
    SEQUENCE_COMPLETE: 'sequence-complete',
    NOT_DUE: 'not-due',
    FREQUENCY_CAP: 'frequency-cap',
    ALREADY_SENT: 'already-sent'
});

/**
 * `cartId:stage` -- one message per basket per step of the sequence.
 *
 * @param {string} cartId
 * @param {number} stage
 * @returns {string}
 */
function dedupeKey(cartId, stage) {
    return `${cartId}:${stage}`;
}

/**
 * A shopper with no preferences row has never expressed one, so the column
 * default is what they would have. Only an explicit zero is a "no".
 *
 * @param {*} flag
 * @returns {boolean}
 */
function isChannelEnabled(flag) {
    return flag === null || flag === undefined ? true : Boolean(Number(flag));
}

/**
 * The channels a shopper is willing to hear about an abandoned basket on.
 *
 * @param {object} preferences - A `notification_preferences` row, possibly
 *   absent, joined onto the candidate.
 * @returns {string[]}
 */
function recoveryChannels(preferences = {}) {
    if (Number(preferences.unsubscribed_all)) return [];

    const channels = [];

    if (isChannelEnabled(preferences.cart_recovery_in_app)) channels.push('in_app');
    if (isChannelEnabled(preferences.cart_recovery_email)) channels.push('email');

    return channels;
}

/**
 * The step of the sequence this basket is owed, or null when it is owed none.
 *
 * Position in the configured delay list *is* the stage number, which is why
 * the configuration sorts it: the count of messages already sent for a basket
 * is what says where in the sequence it has got to.
 *
 * @param {number} messagesSent
 * @param {number} minutesSinceAbandoned
 * @param {number[]} stageDelays
 * @returns {number|null}
 */
function dueStage(messagesSent, minutesSinceAbandoned, stageDelays) {
    const stage = Math.max(0, safeInteger(messagesSent, 0));

    if (stage >= stageDelays.length) return null;

    return minutesSinceAbandoned >= stageDelays[stage] ? stage : null;
}

/**
 * Abandoned baskets worth looking at, with everything the suppression rules
 * need to judge them.
 *
 * The counts are subqueries rather than joins on purpose: a basket is
 * suppressed by the *existence* of an order or an earlier message, and joining
 * would multiply candidate rows by their own history before anything had
 * decided whether to send.
 *
 * @param {object} [options]
 * @param {number} [options.frequencyCapHours]
 * @param {number} [options.giveUpAfterMinutes]
 * @param {number} [options.batchSize]
 * @returns {Promise<object[]>}
 */
async function findRecoveryCandidates(options = {}) {
    const frequencyCapHours = Math.max(
        1,
        safeInteger(options.frequencyCapHours, cartRecoveryConfig.FREQUENCY_CAP_HOURS)
    );
    const giveUpAfterMinutes = Math.max(
        1,
        safeInteger(options.giveUpAfterMinutes, cartRecoveryConfig.GIVE_UP_AFTER_MINUTES)
    );
    const batchSize = Math.max(
        1,
        safeInteger(options.batchSize, cartRecoveryConfig.SCAN_BATCH_SIZE)
    );

    const [rows] = await db.query(
        `SELECT
             c.id AS cart_id,
             c.user_id,
             c.abandoned_at,
             u.email AS user_email,
             u.name AS user_name,
             pref.unsubscribed_all,
             pref.cart_recovery_email,
             pref.cart_recovery_in_app,
             TIMESTAMPDIFF(MINUTE, c.abandoned_at, NOW()) AS minutes_since_abandoned,
             (SELECT COUNT(*) FROM cart_items ci
               WHERE ci.cart_id = c.id) AS line_count,
             (SELECT COUNT(*) FROM cart_recovery_log l
               WHERE l.cart_id = c.id) AS messages_for_cart,
             (SELECT COUNT(*) FROM cart_recovery_log l
               WHERE l.user_id = c.user_id
                 AND l.sent_at > DATE_SUB(NOW(), INTERVAL ? HOUR)) AS messages_in_window,
             (SELECT COUNT(*) FROM orders o
               WHERE o.user_id = c.user_id
                 AND o.deleted_at IS NULL
                 AND o.created_at >= c.abandoned_at) AS orders_since_abandoned
         FROM carts c
         JOIN users u ON u.id = c.user_id
         LEFT JOIN notification_preferences pref ON pref.user_id = c.user_id
         WHERE c.status = ?
           AND c.abandoned_at IS NOT NULL
           AND c.abandoned_at > DATE_SUB(NOW(), INTERVAL ? MINUTE)
         ORDER BY c.abandoned_at ASC
         LIMIT ?`,
        [frequencyCapHours, CART_STATUS_ABANDONED, giveUpAfterMinutes, batchSize]
    );

    return rows;
}

/**
 * The lines to quote back at the shopper, longest-standing first.
 *
 * @param {string} cartId
 * @param {number} limit
 * @returns {Promise<Array<{name: string, price: number, quantity: number}>>}
 */
async function loadBasketPreview(cartId, limit) {
    const [rows] = await db.query(
        `SELECT p.name, p.price, ci.quantity, ci.color, ci.size
         FROM cart_items ci
         JOIN products p ON p.id = ci.product_id
         WHERE ci.cart_id = ?
         ORDER BY ci.created_at ASC
         LIMIT ?`,
        [cartId, Math.max(1, safeInteger(limit, 5))]
    );

    return rows;
}

/**
 * Claim the right to send, before sending.
 *
 * Returns false rather than throwing when the key is taken: another instance,
 * or an earlier run of this one, has this basket at this stage, and that is an
 * ordinary outcome rather than a fault.
 *
 * @param {object} send
 * @param {string} send.cartId
 * @param {string} send.userId
 * @param {number} send.stage
 * @param {string[]} send.channels
 * @returns {Promise<string|null>} The log row id, or null when suppressed.
 */
async function recordRecoverySend({ cartId, userId, stage, channels }) {
    const id = crypto.randomUUID();

    try {
        await db.query(
            `INSERT INTO cart_recovery_log
                (id, cart_id, user_id, stage, channels_json, dedupe_key)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [id, cartId, userId, stage, JSON.stringify(channels), dedupeKey(cartId, stage)]
        );

        return id;
    } catch (error) {
        if (error && error.code === DUPLICATE_ENTRY) return null;

        throw error;
    }
}

/**
 * The message itself.
 *
 * @param {object} context
 * @param {string} context.userName
 * @param {Array} context.items
 * @param {number} context.lineCount
 * @param {string} [context.restoreUrl]
 * @param {string} [context.preferencesUrl]
 * @returns {{subject: string, text: string}}
 */
function buildRecoveryMessage({ userName, items, lineCount, restoreUrl, preferencesUrl }) {
    const lines = items.map(
        (item) => `  - ${item.name}${item.quantity > 1 ? ` x${item.quantity}` : ''}`
    );

    const remaining = lineCount - items.length;

    if (remaining > 0) {
        lines.push(`  - and ${remaining} more`);
    }

    const greeting = userName ? `Hi ${userName},` : 'Hi,';

    return {
        subject: 'You left something in your basket',
        text:
            `${greeting}\n\n` +
            'Your basket is still here:\n\n' +
            `${lines.join('\n')}\n\n` +
            (restoreUrl ? `Pick up where you left off: ${restoreUrl}\n\n` : '') +
            (preferencesUrl
                ? `Manage preferences / unsubscribe: ${preferencesUrl}\n`
                : '')
    };
}

/**
 * Send whatever recovery messages are due, and nothing else.
 *
 * @param {object} [options] - Overrides for the configured policy, used by the
 *   job's manual trigger and by tests.
 * @returns {Promise<{candidates: number, sent: number, suppressed: object}>}
 */
async function runRecoverySweep(options = {}) {
    const stageDelays = options.stageDelaysMinutes || cartRecoveryConfig.STAGE_DELAYS_MINUTES;
    const frequencyCapMessages = Math.max(
        1,
        safeInteger(options.frequencyCapMessages, cartRecoveryConfig.FREQUENCY_CAP_MESSAGES)
    );
    const maxItemsInMessage = Math.max(
        1,
        safeInteger(options.maxItemsInMessage, cartRecoveryConfig.MAX_ITEMS_IN_MESSAGE)
    );

    const candidates = await findRecoveryCandidates(options);

    const suppressed = Object.fromEntries(
        Object.values(SUPPRESSION).map((reason) => [reason, 0])
    );

    // The cap is read per candidate, so several baskets belonging to one
    // shopper would each see the same pre-run figure. What this run has
    // already spent has to be carried forward, or the cap only bites between
    // runs and not within one.
    const spentThisRun = new Map();

    let sent = 0;

    for (const candidate of candidates) {
        const cartId = safeUUID(candidate.cart_id);
        const userId = safeUUID(candidate.user_id);

        if (!cartId || !userId) continue;

        if (safeInteger(candidate.line_count, 0) === 0) {
            suppressed[SUPPRESSION.BASKET_EMPTIED] += 1;
            continue;
        }

        // Buying stops the sequence. Deliberately "any order since the basket
        // was abandoned" rather than "an order from this basket": a shopper who
        // bought the same thing in a fresh basket has still bought it, and
        // being chased about it afterwards is the worst version of this feature.
        if (safeInteger(candidate.orders_since_abandoned, 0) > 0) {
            suppressed[SUPPRESSION.ALREADY_BOUGHT] += 1;
            continue;
        }

        const channels = recoveryChannels(candidate);

        if (!channels.length) {
            suppressed[SUPPRESSION.OPTED_OUT] += 1;
            continue;
        }

        const deliverable = candidate.user_email
            ? channels
            : channels.filter((channel) => channel !== 'email');

        if (!deliverable.length) {
            suppressed[SUPPRESSION.NO_ADDRESS] += 1;
            continue;
        }

        const messagesForCart = safeInteger(candidate.messages_for_cart, 0);

        if (messagesForCart >= stageDelays.length) {
            suppressed[SUPPRESSION.SEQUENCE_COMPLETE] += 1;
            continue;
        }

        const stage = dueStage(
            messagesForCart,
            safeInteger(candidate.minutes_since_abandoned, 0),
            stageDelays
        );

        if (stage === null) {
            suppressed[SUPPRESSION.NOT_DUE] += 1;
            continue;
        }

        const alreadySpent =
            safeInteger(candidate.messages_in_window, 0) + (spentThisRun.get(userId) || 0);

        if (alreadySpent >= frequencyCapMessages) {
            suppressed[SUPPRESSION.FREQUENCY_CAP] += 1;
            continue;
        }

        const logId = await recordRecoverySend({
            cartId,
            userId,
            stage,
            channels: deliverable
        });

        if (!logId) {
            suppressed[SUPPRESSION.ALREADY_SENT] += 1;
            continue;
        }

        spentThisRun.set(userId, (spentThisRun.get(userId) || 0) + 1);

        try {
            await deliverRecoveryMessage({
                logId,
                candidate,
                cartId,
                userId,
                stage,
                channels: deliverable,
                maxItemsInMessage
            });

            sent += 1;
        } catch (error) {
            // The log row stays. Rolling it back to allow a retry would mean a
            // transport that fails halfway through delivery gets to send the
            // same message again on the next run, which is the one outcome the
            // send log exists to prevent.
            logger.error(
                `Cart recovery delivery failed for cart ${cartId} at stage ${stage}: ${error.message}`
            );
        }
    }

    logger.info(
        `Cart recovery: ${sent} message(s) sent from ${candidates.length} candidate(s); ` +
        `suppressed ${describeSuppression(suppressed)}`
    );

    return { candidates: candidates.length, sent, suppressed };
}

/**
 * Publish the message on every channel the shopper allows.
 *
 * Separate from the policy above so that what gets sent can change without the
 * rules about whether to send it moving with it.
 */
async function deliverRecoveryMessage({
    logId,
    candidate,
    cartId,
    userId,
    stage,
    channels,
    maxItemsInMessage
}) {
    const lineCount = safeInteger(candidate.line_count, 0);
    const items = await loadBasketPreview(cartId, maxItemsInMessage);

    // One link per message, minted here rather than reused across the sequence.
    // Issuing supersedes the basket's previous link, so a shopper never has two
    // live credentials for one cart just because we asked twice. The link
    // remembers which send it belongs to, which is what lets an order be
    // credited to a particular message rather than to the programme (#1429).
    const { token } = await issueRestoreToken({ cartId, userId, recoveryLogId: logId });
    const restoreUrl = buildRestoreUrl(token);

    await notificationBroker.publish(
        NOTIFICATION_TYPES.CART_RECOVERY,
        {
            userId,
            cartId,
            stage,
            itemCount: lineCount,
            restoreUrl,
            items: items.map((item) => ({
                name: item.name,
                price: item.price,
                quantity: item.quantity
            }))
        },
        { channels, metadata: { recoveryLogId: logId } }
    );

    if (channels.includes('email')) {
        const preferencesUrl = buildUnsubscribeUrl(buildStableUnsubscribeToken(userId));

        const { subject, text } = buildRecoveryMessage({
            userName: candidate.user_name,
            items,
            lineCount,
            restoreUrl,
            preferencesUrl
        });

        await sendNotificationEmail({ to: candidate.user_email, subject, text });
    }
}

/**
 * Render the suppression counts, omitting the rules that did nothing.
 *
 * @param {object} suppressed
 * @returns {string}
 */
function describeSuppression(suppressed) {
    const active = Object.entries(suppressed)
        .filter(([, count]) => count > 0)
        .map(([reason, count]) => `${reason}=${count}`);

    return active.length ? active.join(', ') : 'nothing';
}

module.exports = {
    SUPPRESSION,
    dedupeKey,
    recoveryChannels,
    dueStage,
    findRecoveryCandidates,
    recordRecoverySend,
    buildRecoveryMessage,
    runRecoverySweep
};
