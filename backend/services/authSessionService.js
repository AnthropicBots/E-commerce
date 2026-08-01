/**
 * Durable per-device sessions.
 *
 * A session is a row in `auth_sessions`, not a credential on the user row, so an
 * account can be signed in on several devices at once. Renewal rotates a session
 * forward: the presented row is marked superseded and a successor is inserted in
 * the same family. Presenting a superseded row afterwards is therefore a replay,
 * which is treated as theft of the whole family rather than as an expiry.
 *
 * Only the digest of a refresh token is stored.
 *
 * @module services/authSessionService
 */

const crypto = require("crypto");
const db = require("../config/db");
const { safeArray } = require("../utils/helpers");
const { publishSessionRevoked } = require("../utils/sessionRevocationBus");
const { REFRESH_TOKEN_TTL_MS, hashRefreshToken } = require("../utils/tokens");

// ==================== CONSTANTS ====================

/**
 * Why a session stopped being usable. `replay` is deliberately distinct from
 * `expired`: it is a signal about the account, not about the clock.
 */
const SESSION_OUTCOME = Object.freeze({
    ROTATED: "rotated",
    UNKNOWN: "unknown",
    EXPIRED: "expired",
    REVOKED: "revoked",
    REPLAY: "replay"
});

const REVOKE_REASON = Object.freeze({
    ROTATED: "rotated",
    LOGOUT: "logout",
    REPLAY_DETECTED: "replay_detected",
    PASSWORD_CHANGED: "password_changed",
    USER_REVOKED: "user_revoked",
    ACCOUNT_DISABLED: "account_disabled"
});

const DEVICE_LABEL_MAX_LENGTH = 120;

// Enough of a label for someone to recognise their own device in a list, drawn
// from the only hint an HTTP client reliably gives us.
const BROWSERS = [
    [/edg/i, "Edge"],
    [/opr|opera/i, "Opera"],
    [/chrome|crios/i, "Chrome"],
    [/firefox|fxios/i, "Firefox"],
    [/safari/i, "Safari"]
];

const PLATFORMS = [
    [/iphone|ipad|ipod/i, "iOS"],
    [/android/i, "Android"],
    [/windows/i, "Windows"],
    [/mac os|macintosh/i, "macOS"],
    [/linux/i, "Linux"]
];

// ==================== PUBLIC SURFACE ====================

/**
 * Record a new session for a freshly issued refresh token.
 *
 * @param {Object} params
 * @param {string} params.userId
 * @param {string} params.refreshToken - Raw token; only its digest is stored.
 * @param {string} [params.ip]
 * @param {string} [params.userAgent]
 * @returns {Promise<{sessionId: string, familyId: string, expiresAt: Date}>}
 */
async function createSession({ userId, refreshToken, ip, userAgent }) {
    const sessionId = crypto.randomUUID();
    const familyId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);

    await db.query(
        `INSERT INTO auth_sessions
            (id, user_id, family_id, token_hash, device_label, user_agent, ip_address, issued_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), ?)`,
        [
            sessionId,
            userId,
            familyId,
            hashRefreshToken(refreshToken),
            describeDevice(userAgent),
            userAgent || null,
            ip || null,
            expiresAt
        ]
    );

    return { sessionId, familyId, expiresAt };
}

/**
 * Move a session forward onto a new refresh token.
 *
 * The caller is expected to have already established that `refreshToken` was
 * issued by this service.
 *
 * @param {Object} params
 * @param {string} params.refreshToken - Token being presented.
 * @param {string} params.newRefreshToken - Token to hand back on success.
 * @param {string} [params.ip]
 * @param {string} [params.userAgent]
 * @returns {Promise<{outcome: string, userId?: string, sessionId?: string, expiresAt?: Date}>}
 */
async function rotateSession({ refreshToken, newRefreshToken, ip, userAgent }) {
    const [rows] = await db.query(
        `SELECT id, user_id, family_id, expires_at, revoked_at, replaced_by
         FROM auth_sessions
         WHERE token_hash = ?
         LIMIT 1`,
        [hashRefreshToken(refreshToken)]
    );

    const session = safeArray(rows)[0];
    if (!session) {
        return { outcome: SESSION_OUTCOME.UNKNOWN };
    }

    // A token that has already been rotated away should never appear again. If
    // it does, either it or its successor is in someone else's hands, and there
    // is no way to tell which -- so the whole family goes.
    if (session.replaced_by) {
        await revokeFamily(session.family_id, REVOKE_REASON.REPLAY_DETECTED);
        return {
            outcome: SESSION_OUTCOME.REPLAY,
            userId: session.user_id,
            familyId: session.family_id
        };
    }

    if (session.revoked_at) {
        return { outcome: SESSION_OUTCOME.REVOKED, userId: session.user_id };
    }

    if (new Date(session.expires_at).getTime() <= Date.now()) {
        return { outcome: SESSION_OUTCOME.EXPIRED, userId: session.user_id };
    }

    const successorId = crypto.randomUUID();

    await db.query(
        `INSERT INTO auth_sessions
            (id, user_id, family_id, token_hash, device_label, user_agent, ip_address, issued_at, last_used_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW(), ?)`,
        [
            successorId,
            session.user_id,
            session.family_id,
            hashRefreshToken(newRefreshToken),
            describeDevice(userAgent),
            userAgent || null,
            ip || null,
            session.expires_at
        ]
    );

    // Guarded on `replaced_by IS NULL` so two renewals racing on the same token
    // cannot both claim to have superseded it.
    const [update] = await db.query(
        `UPDATE auth_sessions
         SET replaced_by = ?, revoked_at = NOW(), revoked_reason = ?
         WHERE id = ? AND replaced_by IS NULL`,
        [successorId, REVOKE_REASON.ROTATED, session.id]
    );

    if (!update || update.affectedRows === 0) {
        await revokeFamily(session.family_id, REVOKE_REASON.REPLAY_DETECTED);
        return {
            outcome: SESSION_OUTCOME.REPLAY,
            userId: session.user_id,
            familyId: session.family_id
        };
    }

    return {
        outcome: SESSION_OUTCOME.ROTATED,
        userId: session.user_id,
        sessionId: successorId,
        expiresAt: new Date(session.expires_at)
    };
}

/**
 * Sessions on an account that are neither ended nor expired, newest first.
 *
 * Rows that have been rotated away are excluded, so one device appears once
 * however many times it has renewed. Nothing derived from the token is included.
 *
 * @param {string} userId
 * @returns {Promise<Array<Object>>} Rows with id, device_label, ip_address,
 *   issued_at, last_used_at and expires_at.
 */
async function listActiveSessions(userId) {
    const [rows] = await db.query(
        `SELECT id, device_label, ip_address, issued_at, last_used_at, expires_at
         FROM auth_sessions
         WHERE user_id = ?
           AND revoked_at IS NULL
           AND replaced_by IS NULL
           AND expires_at > NOW()
         ORDER BY issued_at DESC`,
        [userId]
    );

    return safeArray(rows);
}

/**
 * End one session, identified by the session id carried on an access token.
 *
 * @returns {Promise<boolean>} Whether a live session was ended.
 */
async function revokeSessionById(sessionId, reason) {
    if (!sessionId) return false;

    const [result] = await db.query(
        `UPDATE auth_sessions
         SET revoked_at = NOW(), revoked_reason = ?
         WHERE id = ? AND revoked_at IS NULL`,
        [reason, sessionId]
    );

    const wasRevoked = Boolean(result && result.affectedRows > 0);
    if (wasRevoked) {
        publishSessionRevoked({ sessionId, reason });
    }

    return wasRevoked;
}

/**
 * End one session on behalf of its owner.
 *
 * Scoped to `userId` so a session id learned elsewhere cannot be used to sign
 * another account out.
 *
 * @returns {Promise<boolean>} Whether a live session belonging to the account
 *   was ended.
 */
async function revokeSessionForUser({ userId, sessionId, reason }) {
    if (!sessionId) return false;

    const [result] = await db.query(
        `UPDATE auth_sessions
         SET revoked_at = NOW(), revoked_reason = ?
         WHERE id = ? AND user_id = ? AND revoked_at IS NULL`,
        [reason, sessionId, userId]
    );

    const wasRevoked = Boolean(result && result.affectedRows > 0);
    if (wasRevoked) {
        publishSessionRevoked({ sessionId, reason });
    }

    return wasRevoked;
}

/**
 * End one session, identified by the refresh token that belongs to it.
 *
 * @returns {Promise<boolean>} Whether a live session was ended.
 */
async function revokeSessionByToken(refreshToken, reason) {
    if (!refreshToken) return false;

    const [result] = await db.query(
        `UPDATE auth_sessions
         SET revoked_at = NOW(), revoked_reason = ?
         WHERE token_hash = ? AND revoked_at IS NULL`,
        [reason, hashRefreshToken(refreshToken)]
    );

    return Boolean(result && result.affectedRows > 0);
}

/**
 * End every session descended from one sign-in, including rows already
 * superseded, so nothing in the chain can be rotated forward again.
 *
 * @returns {Promise<number>} Number of rows ended.
 */
async function revokeFamily(familyId, reason) {
    const [result] = await db.query(
        `UPDATE auth_sessions
         SET revoked_at = NOW(), revoked_reason = ?
         WHERE family_id = ? AND revoked_at IS NULL`,
        [reason, familyId]
    );

    return result ? result.affectedRows : 0;
}

/**
 * End every session on an account.
 *
 * @param {Object} params
 * @param {string} params.userId
 * @param {string} [params.exceptSessionId] - Session to leave signed in.
 * @param {string} params.reason
 * @returns {Promise<number>} Number of rows ended.
 */
async function revokeUserSessions({ userId, exceptSessionId, reason }) {
    const conditions = ["user_id = ?", "revoked_at IS NULL"];
    const params = [reason, userId];

    if (exceptSessionId) {
        conditions.push("id <> ?");
        params.push(exceptSessionId);
    }

    const [result] = await db.query(
        `UPDATE auth_sessions
         SET revoked_at = NOW(), revoked_reason = ?
         WHERE ${conditions.join(" AND ")}`,
        params
    );

    publishSessionRevoked({ userId, exceptSessionId, reason });

    return result ? result.affectedRows : 0;
}

// ==================== PRIVATE HELPERS ====================

/**
 * Turn a user-agent string into something a person can recognise.
 */
function describeDevice(userAgent) {
    if (!userAgent) return "Unknown device";

    const browser = BROWSERS.find(([pattern]) => pattern.test(userAgent));
    const platform = PLATFORMS.find(([pattern]) => pattern.test(userAgent));

    if (!browser && !platform) {
        return userAgent.slice(0, DEVICE_LABEL_MAX_LENGTH);
    }
    if (!platform) return browser[1];
    if (!browser) return platform[1];

    return `${browser[1]} on ${platform[1]}`;
}

// ==================== EXPORTS ====================

module.exports = {
    REVOKE_REASON,
    SESSION_OUTCOME,
    createSession,
    describeDevice,
    listActiveSessions,
    revokeFamily,
    revokeSessionById,
    revokeSessionByToken,
    revokeSessionForUser,
    revokeUserSessions,
    rotateSession
};
