// backend/config/trustProxy.js
//
// Express's `trust proxy` setting decides what `req.ip` is, and `req.ip` is
// what the rate limiters bucket on. Getting it wrong is silently exploitable in
// both directions:
//
//   * too little trust and every request behind the load balancer reports the
//     proxy's address, so all callers share one bucket and a single noisy
//     client throttles everybody;
//   * too much trust ("trust proxy: true" trusts the whole X-Forwarded-For
//     chain) and a caller can append any address it likes, choosing its own
//     bucket on every request and evading the limit entirely.
//
// The correct value is a deployment fact, not a code constant, so it is read
// from the environment. The default stays 1 -- one trusted hop, the value this
// app already ran with -- so deployments that do not set TRUST_PROXY keep their
// current behaviour.
//
// TRUST_PROXY accepts:
//   unset            -> 1        (trust exactly one proxy hop)
//   an integer       -> that many hops
//   "false" / "0"    -> trust nothing; use the socket address
//   an address list  -> "10.0.0.0/8, loopback" and similar, passed to Express
//   "true"           -> trust the entire chain (logged loudly; see above)

const logger = require('./logger');

const DEFAULT_TRUSTED_HOPS = 1;

/**
 * Resolve the value to hand to `app.set('trust proxy', ...)`.
 *
 * @param {string|undefined} rawValue typically process.env.TRUST_PROXY
 * @returns {number|boolean|string}
 */
const resolveTrustProxy = (rawValue) => {
    const value = (rawValue || '').trim();

    if (!value) {
        return DEFAULT_TRUSTED_HOPS;
    }

    const normalized = value.toLowerCase();

    if (normalized === 'false' || normalized === 'off') {
        return false;
    }

    if (normalized === 'true' || normalized === 'on') {
        logger.warn(
            'TRUST_PROXY=true trusts every hop in X-Forwarded-For, which lets a caller '
            + 'choose the address the rate limiters key on. Prefer a hop count or an '
            + 'explicit list of proxy addresses.'
        );
        return true;
    }

    if (/^\d+$/.test(normalized)) {
        return Number(normalized);
    }

    // Anything else is an address, CIDR or named subnet list; Express parses
    // these itself and throws on a malformed entry at startup rather than
    // mis-resolving addresses at request time.
    return value;
};

module.exports = { resolveTrustProxy, DEFAULT_TRUSTED_HOPS };
