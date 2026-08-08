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
    safeUUID,
    safeNumber,
    safeArray
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

// ---------------------------------------------------------------------------
// Reading the queue (#1495)
// ---------------------------------------------------------------------------
//
// There was no read path at all. Not a poor one -- none: no SELECT against
// contact_messages anywhere in the repository, no admin route, no screen. A
// customer submitted the form, was told "Thanks -- your message has reached us
// and we'll reply by email", and the row went into a table nobody could open.
//
// The schema was designed for a workflow that was never built. `status`,
// `responded_at`, `responded_by` and two of the three indexes exist to serve
// queries nobody wrote; migration 0042 even names the two questions the queue
// is read by -- "what is unanswered, and what did this person send us before".
// Both are answerable here now.

/** The workflow states, exactly the ENUM in migration 0042. */
const STATUSES = Object.freeze(['new', 'in_progress', 'resolved', 'spam']);

/** Statuses that count as closed, for `responded_at` purposes. */
const CLOSED_STATUSES = Object.freeze(['resolved', 'spam']);

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

class ContactError extends Error {
    constructor(message, status = 400, code = 'CONTACT_ERROR') {
        super(message);
        this.name = 'ContactError';
        this.status = status;
        this.code = code;
    }
}

/**
 * Normalise paging arguments.
 *
 * @param {object} query
 * @returns {{page: number, limit: number, offset: number}}
 */
function resolvePaging(query = {}) {
    const page = Math.max(1, Math.trunc(safeNumber(query.page)) || 1);
    const requested = Math.trunc(safeNumber(query.limit)) || DEFAULT_PAGE_SIZE;
    const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, requested));

    return { page, limit, offset: (page - 1) * limit };
}

/**
 * The support queue.
 *
 * Ordered oldest-first within a status filter, because a queue read newest-first
 * is a queue whose oldest complaint is hardest to find. `idx_contact_messages_
 * status_created` is on `(status, created_at)` for precisely this.
 *
 * @param {object} [filters]
 * @param {string} [filters.status] - one of STATUSES
 * @param {string} [filters.search] - matched against subject, message and email
 * @param {string} [filters.email] - exact sender address
 * @param {number} [filters.page]
 * @param {number} [filters.limit]
 * @returns {Promise<{messages: object[], pagination: object, counts: object}>}
 */
async function listMessages(filters = {}) {
    const { page, limit, offset } = resolvePaging(filters);

    const where = [];
    const params = [];

    if (filters.status) {
        const status = sanitizeString(filters.status).toLowerCase();

        if (!STATUSES.includes(status)) {
            throw new ContactError(
                `status must be one of: ${STATUSES.join(', ')}`,
                400,
                'INVALID_STATUS'
            );
        }

        where.push('status = ?');
        params.push(status);
    }

    if (filters.email) {
        where.push('email = ?');
        params.push(sanitizeString(filters.email).toLowerCase());
    }

    if (filters.search) {
        // LIKE wildcards in the term are escaped: a search for "100%" should
        // find "100%" and not every row in the table.
        const term = `%${escapeLike(sanitizeString(filters.search))}%`;

        where.push("(subject LIKE ? ESCAPE '\\\\' OR message LIKE ? ESCAPE '\\\\' OR email LIKE ? ESCAPE '\\\\')");
        params.push(term, term, term);
    }

    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const [rows] = await db.query(
        `SELECT cm.id, cm.user_id, cm.name, cm.email, cm.subject, cm.message,
                cm.status, cm.responded_at, cm.responded_by, cm.created_at,
                u.name AS account_name,
                r.name AS responder_name
           FROM contact_messages cm
           LEFT JOIN users u ON u.id = cm.user_id
           LEFT JOIN users r ON r.id = cm.responded_by
           ${clause}
          ORDER BY cm.created_at ASC, cm.id ASC
          LIMIT ? OFFSET ?`,
        [...params, limit, offset]
    );

    const [totals] = await db.query(
        `SELECT COUNT(*) AS total FROM contact_messages ${clause}`,
        params
    );

    const total = Number(totals?.[0]?.total || 0);

    return {
        messages: safeArray(rows).map(toQueueEntry),
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.max(1, Math.ceil(total / limit))
        },
        counts: await countByStatus()
    };
}

/**
 * How many messages sit in each state.
 *
 * The number a support screen leads with is "how many are unanswered", and
 * deriving it from a paginated list is not possible.
 *
 * @returns {Promise<Record<string, number>>}
 */
async function countByStatus() {
    const [rows] = await db.query(
        `SELECT status, COUNT(*) AS total FROM contact_messages GROUP BY status`
    );

    const counts = Object.fromEntries(STATUSES.map((status) => [status, 0]));

    for (const row of safeArray(rows)) {
        counts[row.status] = Number(row.total);
    }

    return counts;
}

/**
 * One message, with everything else that sender has ever written.
 *
 * The history is the reason `idx_contact_messages_email` exists and it would
 * otherwise never be used. Answering a complaint without knowing it is the
 * fourth one from the same address is how a support queue loses people.
 *
 * @param {number} id
 * @returns {Promise<object>}
 */
async function getMessage(id) {
    const messageId = Math.trunc(safeNumber(id));

    if (messageId < 1) {
        throw new ContactError('Invalid message ID', 400, 'INVALID_ID');
    }

    const [rows] = await db.query(
        `SELECT cm.id, cm.user_id, cm.name, cm.email, cm.subject, cm.message,
                cm.status, cm.ip_address, cm.user_agent,
                cm.responded_at, cm.responded_by, cm.created_at, cm.updated_at,
                u.name AS account_name,
                r.name AS responder_name
           FROM contact_messages cm
           LEFT JOIN users u ON u.id = cm.user_id
           LEFT JOIN users r ON r.id = cm.responded_by
          WHERE cm.id = ?
          LIMIT 1`,
        [messageId]
    );

    if (!safeArray(rows).length) {
        throw new ContactError('Message not found', 404, 'MESSAGE_NOT_FOUND');
    }

    const message = rows[0];

    const [history] = await db.query(
        `SELECT id, subject, status, created_at
           FROM contact_messages
          WHERE email = ? AND id <> ?
          ORDER BY created_at DESC
          LIMIT 10`,
        [message.email, messageId]
    );

    return {
        ...toQueueEntry(message),
        // Abuse handling: migration 0042 keeps these so "the limiter counts
        // requests, this is what an investigation reads afterwards". They are
        // on the detail view only, not the list.
        ipAddress: message.ip_address,
        userAgent: message.user_agent,
        updatedAt: message.updated_at,
        senderHistory: safeArray(history).map((row) => ({
            id: row.id,
            subject: row.subject,
            status: row.status,
            createdAt: row.created_at
        }))
    };
}

/**
 * Move a message through the workflow.
 *
 * Closing one stamps `responded_at` and `responded_by` from the acting admin.
 * Those columns exist and this transition is the only thing that can fill
 * them; without it "have we answered this?" has no answer that is not
 * somebody's memory, which is what migration 0042 says the status is for.
 *
 * Re-opening clears them, because a message that is `in_progress` again has
 * not been answered, and leaving a stale responder on it would say it had.
 *
 * @param {number} id
 * @param {string} status
 * @param {string} adminId
 * @returns {Promise<object>} the message as it now stands
 */
async function updateStatus(id, status, adminId) {
    const messageId = Math.trunc(safeNumber(id));
    const next = sanitizeString(status).toLowerCase();
    const actor = safeUUID(adminId);

    if (messageId < 1) {
        throw new ContactError('Invalid message ID', 400, 'INVALID_ID');
    }

    if (!STATUSES.includes(next)) {
        throw new ContactError(
            `status must be one of: ${STATUSES.join(', ')}`,
            400,
            'INVALID_STATUS'
        );
    }

    if (!actor) {
        throw new ContactError('Authentication required', 401, 'UNAUTHENTICATED');
    }

    const closing = CLOSED_STATUSES.includes(next);

    const [result] = await db.query(
        `UPDATE contact_messages
            SET status = ?,
                responded_at = ${closing ? 'COALESCE(responded_at, NOW())' : 'NULL'},
                responded_by = ${closing ? '?' : 'NULL'}
          WHERE id = ?`,
        closing ? [next, actor, messageId] : [next, messageId]
    );

    if (result.affectedRows === 0) {
        throw new ContactError('Message not found', 404, 'MESSAGE_NOT_FOUND');
    }

    return getMessage(messageId);
}

/**
 * Escape the LIKE metacharacters in a user-supplied search term.
 *
 * @param {string} value
 * @returns {string}
 */
function escapeLike(value) {
    return String(value).replace(/[\\%_]/g, (character) => `\\${character}`);
}

/**
 * One row as the admin API returns it.
 *
 * `user_id` is deliberately nullable and deliberately not cascaded -- a message
 * must outlive the account that sent it, "or a shopper closing their account
 * erases the complaint that made them close it" (migration 0042). So the
 * account name is a bonus and the email in the body is the identity.
 *
 * @param {object} row
 * @returns {object}
 */
function toQueueEntry(row) {
    return {
        id: row.id,
        name: row.name,
        email: row.email,
        subject: row.subject,
        message: row.message,
        status: row.status,
        createdAt: row.created_at,
        respondedAt: row.responded_at,
        respondedBy: row.responded_by
            ? { id: row.responded_by, name: row.responder_name || null }
            : null,
        account: row.user_id
            ? { id: row.user_id, name: row.account_name || null }
            : null
    };
}

module.exports = {
    validateSubmission,
    recordMessage,
    listMessages,
    countByStatus,
    getMessage,
    updateStatus,
    toQueueEntry,
    ContactError,
    STATUSES,
    CLOSED_STATUSES,
    DEFAULT_PAGE_SIZE,
    MAX_PAGE_SIZE,
    MAX_MESSAGE_LENGTH,
    MIN_MESSAGE_LENGTH
};
