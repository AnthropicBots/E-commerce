// backend/config/cartRecoveryConfig.js
//
// The suppression policy for abandoned-cart recovery, written down in one
// place.
//
// Every value here is the difference between a recovery programme and a
// complaint, and every one of them is a merchandising decision rather than an
// implementation detail: how soon after walking away it is reasonable to say
// something, how many times, how long a basket stays worth chasing. Buried as
// literals in the sender they would be changed by patching the job, at which
// point nobody can say what the policy currently is without reading it.
//
// The rules the schema enforces -- one message per basket per step, the
// preference flags -- are not repeated here. This file is only the numbers.

const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR;

// A first nudge an hour after the basket is written off, then one more the
// following day. Measured from `abandoned_at`, which is already a day of
// silence after the last shopper action, so the first message lands roughly a
// day after the shopper actually left.
const DEFAULT_STAGE_DELAYS_MINUTES = [MINUTES_PER_HOUR, MINUTES_PER_DAY];

/**
 * Read a recovery sequence from a comma-separated environment value.
 *
 * Sorted and de-duplicated rather than taken as written: the sender treats
 * position in this list as the stage number, so an unordered or repeated entry
 * would silently mean "send the third message before the second".
 *
 * @param {string} [raw]
 * @returns {number[]} Delays in minutes, ascending, or the default sequence.
 */
function parseStageDelays(raw) {
    if (!raw) return DEFAULT_STAGE_DELAYS_MINUTES;

    const delays = String(raw)
        .split(',')
        .map((part) => Number(part.trim()))
        .filter((minutes) => Number.isFinite(minutes) && minutes >= 0);

    if (!delays.length) return DEFAULT_STAGE_DELAYS_MINUTES;

    return [...new Set(delays)].sort((a, b) => a - b);
}

const CART_RECOVERY_CONFIG = Object.freeze({
    // How long after abandonment each message in the sequence is due. The
    // length of this list is the length of the sequence: emptying it to a
    // single entry turns the programme into one reminder and nothing else.
    STAGE_DELAYS_MINUTES: Object.freeze(
        parseStageDelays(process.env.CART_RECOVERY_STAGE_DELAYS_MINUTES)
    ),

    // Per-person ceiling, counted across every basket they have left behind.
    // The per-basket rule alone does not bound this: a shopper who abandons
    // three baskets in an afternoon would otherwise get three messages for it.
    FREQUENCY_CAP_MESSAGES:
        Number(process.env.CART_RECOVERY_FREQUENCY_CAP_MESSAGES) || 2,
    FREQUENCY_CAP_HOURS:
        Number(process.env.CART_RECOVERY_FREQUENCY_CAP_HOURS) || 24,

    // Past this, the basket is history rather than a sale in progress and we
    // stop asking about it. Without a stop the sequence would reach back over
    // every abandoned cart ever recorded the first time it runs.
    GIVE_UP_AFTER_MINUTES:
        Number(process.env.CART_RECOVERY_GIVE_UP_AFTER_MINUTES) ||
        7 * MINUTES_PER_DAY,

    // Candidates examined per run. A backlog is drained across scheduled runs
    // rather than in one pass that holds a long read while shoppers check out,
    // matching how the abandonment sweep is bounded.
    SCAN_BATCH_SIZE: Number(process.env.CART_RECOVERY_SCAN_BATCH_SIZE) || 200,

    // Lines quoted in the message. A basket of thirty items does not need
    // thirty lines of email to be recognisable.
    MAX_ITEMS_IN_MESSAGE:
        Number(process.env.CART_RECOVERY_MAX_ITEMS_IN_MESSAGE) || 5,

    // How long a restore link stays usable. Long enough to outlive the whole
    // sequence, so the first message's link still works for somebody who opens
    // their mail on Monday; short enough that a link sitting in a mailbox is
    // not indefinitely valuable to whoever else ends up reading it.
    RESTORE_LINK_TTL_MINUTES:
        Number(process.env.CART_RECOVERY_RESTORE_LINK_TTL_MINUTES) ||
        3 * MINUTES_PER_DAY
});

module.exports = CART_RECOVERY_CONFIG;
