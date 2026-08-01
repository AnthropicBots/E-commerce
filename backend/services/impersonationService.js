/**
 * Admin impersonation grants — mint / revoke / audit (#1393).
 */

"use strict";

const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const db = require("../config/db");
const { sanitizeString, safeInteger } = require("../utils/helpers");

const DEFAULT_TTL_MINUTES = Math.max(
    1,
    parseInt(process.env.IMPERSONATION_TTL_MINUTES, 10) || 10
);
const MAX_TTL_MINUTES = Math.max(
    DEFAULT_TTL_MINUTES,
    parseInt(process.env.IMPERSONATION_MAX_TTL_MINUTES, 10) || 30
);

const ACTIONS = Object.freeze({
    MINT: "mint",
    REQUEST: "request",
    REVOKE: "revoke",
    EXPIRE: "expire",
    DENY: "deny"
});

class ImpersonationError extends Error {
    constructor(message, { status = 400, code = "IMPERSONATION_ERROR" } = {}) {
        super(message);
        this.name = "ImpersonationError";
        this.status = status;
        this.code = code;
    }
}

function subjectId(userLike) {
    return userLike?.id || userLike?.userId || null;
}

async function appendAudit({
    grantId,
    actorAdminId,
    subjectUserId,
    action,
    method = null,
    path = null,
    statusCode = null,
    ip = null,
    userAgent = null,
    meta = null
}) {
    await db.query(
        `INSERT INTO admin_impersonation_audit
            (grant_id, actor_admin_id, subject_user_id, action, method, path,
             status_code, ip, user_agent, meta_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            grantId,
            actorAdminId,
            subjectUserId,
            action,
            method ? String(method).slice(0, 16) : null,
            path ? String(path).slice(0, 512) : null,
            statusCode,
            ip ? String(ip).slice(0, 45) : null,
            userAgent ? String(userAgent).slice(0, 512) : null,
            meta ? JSON.stringify(meta) : null
        ]
    );
}

async function getActiveGrantByJti(jti) {
    const [rows] = await db.query(
        `SELECT * FROM admin_impersonation_grants
         WHERE jti = ? LIMIT 1`,
        [jti]
    );
    return rows[0] || null;
}

/**
 * Mint a short-lived impersonation access token.
 * Subject claim is the target user; actorAdminId is preserved in claims + DB.
 */
async function mintImpersonationToken({
    actorAdmin,
    subjectUserId,
    reason,
    ticketId,
    ttlMinutes,
    ip = null,
    userAgent = null
}) {
    const actorAdminId = subjectId(actorAdmin);
    if (!actorAdminId) {
        throw new ImpersonationError("Admin identity required", {
            status: 401,
            code: "ADMIN_REQUIRED"
        });
    }

    const cleanReason = sanitizeString(reason || "");
    const cleanTicket = sanitizeString(ticketId || "");
    const cleanSubject = sanitizeString(subjectUserId || "");

    if (!cleanSubject) {
        throw new ImpersonationError("subject userId is required", {
            status: 400,
            code: "SUBJECT_REQUIRED"
        });
    }
    if (cleanReason.length < 8) {
        throw new ImpersonationError(
            "A reason of at least 8 characters is required",
            { status: 400, code: "REASON_REQUIRED" }
        );
    }
    if (cleanTicket.length < 3) {
        throw new ImpersonationError("A ticket id is required (min 3 characters)", {
            status: 400,
            code: "TICKET_REQUIRED"
        });
    }
    if (cleanSubject === actorAdminId) {
        throw new ImpersonationError("Cannot impersonate yourself", {
            status: 400,
            code: "SELF_IMPERSONATION"
        });
    }

    const [subjects] = await db.query(
        `SELECT id, email, name, role, is_active, deleted_at
         FROM users WHERE id = ? LIMIT 1`,
        [cleanSubject]
    );
    const subject = subjects[0];
    if (!subject) {
        throw new ImpersonationError("Subject user not found", {
            status: 404,
            code: "SUBJECT_NOT_FOUND"
        });
    }
    if (subject.deleted_at || subject.is_active === 0) {
        throw new ImpersonationError("Cannot impersonate an inactive or deleted user", {
            status: 400,
            code: "SUBJECT_INACTIVE"
        });
    }
    if (subject.role === "admin" || subject.role === "superadmin") {
        throw new ImpersonationError("Cannot impersonate admin accounts", {
            status: 403,
            code: "ADMIN_SUBJECT_FORBIDDEN"
        });
    }

    let ttl = safeInteger(ttlMinutes, DEFAULT_TTL_MINUTES);
    if (ttl < 1) ttl = 1;
    if (ttl > MAX_TTL_MINUTES) ttl = MAX_TTL_MINUTES;

    const grantId = crypto.randomUUID();
    const jti = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + ttl * 60 * 1000);

    await db.query(
        `INSERT INTO admin_impersonation_grants
            (id, actor_admin_id, subject_user_id, reason, ticket_id, jti, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
            grantId,
            actorAdminId,
            cleanSubject,
            cleanReason.slice(0, 500),
            cleanTicket.slice(0, 100),
            jti,
            expiresAt
        ]
    );

    await appendAudit({
        grantId,
        actorAdminId,
        subjectUserId: cleanSubject,
        action: ACTIONS.MINT,
        ip,
        userAgent,
        meta: { reason: cleanReason, ticketId: cleanTicket, ttlMinutes: ttl }
    });

    const secret = process.env.JWT_SECRET;
    if (!secret) {
        throw new ImpersonationError("JWT_SECRET is not configured", {
            status: 500,
            code: "CONFIG_ERROR"
        });
    }

    const token = jwt.sign(
        {
            id: subject.id,
            email: subject.email,
            role: subject.role,
            impersonation: true,
            actorAdminId,
            subjectUserId: subject.id,
            grantId,
            reason: cleanReason.slice(0, 200),
            ticketId: cleanTicket.slice(0, 100),
            jti
        },
        secret,
        { expiresIn: `${ttl}m` }
    );

    return {
        token,
        grantId,
        jti,
        expiresAt: expiresAt.toISOString(),
        ttlMinutes: ttl,
        actorAdminId,
        subjectUserId: subject.id,
        subject: {
            id: subject.id,
            email: subject.email,
            name: subject.name,
            role: subject.role
        },
        reason: cleanReason,
        ticketId: cleanTicket
    };
}

async function revokeImpersonationGrant({
    grantId,
    jti,
    revokedBy,
    ip = null,
    userAgent = null
}) {
    let grant = null;
    if (grantId) {
        const [rows] = await db.query(
            `SELECT * FROM admin_impersonation_grants WHERE id = ? LIMIT 1`,
            [sanitizeString(grantId)]
        );
        grant = rows[0] || null;
    } else if (jti) {
        grant = await getActiveGrantByJti(sanitizeString(jti));
    }

    if (!grant) {
        throw new ImpersonationError("Impersonation grant not found", {
            status: 404,
            code: "GRANT_NOT_FOUND"
        });
    }

    if (grant.revoked_at) {
        return { alreadyRevoked: true, grantId: grant.id };
    }

    const actorId = subjectId(revokedBy) || grant.actor_admin_id;
    await db.query(
        `UPDATE admin_impersonation_grants
         SET revoked_at = NOW(), revoked_by = ?
         WHERE id = ? AND revoked_at IS NULL`,
        [actorId, grant.id]
    );

    await appendAudit({
        grantId: grant.id,
        actorAdminId: grant.actor_admin_id,
        subjectUserId: grant.subject_user_id,
        action: ACTIONS.REVOKE,
        ip,
        userAgent,
        meta: { revokedBy: actorId }
    });

    return { alreadyRevoked: false, grantId: grant.id };
}

/**
 * Validate an impersonation JWT payload against the grant row.
 * @returns {{ ok: true, grant } | { ok: false, code, message, status }}
 */
async function validateImpersonationClaims(decoded) {
    if (!decoded || !decoded.impersonation) {
        return { ok: true, grant: null };
    }

    const grantId = decoded.grantId;
    const jti = decoded.jti;
    const actorAdminId = decoded.actorAdminId;
    const subjectUserId = decoded.subjectUserId || decoded.id;

    if (!grantId || !jti || !actorAdminId || !subjectUserId) {
        return {
            ok: false,
            status: 401,
            code: "IMPERSONATION_CLAIMS_INVALID",
            message: "Impersonation token is missing required claims"
        };
    }

    const grant = await getActiveGrantByJti(jti);
    if (!grant || grant.id !== grantId) {
        return {
            ok: false,
            status: 401,
            code: "IMPERSONATION_GRANT_UNKNOWN",
            message: "Impersonation grant not found"
        };
    }

    if (grant.revoked_at) {
        return {
            ok: false,
            status: 401,
            code: "IMPERSONATION_REVOKED",
            message: "Impersonation grant has been revoked"
        };
    }

    if (new Date(grant.expires_at).getTime() <= Date.now()) {
        await appendAudit({
            grantId: grant.id,
            actorAdminId: grant.actor_admin_id,
            subjectUserId: grant.subject_user_id,
            action: ACTIONS.EXPIRE,
            meta: { source: "validate" }
        }).catch(() => {});
        return {
            ok: false,
            status: 401,
            code: "IMPERSONATION_EXPIRED",
            message: "Impersonation grant has expired"
        };
    }

    if (
        grant.actor_admin_id !== actorAdminId ||
        grant.subject_user_id !== subjectUserId
    ) {
        return {
            ok: false,
            status: 401,
            code: "IMPERSONATION_MISMATCH",
            message: "Impersonation token does not match grant"
        };
    }

    return { ok: true, grant };
}

async function listImpersonationAudit({
    grantId = null,
    actorAdminId = null,
    subjectUserId = null,
    page = 1,
    limit = 50
} = {}) {
    const safePage = Math.max(1, safeInteger(page, 1));
    const safeLimit = Math.min(100, Math.max(1, safeInteger(limit, 50)));
    const offset = (safePage - 1) * safeLimit;

    const where = [];
    const params = [];
    if (grantId) {
        where.push("grant_id = ?");
        params.push(sanitizeString(grantId));
    }
    if (actorAdminId) {
        where.push("actor_admin_id = ?");
        params.push(sanitizeString(actorAdminId));
    }
    if (subjectUserId) {
        where.push("subject_user_id = ?");
        params.push(sanitizeString(subjectUserId));
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const [countRows] = await db.query(
        `SELECT COUNT(*) AS total FROM admin_impersonation_audit ${whereSql}`,
        params
    );
    const [rows] = await db.query(
        `SELECT id, grant_id, actor_admin_id, subject_user_id, action, method,
                path, status_code, ip, user_agent, meta_json, created_at
         FROM admin_impersonation_audit
         ${whereSql}
         ORDER BY created_at DESC
         LIMIT ? OFFSET ?`,
        [...params, safeLimit, offset]
    );

    return {
        entries: rows.map((r) => ({
            id: r.id,
            grantId: r.grant_id,
            actorAdminId: r.actor_admin_id,
            subjectUserId: r.subject_user_id,
            action: r.action,
            method: r.method,
            path: r.path,
            statusCode: r.status_code,
            ip: r.ip,
            userAgent: r.user_agent,
            meta: r.meta_json
                ? typeof r.meta_json === "string"
                    ? JSON.parse(r.meta_json)
                    : r.meta_json
                : null,
            createdAt: r.created_at
        })),
        total: countRows[0]?.total || 0,
        page: safePage,
        limit: safeLimit
    };
}

module.exports = {
    ACTIONS,
    DEFAULT_TTL_MINUTES,
    MAX_TTL_MINUTES,
    ImpersonationError,
    mintImpersonationToken,
    revokeImpersonationGrant,
    validateImpersonationClaims,
    appendAudit,
    listImpersonationAudit,
    getActiveGrantByJti
};
