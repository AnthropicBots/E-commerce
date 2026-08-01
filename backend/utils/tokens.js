/**
 * Token contract shared by the issuing and the verifying halves of auth.
 *
 * Secrets, lifetimes, claim names, cookie names and the refresh-token shape are
 * defined here and nowhere else. Both sides import from this module, so a change
 * to one of them cannot silently invalidate tokens the service just handed out.
 *
 * @module utils/tokens
 */

const crypto = require("crypto");
const jwt = require("jsonwebtoken");

// ==================== SECRETS ====================

const ACCESS_TOKEN_SECRET_VAR = "JWT_SECRET";
const REFRESH_TOKEN_SECRET_VAR = "JWT_REFRESH_SECRET";

// ==================== LIFETIMES ====================

// Access tokens stay deliberately short: renewal, not a long expiry, is what
// keeps a shopper signed in. JWT_EXPIRES_IN is the older spelling and is still
// honoured so existing deployments do not change behaviour on upgrade.
const ACCESS_TOKEN_TTL = process.env.JWT_EXPIRY || process.env.JWT_EXPIRES_IN || "15m";

// A password holder who still owes a second factor gets just enough time to
// supply it.
const TWO_FACTOR_TOKEN_TTL = "5m";

// Absolute lifetime of a session. Rotation moves a session forward but never
// past this, so a session cannot be kept alive indefinitely by refreshing.
const REFRESH_TOKEN_TTL = process.env.JWT_REFRESH_EXPIRY || "7d";

// ==================== CLAIMS ====================

const SUBJECT_CLAIM = "id";

// Ties an access token back to the session that produced it, so a request can
// tell which of the account's sessions it belongs to.
const SESSION_CLAIM = "sid";

// Tokens minted before the subject claim was pinned down carry `userId`. They
// are still accepted when verifying so an upgrade does not sign everybody out
// mid-session; nothing issues them any more.
const LEGACY_SUBJECT_CLAIM = "userId";

// ==================== COOKIES ====================

const COOKIE_NAMES = Object.freeze({
    accessToken: "accessToken",
    refreshToken: "refreshToken"
});

// Must match the path the refresh endpoint is actually mounted at. A cookie
// scoped to any other path is never sent to the endpoint that needs it, and is
// not removed by the clear on logout either.
const REFRESH_COOKIE_PATH = "/api/auth/refresh-token";

// ==================== REFRESH TOKEN SHAPE ====================

// Refresh tokens are opaque handles rather than JWTs: nothing about a session
// is readable from the token, and the server resolves it by lookup. The
// trailing tag is an HMAC over the handle, so a token this service never issued
// is rejected without touching the database.
const REFRESH_TOKEN_HANDLE_BYTES = 40;
const REFRESH_TOKEN_TAG_HEX_LENGTH = 32;
const REFRESH_TOKEN_PATTERN = new RegExp(
    `^[0-9a-f]{${REFRESH_TOKEN_HANDLE_BYTES * 2}}\\.[0-9a-f]{${REFRESH_TOKEN_TAG_HEX_LENGTH}}$`
);

// ==================== CONFIGURATION ====================

/**
 * Read a secret at the moment it is used rather than caching it at import.
 * The auth middleware is expected to react to a secret that changes after the
 * process has started, and callers rely on a missing secret raising rather than
 * silently signing with `undefined`.
 */
function readSecret(name) {
    const value = process.env[name];
    if (!value) {
        throw new Error(
            `FATAL: ${name} environment variable is required but not set. ` +
            `Authentication cannot issue or verify tokens without it.`
        );
    }
    return value;
}

/**
 * Fail at startup rather than on the first sign-in or the first renewal.
 */
function assertTokenConfiguration() {
    const accessSecret = readSecret(ACCESS_TOKEN_SECRET_VAR);
    const refreshSecret = readSecret(REFRESH_TOKEN_SECRET_VAR);

    if (accessSecret === refreshSecret) {
        throw new Error(
            `FATAL: ${ACCESS_TOKEN_SECRET_VAR} and ${REFRESH_TOKEN_SECRET_VAR} must be ` +
            `different values. Sharing one secret lets an access token be presented ` +
            `as refresh material and vice versa.`
        );
    }
}

function assertAccessTokenSecret() {
    readSecret(ACCESS_TOKEN_SECRET_VAR);
}

assertTokenConfiguration();

// ==================== ACCESS TOKENS ====================

/**
 * @param {Object} user - Row with `id`, `email` and `role`.
 * @param {Object} [extraClaims] - Additional claims to merge into the payload.
 * @returns {string} Signed access token.
 */
function issueAccessToken(user, extraClaims = {}) {
    return jwt.sign(
        {
            [SUBJECT_CLAIM]: user.id,
            email: user.email,
            role: user.role,
            ...extraClaims
        },
        readSecret(ACCESS_TOKEN_SECRET_VAR),
        { expiresIn: ACCESS_TOKEN_TTL }
    );
}

/**
 * Short-lived token that stands in for a session until a second factor is
 * supplied.
 */
function issueTwoFactorToken(user) {
    return jwt.sign(
        {
            [SUBJECT_CLAIM]: user.id,
            email: user.email,
            role: user.role,
            is2FA: true
        },
        readSecret(ACCESS_TOKEN_SECRET_VAR),
        { expiresIn: TWO_FACTOR_TOKEN_TTL }
    );
}

/**
 * @throws {Error} When the token is malformed, expired or signed with another key.
 */
function verifyAccessToken(token) {
    return jwt.verify(token, readSecret(ACCESS_TOKEN_SECRET_VAR));
}

/**
 * Whether a verified payload identifies a user under either accepted claim.
 */
function hasSubjectClaim(decoded) {
    if (!decoded) return false;
    return decoded[SUBJECT_CLAIM] !== undefined || decoded[LEGACY_SUBJECT_CLAIM] !== undefined;
}

// ==================== REFRESH TOKENS ====================

function refreshTokenTag(handle) {
    return crypto
        .createHmac("sha256", readSecret(REFRESH_TOKEN_SECRET_VAR))
        .update(handle)
        .digest("hex")
        .slice(0, REFRESH_TOKEN_TAG_HEX_LENGTH);
}

/**
 * @returns {string} A fresh refresh token, tagged so it can be recognised as ours.
 */
function issueRefreshToken() {
    const handle = crypto.randomBytes(REFRESH_TOKEN_HANDLE_BYTES).toString("hex");
    return `${handle}.${refreshTokenTag(handle)}`;
}

/**
 * Shape-only check, for request validation that runs before authentication.
 */
function isRefreshTokenWellFormed(value) {
    return typeof value === "string" && REFRESH_TOKEN_PATTERN.test(value);
}

/**
 * @returns {boolean} True when the token carries a tag this service produced.
 */
function verifyRefreshToken(value) {
    if (!isRefreshTokenWellFormed(value)) {
        return false;
    }

    const [handle, tag] = value.split(".");
    return crypto.timingSafeEqual(
        Buffer.from(tag, "hex"),
        Buffer.from(refreshTokenTag(handle), "hex")
    );
}

/**
 * Digest stored in place of the token itself, so a copy of the session table
 * cannot be replayed as a set of live credentials.
 *
 * @returns {string} 64-character hex digest.
 */
function hashRefreshToken(value) {
    return crypto.createHash("sha256").update(value).digest("hex");
}

// ==================== DURATIONS ====================

const DURATION_UNIT_MS = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000
};

/**
 * Convert a `jsonwebtoken`-style duration ("15m", "7d", "3600") to milliseconds,
 * so a lifetime configured once can also be used as a row expiry.
 */
function durationToMs(duration) {
    const match = /^(\d+)([smhd])?$/.exec(String(duration).trim());
    if (!match) {
        throw new Error(
            `Unsupported duration "${duration}". Use a number of seconds or a value ` +
            `like 30s, 15m, 12h or 7d.`
        );
    }

    const [, amount, unit] = match;
    return Number(amount) * (unit ? DURATION_UNIT_MS[unit] : DURATION_UNIT_MS.s);
}

const REFRESH_TOKEN_TTL_MS = durationToMs(REFRESH_TOKEN_TTL);

// ==================== EXPORTS ====================

module.exports = {
    ACCESS_TOKEN_TTL,
    COOKIE_NAMES,
    REFRESH_COOKIE_PATH,
    REFRESH_TOKEN_TTL,
    REFRESH_TOKEN_TTL_MS,
    SESSION_CLAIM,
    SUBJECT_CLAIM,
    assertAccessTokenSecret,
    assertTokenConfiguration,
    durationToMs,
    hasSubjectClaim,
    hashRefreshToken,
    isRefreshTokenWellFormed,
    issueAccessToken,
    issueRefreshToken,
    issueTwoFactorToken,
    verifyAccessToken,
    verifyRefreshToken
};
