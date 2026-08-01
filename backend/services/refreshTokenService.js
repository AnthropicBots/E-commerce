// backend/services/refreshTokenService.js
// Automatic Token Rotation (ATR) + reuse detection (#1261)
const crypto = require('crypto');
const db = require('../config/db');
const { publishSessionRevoked } = require('../utils/sessionRevocationBus');

const REFRESH_TOKEN_TTL_DAYS = parseInt(process.env.REFRESH_TOKEN_TTL_DAYS, 10) || 30;
const REDIS_FAMILY_TTL_SEC = REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60;
const FINGERPRINT_STRICT = process.env.REFRESH_FINGERPRINT_STRICT === 'true';

// Shared client -- see config/redis.js. A per-module `new Redis({ ... })`
// means an extra connection and an extra reconnect loop per module, and
// makes the module impossible to load without a live Redis (#1341).
const redis = require("../config/redis");

let redisReady = false;
redis.connect().then(() => { redisReady = true; }).catch(() => { redisReady = false; });
redis.on('ready', () => { redisReady = true; });
redis.on('error', () => { redisReady = false; });

function generateRawRefreshToken() {
    return crypto.randomBytes(48).toString('hex');
}

function generateFamilyId() {
    return crypto.randomUUID();
}

function hashToken(token) {
    return crypto.createHash('sha256').update(String(token)).digest('hex');
}

/**
 * Device fingerprint = SHA-256(User-Agent + Client IP)
 */
function buildDeviceFingerprint(userAgent, ip) {
    const ua = String(userAgent || 'unknown').trim().toLowerCase();
    const clientIp = String(ip || '0.0.0.0').trim();
    return crypto
        .createHash('sha256')
        .update(`${ua}|${clientIp}`)
        .digest('hex');
}

function hashIp(ip) {
    return crypto.createHash('sha256').update(String(ip || '')).digest('hex');
}

function familyRevokedKey(familyId) {
    return `rt:family:revoked:${familyId}`;
}

function accessRevokedKey(jti) {
    return `rt:access:revoked:${jti}`;
}

async function blacklistFamily(familyId, reason = 'revoked') {
    if (!familyId || !redisReady) return;
    try {
        await redis.setex(
            familyRevokedKey(familyId),
            REDIS_FAMILY_TTL_SEC,
            JSON.stringify({ reason, at: new Date().toISOString() })
        );
    } catch (err) {
        console.warn('Redis family blacklist failed:', err.message);
    }
}

async function blacklistAccessJti(jti, ttlSec = 3600) {
    if (!jti || !redisReady) return;
    try {
        await redis.setex(accessRevokedKey(jti), ttlSec, '1');
    } catch (err) {
        console.warn('Redis access blacklist failed:', err.message);
    }
}

async function isFamilyRevoked(familyId) {
    if (!familyId) return false;
    if (redisReady) {
        try {
            const hit = await redis.get(familyRevokedKey(familyId));
            if (hit) return true;
        } catch (_) { /* fall through to DB */ }
    }
    try {
        const [rows] = await db.query(
            `SELECT 1 FROM refresh_tokens
             WHERE family_id = ? AND status IN ('revoked', 'reuse_detected')
             LIMIT 1`,
            [familyId]
        );
        return rows.length > 0;
    } catch (_) {
        return false;
    }
}

async function isAccessJtiRevoked(jti) {
    if (!jti || !redisReady) return false;
    try {
        return Boolean(await redis.get(accessRevokedKey(jti)));
    } catch (_) {
        return false;
    }
}

async function logSecurityEvent({
    userId,
    familyId,
    eventType,
    details = {},
    ip = null,
    userAgent = null
}) {
    try {
        await db.query(
            `INSERT INTO refresh_token_security_events
             (id, user_id, family_id, event_type, details, ip_hash, user_agent, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
            [
                crypto.randomUUID(),
                userId,
                familyId,
                eventType,
                JSON.stringify(details),
                ip ? hashIp(ip) : null,
                userAgent ? String(userAgent).slice(0, 512) : null
            ]
        );
    } catch (err) {
        console.error('Refresh token security event log failed:', err.message);
    }
}

/**
 * Issue a new refresh-token family on login (ATR root node).
 */
async function issueRefreshFamily(userId, { userAgent, ip } = {}) {
    const familyId = generateFamilyId();
    const rawToken = generateRawRefreshToken();
    const tokenHash = hashToken(rawToken);
    const fingerprint = buildDeviceFingerprint(userAgent, ip);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_TTL_DAYS);
    const id = crypto.randomUUID();

    await db.query(
        `INSERT INTO refresh_tokens
         (id, user_id, family_id, token_hash, parent_token_hash, device_fingerprint,
          user_agent, ip_hash, status, expires_at, created_at, last_used_at)
         VALUES (?, ?, ?, ?, NULL, ?, ?, ?, 'active', ?, NOW(), NOW())`,
        [
            id,
            userId,
            familyId,
            tokenHash,
            fingerprint,
            userAgent ? String(userAgent).slice(0, 512) : null,
            hashIp(ip),
            expiresAt
        ]
    );

    // Backward-compatible pointer on users table
    await db.query(
        `UPDATE users SET refresh_token = ?, last_login = NOW() WHERE id = ?`,
        [rawToken, userId]
    );

    await logSecurityEvent({
        userId,
        familyId,
        eventType: 'family_issued',
        details: { tokenId: id },
        ip,
        userAgent
    });

    return { refreshToken: rawToken, familyId, tokenId: id, deviceFingerprint: fingerprint };
}

/**
 * Rotate: invalidate presented token, issue child in same family.
 * Reuse of a rotated/revoked token → revoke entire family cascade.
 */
async function rotateRefreshToken(presentedToken, { userAgent, ip } = {}) {
    const presentedHash = hashToken(presentedToken);
    const fingerprint = buildDeviceFingerprint(userAgent, ip);

    const [rows] = await db.query(
        `SELECT * FROM refresh_tokens WHERE token_hash = ? LIMIT 1`,
        [presentedHash]
    );

    if (!rows.length) {
        // Might be legacy users.refresh_token only — migrate once
        const legacy = await tryLegacyRotate(presentedToken, { userAgent, ip, fingerprint });
        if (legacy) return legacy;

        return {
            ok: false,
            code: 'INVALID_REFRESH_TOKEN',
            status: 401,
            message: 'Invalid refresh token'
        };
    }

    const record = rows[0];

    if (new Date(record.expires_at) < new Date()) {
        await db.query(
            `UPDATE refresh_tokens SET status = 'revoked', revoked_at = NOW() WHERE id = ?`,
            [record.id]
        );
        return {
            ok: false,
            code: 'REFRESH_TOKEN_EXPIRED',
            status: 401,
            message: 'Refresh token expired'
        };
    }

    // Reuse / replay detection — previously rotated or revoked token presented again
    if (record.status === 'rotated' || record.status === 'revoked' || record.status === 'reuse_detected') {
        await revokeTokenFamily(record.family_id, record.user_id, 'token_reuse_detected', {
            reusedTokenId: record.id,
            previousStatus: record.status,
            ip,
            userAgent
        });

        return {
            ok: false,
            code: 'REFRESH_TOKEN_REUSE_DETECTED',
            status: 401,
            message: 'Refresh token reuse detected. All sessions have been revoked. Please login again.',
            familyRevoked: true,
            familyId: record.family_id
        };
    }

    if (record.status !== 'active') {
        return {
            ok: false,
            code: 'INVALID_REFRESH_TOKEN',
            status: 401,
            message: 'Invalid refresh token'
        };
    }

    if (await isFamilyRevoked(record.family_id)) {
        return {
            ok: false,
            code: 'FAMILY_REVOKED',
            status: 401,
            message: 'Session family revoked. Please login again.'
        };
    }

    // Device fingerprint matching
    const fingerprintMatch = record.device_fingerprint === fingerprint;
    if (!fingerprintMatch) {
        await logSecurityEvent({
            userId: record.user_id,
            familyId: record.family_id,
            eventType: 'fingerprint_mismatch',
            details: {
                expected: record.device_fingerprint,
                actual: fingerprint
            },
            ip,
            userAgent
        });

        if (FINGERPRINT_STRICT) {
            await revokeTokenFamily(record.family_id, record.user_id, 'fingerprint_mismatch', {
                ip,
                userAgent
            });
            return {
                ok: false,
                code: 'DEVICE_FINGERPRINT_MISMATCH',
                status: 401,
                message: 'Device fingerprint mismatch. Sessions revoked. Please login again.',
                familyRevoked: true
            };
        }
    }

    const newRaw = generateRawRefreshToken();
    const newHash = hashToken(newRaw);
    const newId = crypto.randomUUID();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_TTL_DAYS);

    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        // Optimistic: only rotate if still active (prevents race double-rotate)
        const [upd] = await connection.query(
            `UPDATE refresh_tokens
             SET status = 'rotated', rotated_at = NOW(), last_used_at = NOW()
             WHERE id = ? AND status = 'active'`,
            [record.id]
        );

        if (!upd.affectedRows) {
            await connection.rollback();
            // Lost race — treat as potential reuse
            await revokeTokenFamily(record.family_id, record.user_id, 'concurrent_rotate_race', {
                ip,
                userAgent
            });
            return {
                ok: false,
                code: 'REFRESH_TOKEN_REUSE_DETECTED',
                status: 401,
                message: 'Refresh token reuse detected. All sessions have been revoked. Please login again.',
                familyRevoked: true
            };
        }

        await connection.query(
            `INSERT INTO refresh_tokens
             (id, user_id, family_id, token_hash, parent_token_hash, device_fingerprint,
              user_agent, ip_hash, status, expires_at, created_at, last_used_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, NOW(), NOW())`,
            [
                newId,
                record.user_id,
                record.family_id,
                newHash,
                presentedHash,
                fingerprint,
                userAgent ? String(userAgent).slice(0, 512) : null,
                hashIp(ip),
                expiresAt
            ]
        );

        await connection.query(
            `UPDATE users SET refresh_token = ? WHERE id = ?`,
            [newRaw, record.user_id]
        );

        await connection.commit();
    } catch (err) {
        await connection.rollback();
        throw err;
    } finally {
        connection.release();
    }

    await logSecurityEvent({
        userId: record.user_id,
        familyId: record.family_id,
        eventType: 'token_rotated',
        details: { parentId: record.id, newId, fingerprintMatch },
        ip,
        userAgent
    });

    return {
        ok: true,
        refreshToken: newRaw,
        familyId: record.family_id,
        userId: record.user_id,
        fingerprintMatch
    };
}

async function tryLegacyRotate(presentedToken, { userAgent, ip, fingerprint }) {
    const [users] = await db.query(
        `SELECT id, name, email, role, is_active FROM users WHERE refresh_token = ? LIMIT 1`,
        [presentedToken]
    );
    if (!users.length) return null;
    if (users[0].is_active === 0) {
        return {
            ok: false,
            code: 'ACCOUNT_DEACTIVATED',
            status: 403,
            message: 'Account has been deactivated'
        };
    }

    // Migrate legacy single-token into a family, then rotate
    const issued = await issueRefreshFamily(users[0].id, { userAgent, ip });
    // Immediately rotate the just-issued token so client gets a child (or return issued)
    // Simpler: return the newly issued family token as the rotation result
    return {
        ok: true,
        refreshToken: issued.refreshToken,
        familyId: issued.familyId,
        userId: users[0].id,
        user: users[0],
        fingerprintMatch: true,
        legacyMigrated: true
    };
}

/**
 * Revoke entire token family + Redis blacklist (cascade)
 */
async function revokeTokenFamily(familyId, userId, reason, meta = {}) {
    await db.query(
        `UPDATE refresh_tokens
         SET status = IF(status = 'rotated', 'reuse_detected', 'revoked'),
             revoked_at = NOW()
         WHERE family_id = ? AND status IN ('active', 'rotated')`,
        [familyId]
    );

    // Mark reuse explicitly on already-rotated rows when reason is reuse
    if (reason === 'token_reuse_detected') {
        await db.query(
            `UPDATE refresh_tokens
             SET status = 'reuse_detected', revoked_at = COALESCE(revoked_at, NOW())
             WHERE family_id = ?`,
            [familyId]
        );
    }

    await blacklistFamily(familyId, reason);

    // Clear legacy column if it still points at a revoked family token
    if (userId) {
        await db.query(
            `UPDATE users SET refresh_token = NULL WHERE id = ?`,
            [userId]
        );
    }

    await logSecurityEvent({
        userId,
        familyId,
        eventType: 'family_revoked',
        details: { reason, ...meta },
        ip: meta.ip,
        userAgent: meta.userAgent
    });

    console.warn(`🚨 Refresh token family revoked: ${familyId} reason=${reason}`);

    // Access tokens minted from this family are still valid on the wire until
    // they expire, so any connection holding one has to be closed rather than
    // left running until its own clock runs out.
    publishSessionRevoked({ familyId, reason });

    return { familyId, reason };
}

/**
 * Revoke all families for a user (logout-all / password change)
 */
async function revokeAllUserFamilies(userId, reason = 'user_logout_all') {
    const [families] = await db.query(
        `SELECT DISTINCT family_id FROM refresh_tokens
         WHERE user_id = ? AND status IN ('active', 'rotated')`,
        [userId]
    );

    for (const row of families) {
        await revokeTokenFamily(row.family_id, userId, reason);
    }

    await db.query(`UPDATE users SET refresh_token = NULL, last_logout = NOW() WHERE id = ?`, [userId]);

    // The per-family disconnects above cannot match a connection whose token
    // predates family ids; an account-wide one can.
    publishSessionRevoked({ userId, reason });

    return { revokedFamilies: families.length };
}

/**
 * Revoke only the family for the presented refresh token (single-device logout)
 */
async function revokePresentedSession(presentedToken, userId, reason = 'user_logout') {
    if (!presentedToken) {
        return revokeAllUserFamilies(userId, reason);
    }
    const hash = hashToken(presentedToken);
    const [rows] = await db.query(
        `SELECT family_id, user_id FROM refresh_tokens WHERE token_hash = ? LIMIT 1`,
        [hash]
    );
    if (rows.length) {
        return revokeTokenFamily(rows[0].family_id, rows[0].user_id || userId, reason);
    }
    await db.query(`UPDATE users SET refresh_token = NULL, last_logout = NOW() WHERE id = ?`, [userId]);
    return { revoked: true };
}

module.exports = {
    generateRawRefreshToken,
    generateFamilyId,
    hashToken,
    buildDeviceFingerprint,
    issueRefreshFamily,
    rotateRefreshToken,
    revokeTokenFamily,
    revokeAllUserFamilies,
    revokePresentedSession,
    isFamilyRevoked,
    isAccessJtiRevoked,
    blacklistAccessJti,
    blacklistFamily,
    logSecurityEvent,
    REFRESH_TOKEN_TTL_DAYS
};
