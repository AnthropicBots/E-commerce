// backend/services/newsletterService.js
//
// The newsletter list (#1459).
//
// There was no server side to this at all. Three frontend handlers validated an
// address, waited, and said "Thanks for subscribing!" -- one of them adding
// "Check your inbox" for a mail nothing could send. Every address anyone ever
// typed into that form is gone.
//
// Two rules shape everything below.
//
// DOUBLE OPT-IN. A form anyone can type any address into is a form anyone can
// use to sign somebody else up. A row starts `pending`; only following a link
// mailed to the address makes it `confirmed`, and only `confirmed` rows are a
// mailing list.
//
// THE RESPONSE SAYS NOTHING ABOUT THE ADDRESS. Whether an address is already
// subscribed is information about that address, and this endpoint is
// unauthenticated -- so "you are already subscribed" and "welcome" have to be
// the same sentence, or the form becomes a membership oracle. Same reasoning as
// forgotPassword in #1455.

'use strict';

const crypto = require('crypto');
const db = require('../config/db');
const logger = require('../config/logger');
const { sendNotificationEmail } = require('./notificationEmailService');

/** How long a confirmation link is good for. */
const CONFIRM_TOKEN_TTL_MS = 48 * 60 * 60 * 1000;

/** Longest address the column will hold. */
const MAX_EMAIL_LENGTH = 255;

/**
 * Deliberately the same shape as the four copies already in the codebase
 * (script.js, ui.js, blog.js, authController.js) rather than a stricter one.
 * A sign-up form is not the place to start rejecting addresses that work; the
 * confirmation mail is what establishes whether an address is real.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * A token the recipient sees, and the digest that is stored.
 *
 * Only the digest goes in the table. An unsubscribe token is a bearer
 * credential for someone else's subscription and a confirm token is a bearer
 * credential for putting them on the list, so a database dump should not
 * contain either in a replayable form. Same treatment as refresh tokens.
 *
 * @returns {{raw: string, digest: string}}
 */
const issueToken = () => {
    const raw = crypto.randomBytes(32).toString('hex');
    return { raw, digest: hashToken(raw) };
};

/**
 * @param {string} raw
 * @returns {string} SHA-256 hex.
 */
const hashToken = (raw) =>
    crypto.createHash('sha256').update(String(raw || '')).digest('hex');

/**
 * Trim, lowercase and length-check an address.
 *
 * Lowercased because the column is UNIQUE: without it "A@x.com" and "a@x.com"
 * are two rows, and the mailer sends to both.
 *
 * @param {unknown} email
 * @returns {string|null} null when it is not a usable address.
 */
const normalizeEmail = (email) => {
    const value = String(email ?? '').trim().toLowerCase();

    if (!value || value.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(value)) {
        return null;
    }

    return value;
};

/**
 * Where confirmation and unsubscribe links point.
 *
 * @returns {string}
 */
const siteOrigin = () =>
    (process.env.SITE_ORIGIN || 'http://localhost:5500').replace(/\/+$/, '');

/**
 * Record a sign-up and send the confirmation mail.
 *
 * Idempotent by address, and the four cases it has to handle are all folded
 * into one `INSERT ... ON DUPLICATE KEY UPDATE` so two simultaneous submissions
 * of the same address cannot race into two rows or two different states:
 *
 *   new address           -> pending, mail sent
 *   pending already       -> token replaced, mail sent again (they may not have
 *                            received the first one; this is the "resend" path)
 *   confirmed already     -> left alone, no mail. Re-confirming an address that
 *                            is already on the list would let anyone trigger
 *                            mail to it repeatedly.
 *   unsubscribed before   -> back to pending, mail sent. Someone typing their
 *                            address into the form is asking to be re-added,
 *                            and the confirmation step is what proves it is
 *                            them rather than someone signing them up again.
 *
 * @param {object} input
 * @param {string} input.email
 * @param {string} [input.sourcePage] Page the form was on.
 * @param {string} [input.ip] For the consent record.
 * @param {string} [input.userId] When the visitor was signed in.
 * @returns {Promise<{accepted: boolean, outcome: string}>}
 *   `outcome` is for logs and tests. It must never reach the caller's response.
 */
const subscribe = async ({ email, sourcePage, ip, userId } = {}) => {
    const normalized = normalizeEmail(email);

    if (!normalized) {
        return { accepted: false, outcome: 'invalid_email' };
    }

    const confirm = issueToken();
    const unsubscribe = issueToken();
    const expiresAt = new Date(Date.now() + CONFIRM_TOKEN_TTL_MS);

    // `status = 'confirmed'` rows keep every value they have: the CASE arms
    // below all no-op for them, so a confirmed subscriber's unsubscribe token
    // is never rotated out from under a link already sitting in their inbox.
    const [result] = await db.query(
        `INSERT INTO newsletter_subscribers
            (email, status, confirm_token, confirm_token_expires_at,
             unsubscribe_token, source_page, consent_ip, user_id)
         VALUES (?, 'pending', ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
            status = IF(status = 'confirmed', status, 'pending'),
            confirm_token =
                IF(status = 'confirmed', confirm_token, VALUES(confirm_token)),
            confirm_token_expires_at =
                IF(status = 'confirmed',
                   confirm_token_expires_at,
                   VALUES(confirm_token_expires_at)),
            unsubscribe_token =
                IF(status = 'confirmed',
                   unsubscribe_token,
                   VALUES(unsubscribe_token)),
            source_page =
                IF(status = 'confirmed', source_page, VALUES(source_page)),
            consent_ip =
                IF(status = 'confirmed', consent_ip, VALUES(consent_ip)),
            consent_at =
                IF(status = 'confirmed', consent_at, NOW()),
            user_id = COALESCE(VALUES(user_id), user_id),
            unsubscribed_at =
                IF(status = 'confirmed', unsubscribed_at, NULL)`,
        [
            normalized,
            confirm.digest,
            expiresAt,
            unsubscribe.digest,
            sourcePage || null,
            ip || null,
            userId || null
        ]
    );

    // mysql2 reports affectedRows 1 for an insert and 2 for an update that
    // changed something. An already-confirmed row changes nothing, so it comes
    // back as 0 -- which is exactly the case that must not be mailed.
    const alreadyConfirmed = result.affectedRows === 0;

    if (alreadyConfirmed) {
        return { accepted: true, outcome: 'already_confirmed' };
    }

    await sendConfirmationEmail(normalized, confirm.raw);

    return { accepted: true, outcome: 'confirmation_sent' };
};

/**
 * Mail the confirmation link.
 *
 * Failures are logged and swallowed. The row is already recorded, the caller is
 * getting the same answer either way, and reporting a send failure to an
 * anonymous caller would say "this address got as far as the send", which only
 * happens for addresses not already on the list.
 *
 * @param {string} email
 * @param {string} rawToken
 * @returns {Promise<void>}
 */
const sendConfirmationEmail = async (email, rawToken) => {
    const link =
        `${siteOrigin()}/newsletter.html?action=confirm&token=${rawToken}`;

    try {
        const result = await sendNotificationEmail({
            to: email,
            subject: 'Confirm your newsletter subscription',
            text: [
                'Someone (hopefully you) asked for our newsletter at this address.',
                '',
                'Confirm the subscription:',
                link,
                '',
                'The link is good for 48 hours. If this was not you, ignore this',
                'message -- nothing is sent to an address that has not confirmed.'
            ].join('\n')
        });

        // The transport is best-effort by design (see notificationEmailService):
        // an unconfigured SMTP writes the message to the log instead. Worth a
        // line in the log so "the confirmation mail never arrives" does not turn
        // into a hunt through the newsletter code.
        if (!result.delivered) {
            logger.warn(
                'Newsletter confirmation not delivered (SMTP unconfigured); '
                + 'the message was logged instead.'
            );
        }
    } catch (error) {
        logger.error(`Newsletter confirmation send failed: ${error.message}`);
    }
};

/**
 * Every answer `confirm` can give.
 *
 * Named because the controller branches on them and the tests assert them, and
 * a set of bare strings scattered across three files is how one of them quietly
 * stops being produced.
 */
const CONFIRM_OUTCOMES = Object.freeze({
    /** The link worked; this call is what put the address on the list. */
    CONFIRMED: 'confirmed',
    /** A link for a subscription that is already live. Not a failure. */
    ALREADY_CONFIRMED: 'already_confirmed',
    /** The address has since asked not to be mailed. */
    ALREADY_UNSUBSCRIBED: 'already_unsubscribed',
    /** Still pending, but the 48 hours are up. */
    EXPIRED: 'expired',
    /** No row has ever carried this digest. */
    INVALID_TOKEN: 'invalid_token'
});

/**
 * Redeem a confirmation token.
 *
 * A spent token stays findable and stops being usable (#1612). The successful
 * UPDATE moves the digest from `confirm_token` -- the column every write path
 * matches on -- to `spent_confirm_token`, which no write path matches on at
 * all. Before this the digest was simply set to NULL, so the lookup below found
 * nothing and a second click on a working link was reported as invalid.
 *
 * That matters more than it sounds: double-clicking a link in a mail client is
 * ordinary, and several mail security scanners follow links in a message before
 * the recipient ever opens it. The scanner spends the token; the human is told
 * their link is broken for a subscription that is live; they submit the form
 * again, which correctly mails nothing to an already-confirmed address; and the
 * page stays broken from their point of view forever.
 *
 * @param {string} token Raw token from the link.
 * @returns {Promise<{confirmed: boolean, outcome: string, reason?: string}>}
 */
const confirm = async (token) => {
    if (!token || typeof token !== 'string') {
        return {
            confirmed: false,
            outcome: CONFIRM_OUTCOMES.INVALID_TOKEN,
            reason: CONFIRM_OUTCOMES.INVALID_TOKEN
        };
    }

    const digest = hashToken(token);

    // Guarded on `status = 'pending'` and on the expiry, so an expired or
    // already-spent token is a no-op rather than a re-confirmation.
    const [result] = await db.query(
        `UPDATE newsletter_subscribers
            SET status = 'confirmed',
                confirmed_at = NOW(),
                spent_confirm_token = confirm_token,
                confirm_token = NULL,
                confirm_token_expires_at = NULL
          WHERE confirm_token = ?
            AND status = 'pending'
            AND confirm_token_expires_at > NOW()`,
        [digest]
    );

    if (result.affectedRows > 0) {
        return { confirmed: true, outcome: CONFIRM_OUTCOMES.CONFIRMED };
    }

    // Nothing was confirmed. Which of the four reasons applies is worth
    // knowing, and the caller is holding a token that was mailed to the
    // address, so they have already demonstrated they are entitled to know.
    //
    // Both columns, because a row reaches `spent_confirm_token` by being
    // confirmed *or* by being unsubscribed while still pending.
    const [rows] = await db.query(
        `SELECT status, confirm_token_expires_at
           FROM newsletter_subscribers
          WHERE confirm_token = ? OR spent_confirm_token = ?
          LIMIT 1`,
        [digest, digest]
    );

    const row = rows[0];

    if (!row) {
        return {
            confirmed: false,
            outcome: CONFIRM_OUTCOMES.INVALID_TOKEN,
            reason: CONFIRM_OUTCOMES.INVALID_TOKEN
        };
    }

    if (row.status === 'confirmed') {
        // `confirmed: true` deliberately. The subscriber asked to be on the
        // list and is on the list; that the work was done by an earlier click
        // is not their problem, and reporting it as a failure is what sends
        // them back to the sign-up form.
        return { confirmed: true, outcome: CONFIRM_OUTCOMES.ALREADY_CONFIRMED };
    }

    if (row.status === 'unsubscribed') {
        return {
            confirmed: false,
            outcome: CONFIRM_OUTCOMES.ALREADY_UNSUBSCRIBED,
            reason: CONFIRM_OUTCOMES.ALREADY_UNSUBSCRIBED
        };
    }

    // Still pending, so the only way the UPDATE missed it is the expiry.
    return {
        confirmed: false,
        outcome: CONFIRM_OUTCOMES.EXPIRED,
        reason: CONFIRM_OUTCOMES.EXPIRED
    };
};

/**
 * Take an address off the list.
 *
 * The row is kept and moved to `unsubscribed` rather than deleted: deleting it
 * makes the address eligible to be re-added by anyone who types it into the
 * form, and loses the record that they asked not to be mailed.
 *
 * Repeat calls succeed. An unsubscribe link that reports an error the second
 * time it is clicked reads as "that did not work", and the reasonable response
 * to that is to click it again.
 *
 * @param {string} token Raw unsubscribe token.
 * @returns {Promise<{unsubscribed: boolean, reason?: string}>}
 */
const unsubscribe = async (token) => {
    if (!token || typeof token !== 'string') {
        return { unsubscribed: false, reason: 'invalid_token' };
    }

    const digest = hashToken(token);

    // `spent_confirm_token = COALESCE(confirm_token, spent_confirm_token)`
    // rather than a bare assignment: a row that was already confirmed has NULL
    // in `confirm_token` and its real spent digest in the other column, and
    // overwriting that with NULL would lose the audit key this change exists to
    // keep (#1612). A row unsubscribed while still pending records its live
    // token as spent, which is what lets a confirmation link followed after an
    // unsubscribe be answered truthfully instead of as an invalid link.
    const [result] = await db.query(
        `UPDATE newsletter_subscribers
            SET status = 'unsubscribed',
                unsubscribed_at = COALESCE(unsubscribed_at, NOW()),
                spent_confirm_token = COALESCE(confirm_token, spent_confirm_token),
                confirm_token = NULL,
                confirm_token_expires_at = NULL
          WHERE unsubscribe_token = ?`,
        [digest]
    );

    if (result.affectedRows === 0) {
        // No row carries this token. Distinct from "already unsubscribed",
        // which matches a row and reports success.
        const [rows] = await db.query(
            `SELECT id FROM newsletter_subscribers
              WHERE unsubscribe_token = ? LIMIT 1`,
            [digest]
        );

        if (!rows.length) {
            return { unsubscribed: false, reason: 'invalid_token' };
        }
    }

    return { unsubscribed: true };
};

/**
 * Every address a mailing may go to.
 *
 * The one query this table exists to serve, and the only place that decides
 * what "on the list" means -- so a future mailer cannot get it wrong by writing
 * its own WHERE clause.
 *
 * @returns {Promise<Array<{email: string, unsubscribe_token: string}>>}
 */
const listConfirmed = async () => {
    const [rows] = await db.query(
        `SELECT email, unsubscribe_token
           FROM newsletter_subscribers
          WHERE status = 'confirmed'
          ORDER BY confirmed_at ASC`
    );

    return rows;
};

module.exports = {
    subscribe,
    confirm,
    CONFIRM_OUTCOMES,
    unsubscribe,
    listConfirmed,
    normalizeEmail,
    hashToken,
    CONFIRM_TOKEN_TTL_MS,
    MAX_EMAIL_LENGTH
};
