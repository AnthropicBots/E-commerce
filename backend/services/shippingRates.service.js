// How a delivery rate is derived from rules (#1430).
//
// Everything here is pure: no database, no logger, no clock. Loading the rules
// belongs to shipping.service because it needs the database; this module only
// takes the already-loaded rules and a description of the basket and does the
// matching and the arithmetic. That split is the same one pricing.service and
// promo.service already use, and it is what makes the rules testable on their
// own — rate selection is the part of this that is worth getting wrong loudly.
//
// The order of application is fixed and named, because it is the thing every
// figure depends on and the thing a reader will otherwise have to infer from
// the order of statements:
//
//   1. start at the option's own rate
//   2. the winning `set_rate` rule replaces it
//   3. every matching `surcharge` adds to it
//   4. the largest matching `waive` comes off, floored at zero
//
// Surcharges accumulate and waivers do not, deliberately. Two reasons to
// charge more are two costs; two reasons to charge nothing are still one
// delivery.

const { safeArray, safeNumber, sanitizeString } = require("../utils/helpers");

const APPLICATION_ORDER = Object.freeze([
    "set_rate",
    "surcharge",
    "waive",
]);

const EFFECTS = Object.freeze({
    SET_RATE: "set_rate",
    SURCHARGE: "surcharge",
    WAIVE: "waive",
});

const DESTINATION_SCOPES = Object.freeze({
    ANY: "any",
    PINCODE: "pincode",
    CITY: "city",
    STATE: "state",
});

const round = (value) => Math.round((safeNumber(value) + Number.EPSILON) * 100) / 100;

const normalise = (value) => sanitizeString(value).toLowerCase();

/**
 * Turn a database row into the shape the matcher works with.
 *
 * @param {Object} row
 * @returns {Object}
 */
const toRule = (row) => ({
    id: row.id,
    name: sanitizeString(row.name),
    methodCode: row.method_code ? sanitizeString(row.method_code) : null,
    destinationScope: sanitizeString(row.destination_scope) || DESTINATION_SCOPES.ANY,
    destinationValue: row.destination_value ? sanitizeString(row.destination_value) : null,
    minWeightKg: row.min_weight_kg === null ? null : safeNumber(row.min_weight_kg),
    maxWeightKg: row.max_weight_kg === null ? null : safeNumber(row.max_weight_kg),
    minOrderValue: row.min_order_value === null ? null : safeNumber(row.min_order_value),
    maxOrderValue: row.max_order_value === null ? null : safeNumber(row.max_order_value),
    effect: sanitizeString(row.effect),
    // NULL is meaningful on a waiver — "cover the standard rate" — so it is
    // preserved rather than coerced to zero, which would waive nothing.
    amount: row.amount === null || row.amount === undefined ? null : safeNumber(row.amount),
    priority: safeNumber(row.priority),
});

/**
 * Does a half-open window contain a value? Minimum inclusive, maximum
 * exclusive, so bands written back to back neither overlap nor leave a gap.
 */
const isWithin = (value, min, max) => {
    if (min !== null && min !== undefined && value < min) return false;
    if (max !== null && max !== undefined && value >= max) return false;
    return true;
};

/**
 * Does the rule's destination condition hold?
 *
 * A rule scoped to a place does not match a basket whose destination is not
 * yet known, which happens on the cart page before an address is entered. That
 * is the safe direction for both effects: an unknown destination is quoted
 * without the surcharge it might attract *and* without the waiver it might
 * earn, and the order path re-prices against the address the parcel is
 * actually going to.
 */
const matchesDestination = (rule, destination) => {
    if (rule.destinationScope === DESTINATION_SCOPES.ANY) {
        return true;
    }

    const target = normalise(rule.destinationValue);

    if (!target) {
        return false;
    }

    const place = destination || {};

    if (rule.destinationScope === DESTINATION_SCOPES.PINCODE) {
        return normalise(place.pincode) === target;
    }

    if (rule.destinationScope === DESTINATION_SCOPES.CITY) {
        return normalise(place.city) === target;
    }

    return normalise(place.state) === target;
};

/**
 * Does the rule apply to this basket, going to this place, by this option?
 *
 * @param {Object} rule
 * @param {Object} context
 * @param {string} context.methodCode
 * @param {number} context.orderValue - post-discount subtotal
 * @param {number} context.weightKg
 * @param {{ pincode?: string, city?: string, state?: string }} [context.destination]
 * @returns {boolean}
 */
const matches = (rule, context = {}) => {
    if (rule.methodCode && rule.methodCode !== context.methodCode) {
        return false;
    }

    if (!isWithin(safeNumber(context.weightKg), rule.minWeightKg, rule.maxWeightKg)) {
        return false;
    }

    if (!isWithin(safeNumber(context.orderValue), rule.minOrderValue, rule.maxOrderValue)) {
        return false;
    }

    return matchesDestination(rule, context.destination);
};

/**
 * Derive the rate for one delivery option.
 *
 * The waiver is reported separately from the rate rather than already
 * subtracted, because the pricing engine owns the subtraction and a
 * `free_shipping` promo produces a waiver by another route entirely. Reporting
 * both lets the two meet in one place.
 *
 * @param {Object} input
 * @param {Array<Object>} input.rules - normalised rules, any order
 * @param {number} input.baseRate - the option's own rate
 * @param {number} input.defaultRate - the default option's rate, which is what
 *        a waiver with no stated amount covers
 * @param {Object} input.context - see `matches`
 * @returns {{ rate: number, waiverAmount: number, isWaiverEarned: boolean, appliedRules: Array<Object> }}
 */
const applyRules = ({ rules = [], baseRate = 0, defaultRate = 0, context = {} } = {}) => {
    const applicable = safeArray(rules)
        .filter((rule) => matches(rule, context))
        .sort((a, b) => a.priority - b.priority);

    const appliedRules = [];

    let rate = round(baseRate);

    const override = applicable.find((rule) => rule.effect === EFFECTS.SET_RATE);

    if (override) {
        rate = round(override.amount);
        appliedRules.push(override);
    }

    for (const rule of applicable) {
        if (rule.effect === EFFECTS.SURCHARGE) {
            rate = round(rate + safeNumber(rule.amount));
            appliedRules.push(rule);
        }
    }

    let waiverAmount = 0;
    let waiver = null;

    for (const rule of applicable) {
        if (rule.effect !== EFFECTS.WAIVE) continue;

        const covers = rule.amount === null ? round(defaultRate) : round(rule.amount);

        if (covers > waiverAmount || waiver === null) {
            waiverAmount = covers;
            waiver = rule;
        }
    }

    if (waiver) {
        appliedRules.push(waiver);
    }

    return {
        rate: Math.max(0, rate),
        waiverAmount: Math.max(0, waiverAmount),
        isWaiverEarned: Boolean(waiver),
        appliedRules,
    };
};

/**
 * How far this basket is from earning free delivery.
 *
 * Only value thresholds can be reported this way: "spend 200 more" is
 * actionable, and "live somewhere else" is not. The nearest unearned threshold
 * is the one reported, because telling a shopper about a 5000 threshold while
 * they are 50 short of a 999 one is worse than saying nothing.
 *
 * @param {Object} input - as `applyRules`, minus the rates
 * @returns {{ threshold: number, remaining: number, qualified: boolean, name: string }|null}
 */
const freeShippingProgress = ({ rules = [], context = {} } = {}) => {
    const orderValue = safeNumber(context.orderValue);

    const thresholds = safeArray(rules).filter(
        (rule) =>
            rule.effect === EFFECTS.WAIVE &&
            rule.minOrderValue !== null &&
            rule.minOrderValue > 0 &&
            // Matched with the value condition lifted, so a basket that is
            // short of the threshold still hears about it. Every other
            // condition still has to hold: a threshold that only applies to
            // one state must not be dangled in front of the whole country.
            matches(
                { ...rule, minOrderValue: null, maxOrderValue: null },
                context,
            ),
    );

    if (thresholds.length === 0) {
        return null;
    }

    const unearned = thresholds.filter((rule) => orderValue < rule.minOrderValue);

    const target = unearned.length
        ? unearned.reduce((a, b) => (a.minOrderValue <= b.minOrderValue ? a : b))
        : thresholds.reduce((a, b) => (a.minOrderValue >= b.minOrderValue ? a : b));

    const qualified = orderValue >= target.minOrderValue;

    return {
        name: target.name,
        threshold: round(target.minOrderValue),
        remaining: qualified ? 0 : round(target.minOrderValue - orderValue),
        qualified,
    };
};

module.exports = {
    APPLICATION_ORDER,
    EFFECTS,
    DESTINATION_SCOPES,
    toRule,
    matches,
    applyRules,
    freeShippingProgress,
};
