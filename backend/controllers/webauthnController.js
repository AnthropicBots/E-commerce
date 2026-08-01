/**
 * WebAuthn / Passkey ceremonies (#1385).
 * Issues the same access/refresh token family as password login.
 */

"use strict";

const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const {
    generateRegistrationOptions,
    verifyRegistrationResponse,
    generateAuthenticationOptions,
    verifyAuthenticationResponse
} = require("@simplewebauthn/server");

const db = require("../config/db").promise;
const { sanitizeString, safeArray } = require("../utils/helpers");
const refreshTokenService = require("../services/refreshTokenService");
const challengeStore = require("../services/webauthnChallengeService");
const credentialService = require("../services/webauthnCredentialService");

function getRpConfig() {
    const rpID =
        process.env.WEBAUTHN_RP_ID ||
        process.env.WEBAUTHN_RPID ||
        "localhost";
    const rpName =
        process.env.WEBAUTHN_RP_NAME || "AnthropicBots E-Commerce";

    const origins = new Set();
    const frontend = process.env.FRONTEND_URL || "http://127.0.0.1:5500";
    origins.add(frontend.replace(/\/$/, ""));
    const extra = process.env.WEBAUTHN_ORIGINS || "";
    extra
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .forEach((o) => origins.add(o.replace(/\/$/, "")));

    // Common local Live Server hosts
    origins.add("http://127.0.0.1:5500");
    origins.add("http://localhost:5500");

    return {
        rpID,
        rpName,
        origins: [...origins]
    };
}

function clientMeta(req) {
    const ip =
        req.ip ||
        req.headers["x-forwarded-for"]?.toString().split(",")[0]?.trim() ||
        req.connection?.remoteAddress ||
        null;
    const userAgent = req.headers["user-agent"] || "";
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
        token: jwt.sign(payload, process.env.JWT_SECRET, {
            expiresIn: process.env.JWT_EXPIRES_IN || process.env.JWT_EXPIRY || "15m"
        }),
        jti,
        familyId
    };
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

async function issueSessionForUser(req, res, user, message) {
    const { ip, userAgent } = clientMeta(req);
    const session = await refreshTokenService.issueRefreshFamily(user.id, {
        ip,
        userAgent
    });
    const access = generateAccessToken(user, session.familyId);
    return sendAuthResponse(res, {
        message,
        accessToken: access.token,
        refreshToken: session.refreshToken,
        familyId: session.familyId,
        user,
        security: {
            tokenRotation: true,
            authMethod: "webauthn",
            deviceFingerprint: session.deviceFingerprint
                ? `${session.deviceFingerprint.slice(0, 12)}…`
                : undefined
        }
    });
}

async function loadUserById(userId) {
    const [rows] = await db.query(
        `SELECT id, name, email, role, is_active FROM users WHERE id = ? LIMIT 1`,
        [userId]
    );
    return safeArray(rows)[0] || null;
}

async function loadUserByEmail(email) {
    const [rows] = await db.query(
        `SELECT id, name, email, role, is_active FROM users WHERE email = ? LIMIT 1`,
        [email]
    );
    return safeArray(rows)[0] || null;
}

/**
 * POST /auth/webauthn/register/options
 * Authenticated — start passkey registration.
 */
const registerOptions = async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ success: false, message: "Authentication required" });
        }

        const user = await loadUserById(userId);
        if (!user || user.is_active === 0) {
            return res.status(403).json({ success: false, message: "Account unavailable" });
        }

        const { rpID, rpName } = getRpConfig();
        const existing = await credentialService.listByUserId(userId);
        const excludeCredentials = existing.map((c) => ({
            id: c.credentialID,
            transports: c.transports
        }));

        const options = await generateRegistrationOptions({
            rpName,
            rpID,
            userName: user.email,
            userDisplayName: user.name || user.email,
            userID: new TextEncoder().encode(String(user.id)),
            attestationType: "none",
            excludeCredentials,
            authenticatorSelection: {
                residentKey: "preferred",
                userVerification: "preferred"
            }
        });

        await challengeStore.storeChallenge("registration", userId, {
            challenge: options.challenge
        });

        return res.status(200).json({
            success: true,
            message: "Registration options ready",
            options
        });
    } catch (error) {
        console.error("WEBAUTHN REGISTER OPTIONS ERROR:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to start passkey registration"
        });
    }
};

/**
 * POST /auth/webauthn/register/verify
 * Body: { response, deviceName? }
 */
const registerVerify = async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ success: false, message: "Authentication required" });
        }

        const attestation = req.body?.response || req.body?.credential || req.body;
        if (!attestation?.id || !attestation?.response) {
            return res.status(400).json({
                success: false,
                message: "WebAuthn registration response required"
            });
        }

        const stored = await challengeStore.loadChallenge("registration", userId);
        if (!stored?.challenge) {
            return res.status(400).json({
                success: false,
                message: "Registration challenge expired or missing"
            });
        }

        const { rpID, origins } = getRpConfig();
        const verification = await verifyRegistrationResponse({
            response: attestation,
            expectedChallenge: stored.challenge,
            expectedOrigin: origins,
            expectedRPID: rpID,
            requireUserVerification: false
        });

        await challengeStore.consumeChallenge("registration", userId);

        if (!verification.verified || !verification.registrationInfo) {
            return res.status(400).json({
                success: false,
                message: "Passkey registration verification failed"
            });
        }

        const { credential, credentialDeviceType, credentialBackedUp, aaguid } =
            verification.registrationInfo;

        const deviceName =
            sanitizeString(req.body?.deviceName) ||
            sanitizeString(req.body?.label) ||
            "Passkey";

        const created = await credentialService.createCredential({
            userId,
            credentialId: credential.id,
            publicKey: credential.publicKey,
            counter: credential.counter,
            deviceName,
            transports: credential.transports || attestation.response?.transports,
            backedUp: credentialBackedUp,
            deviceType: credentialDeviceType,
            aaguid
        });

        return res.status(201).json({
            success: true,
            message: "Passkey registered",
            credential: credentialService.toPublicListItem(created)
        });
    } catch (error) {
        console.error("WEBAUTHN REGISTER VERIFY ERROR:", error);
        if (error?.code === "ER_DUP_ENTRY") {
            return res.status(409).json({
                success: false,
                message: "This passkey is already registered"
            });
        }
        return res.status(500).json({
            success: false,
            message: error?.message || "Failed to verify passkey registration"
        });
    }
};

/**
 * POST /auth/webauthn/login/options
 * Body: { email }
 */
const loginOptions = async (req, res) => {
    try {
        const email = sanitizeString(req.body?.email || "").toLowerCase();
        if (!email) {
            return res.status(400).json({ success: false, message: "Email is required" });
        }

        const user = await loadUserByEmail(email);
        // Do not leak whether the account exists — return empty allowCredentials
        // when unknown, but still require a real challenge for known users.
        const { rpID } = getRpConfig();
        let allowCredentials = [];

        if (user && user.is_active !== 0) {
            const creds = await credentialService.listByUserId(user.id);
            allowCredentials = creds.map((c) => ({
                id: c.credentialID,
                transports: c.transports
            }));
        }

        const options = await generateAuthenticationOptions({
            rpID,
            allowCredentials,
            userVerification: "preferred"
        });

        const subject = user?.id || `anon:${email}`;
        await challengeStore.storeChallenge("authentication", subject, {
            challenge: options.challenge,
            email,
            userId: user?.id || null
        });

        return res.status(200).json({
            success: true,
            message: "Authentication options ready",
            options,
            challengeSubject: subject
        });
    } catch (error) {
        console.error("WEBAUTHN LOGIN OPTIONS ERROR:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to start passkey login"
        });
    }
};

/**
 * POST /auth/webauthn/login/verify
 * Body: { email, response, challengeSubject? }
 */
const loginVerify = async (req, res) => {
    try {
        const email = sanitizeString(req.body?.email || "").toLowerCase();
        const assertion = req.body?.response || req.body?.credential;
        if (!email || !assertion?.id) {
            return res.status(400).json({
                success: false,
                message: "Email and WebAuthn assertion required"
            });
        }

        const user = await loadUserByEmail(email);
        if (!user || user.is_active === 0) {
            return res.status(401).json({ success: false, message: "Invalid credentials" });
        }

        const subject =
            sanitizeString(req.body?.challengeSubject) || user.id;
        const stored = await challengeStore.loadChallenge("authentication", subject);
        if (!stored?.challenge) {
            return res.status(400).json({
                success: false,
                message: "Login challenge expired or missing"
            });
        }

        const cred = await credentialService.findByCredentialId(assertion.id);
        if (!cred || cred.userId !== user.id) {
            return res.status(401).json({ success: false, message: "Invalid credentials" });
        }

        const { rpID, origins } = getRpConfig();
        const verification = await verifyAuthenticationResponse({
            response: assertion,
            expectedChallenge: stored.challenge,
            expectedOrigin: origins,
            expectedRPID: rpID,
            credential: {
                id: cred.credentialID,
                publicKey: cred.publicKey,
                counter: cred.counter,
                transports: cred.transports
            },
            requireUserVerification: false
        });

        await challengeStore.consumeChallenge("authentication", subject);
        // Also clear anon subject if used
        if (subject !== user.id) {
            await challengeStore.consumeChallenge("authentication", user.id);
        }

        if (!verification.verified) {
            return res.status(401).json({
                success: false,
                message: "Passkey authentication failed"
            });
        }

        const newCounter = verification.authenticationInfo?.newCounter;
        if (typeof newCounter === "number") {
            await credentialService.updateCounter(cred.credentialID, newCounter);
        }

        return issueSessionForUser(req, res, user, "Passkey login successful");
    } catch (error) {
        console.error("WEBAUTHN LOGIN VERIFY ERROR:", error);
        return res.status(500).json({
            success: false,
            message: error?.message || "Failed to verify passkey login"
        });
    }
};

/**
 * GET /auth/webauthn/credentials
 */
const listCredentials = async (req, res) => {
    try {
        const userId = req.user?.id;
        const creds = await credentialService.listByUserId(userId);
        return res.status(200).json({
            success: true,
            message: "Passkeys loaded",
            credentials: creds.map(credentialService.toPublicListItem)
        });
    } catch (error) {
        console.error("WEBAUTHN LIST ERROR:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to list passkeys"
        });
    }
};

/**
 * PATCH /auth/webauthn/credentials/:id
 * Body: { deviceName }
 */
const renameCredential = async (req, res) => {
    try {
        const userId = req.user?.id;
        const id = sanitizeString(req.params?.id);
        const deviceName = sanitizeString(req.body?.deviceName || req.body?.label);
        if (!id || !deviceName) {
            return res.status(400).json({
                success: false,
                message: "Credential id and device name required"
            });
        }
        const ok = await credentialService.renameCredential(userId, id, deviceName);
        if (!ok) {
            return res.status(404).json({ success: false, message: "Passkey not found" });
        }
        return res.status(200).json({
            success: true,
            message: "Passkey renamed",
            deviceName
        });
    } catch (error) {
        console.error("WEBAUTHN RENAME ERROR:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to rename passkey"
        });
    }
};

/**
 * DELETE /auth/webauthn/credentials/:id
 */
const deleteCredential = async (req, res) => {
    try {
        const userId = req.user?.id;
        const id = sanitizeString(req.params?.id);
        if (!id) {
            return res.status(400).json({ success: false, message: "Credential id required" });
        }
        const ok = await credentialService.deleteCredential(userId, id);
        if (!ok) {
            return res.status(404).json({ success: false, message: "Passkey not found" });
        }
        return res.status(200).json({
            success: true,
            message: "Passkey removed"
        });
    } catch (error) {
        console.error("WEBAUTHN DELETE ERROR:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to remove passkey"
        });
    }
};

module.exports = {
    registerOptions,
    registerVerify,
    loginOptions,
    loginVerify,
    listCredentials,
    renameCredential,
    deleteCredential,
    getRpConfig
};
