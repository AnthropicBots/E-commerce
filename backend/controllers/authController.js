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

function generateAccessToken(user) {
    return jwt.sign(
        { id: user.id, email: user.email, role: user.role },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN || "15m" }
    );
}

function generateRefreshToken() {
    return crypto.randomBytes(40).toString("hex");
}

function sendAuthResponse(res, { message, accessToken, refreshToken, user }) {
    return res.status(200).json({
        success: true,
        message,
        accessToken,
        refreshToken,
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
    if (now > record.lockoutUntil) {
        loginAttempts.delete(email);
        return false;
    }
    return true;
}

function recordLoginFailure(email) {
    const now = Date.now();
    const record = loginAttempts.get(email);
    
    if (!record) {
        loginAttempts.set(email, { attempts: 1, lockoutUntil: now + LOGIN_LOCKOUT_DURATION });
        return;
    }
    
    record.attempts++;
    if (record.attempts >= MAX_LOGIN_ATTEMPTS) {
        record.lockoutUntil = now + LOGIN_LOCKOUT_DURATION;
    }
}

function resetLoginAttempts(email) {
    loginAttempts.delete(email);
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
        await db.query(
            `INSERT INTO users (name, email, password, role, email_verified) VALUES (?, ?, ?, ?, ?)`,
            [pendingUser.name, cleanEmail, pendingUser.hashedPassword, "user", 1]
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

        const accessToken = generateAccessToken(user);
        const refreshToken = generateRefreshToken();

        // Update refresh token and last login time
        await db.query(
            `UPDATE users SET refresh_token = ?, last_login = NOW() WHERE id = ?`, 
            [refreshToken, user.id]
        );

        return sendAuthResponse(res, { 
            message: "Login successful", 
            accessToken, 
            refreshToken, 
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
        if (userId) {
            // Clear refresh token AND update last logout time
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

        const [users] = await db.query(`SELECT id, email_verified FROM users WHERE email = ? LIMIT 1`, [cleanEmail]);
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
        const cleanRefreshToken = sanitizeString(refreshToken);

        if (!cleanRefreshToken) {
            return res.status(401).json({ success: false, message: "Refresh token required" });
        }

        const [users] = await db.query(
            `SELECT id, name, email, role, is_active FROM users WHERE refresh_token = ? LIMIT 1`,
            [cleanRefreshToken]
        );

        if (!safeArray(users).length) {
            return res.status(401).json({ success: false, message: "Invalid refresh token" });
        }

        const user = users[0];
        if (user.is_active === 0) {
            return res.status(403).json({ success: false, message: "Account has been deactivated" });
        }

        const newAccessToken = generateAccessToken(user);
        const newRefreshToken = generateRefreshToken();

        await db.query(`UPDATE users SET refresh_token = ? WHERE id = ?`, [newRefreshToken, user.id]);

        return sendAuthResponse(res, { 
            message: "Token refreshed", 
            accessToken: newAccessToken, 
            refreshToken: newRefreshToken, 
            user 
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