const bcrypt =
    require("bcryptjs");

const jwt =
    require("jsonwebtoken");

const crypto =
    require("crypto");

const db =
    require("../config/db");

const {
    sanitizeString,
    safeArray
} = require(
    "../utils/helpers"
);

// validation patterns
const emailRegex =
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const strongPasswordRegex =
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])/;

// environment validation
if (
    !process.env.JWT_SECRET
) {

    throw new Error(
        "JWT_SECRET environment variable is not set"
    );
}

// generate access token
function generateAccessToken(
    user
) {

    return jwt.sign(
        {

            id:
                user.id,

            role:
                user.role
        },

        process.env.JWT_SECRET,

        {
            expiresIn:
                process.env.JWT_EXPIRES_IN
                || "15m"
        }
    );
}

// generate refresh token
function generateRefreshToken() {

    return crypto
        .randomBytes(40)
        .toString("hex");
}

// standard auth response
function sendAuthResponse(
    res,
    {
        message,
        accessToken,
        refreshToken,
        user
    }
) {
    const cookieOptions = {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    };

    if (refreshToken) {
        res.cookie("refreshToken", refreshToken, cookieOptions);
    }
    if (accessToken) {
        res.cookie("accessToken", accessToken, { ...cookieOptions, maxAge: 15 * 60 * 1000 });
    }

    return res.status(200)
        .json({
            success: true,
            message,
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                role: user.role
            }
        });
}

// signup
const signup =
    async (
        req,
        res
    ) => {

        try {

            const {
                name,
                email,
                password
            } = req.body;

            const cleanName =
                sanitizeString(
                    name
                );

            const cleanEmail =
                sanitizeString(
                    email
                ).toLowerCase();

            // validation
            if (
                !cleanName
                ||
                !cleanEmail
                ||
                !password
            ) {

                return res.status(400)
                    .json({

                        success: false,

                        message:
                            "All fields are required"
                    });
            }

            if (
                cleanName.length < 2
            ) {

                return res.status(400)
                    .json({

                        success: false,

                        message:
                            "Name must be at least 2 characters"
                    });
            }

            if (
                !emailRegex.test(
                    cleanEmail
                )
            ) {

                return res.status(400)
                    .json({

                        success: false,

                        message:
                            "Invalid email format"
                    });
            }

            if (
                password.length < 8
            ) {

                return res.status(400)
                    .json({

                        success: false,

                        message:
                            "Password must be at least 8 characters"
                    });
            }

            if (
                !strongPasswordRegex
                    .test(password)
            ) {

                return res.status(400)
                    .json({

                        success: false,

                        message:
                            "Password must contain uppercase, lowercase, number and special character"
                    });
            }

            // existing user check
            const [
                existingUsers
            ] = await db.query(
                `
                    SELECT id
                    FROM users
                    WHERE email = ?
                    LIMIT 1
                `,
                [
                    cleanEmail
                ]
            );

            if (
                safeArray(
                    existingUsers
                ).length
            ) {

                return res.status(400)
                    .json({

                        success: false,

                        message:
                            "User already exists"
                    });
            }

            // hash password
            const hashedPassword =
                await bcrypt.hash(
                    password,
                    10
                );

            // create user
            await db.query(
                `
                    INSERT INTO users
                    (
                        name,
                        email,
                        password,
                        role
                    )
                    VALUES (?, ?, ?, ?)
                `,
                [
                    cleanName,
                    cleanEmail,
                    hashedPassword,
                    "user"
                ]
            );

            return res.status(201)
                .json({

                    success: true,

                    message:
                        "User registered successfully"
                });

        } catch (error) {

            console.error(
                "SIGNUP ERROR:",
                error
            );

            return res.status(500)
                .json({

                    success: false,

                    message:
                        "Server error"
                });
        }
    };

// login
const login =
    async (
        req,
        res
    ) => {

        try {

            const {
                email,
                password
            } = req.body;

            const cleanEmail =
                sanitizeString(
                    email
                ).toLowerCase();

            if (
                !cleanEmail
                ||
                !password
            ) {

                return res.status(400)
                    .json({

                        success: false,

                        message:
                            "Email and password required"
                    });
            }

            // fetch user
            const [
                users
            ] = await db.query(
                `
                    SELECT *
                    FROM users
                    WHERE email = ?
                    LIMIT 1
                `,
                [
                    cleanEmail
                ]
            );

            if (
                !safeArray(
                    users
                ).length
            ) {

                return res.status(404)
                    .json({

                        success: false,

                        message:
                            "Email is not registered. Please sign up first."
                    });
            }

            const user =
                users[0];

            // inactive account
            if (
                user.is_active === 0
            ) {

                return res.status(403)
                    .json({

                        success: false,

                        message:
                            "Account has been deactivated"
                    });
            }

            // password check
            const isMatch =
                await bcrypt.compare(
                    password,
                    user.password
                );

            if (
                !isMatch
            ) {

                return res.status(400)
                    .json({

                        success: false,

                        message:
                            "Incorrect password. Please try again."
                    });
            }

            // generate tokens
            const accessToken =
                generateAccessToken(
                    user
                );

            const refreshToken =
                generateRefreshToken();

            // save refresh token
            await db.query(
                `
                    UPDATE users
                    SET refresh_token = ?
                    WHERE id = ?
                `,
                [
                    refreshToken,
                    user.id
                ]
            );

            return sendAuthResponse(
                res,
                {

                    message:
                        "Login successful",

                    accessToken,

                    refreshToken,

                    user
                }
            );

        } catch (error) {

            console.error(
                "LOGIN ERROR:",
                error
            );

            return res.status(500)
                .json({

                    success: false,

                    message:
                        "Server error"
                });
        }
    };

// refresh access token
const refreshAccessToken =
    async (
        req,
        res
    ) => {

        try {
            const refreshToken = req.cookies?.refreshToken || req.body?.refreshToken;

            const cleanRefreshToken =
                sanitizeString(
                    refreshToken
                );

            if (
                !cleanRefreshToken
            ) {

                return res.status(401)
                    .json({

                        success: false,

                        message:
                            "Refresh token required"
                    });
            }

            // fetch user
            const [
                users
            ] = await db.query(
                `
                    SELECT
                        id,
                        name,
                        email,
                        role,
                        is_active
                    FROM users
                    WHERE refresh_token = ?
                    LIMIT 1
                `,
                [
                    cleanRefreshToken
                ]
            );

            if (
                !safeArray(
                    users
                ).length
            ) {

                return res.status(401)
                    .json({

                        success: false,

                        message:
                            "Invalid refresh token"
                    });
            }

            const user =
                users[0];

            // inactive account
            if (
                user.is_active === 0
            ) {

                return res.status(403)
                    .json({

                        success: false,

                        message:
                            "Account has been deactivated"
                    });
            }

            // rotate tokens
            const newAccessToken =
                generateAccessToken(
                    user
                );

            const newRefreshToken =
                generateRefreshToken();

            await db.query(
                `
                    UPDATE users
                    SET refresh_token = ?
                    WHERE id = ?
                `,
                [
                    newRefreshToken,
                    user.id
                ]
            );

            return sendAuthResponse(
                res,
                {

                    message:
                        "Token refreshed",

                    accessToken:
                        newAccessToken,

                    refreshToken:
                        newRefreshToken,

                    user
                }
            );

        } catch (error) {

            console.error(
                "REFRESH TOKEN ERROR:",
                error
            );

            return res.status(500)
                .json({

                    success: false,

                    message:
                        "Server error"
                });
        }
    };

module.exports = {

    signup,

    login,

    refreshAccessToken
};