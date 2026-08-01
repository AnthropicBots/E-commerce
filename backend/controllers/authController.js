/**
 * Authentication Controller with Security Improvements
 * @module controllers/authController
 */

const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const db = require("../config/db");
const { sanitizeString, safeArray } = require("../utils/helpers");
const { getClearCookieOptions } = require("../config/cookieConfig");
const { PERMISSIONS, hasPermission } = require("../config/policy");
const refreshTokenService = require("../services/refreshTokenService");
const agentIdentityService = require("../services/agentIdentityService");
// Lockout state lives in Redis so it survives a restart and is observed by
// every instance; the policy it enforces is unchanged.
const loginLockoutService = require("../services/loginLockoutService");

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
const {
    MAX_LOGIN_ATTEMPTS,
    LOGIN_LOCKOUT_DURATION,
    LOGIN_ATTEMPT_WINDOW
} = loginLockoutService;

// ==================== VALIDATION PATTERNS ====================
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const strongPasswordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])/;
const otpRegex = /^\d{6}$/;

// ==================== RATE LIMITING ====================
const otpRateLimiter = new Map();

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

// ==================== APPWRITE CLIENT ====================
const appwriteClient = new Client()
    .setEndpoint(process.env.VITE_APPWRITE_ENDPOINT || 'https://fra.cloud.appwrite.io/v1')
    .setProject(process.env.VITE_APPWRITE_PROJECT_ID);

const appwriteAccount = new Account(appwriteClient);

// ==================== HELPER FUNCTIONS ====================

function clientMeta(req) {
    const ip = req.ip
        || req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim()
        || req.connection?.remoteAddress
        || null;
    const userAgent = req.headers['user-agent'] || '';
    return { ip, userAgent };
}

function generateAccessToken(user, familyId = null) {
    const jti = crypto.randomUUID();
    const payload = {
        id: user.id,
        email: user.email,
        role: user.role,
        jti
    };
    if (familyId) {
        payload.fid = familyId;
    }
    return {
        token: jwt.sign(
            payload,
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRES_IN || "15m" }
        ),
        jti,
        familyId
    };
}

function generateRefreshToken() {
    return refreshTokenService.generateRawRefreshToken();
}

function sendAuthResponse(res, { message, accessToken, refreshToken, user, familyId, security }) {
    return res.status(200).json({
        success: true,
        message,
        accessToken,
        refreshToken,
        familyId: familyId || undefined,
        security: security || undefined,
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

const {
    isLoginLocked,
    recordLoginFailure,
    resetLoginAttempts,
    clearLoginAttempts
} = loginLockoutService;

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
        if (await isLoginLocked(cleanEmail)) {
            return res.status(429).json({ 
                success: false, 
                message: "Too many failed attempts. Account locked for 15 minutes." 
            });
        }

        const [users] = await db.query(`SELECT * FROM users WHERE email = ? LIMIT 1`, [cleanEmail]);
        if (!safeArray(users).length) {
            await recordLoginFailure(cleanEmail);
            return res.status(401).json({ success: false, message: "Invalid credentials" });
        }

        const user = users[0];
        if (user.is_active === 0) {
            return res.status(403).json({ success: false, message: "Account has been deactivated" });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            await recordLoginFailure(cleanEmail);
            return res.status(401).json({ success: false, message: "Invalid credentials" });
        }

        // Reset login attempts on success
        await resetLoginAttempts(cleanEmail);

        // Check if 2FA is enabled
        if (user.is_2fa_enabled === 1) {
            const tempToken = issueTwoFactorToken(user);
            return res.status(200).json({
                success: true,
                requires2FA: true,
                tempToken,
                message: "2FA verification required"
            });
        }

        const { ip, userAgent } = clientMeta(req);
        const session = await refreshTokenService.issueRefreshFamily(user.id, { ip, userAgent });
        const access = generateAccessToken(user, session.familyId);

        return sendAuthResponse(res, {
            message: "Login successful",
            accessToken: access.token,
            refreshToken: session.refreshToken,
            familyId: session.familyId,
            user,
            security: {
                tokenRotation: true,
                deviceFingerprint: session.deviceFingerprint.slice(0, 12) + '…'
            }
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
        const presented =
            sanitizeString(req.body?.refreshToken)
            || req.cookies?.refreshToken
            || null;
        const logoutAll = req.body?.allDevices === true || req.query?.allDevices === 'true';

        if (userId) {
            if (logoutAll) {
                await refreshTokenService.revokeAllUserFamilies(userId, 'user_logout_all');
                // Cascade: suspend user-bound agent sessions (#1261 multi-device)
                await agentIdentityService.onUserSessionFamilyRevoked(
                    userId,
                    null,
                    'user_logout_all'
                ).catch(() => {});
            } else {
                await refreshTokenService.revokePresentedSession(
                    presented,
                    userId,
                    'user_logout'
                );
                if (req.user?.fid) {
                    await agentIdentityService.onUserSessionFamilyRevoked(
                        userId,
                        req.user.fid,
                        'user_logout'
                    ).catch(() => {});
                }
            }

            if (req.user?.jti) {
                await refreshTokenService.blacklistAccessJti(req.user.jti);
            }
        }

        // Clear cookies using shared cookie options
        res.clearCookie(COOKIE_NAMES.accessToken, getClearCookieOptions());
        res.clearCookie(COOKIE_NAMES.refreshToken, getClearCookieOptions(REFRESH_COOKIE_PATH));

        console.log(`🔓 User ${userId} logged out successfully`);

        return res.status(200).json({
            success: true,
            message: logoutAll
                ? "Logged out from all devices successfully"
                : "Logged out successfully",
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

        // A reset is the path someone takes when they may have lost control of
        // the account, so every existing session goes -- there is no session to
        // keep here, because the reset is not made from a signed-in device.
        const [resetUsers] = await db.query(
            `SELECT id FROM users WHERE email = ? LIMIT 1`,
            [appwriteUser.email]
        );
        if (safeArray(resetUsers).length) {
            await revokeUserSessions({
                userId: resetUsers[0].id,
                reason: REVOKE_REASON.PASSWORD_CHANGED
            });
        }

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

        // Password change → revoke all refresh families (force re-auth on every device)
        await refreshTokenService.revokeAllUserFamilies(userId, 'password_changed');
        await agentIdentityService.onUserSessionFamilyRevoked(
            userId,
            null,
            'password_changed'
        ).catch(() => {});

        return res.status(200).json({ 
            success: true, 
            message: "Password changed successfully. Please login again on all devices." 
        });
    } catch (error) {
        console.error("CHANGE PASSWORD ERROR:", error);
        return res.status(500).json({ success: false, message: "Server error" });
    }
};

// ==================== 8. REFRESH ACCESS TOKEN ====================
const refreshAccessToken = async (req, res) => {
    try {
        const presented =
            sanitizeString(req.body?.refreshToken)
            || req.cookies?.refreshToken
            || null;

        if (!presented) {
            return res.status(401).json({ success: false, message: "Refresh token required" });
        }

        const { ip, userAgent } = clientMeta(req);
        const rotation = await refreshTokenService.rotateRefreshToken(presented, { ip, userAgent });

        if (!rotation.ok) {
            if (rotation.familyRevoked) {
                await agentIdentityService.onUserSessionFamilyRevoked(
                    rotation.userId || null,
                    rotation.familyId,
                    'token_reuse_detected'
                ).catch(() => {});
            }
            return res.status(rotation.status || 401).json({
                success: false,
                message: rotation.message,
                errorCode: rotation.code,
                securityAlarm: rotation.familyRevoked === true
            });
        }

        const [users] = await db.query(
            `SELECT id, name, email, role, is_active FROM users WHERE id = ? LIMIT 1`,
            [rotation.userId]
        );

        if (!safeArray(users).length) {
            await revokeUserSessions({
                userId: rotation.userId,
                reason: REVOKE_REASON.ACCOUNT_DISABLED
            });
            return res.status(401).json({ success: false, message: "Invalid refresh token" });
        }

        const user = rotation.user || users[0];
        if (user.is_active === 0) {
            await revokeUserSessions({
                userId: user.id,
                reason: REVOKE_REASON.ACCOUNT_DISABLED
            });
            return res.status(403).json({ success: false, message: "Account has been deactivated" });
        }

        const access = generateAccessToken(user, rotation.familyId);

        return sendAuthResponse(res, {
            message: "Token refreshed",
            accessToken: access.token,
            refreshToken: rotation.refreshToken,
            familyId: rotation.familyId,
            user,
            security: {
                tokenRotation: true,
                fingerprintMatch: rotation.fingerprintMatch !== false,
                legacyMigrated: rotation.legacyMigrated || false
            }
        });
    } catch (error) {
        console.error("REFRESH TOKEN ERROR:", error);
        return res.status(500).json({ success: false, message: "Server error" });
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
        if (!hasPermission(req.user, PERMISSIONS.SECURITY_AUDIT)) {
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

// ==================== GDPR / DPDP ERASURE (#1397) ====================

const dataErasureService = require("../services/dataErasureService");

/**
 * POST /api/auth/erasure/request
 * Authenticated user opens a staged erasure request; confirmation email sent.
 */
const requestDataErasure = async (req, res) => {
    try {
        const { ip, userAgent } = clientMeta(req);
        const result = await dataErasureService.requestErasure(req.user.id, {
            reason: req.body?.reason,
            ip,
            userAgent
        });
        return res.status(201).json({
            success: true,
            message: result.message,
            requestId: result.requestId,
            status: result.status,
            expiresAt: result.expiresAt,
            emailDelivered: result.emailDelivered,
            ...(result.confirmationToken
                ? { confirmationToken: result.confirmationToken }
                : {})
        });
    } catch (error) {
        const status = error.status || 500;
        return res.status(status).json({
            success: false,
            code: error.code || "ERASURE_ERROR",
            message: error.message || "Failed to create erasure request"
        });
    }
};

/**
 * POST /api/auth/erasure/confirm
 * Confirm with the emailed token — runs soft-delete → anonymize → purge → receipt.
 */
const confirmDataErasure = async (req, res) => {
    try {
        const token = sanitizeString(req.body?.token || req.body?.confirmationToken || "");
        const requestId = sanitizeString(req.body?.requestId || "") || null;
        const result = await dataErasureService.confirmErasure(token, { requestId });
        return res.status(200).json({
            success: true,
            message: result.message,
            receiptId: result.receiptId,
            requestId: result.requestId,
            status: result.status,
            summary: result.summary
        });
    } catch (error) {
        const status = error.status || 500;
        return res.status(status).json({
            success: false,
            code: error.code || "ERASURE_ERROR",
            message: error.message || "Failed to confirm erasure"
        });
    }
};

/**
 * GET /api/auth/erasure/:requestId
 * Authenticated user checks their own erasure request status.
 */
const getMyErasureStatus = async (req, res) => {
    try {
        const requestId = sanitizeString(req.params.requestId || "");
        const status = await dataErasureService.getErasureStatus(requestId, {
            userId: req.user.id,
            asAdmin: false
        });
        return res.status(200).json({
            success: true,
            erasure: status
        });
    } catch (error) {
        const status = error.status || 500;
        return res.status(status).json({
            success: false,
            code: error.code || "ERASURE_ERROR",
            message: error.message || "Failed to fetch erasure status"
        });
    }
};

/**
 * GET /api/auth/erasure/receipt/:receiptId
 * Public verification of an erasure receipt (no PII).
 */
const verifyErasureReceipt = async (req, res) => {
    try {
        const receiptId = sanitizeString(req.params.receiptId || "");
        const receipt = await dataErasureService.verifyReceipt(receiptId);
        return res.status(200).json({
            success: true,
            receipt
        });
    } catch (error) {
        const status = error.status || 500;
        return res.status(status).json({
            success: false,
            code: error.code || "ERASURE_ERROR",
            message: error.message || "Failed to verify receipt"
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
    getMe,
    requestDataErasure,
    confirmDataErasure,
    getMyErasureStatus,
    verifyErasureReceipt
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