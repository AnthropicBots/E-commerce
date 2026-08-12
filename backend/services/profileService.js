// backend/services/profileService.js
//
// The signed-in shopper's own profile (#1548).
//
// There was no server side to this at all. `profile.js` and
// `dashboard-settings.js` both validated a form, wrote it to `localStorage`
// and said "Profile saved successfully!". Nothing was sent anywhere. The
// change was gone on any other device and gone after clearing site data, the
// two editors kept separate copies under different keys, and the `phone`,
// `address`, `city`, `state`, `zip`, `country` and `avatar` columns that have
// been on `users` since the baseline schema were written by nothing but
// signup. Same shape of defect as the newsletter form in #1459.
//
// Three rules shape everything below.
//
// EMAIL IS NOT A PROFILE FIELD. `dashboard-settings.js` let the shopper edit
// it and wrote the new address into the cached `user` object -- the identity
// the rest of the frontend reads -- so the UI showed an address the account
// could not be logged in with. Changing an account's email is an identity
// change and belongs with the existing verification flow. It is ignored here,
// loudly enough that a caller sending one is told why.
//
// ONLY WHAT WAS SENT IS WRITTEN. A client that submits `{ name }` must not
// blank the phone number. Same partial-update rule the address book uses.
//
// THE COLUMN WIDTHS ARE THE LIMITS. Validation is derived from the schema
// rather than picked, so a value that passes here cannot be truncated on the
// way in -- silently, outside strict mode.

'use strict';

const db = require('../config/db');
const { safeArray, sanitizeString } = require('../utils/helpers');

/**
 * Field -> column, and the column's width.
 *
 * Straight from migrations/0001_baseline_schema.sql. `address` is TEXT, so it
 * gets a policy limit rather than a schema one: an address longer than this is
 * a paste of something else.
 */
const PROFILE_FIELDS = Object.freeze({
    name: { column: 'name', maxLength: 255, required: true, minLength: 2 },
    phone: { column: 'phone', maxLength: 20 },
    address: { column: 'address', maxLength: 500 },
    city: { column: 'city', maxLength: 100 },
    state: { column: 'state', maxLength: 100 },
    zip: { column: 'zip', maxLength: 20 },
    country: { column: 'country', maxLength: 100 },
    avatar: { column: 'avatar', maxLength: 500 }
});

/** Fields a client may send. Anything else is rejected rather than ignored. */
const WRITABLE_FIELDS = Object.freeze(Object.keys(PROFILE_FIELDS));

/**
 * Fields a client may *think* it can send, with the reason it cannot.
 *
 * Named explicitly so the refusal says what to do instead. Silently dropping
 * an email change is how the frontend came to believe it had made one.
 */
const REFUSED_FIELDS = Object.freeze({
    email:
        'Email cannot be changed here. Changing the address on an account is '
        + 'an identity change and needs to be verified.',
    password: 'Use the change-password endpoint.',
    role: 'Roles are set by an administrator.',
    id: 'The account id is not editable.'
});

/**
 * Deliberately the same permissive shape the rest of the codebase uses for
 * phone numbers rather than a stricter one. A profile form is not the place to
 * reject a number that works.
 */
const PHONE_PATTERN = /^[+\d][\d\s\-()]{7,19}$/;

/** Avatars are URLs, and a `javascript:` one in an `<img src>` is a payload. */
const AVATAR_URL_PATTERN = /^https?:\/\//i;

/** Also allowed for avatars: a data: image, which is what the file picker produces. */
const AVATAR_DATA_PATTERN = /^data:image\/(png|jpe?g|gif|webp);base64,/i;

/**
 * Error carrying the HTTP status the controller should use.
 *
 * Without it the controller has to pattern-match on message text to tell 400
 * from 404, which is how "not found" ends up as a 500.
 */
class ProfileError extends Error {
    constructor(message, status = 400, code = 'PROFILE_ERROR', details = null) {
        super(message);
        this.name = 'ProfileError';
        this.status = status;
        this.code = code;
        this.details = details;
    }
}

/**
 * Shape a `users` row for the API.
 *
 * `null` rather than `""` for anything unset, so a client can tell "not
 * provided" from "provided as empty".
 *
 * @param {object} row
 * @returns {object|null}
 */
function toPublicProfile(row) {
    if (!row) return null;

    return {
        id: row.id,
        name: row.name,
        email: row.email,
        role: row.role,
        phone: row.phone || null,
        address: row.address || null,
        city: row.city || null,
        state: row.state || null,
        zip: row.zip || null,
        country: row.country || null,
        avatar: row.avatar || null,
        isVerified: Boolean(row.is_verified),
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}

/**
 * Check one field's value.
 *
 * Returns the value to store, or throws. An empty string is a deliberate
 * clear and becomes NULL -- except on `name`, which the account cannot be
 * without.
 *
 * @param {string} field
 * @param {unknown} rawValue
 * @returns {string|null}
 */
function normalizeField(field, rawValue) {
    const spec = PROFILE_FIELDS[field];
    const value = sanitizeString(rawValue == null ? '' : rawValue).trim();

    if (!value) {
        if (spec.required) {
            throw new ProfileError(`${field} cannot be empty`, 400, 'INVALID_PROFILE');
        }

        return null;
    }

    if (value.length > spec.maxLength) {
        throw new ProfileError(
            `${field} cannot be longer than ${spec.maxLength} characters`,
            400,
            'INVALID_PROFILE'
        );
    }

    if (spec.minLength && value.length < spec.minLength) {
        throw new ProfileError(
            `${field} must be at least ${spec.minLength} characters`,
            400,
            'INVALID_PROFILE'
        );
    }

    if (field === 'phone' && !PHONE_PATTERN.test(value)) {
        throw new ProfileError(
            'Please enter a valid phone number',
            400,
            'INVALID_PROFILE'
        );
    }

    if (
        field === 'avatar'
        && !AVATAR_URL_PATTERN.test(value)
        && !AVATAR_DATA_PATTERN.test(value)
    ) {
        // The value ends up in an `<img src>`. A `javascript:` or `vbscript:`
        // URL there is stored XSS, and this repo has already had one class of
        // that (#1276).
        throw new ProfileError(
            'Avatar must be an http(s) URL or an image data URL',
            400,
            'INVALID_PROFILE'
        );
    }

    return value;
}

/**
 * Turn a request body into the set of columns to write.
 *
 * @param {object} payload
 * @returns {{assignments: string[], values: Array, fields: string[]}}
 * @throws {ProfileError} on an unknown field, a refused one, or a bad value
 */
function buildUpdate(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new ProfileError('A profile object is required', 400, 'INVALID_PROFILE');
    }

    const assignments = [];
    const values = [];
    const fields = [];

    for (const key of Object.keys(payload)) {
        if (REFUSED_FIELDS[key]) {
            throw new ProfileError(REFUSED_FIELDS[key], 400, 'FIELD_NOT_EDITABLE');
        }

        if (!WRITABLE_FIELDS.includes(key)) {
            // Rejected rather than ignored. A client sending a field this does
            // not know about believes it is saving something.
            throw new ProfileError(
                `Unknown profile field: ${key}`,
                400,
                'UNKNOWN_FIELD',
                { allowed: WRITABLE_FIELDS }
            );
        }

        // `undefined` is "not sent". Only what is present is written, so
        // `{ name }` does not blank the phone number.
        if (payload[key] === undefined) {
            continue;
        }

        assignments.push(`${PROFILE_FIELDS[key].column} = ?`);
        values.push(normalizeField(key, payload[key]));
        fields.push(key);
    }

    if (!assignments.length) {
        throw new ProfileError('No profile fields were supplied', 400, 'EMPTY_UPDATE');
    }

    return { assignments, values, fields };
}

const profileService = {
    PROFILE_FIELDS,
    WRITABLE_FIELDS,
    REFUSED_FIELDS,
    ProfileError,
    toPublicProfile,
    buildUpdate,

    /**
     * The signed-in shopper's profile.
     *
     * @param {string} userId
     * @returns {Promise<object>}
     */
    getProfile: async (userId) => {
        if (!userId) {
            throw new ProfileError('Authentication required', 401, 'UNAUTHENTICATED');
        }

        const [rows] = await db.query(
            `SELECT id, name, email, role, phone, address, city, state, zip,
                    country, avatar, is_verified, is_active, created_at, updated_at
               FROM users
              WHERE id = ? AND deleted_at IS NULL
              LIMIT 1`,
            [userId]
        );

        const user = safeArray(rows)[0];

        if (!user) {
            throw new ProfileError('User not found', 404, 'NOT_FOUND');
        }

        // A deactivated account is answered the same way `getMe` answers it,
        // so the two do not disagree about whether the session is usable.
        if (Number(user.is_active) === 0) {
            throw new ProfileError('Account has been deactivated', 403, 'ACCOUNT_DISABLED');
        }

        return toPublicProfile(user);
    },

    /**
     * Save a partial profile update.
     *
     * Returns the stored profile, so the client renders what the server holds
     * rather than what it hoped it sent -- which is exactly the gap that let
     * "Profile saved successfully!" mean nothing.
     *
     * @param {string} userId
     * @param {object} payload
     * @returns {Promise<object>}
     */
    updateProfile: async (userId, payload) => {
        if (!userId) {
            throw new ProfileError('Authentication required', 401, 'UNAUTHENTICATED');
        }

        const { assignments, values } = buildUpdate(payload);

        const [result] = await db.query(
            `UPDATE users
                SET ${assignments.join(', ')}, updated_by = ?
              WHERE id = ? AND deleted_at IS NULL`,
            [...values, userId, userId]
        );

        // affectedRows counts rows matched, not rows changed, so re-saving an
        // unchanged profile is a success rather than a 404. Zero means the
        // account is gone.
        if (!result || result.affectedRows === 0) {
            throw new ProfileError('User not found', 404, 'NOT_FOUND');
        }

        return profileService.getProfile(userId);
    }
};

module.exports = profileService;
module.exports.ProfileError = ProfileError;
