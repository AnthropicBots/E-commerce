// backend/services/pincodeCache.js
//
// One cache over serviceable_pincodes (#1496).
//
// There were two. `models/Pincode.js` created a NodeCache and so did
// `controllers/pincodeController.js`, both with a 24-hour TTL, both keyed by a
// `pincode_<code>` scheme from a `getCacheKey` copied verbatim into both files.
// One key, two caches, two shapes: the model stored the raw rows, the
// controller stored a formatted answer.
//
// Neither invalidation reached the other:
//
//   * Pincode.create/update/delete cleared the model's entry, so the shopper-
//     facing checker kept serving its own copy for up to 24 hours;
//   * clearPincodeCache flushed the controller's, so shipping quotes -- which
//     go through Pincode.findByCode -- kept using theirs;
//   * Pincode.clearCache() existed and was called from nowhere.
//
// There was no sequence of callable operations that cleared both, so an admin
// correcting a pincode's ETA changed what the shipping quote said and did not
// change what the product page said. Two caches under one key scheme cannot be
// made to agree; the fix is that there is one, here, and both callers use it.

'use strict';

const NodeCache = require('node-cache');

/**
 * A day. Serviceability changes when someone edits a row, and every path that
 * edits one invalidates through this module, so the TTL is a backstop rather
 * than the mechanism.
 */
const PINCODE_CACHE_TTL_SECONDS =
    Number(process.env.PINCODE_CACHE_TTL_SECONDS) || 86400;

const cache = new NodeCache({
    stdTTL: PINCODE_CACHE_TTL_SECONDS,
    checkperiod: 3600,
    // Values are handed out by reference otherwise, so a caller that mutates
    // what it got mutates what everyone else will get.
    useClones: true
});

/**
 * Namespaced so two kinds of answer about the same pincode -- the raw row and
 * the formatted deliverability verdict -- cannot collide under one key, which
 * is precisely what the two old caches did.
 *
 * @param {string} namespace
 * @param {string} pincode
 * @returns {string}
 */
function key(namespace, pincode) {
    return `pincode:${namespace}:${pincode}`;
}

/**
 * @param {string} namespace
 * @param {string} pincode
 * @returns {*} the cached value, or undefined
 */
function get(namespace, pincode) {
    return cache.get(key(namespace, pincode));
}

/**
 * @param {string} namespace
 * @param {string} pincode
 * @param {*} value
 */
function set(namespace, pincode, value) {
    cache.set(key(namespace, pincode), value);
}

/**
 * Forget everything known about one pincode, in every namespace.
 *
 * This is the operation that did not exist. A write invalidated whichever
 * cache the writer happened to hold a reference to, and the other one kept
 * answering.
 *
 * @param {string} pincode
 * @returns {number} how many entries were dropped
 */
function invalidate(pincode) {
    const keys = cache.keys().filter((cached) => cached.endsWith(`:${pincode}`));

    return cache.del(keys);
}

/**
 * Drop everything.
 *
 * @returns {number} how many entries were dropped
 */
function flush() {
    const count = cache.keys().length;
    cache.flushAll();
    return count;
}

/**
 * @returns {{size: number, keys: string[], hits: number, misses: number}}
 */
function stats() {
    const nodeStats = cache.getStats?.() || {};

    return {
        size: cache.keys().length,
        keys: cache.keys(),
        hits: nodeStats.hits || 0,
        misses: nodeStats.misses || 0
    };
}

module.exports = {
    NAMESPACE_ROWS: 'rows',
    NAMESPACE_VERDICT: 'verdict',
    PINCODE_CACHE_TTL_SECONDS,
    get,
    set,
    invalidate,
    flush,
    stats,
    key
};
