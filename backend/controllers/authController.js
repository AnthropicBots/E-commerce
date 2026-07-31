/**
 * Authentication Controller with Security Improvements
 * @module controllers/authController
 */

const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const db = require("../config/db");
const { sanitizeString, safeArray } = require("../utils/helpers");
const { getClearCookieOptions } = require("../config/cookieConfig");

let redis = null;
try {
    redis = require("../config/redis");
} catch (err) {
    console.warn("Redis unavailable for refresh-token revocation list:", err.message);
}

// Appwrite SDK
const { Client, Account, ID, Databases } = require('node-appwrite');

// 2FA dependencies
const { authenticator } = require('otplib');
const qrcode = require('qrcode');
const { encrypt, decrypt } = require('../utils/encryption');

// ==================== CONSTANTS ====================
const OTP_EXPIRY_MINUTES = parseInt(process.env.OTP_EXPIRY_MINUTES) || 10;
const OTP_RATE_LIMIT_WINDOW = 5 * 60 * 1000; // 5 minutes
const OTP_RATE_LIMIT_MAX = 3; // Max 3 OTP requests per window
const CLEANUP_INTERVAL = 5 * 60 * 1000; // 5 minutes
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_LOCKOUT_DURATION = 15 * 60 * 1000; // 15 minutes
// Window in which the failed attempts must accumulate to trip the lockout.
// Failures older than this roll off so isolated mistakes never reach the threshold.
const LOGIN_ATTEMPT_WINDOW = 15 * 60 * 1000; // 15 minutes

// Issue #1261 — refresh token rotation / reuse detection
const REFRESH_TOKEN_TTL_DAYS = parseInt(process.env.REFRESH_TOKEN_TTL_DAYS, 10) || 30;
const STRICT_DEVICE_FINGERPRINT = process.env.STRICT_DEVICE_FINGERPRINT !== "false";
const REFRESH_STATUS = {
    ACTIVE: "active",
    ROTATED: "rotated",
    REVOKED: "revoked"
};

// ==================== VALIDATION PATTERNS ====================
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const strongPasswordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])/;
const otpRegex = /^\d{6}$/;

// ==================== RATE LIMITING ====================
const otpRateLimiter = new Map();
const loginAttempts = new Map();

// ==================== PENDING SIGNUPS CACHE ====================
const pendingSignups = new Map();

// Clean up expired pending signups every 5 minutes
setInterval(() => {
    const now = Date.now();
    for (const [email, data] of pendingSignups.entries()) {
        if (now > data.expiresAt) {
            pendingSignups.delete(email);
        }
    }
    // Clean up expired rate limiter entries
    for (const [key, data] of otpRateLimiter.entries()) {
        if (now > data.resetTime) {
            otpRateLimiter.delete(key);
        }
    }
}, CLEANUP_INTERVAL);

// ==================== JWT SECRET VALIDATION ====================
if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET environment variable is not set");
}

// ==================== APPWRITE CLIENT ====================
const appwriteClient = new Client()
    .setEndpoint(process.env.VITE_APPWRITE_ENDPOINT || 'https://fra.cloud.appwrite.io/v1')
    .setProject(process.env.VITE_APPWRITE_PROJECT_ID);

const appwriteAccount = new Account(appwriteClient);

// ==================== HELPER FUNCTIONS ====================

function generateAccessToken(user, extras = {}) {
    return jwt.sign(
        {
            id: user.id,
            email: user.email,
            role: user.role,
            jti: crypto.randomUUID(),
            ...extras
        },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN || "15m" }
    );
}

function generateRefreshToken() {
    return crypto.randomBytes(40).toString("hex");
}

function hashToken(token) {
    return crypto.createHash("sha256").update(String(token)).digest("hex");
}

function getClientIp(req) {
    const forwarded = req.headers["x-forwarded-for"];
    if (typeof forwarded === "string" && forwarded.length) {
        return forwarded.split(",")[0].trim();
    }
    return req.ip || req.socket?.remoteAddress || "0.0.0.0";
}

/**
 * Device fingerprint = SHA-256(User-Agent + Client IP)
 */
function buildDeviceFingerprint(req) {
    const ua = String(req.headers["user-agent"] || "unknown");
    const ip = getClientIp(req);
    return crypto.createHash("sha256").update(`${ua}|${ip}`).digest("hex");
}

function refreshExpiryDate() {
    const d = new Date();
    d.setDate(d.getDate() + REFRESH_TOKEN_TTL_DAYS);
    return d;
}

async function redisSetEx(key, ttlSeconds, value) {
    if (!redis) return;
    try {
        await redis.setex(key, ttlSeconds, value);
    } catch (err) {
        console.warn("Redis setex failed:", err.message);
    }
}

async function redisExists(key) {
    if (!redis) return false;
    try {
        return (await redis.exists(key)) === 1;
    } catch (err) {
        console.warn("Redis exists failed:", err.message);
        return false;
    }
}

async function blacklistFamily(familyId, ttlSeconds = REFRESH_TOKEN_TTL_DAYS * 86400) {
    await redisSetEx(`rt:family:revoked:${familyId}`, ttlSeconds, "1");
}

async function blacklistTokenHash(tokenHash, ttlSeconds = REFRESH_TOKEN_TTL_DAYS * 86400) {
    await redisSetEx(`rt:revoked:${tokenHash}`, ttlSeconds, "1");
}

async function markUserForceReauth(userId) {
    const ts = String(Math.floor(Date.now() / 1000));
    await redisSetEx(`auth:user:revoke_before:${userId}`, REFRESH_TOKEN_TTL_DAYS * 86400, ts);
    return Number(ts);
}

async function logSecurityEvent({ userId, familyId, eventType, tokenHash, req, details }) {
    try {
        await db.query(
            `INSERT INTO refresh_token_security_events
             (user_id, family_id, event_type, token_hash, ip_address, user_agent, details)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
                userId,
                familyId || null,
                eventType,
                tokenHash || null,
                getClientIp(req),
                String(req.headers["user-agent"] || "").slice(0, 512),
                JSON.stringify(details || {})
            ]
        );
    } catch (err) {
        console.warn("Failed to log refresh-token security event:", err.message);
    }
}

/**
 * Issue a new refresh-token family for a device session (login).
 */
async function issueRefreshTokenFamily(user, req) {
    const familyId = crypto.randomUUID();
    const rawToken = generateRefreshToken();
    const tokenHash = hashToken(rawToken);
    const fingerprint = buildDeviceFingerprint(req);
    const expiresAt = refreshExpiryDate();

    await db.query(
        `INSERT INTO refresh_tokens
         (user_id, family_id, token_hash, parent_token_hash, device_fingerprint,
          ip_address, user_agent, status, expires_at)
         VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
        [
            user.id,
            familyId,
            tokenHash,
            fingerprint,
            getClientIp(req),
            String(req.headers["user-agent"] || "").slice(0, 512),
            REFRESH_STATUS.ACTIVE,
            expiresAt
        ]
    );

    // Keep legacy column in sync for older clients / queries
    await db.query(
        `UPDATE users SET refresh_token = ?, last_login = NOW() WHERE id = ?`,
        [rawToken, user.id]
    );

    await logSecurityEvent({
        userId: user.id,
        familyId,
        eventType: "family_issued",
        tokenHash,
        req,
        details: { expiresAt }
    });

    return { rawToken, familyId, tokenHash, fingerprint, expiresAt };
}

/**
 * Cascade-revoke an entire refresh-token family (reuse / theft / logout).
 */
async function revokeTokenFamily(familyId, userId, reason, req) {
    await db.query(
        `UPDATE refresh_tokens
         SET status = ?, revoked_at = NOW(), revoke_reason = ?
         WHERE family_id = ? AND status IN (?, ?)`,
        [REFRESH_STATUS.REVOKED, reason, familyId, REFRESH_STATUS.ACTIVE, REFRESH_STATUS.ROTATED]
    );

    await blacklistFamily(familyId);
    await markUserForceReauth(userId);

    // Clear legacy single-token column when this was the user's current token family
    await db.query(
        `UPDATE users SET refresh_token = NULL WHERE id = ?`,
        [userId]
    );

    // Cascade: detach any AI agent sessions bound to this family (#1261)
    try {
        const agentIdentityService = require("../services/agentIdentityService");
        if (typeof agentIdentityService.revokeAgentSessionsForUser === "function") {
            await agentIdentityService.revokeAgentSessionsForUser(userId, reason);
        }
    } catch (err) {
        console.warn("Agent session cascade skipped:", err.message);
    }

    await logSecurityEvent({
        userId,
        familyId,
        eventType: "family_revoked",
        req,
        details: { reason }
    });
}

/**
 * Revoke every active/rotated refresh token for a user (all devices).
 */
async function revokeAllUserRefreshTokens(userId, reason, req) {
    const [families] = await db.query(
        `SELECT DISTINCT family_id FROM refresh_tokens
         WHERE user_id = ? AND status IN (?, ?)`,
        [userId, REFRESH_STATUS.ACTIVE, REFRESH_STATUS.ROTATED]
    );

    for (const row of safeArray(families)) {
        await revokeTokenFamily(row.family_id, userId, reason, req);
    }

    await db.query(`UPDATE users SET refresh_token = NULL, last_logout = NOW() WHERE id = ?`, [userId]);
    await markUserForceReauth(userId);
}

/**
 * Automatic Token Rotation with reuse detection.
 * Returns { accessToken, refreshToken, user, familyId } or throws typed errors.
 */
async function rotateRefreshToken(rawRefreshToken, req) {
    const tokenHash = hashToken(rawRefreshToken);

    if (await redisExists(`rt:revoked:${tokenHash}`)) {
        const err = new Error("Refresh token revoked");
        err.code = "RT_REVOKED";
        throw err;
    }

    const [rows] = await db.query(
        `SELECT rt.*, u.name, u.email, u.role, u.is_active
         FROM refresh_tokens rt
         INNER JOIN users u ON u.id = rt.user_id
         WHERE rt.token_hash = ?
         LIMIT 1`,
        [tokenHash]
    );

    if (!safeArray(rows).length) {
        // Fallback: legacy users.refresh_token column (pre-migration sessions)
        const [legacyUsers] = await db.query(
            `SELECT id, name, email, role, is_active FROM users WHERE refresh_token = ? LIMIT 1`,
            [rawRefreshToken]
        );
        if (!safeArray(legacyUsers).length) {
            const err = new Error("Invalid refresh token");
            err.code = "RT_INVALID";
            throw err;
        }
        const legacyUser = legacyUsers[0];
        if (legacyUser.is_active === 0) {
            const err = new Error("Account has been deactivated");
            err.code = "RT_INACTIVE";
            throw err;
        }
        const issued = await issueRefreshTokenFamily(legacyUser, req);
        const accessToken = generateAccessToken(legacyUser, { familyId: issued.familyId });
        return {
            accessToken,
            refreshToken: issued.rawToken,
            user: legacyUser,
            familyId: issued.familyId,
            migrated: true
        };
    }

    const record = rows[0];
    const user = {
        id: record.user_id,
        name: record.name,
        email: record.email,
        role: record.role,
        is_active: record.is_active
    };

    if (user.is_active === 0) {
        const err = new Error("Account has been deactivated");
        err.code = "RT_INACTIVE";
        throw err;
    }

    if (await redisExists(`rt:family:revoked:${record.family_id}`)) {
        const err = new Error("Refresh token family revoked");
        err.code = "RT_FAMILY_REVOKED";
        throw err;
    }

    if (record.status === REFRESH_STATUS.REVOKED) {
        const err = new Error("Refresh token revoked");
        err.code = "RT_REVOKED";
        throw err;
    }

    // --- REUSE DETECTION: previously rotated token presented again ---
    if (record.status === REFRESH_STATUS.ROTATED) {
        console.error(
            `🚨 Refresh token REUSE detected for user ${user.id} family ${record.family_id}`
        );
        await revokeTokenFamily(
            record.family_id,
            user.id,
            "refresh_token_reuse_detected",
            req
        );
        await blacklistTokenHash(tokenHash);
        await logSecurityEvent({
            userId: user.id,
            familyId: record.family_id,
            eventType: "reuse_detected",
            tokenHash,
            req,
            details: { alarm: true, action: "family_cascade_revoked" }
        });

        const err = new Error(
            "Refresh token reuse detected. All sessions in this device family have been revoked. Please log in again."
        );
        err.code = "RT_REUSE_DETECTED";
        err.status = 401;
        throw err;
    }

    if (new Date(record.expires_at).getTime() < Date.now()) {
        await db.query(
            `UPDATE refresh_tokens SET status = ?, revoked_at = NOW(), revoke_reason = ? WHERE id = ?`,
            [REFRESH_STATUS.REVOKED, "expired", record.id]
        );
        const err = new Error("Refresh token expired");
        err.code = "RT_EXPIRED";
        throw err;
    }

    // Device fingerprint matching (UA + IP hash)
    const currentFingerprint = buildDeviceFingerprint(req);
    if (STRICT_DEVICE_FINGERPRINT && record.device_fingerprint !== currentFingerprint) {
        await revokeTokenFamily(
            record.family_id,
            user.id,
            "device_fingerprint_mismatch",
            req
        );
        await logSecurityEvent({
            userId: user.id,
            familyId: record.family_id,
            eventType: "fingerprint_mismatch",
            tokenHash,
            req,
            details: {
                expected: record.device_fingerprint,
                actual: currentFingerprint
            }
        });
        const err = new Error(
            "Device fingerprint mismatch. Session revoked for security. Please log in again."
        );
        err.code = "RT_FINGERPRINT_MISMATCH";
        err.status = 401;
        throw err;
    }

    // Rotate: invalidate old, issue new child in same family
    const newRawToken = generateRefreshToken();
    const newHash = hashToken(newRawToken);
    const expiresAt = refreshExpiryDate();

    await db.query(
        `UPDATE refresh_tokens
         SET status = ?, rotated_at = NOW(), last_used_at = NOW()
         WHERE id = ? AND status = ?`,
        [REFRESH_STATUS.ROTATED, record.id, REFRESH_STATUS.ACTIVE]
    );

    await db.query(
        `INSERT INTO refresh_tokens
         (user_id, family_id, token_hash, parent_token_hash, device_fingerprint,
          ip_address, user_agent, status, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            user.id,
            record.family_id,
            newHash,
            tokenHash,
            currentFingerprint,
            getClientIp(req),
            String(req.headers["user-agent"] || "").slice(0, 512),
            REFRESH_STATUS.ACTIVE,
            expiresAt
        ]
    );

    await blacklistTokenHash(tokenHash, Math.max(
        60,
        Math.floor((new Date(record.expires_at).getTime() - Date.now()) / 1000)
    ));

    await db.query(`UPDATE users SET refresh_token = ? WHERE id = ?`, [newRawToken, user.id]);

    await logSecurityEvent({
        userId: user.id,
        familyId: record.family_id,
        eventType: "token_rotated",
        tokenHash: newHash,
        req,
        details: { parent: tokenHash }
    });

    const accessToken = generateAccessToken(user, { familyId: record.family_id });
    return {
        accessToken,
        refreshToken: newRawToken,
        user,
        familyId: record.family_id
    };
}

function sendAuthResponse(res, { message, accessToken, refreshToken, user, familyId }) {
    return res.status(200).json({
        success: true,
        message,
        accessToken,
        refreshToken,
        ...(familyId ? { familyId } : {}),
        user: {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role
        }
    });
}

function isOTPRateLimited(email) {
    const now = Date.now();
    const key = `otp_${email}`;
    const record = otpRateLimiter.get(key);
    
    if (!record) {
        otpRateLimiter.set(key, { count: 1, resetTime: now + OTP_RATE_LIMIT_WINDOW });
        return false;
    }
    
    if (now > record.resetTime) {
        otpRateLimiter.set(key, { count: 1, resetTime: now + OTP_RATE_LIMIT_WINDOW });
        return false;
    }
    
    if (record.count >= OTP_RATE_LIMIT_MAX) {
        return true;
    }
    
    record.count++;
    return false;
}

function isLoginLocked(email) {
    const now = Date.now();
    const record = loginAttempts.get(email);

    if (!record) return false;

    // Only an active lockout blocks login. Counting failures within the
    // window is not itself a lock — that is what let a single mistyped
    // password lock the account before.
    if (record.lockoutUntil && now < record.lockoutUntil) {
        return true;
    }

    // No active lockout: drop the record once the lockout has expired or the
    // rolling attempt window has elapsed, so the counter restarts cleanly.
    if ((record.lockoutUntil && now >= record.lockoutUntil) || now > record.windowExpires) {
        loginAttempts.delete(email);
    }
    return false;
}

function recordLoginFailure(email) {
    const now = Date.now();
    const record = loginAttempts.get(email);

    // Start a fresh window on the first failure or after the previous window
    // rolled off without reaching the threshold.
    if (!record || now > record.windowExpires) {
        loginAttempts.set(email, {
            attempts: 1,
            windowExpires: now + LOGIN_ATTEMPT_WINDOW,
            lockoutUntil: null
        });
        return;
    }

    record.attempts++;
    // The lockout only starts once the threshold is reached within the window.
    if (record.attempts >= MAX_LOGIN_ATTEMPTS) {
        record.lockoutUntil = now + LOGIN_LOCKOUT_DURATION;
    }
}

function resetLoginAttempts(email) {
    loginAttempts.delete(email);
}

// Test-only: drop all tracked attempts so cases start from a clean slate.
function clearLoginAttempts() {
    loginAttempts.clear();
}

// ==================== 1. SIGNUP (Send OTP) ====================
const signup = async (req, res) => {
    try {
        const { name, email, password } = req.body;
        const cleanName = sanitizeString(name);
        const cleanEmail = sanitizeString(email).toLowerCase();

        // Validation
        if (!cleanName || !cleanEmail || !password) {
            return res.status(400).json({ success: false, message: "All fields are required" });
        }
        if (!emailRegex.test(cleanEmail)) {
            return res.status(400).json({ success: false, message: "Invalid email format" });
        }
        if (password.length < 8 || !strongPasswordRegex.test(password)) {
            return res.status(400).json({ 
                success: false, 
                message: "Password must contain uppercase, lowercase, number and special character and min 8 characters" 
            });
        }

        // Rate limiting
        if (isOTPRateLimited(cleanEmail)) {
            return res.status(429).json({ 
                success: false, 
                message: "Too many OTP requests. Please wait 5 minutes." 
            });
        }

        // Check if user already exists in MySQL
        const [existingUsers] = await db.query(`SELECT id FROM users WHERE email = ? LIMIT 1`, [cleanEmail]);
        if (safeArray(existingUsers).length) {
            return res.status(400).json({ success: false, message: "Email already exists" });
        }

        // Send OTP via Appwrite
        const token = await appwriteAccount.createEmailToken(ID.unique(), cleanEmail);

        // Store pending user with hashed password
        const hashedPassword = await bcrypt.hash(password, 10);
        pendingSignups.set(cleanEmail, {
            name: cleanName,
            hashedPassword,
            userId: token.userId,
            expiresAt: Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000
        });

        return res.status(200).json({
            success: true,
            message: "OTP sent to email",
            userId: token.userId
        });
    } catch (error) {
        console.error("SIGNUP OTP ERROR:", error);
        return res.status(500).json({ success: false, message: "Failed to send OTP. Please try again." });
    }
};

// ==================== 2. VERIFY SIGNUP OTP ====================
const verifySignup = async (req, res) => {
    try {
        const { email, otp } = req.body;
        const cleanEmail = sanitizeString(email).toLowerCase();

        // Validate OTP format
        if (!otpRegex.test(otp)) {
            return res.status(400).json({ success: false, message: "Invalid OTP format. Must be 6 digits." });
        }

        const pendingUser = pendingSignups.get(cleanEmail);
        if (!pendingUser) {
            return res.status(400).json({ success: false, message: "No pending registration found for this email" });
        }
        if (Date.now() > pendingUser.expiresAt) {
            pendingSignups.delete(cleanEmail);
            return res.status(400).json({ success: false, message: "OTP has expired. Please request a new one." });
        }

        // Verify OTP with Appwrite
        let session;
        try {
            session = await appwriteAccount.createSession(pendingUser.userId, otp);
        } catch (err) {
            return res.status(400).json({ success: false, message: "Invalid OTP. Please try again." });
        }

        // Initialize user-scoped Appwrite client
        const userClient = new Client()
            .setEndpoint(process.env.VITE_APPWRITE_ENDPOINT || 'https://fra.cloud.appwrite.io/v1')
            .setProject(process.env.VITE_APPWRITE_PROJECT_ID)
            .setSession(session.secret);
        
        const userAccount = new Account(userClient);
        const databases = new Databases(userClient);

        // Update Appwrite profile
        try {
            await userAccount.updateName(pendingUser.name);
        } catch (updateErr) {
            console.warn("Failed to update Appwrite name:", updateErr.message);
        }

        // Save to Appwrite Database if configured
        if (process.env.VITE_APPWRITE_DATABASE_ID && process.env.VITE_APPWRITE_USERS_TABLE_ID) {
            try {
                await databases.createDocument(
                    process.env.VITE_APPWRITE_DATABASE_ID,
                    process.env.VITE_APPWRITE_USERS_TABLE_ID,
                    ID.unique(),
                    { name: pendingUser.name, email: cleanEmail, role: 'user', isVerified: true }
                );
            } catch (dbErr) {
                console.warn("Could not save to Appwrite DB:", dbErr.message);
            }
        }

        // Save to MySQL with email_verified flag
        const userId = crypto.randomUUID();
        await db.query(
            `INSERT INTO users (id, name, email, password, role, is_verified) VALUES (?, ?, ?, ?, ?, ?)`,
            [userId, pendingUser.name, cleanEmail, pendingUser.hashedPassword, "user", 1]
        );

        // Cleanup Appwrite session
        try {
            await userAccount.deleteSession('current');
        } catch (logoutErr) {
            console.warn("Failed to delete Appwrite session:", logoutErr.message);
        }
        
        pendingSignups.delete(cleanEmail);

        return res.status(201).json({ success: true, message: "Account created successfully" });
    } catch (error) {
        console.error("VERIFY SIGNUP ERROR:", error);
        return res.status(500).json({ success: false, message: "Server error during verification" });
    }
};

// ==================== 3. LOGIN ====================
const login = async (req, res) => {
    try {
        const { email, password } = req.body;
        const cleanEmail = sanitizeString(email).toLowerCase();

        if (!cleanEmail || !password) {
            return res.status(400).json({ success: false, message: "Email and password required" });
        }

        // Check login lockout
        if (isLoginLocked(cleanEmail)) {
            return res.status(429).json({ 
                success: false, 
                message: "Too many failed attempts. Account locked for 15 minutes." 
            });
        }

        const [users] = await db.query(`SELECT * FROM users WHERE email = ? LIMIT 1`, [cleanEmail]);
        if (!safeArray(users).length) {
            recordLoginFailure(cleanEmail);
            return res.status(401).json({ success: false, message: "Invalid credentials" });
        }

        const user = users[0];
        if (user.is_active === 0) {
            return res.status(403).json({ success: false, message: "Account has been deactivated" });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            recordLoginFailure(cleanEmail);
            return res.status(401).json({ success: false, message: "Invalid credentials" });
        }

        // Reset login attempts on success
        resetLoginAttempts(cleanEmail);

        // Check if 2FA is enabled
        if (user.is_2fa_enabled === 1) {
            const tempToken = jwt.sign(
                { id: user.id, email: user.email, role: user.role, is2FA: true },
                process.env.JWT_SECRET,
                { expiresIn: "5m" }
            );
            return res.status(200).json({
                success: true,
                requires2FA: true,
                tempToken,
                message: "2FA verification required"
            });
        }

        const issued = await issueRefreshTokenFamily(user, req);
        const accessWithFamily = generateAccessToken(user, { familyId: issued.familyId });

        return sendAuthResponse(res, { 
            message: "Login successful", 
            accessToken: accessWithFamily, 
            refreshToken: issued.rawToken,
            familyId: issued.familyId,
            user 
        });
    } catch (error) {
        console.error("LOGIN ERROR:", error);
        return res.status(500).json({ success: false, message: "Server error" });
    }
};

// ==================== 4. LOGOUT ====================
const logout = async (req, res) => {
    try {
        const userId = req.user?.id;
        const bodyRefresh = sanitizeString(req.body?.refreshToken || "");
        const cookieRefresh = sanitizeString(req.cookies?.refreshToken || "");
        const presentedRefresh = bodyRefresh || cookieRefresh;

        if (userId) {
            if (presentedRefresh) {
                const tokenHash = hashToken(presentedRefresh);
                const [rows] = await db.query(
                    `SELECT family_id FROM refresh_tokens WHERE token_hash = ? AND user_id = ? LIMIT 1`,
                    [tokenHash, userId]
                );
                if (safeArray(rows).length) {
                    await revokeTokenFamily(
                        rows[0].family_id,
                        userId,
                        "user_logout",
                        req
                    );
                } else {
                    await revokeAllUserRefreshTokens(userId, "user_logout", req);
                }
            } else {
                // No refresh token presented → revoke all device families
                await revokeAllUserRefreshTokens(userId, "user_logout_all_devices", req);
            }

            await db.query(
                `UPDATE users SET refresh_token = NULL, last_logout = NOW() WHERE id = ?`,
                [userId]
            );
        }

        // Clear cookies using shared cookie options
        res.clearCookie('accessToken', getClearCookieOptions());
        res.clearCookie('refreshToken', getClearCookieOptions('/api/auth/refresh'));

        console.log(`🔓 User ${userId} logged out successfully`);

        return res.status(200).json({
            success: true,
            message: "Logged out successfully",
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error("❌ LOGOUT ERROR:", error);
        return res.status(500).json({ success: false, message: "Logout failed. Please try again." });
    }
};
// ==================== 5. FORGOT PASSWORD ====================
const forgotPassword = async (req, res) => {
    try {
        const { email } = req.body;
        const cleanEmail = sanitizeString(email).toLowerCase();

        if (!emailRegex.test(cleanEmail)) {
            return res.status(400).json({ success: false, message: "Invalid email format" });
        }

        // Rate limiting
        if (isOTPRateLimited(cleanEmail)) {
            return res.status(429).json({ 
                success: false, 
                message: "Too many OTP requests. Please wait 5 minutes." 
            });
        }

        const [users] = await db.query(`SELECT id, is_verified AS email_verified FROM users WHERE email = ? LIMIT 1`, [cleanEmail]);
        if (!safeArray(users).length) {
            // Security: Don't reveal if email exists
            return res.status(200).json({ 
                success: true, 
                message: "If the email is registered, an OTP has been sent." 
            });
        }

        const user = users[0];
        if (!user.email_verified) {
            return res.status(400).json({ 
                success: false, 
                message: "Please verify your email first before requesting password reset." 
            });
        }

        // Send OTP via Appwrite
        await appwriteAccount.createEmailToken(ID.unique(), cleanEmail);
        
        return res.status(200).json({
            success: true,
            message: "OTP sent to your email"
        });
    } catch (error) {
        console.error("FORGOT PASSWORD ERROR:", error);
        return res.status(500).json({ success: false, message: "Failed to send reset OTP" });
    }
};

// ==================== 6. RESET PASSWORD ====================
const resetPassword = async (req, res) => {
    try {
        const { userId, otp, newPassword } = req.body;

        if (!userId || !otp || !newPassword) {
            return res.status(400).json({ success: false, message: "Missing required fields" });
        }

        // Validate OTP format
        if (!otpRegex.test(otp)) {
            return res.status(400).json({ success: false, message: "Invalid OTP format. Must be 6 digits." });
        }

        // Validate password
        if (newPassword.length < 8 || !strongPasswordRegex.test(newPassword)) {
            return res.status(400).json({ 
                success: false, 
                message: "Password must contain uppercase, lowercase, number and special character and min 8 characters" 
            });
        }

        // Verify OTP
        let session;
        try {
            session = await appwriteAccount.createSession(userId, otp);
        } catch (err) {
            return res.status(400).json({ success: false, message: "Invalid or expired OTP" });
        }

        // Initialize user-scoped Appwrite client
        const userClient = new Client()
            .setEndpoint(process.env.VITE_APPWRITE_ENDPOINT || 'https://fra.cloud.appwrite.io/v1')
            .setProject(process.env.VITE_APPWRITE_PROJECT_ID)
            .setSession(session.secret);
        
        const userAccount = new Account(userClient);
        const appwriteUser = await userAccount.get();

        // Update password in Appwrite
        try {
            await userAccount.updatePassword(newPassword);
        } catch (pwErr) {
            console.warn("Failed to update password in Appwrite:", pwErr.message);
        }

        // Update password in MySQL
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        await db.query(`UPDATE users SET password = ? WHERE email = ?`, [hashedPassword, appwriteUser.email]);

        // Cleanup Appwrite session
        try {
            await userAccount.deleteSession('current');
        } catch (logoutErr) {
            console.warn("Failed to delete Appwrite session:", logoutErr.message);
        }

        return res.status(200).json({ 
            success: true, 
            message: "Password reset successfully. You can now login." 
        });
    } catch (error) {
        console.error("RESET PASSWORD ERROR:", error);
        return res.status(500).json({ success: false, message: "Failed to reset password" });
    }
};

// ==================== 7. CHANGE PASSWORD ====================
const changePassword = async (req, res) => {
    try {
        const userId = req.user?.id;
        const { currentPassword, newPassword } = req.body;

        if (!userId) {
            return res.status(401).json({ success: false, message: "Unauthorized" });
        }

        if (!currentPassword || !newPassword) {
            return res.status(400).json({ success: false, message: "Current password and new password required" });
        }

        // Validate new password
        if (newPassword.length < 8 || !strongPasswordRegex.test(newPassword)) {
            return res.status(400).json({ 
                success: false, 
                message: "Password must contain uppercase, lowercase, number and special character and min 8 characters" 
            });
        }

        // Get user from database
        const [users] = await db.query(`SELECT password FROM users WHERE id = ? LIMIT 1`, [userId]);
        if (!safeArray(users).length) {
            return res.status(404).json({ success: false, message: "User not found" });
        }

        // Verify current password
        const isMatch = await bcrypt.compare(currentPassword, users[0].password);
        if (!isMatch) {
            return res.status(401).json({ success: false, message: "Current password is incorrect" });
        }

        // Hash and update new password
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        await db.query(`UPDATE users SET password = ? WHERE id = ?`, [hashedPassword, userId]);

        return res.status(200).json({ 
            success: true, 
            message: "Password changed successfully" 
        });
    } catch (error) {
        console.error("CHANGE PASSWORD ERROR:", error);
        return res.status(500).json({ success: false, message: "Server error" });
    }
};

// ==================== 8. REFRESH ACCESS TOKEN ====================
const refreshAccessToken = async (req, res) => {
    try {
        const { refreshToken } = req.body;
        const cleanRefreshToken = sanitizeString(
            refreshToken || req.cookies?.refreshToken || ""
        );

        if (!cleanRefreshToken) {
            return res.status(401).json({ success: false, message: "Refresh token required" });
        }

        const rotated = await rotateRefreshToken(cleanRefreshToken, req);

        return sendAuthResponse(res, {
            message: "Token refreshed",
            accessToken: rotated.accessToken,
            refreshToken: rotated.refreshToken,
            familyId: rotated.familyId,
            user: rotated.user
        });
    } catch (error) {
        console.error("REFRESH TOKEN ERROR:", error);

        const status = error.status || 401;
        const reuseOrTheft = [
            "RT_REUSE_DETECTED",
            "RT_FINGERPRINT_MISMATCH",
            "RT_FAMILY_REVOKED"
        ].includes(error.code);

        return res.status(status).json({
            success: false,
            message: error.message || "Server error",
            code: error.code || "RT_ERROR",
            ...(reuseOrTheft
                ? {
                    securityAlarm: true,
                    action: "reauthenticate",
                    detail: "Token family revoked. Sign in again on all affected devices."
                }
                : {})
        });
    }
};



// ==================== 9. GET API STATUS ====================
const getStatus = (req, res) => {
    res.status(200).json({
        success: true,
        message: "Auth API running",
        timestamp: new Date().toISOString(),
        version: "2.1.0",
        security: {
            behavioralCaptcha: process.env.ENABLE_BEHAVIORAL_CAPTCHA === 'true',
            syntheticFraudDetection: true,
            rateLimiting: true
        }
    });
};

// ==================== 10. VALIDATE TOKEN ====================
const validateToken = (req, res) => {
    res.status(200).json({
        success: true,
        message: "Token is valid",
        user: {
            id: req.user.id,
            email: req.user.email,
            role: req.user.role,
            isTrustedAgent: req.isTrustedAgent || false
        }
    });
};

// ==================== 11. SECURITY AUDIT (Admin Only) ====================
const getSecurityAudit = async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                message: "Admin access required"
            });
        }

        const [logs] = await db.query(
            `SELECT * FROM security_logs ORDER BY timestamp DESC LIMIT 100`
        );

        return res.status(200).json({
            success: true,
            data: logs,
            count: logs.length,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error("❌ SECURITY AUDIT ERROR:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch security logs"
        });
    }
};

// ==================== 12. FRAUD STATUS (Authenticated) ====================
const getFraudStatus = async (req, res) => {
    try {
        const [detection] = await db.query(
            `SELECT risk_level, risk_score, confidence, timestamp 
             FROM synthetic_identity_detections 
             WHERE user_id = ? 
             ORDER BY timestamp DESC 
             LIMIT 1`,
            [req.user.id]
        );

        if (detection.length === 0) {
            return res.status(200).json({
                success: true,
                message: "No fraud detection records found",
                status: "clean"
            });
        }

        const isFlagged = detection[0].risk_level === 'critical' ||
            detection[0].risk_level === 'high';

        return res.status(200).json({
            success: true,
            data: detection[0],
            isFlagged,
            status: isFlagged ? 'flagged' : 'clean',
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error("❌ FRAUD STATUS ERROR:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch fraud status"
        });
    }
};

const getMe = async (req, res) => {
    try {
        const [users] = await db.query(
            "SELECT id, name, email, role, is_active FROM users WHERE id = ? LIMIT 1",
            [req.user.id]
        );

        if (!users || !users.length) {
            return res.status(404).json({
                success: false,
                message: "User not found"
            });
        }

        const user = users[0];

        if (user.is_active === 0) {
            return res.status(403).json({
                success: false,
                message: "Account has been deactivated"
            });
        }

        return res.status(200).json({
            success: true,
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                role: user.role
            }
        });
    } catch (error) {
        console.error("GET ME ERROR:", error);
        return res.status(500).json({
            success: false,
            message: "Server error"
        });
    }
};


// ==================== EXPORTS ====================
module.exports = {
    signup,
    verifySignup,
    login,
    logout,
    forgotPassword,
    resetPassword,
    changePassword,
    refreshAccessToken,
    getStatus,      
    validateToken,  
    getSecurityAudit, 
    getFraudStatus,
    getMe
};

// Internal login-guard helpers exposed for unit testing only. Not part of the
// HTTP surface; runtime behavior is unchanged.
module.exports._loginGuard = {
    isLoginLocked,
    recordLoginFailure,
    resetLoginAttempts,
    clearLoginAttempts,
    MAX_LOGIN_ATTEMPTS,
    LOGIN_LOCKOUT_DURATION,
    LOGIN_ATTEMPT_WINDOW
};

// Issue #1261 helpers exposed for unit testing / agent bindings.
module.exports._refreshTokenSecurity = {
    hashToken,
    buildDeviceFingerprint,
    issueRefreshTokenFamily,
    rotateRefreshToken,
    revokeTokenFamily,
    revokeAllUserRefreshTokens,
    REFRESH_STATUS,
    STRICT_DEVICE_FINGERPRINT
};