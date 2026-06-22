const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const db = require("../config/db");
const { sanitizeString, safeArray } = require("../utils/helpers");

// Appwrite SDK
const { Client, Account, ID, Databases } = require('node-appwrite');

// In-memory cache for pending signups (Email -> { name, password, userId, expiresAt })
const pendingSignups = new Map();

// Initialize Appwrite Client (No API Key needed for Account API)
const appwriteClient = new Client()
    .setEndpoint(process.env.VITE_APPWRITE_ENDPOINT || 'https://fra.cloud.appwrite.io/v1')
    .setProject(process.env.VITE_APPWRITE_PROJECT_ID);

const appwriteAccount = new Account(appwriteClient);

// validation patterns
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const strongPasswordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])/;

if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET environment variable is not set");
}

function generateAccessToken(user) {
    return jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || "15m" });
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

// 1. Initiate Signup (Send OTP)
const signup = async (req, res) => {
    try {
        const { name, email, password } = req.body;
        const cleanName = sanitizeString(name);
        const cleanEmail = sanitizeString(email).toLowerCase();

        if (!cleanName || !cleanEmail || !password) {
            return res.status(400).json({ success: false, message: "All fields are required" });
        }
        if (!emailRegex.test(cleanEmail)) {
            return res.status(400).json({ success: false, message: "Invalid email format" });
        }
        if (password.length < 8 || !strongPasswordRegex.test(password)) {
            return res.status(400).json({ success: false, message: "Password must contain uppercase, lowercase, number and special character and 8 characters" });
        }

        // Check if user already exists in MySQL
        const [existingUsers] = await db.query(`SELECT id FROM users WHERE email = ? LIMIT 1`, [cleanEmail]);
        if (safeArray(existingUsers).length) {
            return res.status(400).json({ success: false, message: "Email already exists" });
        }

        // Send OTP via Appwrite Email Token
        const token = await appwriteAccount.createEmailToken(ID.unique(), cleanEmail);

        // Store pending user
        pendingSignups.set(cleanEmail, {
            name: cleanName,
            password: password, // Store plain text temporarily, hash before saving to DB
            userId: token.userId,
            expiresAt: Date.now() + 10 * 60 * 1000 // 10 minutes expiry
        });

        return res.status(200).json({
            success: true,
            message: "OTP sent to email",
            userId: token.userId
        });
    } catch (error) {
        console.error("SIGNUP OTP ERROR:", error);
        return res.status(500).json({ success: false, message: error.message || "Failed to send OTP" });
    }
};

// 2. Verify Signup OTP
const verifySignup = async (req, res) => {
    try {
        const { email, otp } = req.body;
        const cleanEmail = sanitizeString(email).toLowerCase();

        const pendingUser = pendingSignups.get(cleanEmail);
        if (!pendingUser) {
            return res.status(400).json({ success: false, message: "No pending registration found for this email" });
        }
        if (Date.now() > pendingUser.expiresAt) {
            pendingSignups.delete(cleanEmail);
            return res.status(400).json({ success: false, message: "Expired OTP" });
        }

        // Verify OTP with Appwrite
        let session;
        try {
            session = await appwriteAccount.createSession(pendingUser.userId, otp);
        } catch (err) {
            return res.status(400).json({ success: false, message: "Invalid OTP" });
        }

        // Session created, user verified!
        // Initialize user-scoped Appwrite client to update name/password
        const userClient = new Client()
            .setEndpoint(process.env.VITE_APPWRITE_ENDPOINT || 'https://fra.cloud.appwrite.io/v1')
            .setProject(process.env.VITE_APPWRITE_PROJECT_ID)
            .setSession(session.secret);
        
        const userAccount = new Account(userClient);
        const databases = new Databases(userClient);
        
        // Update Name & Password in Appwrite
        try {
            await userAccount.updateName(pendingUser.name);
            await userAccount.updatePassword(pendingUser.password);
        } catch (updateErr) {
            console.warn("Failed to update Appwrite profile:", updateErr.message);
        }

        // Store in Appwrite Database if configured
        if (process.env.VITE_APPWRITE_DATABASE_ID && process.env.VITE_APPWRITE_USERS_TABLE_ID) {
            try {
                await databases.createDocument(
                    process.env.VITE_APPWRITE_DATABASE_ID,
                    process.env.VITE_APPWRITE_USERS_TABLE_ID,
                    ID.unique(),
                    { name: pendingUser.name, email: cleanEmail, role: 'user' }
                );
            } catch (dbErr) {
                console.warn("Could not save to Appwrite DB (might lack permissions):", dbErr.message);
            }
        }

        // Hash password and save to MySQL
        const hashedPassword = await bcrypt.hash(pendingUser.password, 10);
        await db.query(
            `INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)`,
            [pendingUser.name, cleanEmail, hashedPassword, "user"]
        );

        // Log user out from Appwrite (we will use local JWT for sessions)
        try {
            await userAccount.deleteSession('current');
        } catch (logoutErr) {
            console.warn("Failed to delete Appwrite session:", logoutErr.message);
        }
        pendingSignups.delete(cleanEmail);

        return res.status(201).json({ success: true, message: "Account created successfully" });
    } catch (error) {
        console.error("VERIFY SIGNUP ERROR:", error);
        return res.status(500).json({ success: false, message: "Server error during verification: " + error.message, stack: error.stack });
    }
};

// 3. Login
const login = async (req, res) => {
    try {
        const { email, password } = req.body;
        const cleanEmail = sanitizeString(email).toLowerCase();

        if (!cleanEmail || !password) {
            return res.status(400).json({ success: false, message: "Email and password required" });
        }

        const [users] = await db.query(`SELECT * FROM users WHERE email = ? LIMIT 1`, [cleanEmail]);
        if (!safeArray(users).length) {
            return res.status(400).json({ success: false, message: "Invalid credentials" });
        }

        const user = users[0];
        if (user.is_active === 0) {
            return res.status(403).json({ success: false, message: "Account has been deactivated" });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({ success: false, message: "Invalid credentials" });
        }

        const accessToken = generateAccessToken(user);
        const refreshToken = generateRefreshToken();

        await db.query(`UPDATE users SET refresh_token = ? WHERE id = ?`, [refreshToken, user.id]);

        return sendAuthResponse(res, { message: "Login successful", accessToken, refreshToken, user });
    } catch (error) {
        console.error("LOGIN ERROR:", error);
        return res.status(500).json({ success: false, message: "Server error" });
    }
};

// 4. Forgot Password (Send OTP)
const forgotPassword = async (req, res) => {
    try {
        const { email } = req.body;
        const cleanEmail = sanitizeString(email).toLowerCase();

        const [users] = await db.query(`SELECT id FROM users WHERE email = ? LIMIT 1`, [cleanEmail]);
        if (!safeArray(users).length) {
            // Do not reveal if email exists, just say OTP sent for security
            return res.status(200).json({ success: true, message: "If the email is registered, an OTP has been sent." });
        }

        const token = await appwriteAccount.createEmailToken(ID.unique(), cleanEmail);
        
        return res.status(200).json({
            success: true,
            message: "OTP sent to your email",
            userId: token.userId
        });
    } catch (error) {
        console.error("FORGOT PASSWORD ERROR:", error);
        return res.status(500).json({ success: false, message: "Failed to send reset OTP" });
    }
};

// 5. Reset Password (Verify OTP & Set New Password)
const resetPassword = async (req, res) => {
    try {
        const { userId, otp, newPassword } = req.body;

        if (!userId || !otp || !newPassword) {
            return res.status(400).json({ success: false, message: "Missing required fields" });
        }

        if (newPassword.length < 8 || !strongPasswordRegex.test(newPassword)) {
            return res.status(400).json({ success: false, message: "Password must contain uppercase, lowercase, number and special character and 8 characters" });
        }

        // Verify OTP
        let session;
        try {
            session = await appwriteAccount.createSession(userId, otp);
        } catch (err) {
            return res.status(400).json({ success: false, message: "Invalid OTP or Expired OTP" });
        }

        // Use session to fetch user details and update password
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

        return res.status(200).json({ success: true, message: "Password reset successfully. You can now login." });
    } catch (error) {
        console.error("RESET PASSWORD ERROR:", error);
        return res.status(500).json({ success: false, message: "Failed to reset password" });
    }
};

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

        return sendAuthResponse(res, { message: "Token refreshed", accessToken: newAccessToken, refreshToken: newRefreshToken, user });
    } catch (error) {
        console.error("REFRESH TOKEN ERROR:", error);
        return res.status(500).json({ success: false, message: "Server error" });
    }
};

module.exports = {
    signup,
    verifySignup,
    login,
    forgotPassword,
    resetPassword,
    refreshAccessToken
};