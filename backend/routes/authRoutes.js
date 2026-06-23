const express =
    require("express");

const router =
    express.Router();

const {
    signup,
    verifySignup,
    login,
    forgotPassword,
    resetPassword,
    refreshAccessToken
} = require(
    "../controllers/authController"
);

const authMiddleware =
    require(
        "../middleware/authMiddleware"
    );

const db =
    require(
        "../config/db"
    ).promise;

const {
    sanitizeString
} = require(
    "../utils/helpers"
);
const { signupLimiter, loginLimiter, forgotPasswordLimiter, refreshTokenLimiter } = require("../middleware/rateLimiter");

// auth api status
router.get(
    "/status",
    (
        req,
        res
    ) => {

        res.status(200)
            .json({

                success: true,

                message:
                    "Auth API running"
            });
    }
);

// signup
router.post(
    "/signup",
    signupLimiter,
    (
        req,
        res,
        next
    ) => {

        const {
            name,
            email,
            password
        } = req.body;

        // validate name
        if (
            !sanitizeString(
                name
            )
        ) {

            return res.status(400)
                .json({

                    success: false,

                    message:
                        "Name is required"
                });
        }

        // validate email
        if (
            !sanitizeString(
                email
            )
        ) {

            return res.status(400)
                .json({

                    success: false,

                    message:
                        "Email is required"
                });
        }

        // validate password
        if (
            !sanitizeString(
                password
            )
        ) {

            return res.status(400)
                .json({

                    success: false,

                    message:
                        "Password is required"
                });
        }

        next();
    },
    signup
);

// verify signup
router.post(
    "/verify-signup",
    signupLimiter,
    (req, res, next) => {
        const { email, otp } = req.body;
        if (!sanitizeString(email) || !sanitizeString(otp)) {
            return res.status(400).json({ success: false, message: "Email and OTP are required" });
        }
        next();
    },
    verifySignup
);

// login
router.post(
    "/login",
    loginLimiter,
    (
        req,
        res,
        next
    ) => {

        const {
            email,
            password
        } = req.body;

        // validate email
        if (
            !sanitizeString(
                email
            )
        ) {

            return res.status(400)
                .json({

                    success: false,

                    message:
                        "Email is required"
                });
        }

        // validate password
        if (
            !sanitizeString(
                password
            )
        ) {

            return res.status(400)
                .json({

                    success: false,

                    message:
                        "Password is required"
                });
        }

        next();
    },
    login
);

// forgot password
router.post(
    "/forgot-password",
    forgotPasswordLimiter,
    (req, res, next) => {
        const { email } = req.body;
        if (!sanitizeString(email)) {
            return res.status(400).json({ success: false, message: "Email is required" });
        }
        next();
    },
    forgotPassword
);

// reset password
router.post(
    "/reset-password",
    forgotPasswordLimiter,
    (req, res, next) => {
        const { userId, otp, newPassword } = req.body;
        if (!sanitizeString(userId) || !sanitizeString(otp) || !sanitizeString(newPassword)) {
            return res.status(400).json({ success: false, message: "User ID, OTP, and New Password are required" });
        }
        next();
    },
    resetPassword
);

// refresh access token
router.post(
    "/refresh-token",
    refreshTokenLimiter,
    (
        req,
        res,
        next
    ) => {

        const {
            refreshToken
        } = req.body;

        if (
            !sanitizeString(
                refreshToken
            )
        ) {

            return res.status(400)
                .json({

                    success: false,

                    message:
                        "Refresh token required"
                });
        }

        next();
    },
    refreshAccessToken
);

// logout
router.post(
    "/logout",
    authMiddleware,
    async (
        req,
        res
    ) => {

        try {

            await db.query(
                `
                    UPDATE users
                    SET refresh_token = NULL
                    WHERE id = ?
                `,
                [
                    req.user.id
                ]
            );

            return res.status(200)
                .json({

                    success: true,

                    message:
                        "Logged out successfully"
                });

        } catch (error) {

            console.error(
                "LOGOUT ERROR:",
                error
            );

            return res.status(500)
                .json({

                    success: false,

                    message:
                        "Logout failed"
                });
        }
    }
);

// current user
router.get(
    "/me",
    authMiddleware,
    async (
        req,
        res
    ) => {
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
    }
);

// route fallback
router.use(
    (
        req,
        res
    ) => {

        res.status(404)
            .json({

                success: false,

                message:
                    "Auth route not found"
            });
    }
);

module.exports =
    router;