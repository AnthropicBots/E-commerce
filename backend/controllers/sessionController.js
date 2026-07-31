/**
 * Lets an account holder see where their account is signed in and end those
 * sessions.
 *
 * @module controllers/sessionController
 */

const { sanitizeString } = require("../utils/helpers");
const { SESSION_CLAIM } = require("../utils/tokens");
const {
    REVOKE_REASON,
    listActiveSessions,
    revokeSessionForUser,
    revokeUserSessions
} = require("../services/authSessionService");

// ==================== 1. LIST SESSIONS ====================
const getSessions = async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ success: false, message: "Unauthorized" });
        }

        const currentSessionId = req.user?.[SESSION_CLAIM] || null;
        const sessions = await listActiveSessions(userId);

        return res.status(200).json({
            success: true,
            count: sessions.length,
            sessions: sessions.map((session) => ({
                id: session.id,
                device: session.device_label,
                ipAddress: session.ip_address,
                createdAt: session.issued_at,
                lastUsedAt: session.last_used_at,
                expiresAt: session.expires_at,
                isCurrent: session.id === currentSessionId
            }))
        });
    } catch (error) {
        console.error("❌ LIST SESSIONS ERROR:", error);
        return res.status(500).json({ success: false, message: "Failed to fetch sessions" });
    }
};

// ==================== 2. REVOKE ONE SESSION ====================
const deleteSession = async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ success: false, message: "Unauthorized" });
        }

        const sessionId = sanitizeString(req.params.sessionId);
        if (!sessionId) {
            return res.status(400).json({ success: false, message: "Session id is required" });
        }

        const wasRevoked = await revokeSessionForUser({
            userId,
            sessionId,
            reason: REVOKE_REASON.USER_REVOKED
        });

        if (!wasRevoked) {
            return res.status(404).json({ success: false, message: "Session not found" });
        }

        const isCurrentSession = sessionId === req.user?.[SESSION_CLAIM];

        return res.status(200).json({
            success: true,
            message: "Session ended",
            // The caller has just ended the session it is using, so it needs to
            // stop using the tokens it holds rather than wait for a 401.
            endedCurrentSession: isCurrentSession
        });
    } catch (error) {
        console.error("❌ REVOKE SESSION ERROR:", error);
        return res.status(500).json({ success: false, message: "Failed to end session" });
    }
};

// ==================== 3. REVOKE EVERY OTHER SESSION ====================
const deleteOtherSessions = async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ success: false, message: "Unauthorized" });
        }

        const revokedCount = await revokeUserSessions({
            userId,
            exceptSessionId: req.user?.[SESSION_CLAIM],
            reason: REVOKE_REASON.USER_REVOKED
        });

        return res.status(200).json({
            success: true,
            message: "Other sessions ended",
            revokedCount
        });
    } catch (error) {
        console.error("❌ REVOKE OTHER SESSIONS ERROR:", error);
        return res.status(500).json({ success: false, message: "Failed to end other sessions" });
    }
};

// ==================== EXPORTS ====================
module.exports = {
    getSessions,
    deleteSession,
    deleteOtherSessions
};
