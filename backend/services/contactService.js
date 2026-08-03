// backend/services/contactService.js
//
// Storing a message from the contact form (#1445).
//
// contact.html has posted to /api/contact since it was written and nothing has
// ever served the path, so every message anyone has sent through this site has
// been discarded -- behind a "Message submitted successfully!" toast, because
// the frontend's apiRequest resolves on a 404 rather than rejecting.
//
// The table is migrations/0042_contact_messages_and_share_interactions.sql.

const db = require("../config/db");
const {
    sanitizeString,
    validateEmail,
    safeUUID
} = require("../utils/helpers");

// Long enough for a real complaint, short enough that the column is not a
// place to store a payload. TEXT would hold far more; the limit is a product
// decision, not a storage one.
const MAX_NAME_LENGTH = 255;
const MAX_EMAIL_LENGTH = 255;
const MAX_SUBJECT_LENGTH = 255;
const MAX_MESSAGE_LENGTH = 5000;
const MIN_MESSAGE_LENGTH = 10;

/**
 * Validate and normalise one submission.
 *
 * Returns the fields ready to insert, or the first thing wrong with them.
 * Validation lives here rather than in the route so that the rules travel with
 * the writer -- a second caller (an admin tool, a support import) cannot get a
 * different answer to "is this a valid message?".
 *
 * @param {object} payload
 * @returns {{valid: true, value: object} | {valid: false, message: string}}
 */
function validateSubmission(payload = {}) {
    const name = sanitizeString(payload.name);
    const email = sanitizeString(payload.email).toLowerCase();
    const subject = sanitizeString(payload.subject);
    const message = sanitizeString(payload.message);

    if (!name || !email || !subject || !message) {
        return {
            valid: false,
            message: "Name, email, subject and message are all required"
        };
    }

    if (name.length > MAX_NAME_LENGTH) {
        return { valid: false, message: `Name cannot exceed ${MAX_NAME_LENGTH} characters` };
    }

    if (email.length > MAX_EMAIL_LENGTH || !validateEmail(email)) {
        return { valid: false, message: "Please provide a valid email address" };
    }

    if (subject.length > MAX_SUBJECT_LENGTH) {
        return { valid: false, message: `Subject cannot exceed ${MAX_SUBJECT_LENGTH} characters` };
    }

    if (message.length < MIN_MESSAGE_LENGTH) {
        return {
            valid: false,
            message: `Message must be at least ${MIN_MESSAGE_LENGTH} characters`
        };
    }

    if (message.length > MAX_MESSAGE_LENGTH) {
        return {
            valid: false,
            message: `Message cannot exceed ${MAX_MESSAGE_LENGTH} characters`
        };
    }

    return { valid: true, value: { name, email, subject, message } };
}

/**
 * Persist a validated submission.
 *
 * `userId` is best-effort: the form is open to anyone, so it is recorded when
 * the sender happened to be signed in and left NULL otherwise. The email in
 * the body is the address support replies to either way.
 *
 * @param {object} submission - Output of validateSubmission().value.
 * @param {object} [context]
 * @param {string|null} [context.userId]
 * @param {string|null} [context.ipAddress]
 * @param {string|null} [context.userAgent]
 * @returns {Promise<number>} The new row's id.
 */
async function recordMessage(submission, context = {}) {
    const [result] = await db.query(
        `INSERT INTO contact_messages
            (user_id, name, email, subject, message, ip_address, user_agent)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
            safeUUID(context.userId),
            submission.name,
            submission.email,
            submission.subject,
            submission.message,
            context.ipAddress || null,
            // TEXT column, but a header is attacker-controlled and unbounded.
            context.userAgent ? String(context.userAgent).slice(0, 1000) : null
        ]
    );

    return result.insertId;
}

module.exports = {
    validateSubmission,
    recordMessage,
    MAX_MESSAGE_LENGTH,
    MIN_MESSAGE_LENGTH
};
