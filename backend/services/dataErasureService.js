/**
 * Data Retention & GDPR / DPDP Erasure Workflow (#1397).
 *
 * Staged flow:
 *   1. authenticate request  → pending_confirmation + confirmation email
 *   2. soft-delete user      → is_active=0, deleted_at set
 *   3. anonymize PII         → orders keep legal totals; PII redacted
 *   4. purge tokens/sessions → refresh_tokens, auth_sessions, carts, wishlist
 *   5. issue erasure receipt → receipt_id returned to the user
 *
 * Order rows are intentionally retained (tax / dispute / accounting). Only
 * personally identifiable fields are overwritten with stable anonymized values
 * keyed by the receipt id.
 */

"use strict";

const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const db = require("../config/db");
const { withTransaction } = require("../config/db");
const { sanitizeString, safeArray } = require("../utils/helpers");
const refreshTokenService = require("./refreshTokenService");

const CONFIRMATION_TTL_HOURS = Math.max(
    1,
    parseInt(process.env.ERASURE_CONFIRM_TTL_HOURS, 10) || 24
);

const STATUS = Object.freeze({
    PENDING: "pending_confirmation",
    CONFIRMED: "confirmed",
    SOFT_DELETED: "soft_deleted",
    ANONYMIZING: "anonymizing",
    PURGING: "purging",
    COMPLETED: "completed",
    FAILED: "failed",
    CANCELLED: "cancelled"
});

const ANON = Object.freeze({
    name: "Erased User",
    phone: null,
    address: "[REDACTED]",
    city: "[REDACTED]",
    state: "[REDACTED]",
    zip: "[REDACTED]",
    country: null
});

class ErasureError extends Error {
    constructor(message, { status = 400, code = "ERASURE_ERROR" } = {}) {
        super(message);
        this.name = "ErasureError";
        this.status = status;
        this.code = code;
    }
}

function sha256(value) {
    return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function mintReceiptId() {
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const suffix = crypto.randomBytes(4).toString("hex").toUpperCase();
    return `ER-${stamp}-${suffix}`;
}

function anonymizedEmail(receiptId) {
    // Unique + non-deliverable so UNIQUE(email) on users stays satisfied.
    return `erased+${receiptId.toLowerCase()}@erased.invalid`;
}

function redactedAddressJson() {
    return JSON.stringify({
        line1: ANON.address,
        city: ANON.city,
        state: ANON.state,
        zip: ANON.zip,
        redacted: true
    });
}

async function sendConfirmationEmail({ to, confirmToken, requestId }) {
    const frontend = (process.env.FRONTEND_URL || "http://localhost:5500").replace(/\/$/, "");
    const confirmUrl = `${frontend}/signin.html?erasureConfirm=${encodeURIComponent(confirmToken)}&requestId=${encodeURIComponent(requestId)}`;
    const subject = "Confirm your data erasure request";
    const body =
        `You requested erasure of your account under our GDPR / DPDP workflow.\n\n` +
        `Confirm within ${CONFIRMATION_TTL_HOURS} hours using this link:\n${confirmUrl}\n\n` +
        `Or submit token ${confirmToken} to POST /api/auth/erasure/confirm.\n\n` +
        `If you did not request this, you can ignore this email — nothing will be deleted.`;

    const host = process.env.SMTP_HOST;
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;

    if (host && user && pass) {
        try {
            const nodemailer = require("nodemailer");
            const transporter = nodemailer.createTransport({
                host,
                port: Number(process.env.SMTP_PORT) || 587,
                secure: false,
                auth: { user, pass }
            });
            await transporter.sendMail({
                from: process.env.SMTP_FROM || user,
                to,
                subject,
                text: body
            });
            return { delivered: true, channel: "smtp" };
        } catch (err) {
            console.error("Erasure confirmation email failed:", err.message);
            // Fall through to log channel so the workflow is still testable.
        }
    }

    console.info("[erasure] confirmation email (SMTP not configured):\n", {
        to,
        subject,
        confirmUrl,
        requestId
    });
    return { delivered: false, channel: "log", confirmUrl };
}

async function appendStage(connection, requestId, stage, detail = {}) {
    const [rows] = await connection.query(
        "SELECT stages_json FROM erasure_requests WHERE id = ?",
        [requestId]
    );
    const stages = rows[0]?.stages_json
        ? (typeof rows[0].stages_json === "string"
            ? JSON.parse(rows[0].stages_json)
            : rows[0].stages_json)
        : [];
    stages.push({
        stage,
        at: new Date().toISOString(),
        ...detail
    });
    await connection.query(
        "UPDATE erasure_requests SET stages_json = ?, updated_at = NOW() WHERE id = ?",
        [JSON.stringify(stages), requestId]
    );
    return stages;
}

async function setStatus(connection, requestId, status, extra = {}) {
    const sets = ["status = ?", "updated_at = NOW()"];
    const params = [status];
    if (extra.errorMessage !== undefined) {
        sets.push("error_message = ?");
        params.push(extra.errorMessage);
    }
    if (extra.receiptId !== undefined) {
        sets.push("receipt_id = ?");
        params.push(extra.receiptId);
    }
    if (extra.confirmedAt) {
        sets.push("confirmed_at = NOW()");
    }
    if (extra.completedAt) {
        sets.push("completed_at = NOW()");
    }
    params.push(requestId);
    await connection.query(
        `UPDATE erasure_requests SET ${sets.join(", ")} WHERE id = ?`,
        params
    );
}

/**
 * Step 1 — authenticated user opens an erasure request + confirmation email.
 */
async function requestErasure(userId, { reason = null, ip = null, userAgent = null } = {}) {
    const [users] = await db.query(
        `SELECT id, email, name, role, is_active, deleted_at
         FROM users WHERE id = ? LIMIT 1`,
        [userId]
    );
    const user = users[0];
    if (!user) {
        throw new ErasureError("User not found", { status: 404, code: "USER_NOT_FOUND" });
    }
    if (user.role === "admin" || user.role === "superadmin") {
        throw new ErasureError("Admin accounts cannot self-erase via this workflow", {
            status: 403,
            code: "ADMIN_ERASURE_FORBIDDEN"
        });
    }
    if (user.deleted_at) {
        throw new ErasureError("Account is already erased or pending deletion", {
            status: 409,
            code: "ALREADY_ERASED"
        });
    }

    const [open] = await db.query(
        `SELECT id, status FROM erasure_requests
         WHERE user_id = ? AND status IN (?, ?, ?, ?, ?)
         ORDER BY created_at DESC LIMIT 1`,
        [
            userId,
            STATUS.PENDING,
            STATUS.CONFIRMED,
            STATUS.SOFT_DELETED,
            STATUS.ANONYMIZING,
            STATUS.PURGING
        ]
    );
    if (open[0]) {
        throw new ErasureError("An erasure request is already in progress", {
            status: 409,
            code: "ERASURE_IN_PROGRESS"
        });
    }

    const requestId = crypto.randomUUID();
    const confirmToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = sha256(confirmToken);
    const expiresAt = new Date(Date.now() + CONFIRMATION_TTL_HOURS * 60 * 60 * 1000);

    await db.query(
        `INSERT INTO erasure_requests (
            id, user_id, status, confirmation_token_hash, confirmation_expires_at,
            reason, requested_ip, user_agent, original_email_hash, stages_json
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            requestId,
            userId,
            STATUS.PENDING,
            tokenHash,
            expiresAt,
            reason ? sanitizeString(reason).slice(0, 500) : null,
            ip ? String(ip).slice(0, 45) : null,
            userAgent ? String(userAgent).slice(0, 512) : null,
            sha256(String(user.email).toLowerCase()),
            JSON.stringify([
                {
                    stage: "requested",
                    at: new Date().toISOString()
                }
            ])
        ]
    );

    const emailResult = await sendConfirmationEmail({
        to: user.email,
        confirmToken,
        requestId
    });

    return {
        requestId,
        status: STATUS.PENDING,
        expiresAt: expiresAt.toISOString(),
        emailDelivered: Boolean(emailResult.delivered),
        // Token is only returned when SMTP is off so local/dev can confirm.
        // Production with SMTP relies on the email link alone.
        confirmationToken: emailResult.delivered ? undefined : confirmToken,
        message:
            "Erasure request created. Confirm via the email we sent to complete deletion."
    };
}

/**
 * Steps 2–5 — confirm token and run soft-delete → anonymize → purge → receipt.
 */
async function confirmErasure(confirmToken, { requestId = null } = {}) {
    if (!confirmToken || String(confirmToken).length < 16) {
        throw new ErasureError("Invalid confirmation token", {
            status: 400,
            code: "INVALID_TOKEN"
        });
    }

    const tokenHash = sha256(confirmToken);
    const params = [tokenHash, STATUS.PENDING];
    let sql =
        `SELECT * FROM erasure_requests
         WHERE confirmation_token_hash = ? AND status = ?`;
    if (requestId) {
        sql += " AND id = ?";
        params.push(requestId);
    }
    sql += " LIMIT 1";

    const [rows] = await db.query(sql, params);
    const request = rows[0];
    if (!request) {
        throw new ErasureError("Erasure request not found or already processed", {
            status: 404,
            code: "REQUEST_NOT_FOUND"
        });
    }
    if (new Date(request.confirmation_expires_at).getTime() < Date.now()) {
        await db.query(
            `UPDATE erasure_requests SET status = ?, error_message = ?, updated_at = NOW() WHERE id = ?`,
            [STATUS.CANCELLED, "Confirmation token expired", request.id]
        );
        throw new ErasureError("Confirmation token has expired. Please request erasure again.", {
            status: 410,
            code: "TOKEN_EXPIRED"
        });
    }

    const receiptId = mintReceiptId();
    const anonEmail = anonymizedEmail(receiptId);
    const burnedPassword = await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 10);

    let summary;

    try {
        summary = await withTransaction(async (connection) => {
            await setStatus(connection, request.id, STATUS.CONFIRMED, { confirmedAt: true });
            await appendStage(connection, request.id, "confirmed");

            // --- soft-delete -------------------------------------------------
            await setStatus(connection, request.id, STATUS.SOFT_DELETED);
            await connection.query(
                `UPDATE users SET
                    is_active = 0,
                    deleted_at = NOW(),
                    delete_reason = ?,
                    password = ?,
                    name = ?,
                    phone = NULL,
                    address = ?,
                    city = ?,
                    state = ?,
                    zip = ?,
                    avatar = NULL
                 WHERE id = ?`,
                [
                    `GDPR/DPDP erasure ${receiptId}`,
                    burnedPassword,
                    ANON.name,
                    ANON.address,
                    ANON.city,
                    ANON.state,
                    ANON.zip,
                    request.user_id
                ]
            );
            await appendStage(connection, request.id, "soft_deleted");

            // --- anonymize order PII (retain legal totals / status) ----------
            await setStatus(connection, request.id, STATUS.ANONYMIZING);
            const [orderResult] = await connection.query(
                `UPDATE orders SET
                    customer_name = ?,
                    customer_email = ?,
                    customer_phone = NULL,
                    city = ?,
                    state = ?,
                    zip = ?,
                    full_address = ?,
                    billing_address = ?,
                    shipping_address = ?,
                    ip_address = NULL,
                    user_agent = NULL,
                    notes = NULL
                 WHERE user_id = ?`,
                [
                    ANON.name,
                    anonEmail,
                    ANON.city,
                    ANON.state,
                    ANON.zip,
                    ANON.address,
                    redactedAddressJson(),
                    redactedAddressJson(),
                    request.user_id
                ]
            );
            const ordersAnonymized = orderResult?.affectedRows || 0;
            await appendStage(connection, request.id, "orders_anonymized", {
                ordersAnonymized
            });

            // Finish user email anonymization after orders (unique email).
            await connection.query(
                `UPDATE users SET email = ? WHERE id = ?`,
                [anonEmail, request.user_id]
            );
            await appendStage(connection, request.id, "user_anonymized");

            // --- purge tokens, sessions, carts, wishlist ---------------------
            await setStatus(connection, request.id, STATUS.PURGING);

            const [rt] = await connection.query(
                `DELETE FROM refresh_tokens WHERE user_id = ?`,
                [request.user_id]
            );
            let sessionsPurged = 0;
            try {
                const [as] = await connection.query(
                    `DELETE FROM auth_sessions WHERE user_id = ?`,
                    [request.user_id]
                );
                sessionsPurged = as?.affectedRows || 0;
            } catch (_) {
                /* table may be absent on older DBs */
            }

            const [cart] = await connection.query(
                `DELETE FROM cart_items WHERE user_id = ?`,
                [request.user_id]
            );
            let wishlistPurged = 0;
            try {
                const [wl] = await connection.query(
                    `DELETE FROM wishlist_items WHERE user_id = ?`,
                    [request.user_id]
                );
                wishlistPurged = wl?.affectedRows || 0;
            } catch (_) { /* ignore */ }

            // Best-effort inventory lock cleanup
            try {
                await connection.query(
                    `DELETE FROM inventory_locks WHERE user_id = ?`,
                    [request.user_id]
                );
            } catch (_) { /* ignore */ }

            await appendStage(connection, request.id, "purged", {
                refreshTokens: rt?.affectedRows || 0,
                sessions: sessionsPurged,
                cartItems: cart?.affectedRows || 0,
                wishlistItems: wishlistPurged
            });

            // --- receipt -----------------------------------------------------
            const receiptRowId = crypto.randomUUID();
            const summaryPayload = {
                receiptId,
                requestId: request.id,
                userId: request.user_id,
                ordersAnonymized,
                refreshTokensPurged: rt?.affectedRows || 0,
                sessionsPurged,
                cartItemsPurged: cart?.affectedRows || 0,
                wishlistItemsPurged: wishlistPurged,
                framework: ["GDPR", "DPDP"],
                completedAt: new Date().toISOString()
            };

            await connection.query(
                `INSERT INTO erasure_receipts (id, receipt_id, erasure_request_id, user_id, summary_json)
                 VALUES (?, ?, ?, ?, ?)`,
                [
                    receiptRowId,
                    receiptId,
                    request.id,
                    request.user_id,
                    JSON.stringify(summaryPayload)
                ]
            );

            await setStatus(connection, request.id, STATUS.COMPLETED, {
                receiptId,
                completedAt: true
            });
            await appendStage(connection, request.id, "completed", { receiptId });

            return summaryPayload;
        });
    } catch (err) {
        try {
            await db.query(
                `UPDATE erasure_requests SET status = ?, error_message = ?, updated_at = NOW() WHERE id = ?`,
                [STATUS.FAILED, String(err.message || err).slice(0, 1000), request.id]
            );
        } catch (_) { /* ignore */ }
        throw err;
    }

    // Revoke live JWT families outside the txn (may touch Redis).
    try {
        if (typeof refreshTokenService.revokeAllUserFamilies === "function") {
            await refreshTokenService.revokeAllUserFamilies(
                request.user_id,
                "gdpr_erasure"
            );
        }
    } catch (err) {
        console.warn("Erasure post-purge token revoke warning:", err.message);
    }

    return {
        success: true,
        receiptId: summary.receiptId,
        requestId: request.id,
        status: STATUS.COMPLETED,
        summary,
        message:
            "Your data erasure is complete. Keep this receipt ID for your records."
    };
}

/**
 * User or admin: fetch a single request (user may only see their own).
 */
async function getErasureStatus(requestId, { userId = null, asAdmin = false } = {}) {
    const [rows] = await db.query(
        `SELECT id, user_id, status, receipt_id, reason, stages_json,
                error_message, confirmed_at, completed_at, created_at, updated_at,
                confirmation_expires_at
         FROM erasure_requests WHERE id = ? LIMIT 1`,
        [requestId]
    );
    const row = rows[0];
    if (!row) {
        throw new ErasureError("Erasure request not found", {
            status: 404,
            code: "REQUEST_NOT_FOUND"
        });
    }
    if (!asAdmin && userId && row.user_id !== userId) {
        throw new ErasureError("Erasure request not found", {
            status: 404,
            code: "REQUEST_NOT_FOUND"
        });
    }

    const stages = row.stages_json
        ? (typeof row.stages_json === "string"
            ? JSON.parse(row.stages_json)
            : row.stages_json)
        : [];

    return {
        id: row.id,
        userId: asAdmin ? row.user_id : undefined,
        status: row.status,
        receiptId: row.receipt_id,
        reason: row.reason,
        stages,
        errorMessage: row.error_message,
        confirmedAt: row.confirmed_at,
        completedAt: row.completed_at,
        expiresAt: row.confirmation_expires_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}

/**
 * Admin status tracker — paginated list.
 */
async function listErasureRequests({ status = null, page = 1, limit = 20 } = {}) {
    const safePage = Math.max(1, parseInt(page, 10) || 1);
    const safeLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const offset = (safePage - 1) * safeLimit;

    const where = [];
    const params = [];
    if (status) {
        where.push("status = ?");
        params.push(sanitizeString(status));
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const [countRows] = await db.query(
        `SELECT COUNT(*) AS total FROM erasure_requests ${whereSql}`,
        params
    );
    const [rows] = await db.query(
        `SELECT id, user_id, status, receipt_id, reason, error_message,
                confirmed_at, completed_at, created_at, updated_at
         FROM erasure_requests
         ${whereSql}
         ORDER BY created_at DESC
         LIMIT ? OFFSET ?`,
        [...params, safeLimit, offset]
    );

    return {
        requests: safeArray(rows).map((r) => ({
            id: r.id,
            userId: r.user_id,
            status: r.status,
            receiptId: r.receipt_id,
            reason: r.reason,
            errorMessage: r.error_message,
            confirmedAt: r.confirmed_at,
            completedAt: r.completed_at,
            createdAt: r.created_at,
            updatedAt: r.updated_at
        })),
        total: countRows[0]?.total || 0,
        page: safePage,
        limit: safeLimit
    };
}

/**
 * Verify a receipt id without exposing PII.
 */
async function verifyReceipt(receiptId) {
    const [rows] = await db.query(
        `SELECT receipt_id, erasure_request_id, summary_json, issued_at
         FROM erasure_receipts WHERE receipt_id = ? LIMIT 1`,
        [sanitizeString(receiptId)]
    );
    const row = rows[0];
    if (!row) {
        throw new ErasureError("Receipt not found", {
            status: 404,
            code: "RECEIPT_NOT_FOUND"
        });
    }
    const summary = row.summary_json
        ? (typeof row.summary_json === "string"
            ? JSON.parse(row.summary_json)
            : row.summary_json)
        : {};
    return {
        valid: true,
        receiptId: row.receipt_id,
        requestId: row.erasure_request_id,
        issuedAt: row.issued_at,
        framework: summary.framework || ["GDPR", "DPDP"],
        ordersAnonymized: summary.ordersAnonymized ?? null,
        completedAt: summary.completedAt || row.issued_at
    };
}

module.exports = {
    STATUS,
    ErasureError,
    requestErasure,
    confirmErasure,
    getErasureStatus,
    listErasureRequests,
    verifyReceipt,
    // test helpers
    _internal: {
        sha256,
        mintReceiptId,
        anonymizedEmail,
        sendConfirmationEmail
    }
};
