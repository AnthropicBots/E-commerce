// Delivery options: what may be offered, and what each one costs (#1430).
//
// This is the only place that reads `shipping_methods`, and the only place
// that turns a code the client sent into a rate. The pricing engine does the
// arithmetic and knows nothing about the database; this module does the
// lookup and knows nothing about the arithmetic. That split is what keeps the
// charge server-computed: a request body can name a method, and nothing else.
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
const SHIPPING_CONFIG = require("../config/shippingConfig");

// Marks a code the client sent that names no active method, so controllers can
// answer with a 400 naming the options rather than a generic server error.
const UNKNOWN_METHOD_CODE = "SHIPPING_METHOD_UNKNOWN";

let cache = null;

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
 * The descriptor the pricing engine takes.
 *
 * `waiverRate` is how much of this method's rate a free-shipping entitlement
 * covers, and it is the *default* method's rate for every option. Free
 * shipping means the store absorbs the standard cost of delivery, so a shopper
 * who has earned it and then upgrades pays the difference rather than nothing.
 *
 * @param {Object} method
 * @param {Object} defaultMethod
 * @returns {Object}
 */
const toPricingDescriptor = (method, defaultMethod) => ({
    code: method.code,
    label: method.label,
    rate: method.rate,
    waiverRate: defaultMethod ? defaultMethod.rate : method.rate,
});

/**
 * Price every option for one basket.
 *
 * Each option is priced by the engine rather than by adding rates up here, so
 * what a shopper is shown next to each option is the figure that option would
 * actually be charged -- including the case where a waiver makes two options
 * cost the same.
 *
 * @param {Object} input
 * @param {number} input.postDiscountSubtotal
 * @param {boolean} [input.isShippingWaived] a free_shipping promo is applied
 * @param {any} [input.selectedCode] the option the shopper picked, if any
 * @returns {Promise<{ selected: Object, options: Array<Object> }>}
 */
const quoteOptions = async ({
    postDiscountSubtotal,
    isShippingWaived = false,
    selectedCode = null,
} = {}) => {
    const [methods, defaultMethod, selected] = await Promise.all([
        listMethods(),
        getDefaultMethod(),
        resolveMethod(selectedCode),
    ]);

    const options = methods.map((method) => {
        const descriptor = toPricingDescriptor(method, defaultMethod);

        return {
            code: method.code,
            label: method.label,
            description: method.description,
            isDefault: method.code === defaultMethod.code,
            isSelected: method.code === selected.code,
            cost: pricing.calculateShipping(postDiscountSubtotal, {
                isShippingWaived,
                methodRate: descriptor.rate,
                waiverRate: descriptor.waiverRate,
            }),
        };
    });

    return {
        selected: toPricingDescriptor(selected, defaultMethod),
        options,
    };
};

/**
 * Drop the cached options. Used by tests, and by anything that changes a rate
 * and needs the change to be visible immediately.
 */
const clearCache = () => {
    cache = null;
};

module.exports = {
    UNKNOWN_METHOD_CODE,
    listMethods,
    getDefaultMethod,
    resolveMethod,
    toPricingDescriptor,
    quoteOptions,
    clearCache,
};
