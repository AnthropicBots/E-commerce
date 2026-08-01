// backend/validators/addressValidator.js
//
// Validation and normalisation for the saved address book (#1347).
//
// Two jobs, kept together because they must agree:
//
//   1. Reject input the service cannot store (missing required fields, values
//      longer than their column, a postal code that is not a postal code).
//   2. Normalise what survives, so "  mumbai " and "Mumbai" are the same
//      address and a shopper does not end up with two entries that look
//      identical in the picker.
//
// Every message names the field and what would have been acceptable. A
// validator that answers "Invalid address" makes the caller guess which of
// eleven fields was wrong.

const { sanitizeString } = require('../utils/helpers');

// Column widths from schema.sql. Enforcing them here turns a truncation (or,
// in strict mode, an ER_DATA_TOO_LONG 500) into a 400 that names the field.
const MAX_LENGTHS = {
    label: 50,
    recipientName: 255,
    recipientPhone: 20,
    addressLine1: 255,
    addressLine2: 255,
    landmark: 255,
    city: 100,
    state: 100,
    postalCode: 20,
    country: 100
};

const REQUIRED_FIELDS = [
    'recipientName',
    'recipientPhone',
    'addressLine1',
    'city',
    'state',
    'postalCode'
];

// Offered in the UI; anything else the shopper types is accepted as-is. The
// column is a VARCHAR rather than an ENUM precisely so this list is a
// suggestion, not a constraint.
const SUGGESTED_LABELS = ['Home', 'Work', 'Other'];

// Deliberately permissive: 6 digits for India (the default country), but any
// 4-10 character alphanumeric code with optional spaces or a hyphen, so UK and
// Canadian formats are not rejected out of hand.
const POSTAL_CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9\s-]{2,9}$/;

// 7-15 digits, optional leading +, optional separators. E.164 allows up to 15.
const PHONE_PATTERN = /^\+?[0-9][0-9\s-]{6,18}$/;

/**
 * Title-case a place name for display consistency.
 *
 * "mumbai" and "MUMBAI" both become "Mumbai", so the picker does not show what
 * looks like two different cities. Hyphenated and apostrophed names are handled
 * ("port-au-prince" -> "Port-Au-Prince", "o'fallon" -> "O'Fallon").
 */
function normalizePlaceName(value) {
    return sanitizeString(value)
        .toLowerCase()
        .replace(/(^|[\s'-])([a-z])/g, (_, boundary, letter) => boundary + letter.toUpperCase())
        .trim();
}

/**
 * Collapse internal whitespace and trim.
 *
 * Copy-pasted addresses routinely arrive with a newline or a run of spaces in
 * the middle; storing them verbatim makes the same address fail to look the
 * same twice.
 */
function normalizeText(value) {
    return sanitizeString(value).replace(/\s+/g, ' ').trim();
}

/**
 * Normalise a postal code to uppercase with single internal spaces.
 */
function normalizePostalCode(value) {
    return normalizeText(value).toUpperCase();
}

/**
 * Normalise a phone number by stripping display separators.
 *
 * The `+` is kept because it carries meaning; spaces and hyphens do not, and
 * keeping them means "+91 98765 43210" and "+919876543210" are stored as two
 * different numbers.
 */
function normalizePhone(value) {
    return sanitizeString(value).replace(/[\s-]/g, '');
}

/**
 * Validate and normalise an address payload.
 *
 * @param {object} body raw request body
 * @param {{partial?: boolean}} [options] when partial, absent fields are left
 *        out of the result instead of being reported as missing -- that is the
 *        difference between a PUT that replaces and a PATCH-style update that
 *        touches only what it names.
 * @returns {{valid: boolean, errors: string[], value: object}}
 */
function validateAddress(body, options = {}) {
    const { partial = false } = options;
    const source = body && typeof body === 'object' ? body : {};

    const errors = [];
    const value = {};

    // --- required fields -------------------------------------------------
    for (const field of REQUIRED_FIELDS) {
        const raw = source[field];
        const provided = raw !== undefined && raw !== null && String(raw).trim() !== '';

        if (!provided) {
            // On a partial update, "absent" means "leave it alone". An
            // explicitly empty string is still an error: the caller is asking
            // to blank a NOT NULL column.
            if (!partial) {
                errors.push(`${field} is required`);
            } else if (raw !== undefined && String(raw).trim() === '') {
                errors.push(`${field} cannot be empty`);
            }
            continue;
        }

        value[field] = normalizeText(raw);
    }

    // --- optional fields -------------------------------------------------
    for (const field of ['label', 'addressLine2', 'landmark', 'country']) {
        if (source[field] === undefined) continue;

        // An explicit empty string clears an optional field. That is a
        // meaningful request ("this address has no line 2 after all"), so it is
        // preserved rather than dropped.
        value[field] = source[field] === null ? '' : normalizeText(source[field]);
    }

    // --- defaults for a full create -------------------------------------
    if (!partial) {
        if (!value.label) value.label = 'Home';
        if (!value.country) value.country = 'India';
    }

    // --- normalisation ---------------------------------------------------
    for (const field of ['city', 'state', 'country']) {
        if (value[field]) value[field] = normalizePlaceName(value[field]);
    }

    if (value.postalCode) value.postalCode = normalizePostalCode(value.postalCode);
    if (value.recipientPhone) value.recipientPhone = normalizePhone(value.recipientPhone);

    // --- format checks ---------------------------------------------------
    if (value.postalCode && !POSTAL_CODE_PATTERN.test(value.postalCode)) {
        errors.push('postalCode must be 3-10 letters or digits');
    }

    if (value.recipientPhone && !PHONE_PATTERN.test(value.recipientPhone)) {
        errors.push('recipientPhone must be a valid phone number (7-15 digits, optional +)');
    }

    // A name that is only punctuation passes a length check and is useless to a
    // courier.
    if (value.recipientName && !/[A-Za-z]/.test(value.recipientName)) {
        errors.push('recipientName must contain at least one letter');
    }

    // --- length checks ---------------------------------------------------
    // Run last so a field is not reported as both malformed and too long.
    for (const [field, max] of Object.entries(MAX_LENGTHS)) {
        if (typeof value[field] === 'string' && value[field].length > max) {
            errors.push(`${field} must be ${max} characters or fewer`);
        }
    }

    // --- default flag ----------------------------------------------------
    if (source.isDefault !== undefined) {
        if (typeof source.isDefault !== 'boolean') {
            errors.push('isDefault must be true or false');
        } else {
            value.isDefault = source.isDefault;
        }
    }

    return { valid: errors.length === 0, errors, value };
}

/**
 * Express middleware wrapping `validateAddress`.
 *
 * The normalised payload replaces `req.body`, so downstream handlers cannot
 * accidentally read the raw values -- which is how a trimmed-and-validated
 * field ends up stored untrimmed.
 */
function addressValidatorMiddleware(options = {}) {
    return (req, res, next) => {
        const result = validateAddress(req.body, options);

        if (!result.valid) {
            return res.status(400).json({
                success: false,
                error: 'Invalid address',
                details: result.errors
            });
        }

        req.body = result.value;
        next();
    };
}

module.exports = {
    validateAddress,
    addressValidatorMiddleware,
    normalizePlaceName,
    normalizePostalCode,
    normalizePhone,
    normalizeText,
    REQUIRED_FIELDS,
    SUGGESTED_LABELS,
    MAX_LENGTHS
};
