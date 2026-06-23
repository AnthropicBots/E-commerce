const jwt =
    require("jsonwebtoken");

// environment validation
if (
    !process.env.JWT_SECRET
) {

    throw new Error(
        "JWT_SECRET environment variable is not set"
    );
}

// extract bearer token
function extractToken(
    authHeader
) {

    if (
        !authHeader
        ||
        typeof authHeader !== "string"
    ) {

        return null;
    }

    if (
        !authHeader.startsWith(
            "Bearer "
        )
    ) {

        return null;
    }

    const token =
        authHeader
            .split(" ")[1]
            ?.trim();

    return token || null;
}

// unauthorized response
function unauthorized(
    res,
    message =
        "Unauthorized access"
) {

    return res.status(401)
        .json({

            success: false,

            message
        });
}

// auth middleware
const authMiddleware =
    (
        req,
        res,
        next
    ) => {

        try {

            const authHeader = req.headers.authorization;

            // extract token
            let token = extractToken(authHeader);

            // check cookies if header is missing
            if (!token && req.cookies && req.cookies.accessToken) {
                token = req.cookies.accessToken;
            }

            if (
                !token
            ) {

                return unauthorized(
                    res,
                    "Authentication token required"
                );
            }

            // verify token
            const decoded =
                jwt.verify(
                    token,
                    process.env.JWT_SECRET
                );

            // validate payload
            if (
                !decoded
                ||
                !decoded.id
            ) {

                return unauthorized(
                    res,
                    "Invalid token payload"
                );
            }

            // attach user
            req.user = {

                id:
                    Number(
                        decoded.id
                    ),

                role:
                    decoded.role
                    || "customer"
            };

            next();

        } catch (error) {

            console.error(
                "AUTH ERROR:",
                error.message
            );

            // token expired
            if (
                error.name ===
                "TokenExpiredError"
            ) {

                return unauthorized(
                    res,
                    "Session expired"
                );
            }

            // invalid token
            if (
                error.name ===
                "JsonWebTokenError"
            ) {

                return unauthorized(
                    res,
                    "Invalid authentication token"
                );
            }

            // malformed token
            if (
                error.name ===
                "NotBeforeError"
            ) {

                return unauthorized(
                    res,
                    "Token not active"
                );
            }

            return unauthorized(
                res
            );
        }
    };

module.exports =
    authMiddleware;