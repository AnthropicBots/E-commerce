// Delivery options: what may be offered, and what each one costs (#1430).
//
// This is the only place that reads `shipping_methods` and `shipping_rate_
// rules`, and the only place that turns a code the client sent into a rate.
// Three modules meet here and none of them overlaps: shippingRates.service
// matches rules and knows no SQL, pricing.service does the money arithmetic
// and knows neither, and this module does the lookups. That split is what
// keeps the charge server-computed — a request body can name a method and a
// destination, and nothing else.
//
// Every read is defensive in the same way `order.service.resolveItemVariant`
// is: a deployment that has not applied the migration, or a reference table
// that is briefly unreadable, must not take checkout down. It falls back to
// the configured default, which prices exactly as this store did before
// delivery options existed.

const db = require("../config/db");
const logger = require("../utils/logger");
const { safeArray, safeInteger, safeNumber, sanitizeString } = require("../utils/helpers");
const pricing = require("./pricing.service");
const rates = require("./shippingRates.service");
const Pincode = require("../models/Pincode");
const SHIPPING_CONFIG = require("../config/shippingConfig");

// Marks a code the client sent that names no active method, so controllers can
// answer with a 400 naming the options rather than a generic server error.
const UNKNOWN_METHOD_CODE = "SHIPPING_METHOD_UNKNOWN";

let cache = null;
let rulesCache = null;

const toMethod = (row) => ({
    code: sanitizeString(row.code),
    label: sanitizeString(row.label),
    description: sanitizeString(row.description) || null,
    rate: safeNumber(row.base_rate),
    isDefault: Boolean(row.is_default),
    sortOrder: safeInteger(row.sort_order, 0),
});

const readMethods = async () => {
    let methods;

    try {
        const [rows] = await db.query(
            `SELECT code, label, description, base_rate, is_default, sort_order
               FROM shipping_methods
              WHERE is_active = 1
              ORDER BY sort_order ASC, code ASC`,
        );

        methods = safeArray(rows).map(toMethod);
    } catch (error) {
        logger.warn(`Delivery options could not be read: ${error.message}`);
        methods = [];
    }

    // An empty list is treated the same as an unreadable one. Offering no way
    // to have an order delivered is never the intended configuration, and a
    // checkout with no options is a checkout nobody can complete.
    return methods.length > 0 ? methods : [SHIPPING_CONFIG.FALLBACK_METHOD];
};

/**
 * The active delivery options, in the order they should be offered.
 *
 * The in-flight read is what is cached, not just its result: pricing one
 * basket asks for the options several times over, and caching only the
 * settled value would send every one of those to the database while the first
 * was still running.
 *
 * @returns {Promise<Array<Object>>}
 */
const listMethods = () => {
    if (cache && Date.now() < cache.expiresAt) {
        return cache.methods;
    }

    const methods = readMethods();

    cache = {
        methods,
        expiresAt: Date.now() + SHIPPING_CONFIG.CACHE_TTL_MS,
    };

    return methods;
};

const readRules = async () => {
    try {
        const [rows] = await db.query(
            `SELECT id, name, method_code, destination_scope, destination_value,
                    min_weight_kg, max_weight_kg, min_order_value, max_order_value,
                    effect, amount, priority
               FROM shipping_rate_rules
              WHERE is_active = 1
              ORDER BY priority ASC, id ASC`,
        );

        return safeArray(rows).map(rates.toRule);
    } catch (error) {
        // No rules is a valid configuration — it means every option costs its
        // own rate — so an unreadable table degrades to flat pricing rather
        // than to a failed checkout.
        logger.warn(`Shipping rate rules could not be read: ${error.message}`);
        return [];
    }
};

/**
 * The active rate rules. Cached on the same terms as the options themselves.
 *
 * @returns {Promise<Array<Object>>}
 */
const listRules = () => {
    if (rulesCache && Date.now() < rulesCache.expiresAt) {
        return rulesCache.rules;
    }

    const rules = readRules();

    rulesCache = {
        rules,
        expiresAt: Date.now() + SHIPPING_CONFIG.CACHE_TTL_MS,
    };

    return rules;
};

/**
 * Fill in the city and state a pincode resolves to.
 *
 * Destination rules are written against what `serviceable_pincodes` already
 * knows, so this is the one translation between "the shopper typed six digits"
 * and "the rule says Maharashtra". A pincode the store does not serve resolves
 * to nothing, and rules scoped to a place then simply do not match.
 *
 * @param {{ pincode?: string, city?: string, state?: string }} [destination]
 * @returns {Promise<{ pincode: string|null, city: string|null, state: string|null }>}
 */
const resolveDestination = async (destination = {}) => {
    const pincode = sanitizeString(destination.pincode || destination.zip);
    const resolved = {
        pincode: pincode || null,
        city: sanitizeString(destination.city) || null,
        state: sanitizeString(destination.state) || null,
    };

    if (!pincode || (resolved.city && resolved.state)) {
        return resolved;
    }

    try {
        const [row] = safeArray(await Pincode.findByCode(pincode));

        if (row) {
            // The serviceability record wins over anything the client typed:
            // a rule that says "Maharashtra" must not be dodged by claiming a
            // Mumbai pincode is somewhere else.
            resolved.city = sanitizeString(row.city) || resolved.city;
            resolved.state = sanitizeString(row.state) || resolved.state;
        }
    } catch (error) {
        logger.warn(`Destination ${pincode} could not be resolved: ${error.message}`);
    }

    return resolved;
};

/**
 * How heavy a basket is, in kilograms.
 *
 * Products carry a weight and most of them have never had one set. A missing
 * weight becomes the configured per-unit default rather than zero, because a
 * weightless parcel would fall in the lightest band of every weight rule and
 * quietly under-charge the whole catalogue.
 *
 * @param {Array<Object>} lines - priced lines carrying `weight` and `qty`
 * @returns {number}
 */
const basketWeightKg = (lines) =>
    safeArray(lines).reduce((total, line) => {
        const unit = safeNumber(line?.weight, 0) || SHIPPING_CONFIG.DEFAULT_ITEM_WEIGHT_KG;
        const qty = Math.max(1, safeInteger(line?.qty, 1));

        return total + unit * qty;
    }, 0);

/**
 * The option a checkout gets when it does not choose one.
 *
 * The configured code wins over the table's own flag so that the method whose
 * rate a free-shipping entitlement covers is a stated decision rather than
 * whichever row happens to carry the marker. Falling through to the first
 * offered option keeps a misconfigured table from leaving checkout with no
 * default at all.
 *
 * @returns {Promise<Object>}
 */
const getDefaultMethod = async () => {
    const methods = await listMethods();

    return (
        methods.find((method) => method.code === SHIPPING_CONFIG.DEFAULT_METHOD_CODE) ||
        methods.find((method) => method.isDefault) ||
        methods[0]
    );
};

/**
 * Turn a requested code into the method it names.
 *
 * An absent code is the backwards-compatible case and resolves to the default,
 * which is what keeps a checkout path that does not offer a choice working
 * unchanged. A code that is present but names nothing is rejected rather than
 * quietly defaulted: silently substituting an option would charge a shopper
 * for delivery they did not pick.
 *
 * @param {any} requestedCode
 * @returns {Promise<Object>}
 */
const resolveMethod = async (requestedCode) => {
    const code = sanitizeString(requestedCode);

    if (!code) {
        return getDefaultMethod();
    }

    const methods = await listMethods();
    const match = methods.find((method) => method.code === code);

    if (!match) {
        const error = new Error(
            `Unknown delivery option "${code}". Available: ` +
                `${methods.map((method) => method.code).join(", ")}.`,
        );
        error.code = UNKNOWN_METHOD_CODE;
        throw error;
    }

    return match;
};

/**
 * The descriptor the pricing engine takes, for one option and one basket.
 *
 * `rate` is what the rules made of the option's own rate. `waiverRate` is how
 * much of that a waiver covers, and it is the better of two entitlements: what
 * a matching waive rule states, and — when a `free_shipping` promo is in play —
 * the *default* option's rate. Free shipping means the store absorbs the
 * standard cost of delivery, so a shopper who has earned it and then upgrades
 * pays the difference rather than nothing.
 *
 * @param {Object} input
 * @param {Object} input.method
 * @param {Object} input.defaultMethod
 * @param {Array<Object>} input.rules
 * @param {Object} input.context - the basket, as `shippingRates.matches` takes it
 * @param {boolean} [input.isShippingWaived]
 * @returns {Object}
 */
const toPricingDescriptor = ({
    method,
    defaultMethod,
    rules = [],
    context = {},
    isShippingWaived = false,
} = {}) => {
    const defaultRate = defaultMethod ? defaultMethod.rate : method.rate;

    const applied = rates.applyRules({
        rules,
        baseRate: method.rate,
        defaultRate,
        context: { ...context, methodCode: method.code },
    });

    const waiverRate = Math.max(
        applied.isWaiverEarned ? applied.waiverAmount : 0,
        isShippingWaived ? defaultRate : 0,
    );

    return {
        code: method.code,
        label: method.label,
        rate: applied.rate,
        waiverRate,
        isWaiverEarned: waiverRate > 0,
    };
};

/**
 * Price every option for one basket.
 *
 * Each option is priced by the engine rather than by adding rates up here, so
 * what a shopper is shown next to each option is the figure that option would
 * actually be charged -- including the case where a waiver makes two options
 * cost the same.
 *
 * The destination is taken on trust for a quote and re-resolved from the order
 * itself when the order is placed, so a client that names a cheaper pincode
 * than it ships to gets a quote that the order path then refuses as a total
 * mismatch.
 *
 * @param {Object} input
 * @param {number} input.postDiscountSubtotal
 * @param {boolean} [input.isShippingWaived] a free_shipping promo is applied
 * @param {any} [input.selectedCode] the option the shopper picked, if any
 * @param {Object} [input.destination] pincode, and city/state if already known
 * @param {number} [input.weightKg]
 * @returns {Promise<{ selected: Object, options: Array<Object>, freeShipping: Object|null }>}
 */
const quoteOptions = async ({
    postDiscountSubtotal,
    isShippingWaived = false,
    selectedCode = null,
    destination = null,
    weightKg = 0,
} = {}) => {
    const [methods, defaultMethod, selected, rules, place] = await Promise.all([
        listMethods(),
        getDefaultMethod(),
        resolveMethod(selectedCode),
        listRules(),
        resolveDestination(destination || {}),
    ]);

    const context = {
        orderValue: safeNumber(postDiscountSubtotal),
        weightKg: safeNumber(weightKg),
        destination: place,
    };

    const describe = (method) =>
        toPricingDescriptor({
            method,
            defaultMethod,
            rules,
            context,
            isShippingWaived,
        });

    const options = methods.map((method) => {
        const descriptor = describe(method);

        return {
            code: method.code,
            label: method.label,
            description: method.description,
            isDefault: method.code === defaultMethod.code,
            isSelected: method.code === selected.code,
            cost: pricing.calculateShipping(postDiscountSubtotal, {
                isShippingWaived,
                isWaiverEarned: descriptor.isWaiverEarned,
                methodRate: descriptor.rate,
                waiverRate: descriptor.waiverRate,
            }),
        };
    });

    // Reported against the default option, because that is the one a threshold
    // is understood to be about. A shopper is told what free delivery would
    // cover, not what an upgrade would still cost on top of it.
    const progress = rates.freeShippingProgress({
        rules,
        context: { ...context, methodCode: defaultMethod.code },
    });

    return {
        selected: describe(selected),
        options,
        // The rule's own name is internal wording for operators and is left
        // behind here; the shopper is shown the figures.
        freeShipping: progress
            ? {
                  threshold: progress.threshold,
                  remaining: progress.remaining,
                  qualified: progress.qualified,
              }
            : null,
    };
};

/**
 * Drop the cached options and rules. Used by tests, and by anything that
 * changes a rate and needs the change to be visible immediately.
 */
const clearCache = () => {
    cache = null;
    rulesCache = null;
};

module.exports = {
    UNKNOWN_METHOD_CODE,
    listMethods,
    listRules,
    getDefaultMethod,
    resolveMethod,
    resolveDestination,
    basketWeightKg,
    toPricingDescriptor,
    quoteOptions,
    clearCache,
};
