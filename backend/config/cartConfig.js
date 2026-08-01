// backend/config/cartConfig.js
//
// The cart lifecycle's one judgement call, and the limits the sweep that
// applies it runs under.
//
// "How long until a basket counts as abandoned" is a merchandising decision,
// not an implementation detail: it moves with campaigns, and it is the single
// number every abandonment figure in reporting depends on. It is named and
// overridable here so changing it is a configuration change rather than a
// patch to the job.

const MINUTES_PER_DAY = 24 * 60;

const CART_CONFIG = Object.freeze({
    // A cart untouched for this long is abandoned. A day is long enough that a
    // shopper comparing prices over an evening is not written off, and short
    // enough that the figure still describes this week's trading.
    ABANDON_AFTER_MINUTES:
        Number(process.env.CART_ABANDON_AFTER_MINUTES) || MINUTES_PER_DAY,

    // Rows per statement. The sweep works in batches so a backlog cannot turn
    // into one enormous UPDATE holding locks across the whole table while
    // shoppers are trying to check out.
    SWEEP_BATCH_SIZE: Number(process.env.CART_SWEEP_BATCH_SIZE) || 500,

    // Ceiling on batches in a single run, so a large backlog is drained over
    // several scheduled runs instead of one that never ends. At the defaults a
    // run transitions at most 10,000 carts.
    SWEEP_MAX_BATCHES: Number(process.env.CART_SWEEP_MAX_BATCHES) || 20
});

module.exports = CART_CONFIG;
