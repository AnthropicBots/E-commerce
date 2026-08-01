/**
 * Impersonation context middleware (#1393).
 *
 * When the access token carries impersonation claims:
 *  - validates the time-boxed grant (auto-expiry + revoke)
 *  - watermarks the response with X-Impersonating / related headers
 *  - appends an immutable audit row for each request (actorAdminId + subjectUserId)
 *
 * Safe no-op for normal (non-impersonation) sessions.
 */

"use strict";

const impersonationService = require("../services/impersonationService");

function clientMeta(req) {
    const ip =
        req.ip ||
        req.headers["x-forwarded-for"]?.toString().split(",")[0]?.trim() ||
        req.connection?.remoteAddress ||
        null;
    const userAgent = req.headers["user-agent"] || "";
    return { ip, userAgent };
}

function setWatermarkHeaders(res, ctx) {
    res.setHeader("X-Impersonating", ctx.subjectUserId);
    res.setHeader("X-Impersonation-Actor", ctx.actorAdminId);
    res.setHeader("X-Impersonation-Grant", ctx.grantId);
    if (ctx.ticketId) {
        res.setHeader("X-Impersonation-Ticket", String(ctx.ticketId).slice(0, 100));
    }
}

/**
 * Express middleware — call after auth has set req.user.
 */
async function impersonationMiddleware(req, res, next) {
    try {
        const decoded = req.user;
        if (!decoded || !decoded.impersonation) {
            return next();
        }

        const validation = await impersonationService.validateImpersonationClaims(decoded);
        if (!validation.ok) {
            const { ip, userAgent } = clientMeta(req);
            if (decoded.grantId && decoded.actorAdminId && decoded.subjectUserId) {
                await impersonationService
                    .appendAudit({
                        grantId: decoded.grantId,
                        actorAdminId: decoded.actorAdminId,
                        subjectUserId: decoded.subjectUserId,
                        action: impersonationService.ACTIONS.DENY,
                        method: req.method,
                        path: req.originalUrl || req.url,
                        statusCode: validation.status || 401,
                        ip,
                        userAgent,
                        meta: { code: validation.code }
                    })
                    .catch(() => {});
            }

            return res.status(validation.status || 401).json({
                success: false,
                code: validation.code,
                message: validation.message || "Impersonation not allowed"
            });
        }

        const grant = validation.grant;
        const ctx = {
            grantId: grant.id,
            actorAdminId: grant.actor_admin_id,
            subjectUserId: grant.subject_user_id,
            reason: grant.reason,
            ticketId: grant.ticket_id,
            expiresAt: grant.expires_at
        };

        req.impersonation = ctx;
        // Preserve real admin identity for any downstream that needs both.
        req.actorAdminId = ctx.actorAdminId;
        req.subjectUserId = ctx.subjectUserId;

        // Ensure req.user.id is the subject (token already uses subject id).
        req.user.id = ctx.subjectUserId;
        req.user.userId = ctx.subjectUserId;

        setWatermarkHeaders(res, ctx);

        // Audit every action under this grant when the response finishes.
        const { ip, userAgent } = clientMeta(req);
        res.on("finish", () => {
            impersonationService
                .appendAudit({
                    grantId: ctx.grantId,
                    actorAdminId: ctx.actorAdminId,
                    subjectUserId: ctx.subjectUserId,
                    action: impersonationService.ACTIONS.REQUEST,
                    method: req.method,
                    path: req.originalUrl || req.url,
                    statusCode: res.statusCode,
                    ip,
                    userAgent,
                    meta: {
                        ticketId: ctx.ticketId
                    }
                })
                .catch((err) => {
                    console.error("Impersonation audit append failed:", err.message);
                });
        });

        return next();
    } catch (error) {
        console.error("impersonationMiddleware error:", error);
        return res.status(500).json({
            success: false,
            message: "Impersonation middleware failure"
        });
    }
}

module.exports = {
    impersonationMiddleware,
    setWatermarkHeaders
};
