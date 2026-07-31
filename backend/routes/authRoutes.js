const express = require("express");
const router = express.Router();
// ======================== CONTROLLERS ========================
const {
    signup,
    verifySignup,
    login,
    forgotPassword,
    resetPassword,
    refreshAccessToken,
    getMe,
    getStatus,
    logout,
    validateToken,
    changePassword,
    getSecurityAudit,
    getFraudStatus,
    //verify2FA,
    //generate2FA,
    //enable2FA,
    //disable2FA
} = require("../controllers/authController");
const {
    getSessions,
    deleteSession,
    deleteOtherSessions
} = require("../controllers/sessionController");
// ======================== MIDDLEWARE ========================
const authMiddleware = require("../middleware/authMiddleware");
const {
    signupLimiter,
    loginLimiter,
    forgotPasswordLimiter,
    refreshTokenLimiter
} = require("../middleware/rateLimiter");
const { applyCaptchaCheck } = require("../middleware/captchaMiddleware");
const { detectSyntheticIdentity } = require("../middleware/fraudDetectionMiddleware");

// ✅ New Validation Middleware Import Added
const {
    validateSignup,
    validateVerifySignup,
    validateLogin,
    validateForgotPassword,
    validateResetPassword,
    validateRefreshToken,
    validateChangePassword
} = require("../middleware/authValidation");

// ======================== DATABASE ========================
const db = require("../config/db").promise;

// ======================== ENVIRONMENT VALIDATION ========================
// The token contract checks its own configuration when imported, so a missing
// or shared secret refuses to start rather than breaking sign-in at runtime.
require("../utils/tokens");

// ======================== HELPER FUNCTIONS ========================

// ❌ `validateRequiredFields` helper removed completely
// ❌ `sanitizeString` import removed because it's now handled in the middleware



// ======================== ROUTES ========================

/**
 * GET /api/auth/status
 * Check auth API status
 */
router.get("/status", getStatus);

/**
 * POST /api/auth/signup
 * Register new user
 */
router.post(
    "/signup",
    signupLimiter,
    applyCaptchaCheck,
    detectSyntheticIdentity,
    validateSignup,   
    signup
);

/**
 * POST /api/auth/verify-signup
 * Verify OTP for signup
 */
router.post(
    "/verify-signup",
    signupLimiter,
    applyCaptchaCheck,
    validateVerifySignup, 
    verifySignup
);

/**
 * POST /api/auth/login
 * User login
 */
router.post(
    "/login",
    loginLimiter,
    applyCaptchaCheck,
    validateLogin,  
    login
);

/**
 * POST /api/auth/forgot-password
 * Request password reset OTP
 */
router.post(
    "/forgot-password",
    forgotPasswordLimiter,
    applyCaptchaCheck,
    validateForgotPassword, 
    forgotPassword
);

/**
 * POST /api/auth/reset-password
 * Reset password with OTP
 */
router.post(
    "/reset-password",
    forgotPasswordLimiter,
    applyCaptchaCheck,
    validateResetPassword,
    resetPassword
);

/**
 * POST /api/auth/refresh-token
 * Refresh access token
 */
router.post(
    "/refresh-token",
    refreshTokenLimiter,
    applyCaptchaCheck,
    validateRefreshToken, 
    refreshAccessToken
);

/**
 * POST /api/auth/logout
 * Logout user
 */
router.post(
    "/logout",
    authMiddleware,
   logout
);

/**
 * GET /api/auth/me
 * Get current user information
 */
router.get(
    "/me",
    authMiddleware,
    getMe
);

/**
 * POST /api/auth/validate-token
 * Validate if token is still active
 */
router.post(
    "/validate-token",
    authMiddleware,
    validateToken
);

/**
 * POST /api/auth/change-password
 * Change password (authenticated)
 */
router.post(
    "/change-password",
    authMiddleware,
    applyCaptchaCheck,
    validateChangePassword,
    changePassword
);

// ======================== SESSION ROUTES ========================

/**
 * GET /api/auth/sessions
 * List the account's active sessions
 */
router.get(
    "/sessions",
    authMiddleware,
    getSessions
);

/**
 * DELETE /api/auth/sessions
 * End every session on the account except the one making the request
 */
router.delete(
    "/sessions",
    authMiddleware,
    deleteOtherSessions
);

/**
 * DELETE /api/auth/sessions/:sessionId
 * End one session on the account
 */
router.delete(
    "/sessions/:sessionId",
    authMiddleware,
    deleteSession
);

/**
 * GET /api/auth/security-audit
 * Get security audit log (admin only)
 */
router.get(
    "/security-audit",
    authMiddleware,
   getSecurityAudit
);

/**
 * GET /api/auth/fraud-status
 * Get fraud detection status for current user (authenticated)
 */
router.get(
    "/fraud-status",
    authMiddleware,
    async (req, res) => {
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
    }
);

// ======================== 2FA ROUTES ========================

/**
 * POST /api/auth/verify-2fa
 * Complete login using 2FA TOTP code
 */
/**router.post(
    "/verify-2fa",
    loginLimiter,
    applyCaptchaCheck,
    verify2FA
);**/

/**
 * POST /api/auth/2fa/generate
 * Generate 2FA secret (admins only)
 */
/**router.post(
    "/2fa/generate",
    authMiddleware,
    generate2FA
);
**/

/**
 * POST /api/auth/2fa/enable
 * Enable 2FA after scanning QR code
 */
/**router.post(
    "/2fa/enable",
    authMiddleware,
    enable2FA
);
**/

/**
 * POST /api/auth/2fa/disable
 * Disable 2FA
 */
/**router.post(
    "/2fa/disable",
    authMiddleware,
    disable2FA
);
*/

// ======================== ROUTE FALLBACK ========================

/**
 * 404 - Route not found
 */
router.use((req, res) => {
    res.status(404).json({
        success: false,
        message: "Auth route not found",
        path: req.path,
        method: req.method
    });
});

// ======================== EXPORTS ========================

module.exports = router;