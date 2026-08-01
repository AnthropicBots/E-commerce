/**
 * Bot-resistant checkout challenge gate (#1396).
 *
 * When the request risk score is elevated (or payment method is COD under
 * medium+ risk), require a verified Proof-of-Work solution or Private Access
 * Token bound to the checkout idempotency key before order creation.
 *
 * Low-risk shoppers take the grace path (no challenge).
 *
 * Client headers / body:
 *   Idempotency-Key | X-Idempotency-Key | body.idempotencyKey
 *   X-Checkout-Challenge-Id + X-Checkout-Challenge-Nonce
 *   X-Private-Access-Token | body.privateAccessToken | body.captchaToken
 */

"use strict";

const powChallengeService = require("../services/powChallengeService");
const { sanitizeString } = require("../utils/helpers");

const RISK_CHALLENGE_THRESHOLD = Math.max(
    0,
    parseInt(process.env.CHECKOUT_CHALLENGE_RISK_SCORE, 10) || 50
);

function readIdempotencyKey(req) {
    return (
        sanitizeString(
            req.get("Idempotency-Key") ||
            req.get("X-Idempotency-Key") ||
            req.body?.idempotencyKey ||
            ""
        ) || null
    );
}

function readChallengeProof(req) {
    return {
        challengeId: sanitizeString(
            req.get("X-Checkout-Challenge-Id") ||
            req.body?.challengeId ||
            ""
        ) || null,
        nonce: sanitizeString(
            req.get("X-Checkout-Challenge-Nonce") ||
            req.body?.challengeNonce ||
            req.body?.nonce ||
            ""
        ),
        pat:
            sanitizeString(
                req.get("X-Private-Access-Token") ||
                req.body?.privateAccessToken ||
                req.body?.captchaToken ||
                ""
            ) || null
    };
}

function scoreFromRequest(req) {
    if (req.risk && typeof req.risk.score === "number") {
        return {
            score: req.risk.score,
            level: req.risk.level || "low"
        };
    }

    // Lightweight fallback when global risk middleware did not run:
    // COD + missing/odd UA bumps score so scripted COD abuse still hits the gate.
    let score = 0;
    let level = "low";
    const payment = String(req.body?.paymentMethod || "").toLowerCase();
    const ua = String(req.get("user-agent") || "");

    if (payment === "cod") score += 35;
    if (!ua || /curl|wget|python-requests|scrapy|bot/i.test(ua)) score += 40;
    if (req.body?.items && Array.isArray(req.body.items) && req.body.items.length > 20) {
        score += 20;
    }

    if (score >= 75) level = "high";
    else if (score >= 50) level = "medium";
    else if (score >= 20) level = "low";

    return { score, level };
}

function needsChallenge(risk, req) {
    if (process.env.CHECKOUT_CHALLENGE_ENABLED === "false") {
        return false;
    }
    if (risk.score >= RISK_CHALLENGE_THRESHOLD) return true;
    if (risk.level === "high" || risk.level === "critical") return true;

    const payment = String(req.body?.paymentMethod || "").toLowerCase();
    // Fake COD is the primary abuse vector called out in #1396.
    if (payment === "cod" && risk.score >= 35) return true;

    return false;
}

/**
 * Express middleware — place after authMiddleware on order-create paths.
 */
async function checkoutChallengeMiddleware(req, res, next) {
    try {
        const risk = scoreFromRequest(req);
        req.checkoutRisk = risk;

        if (!needsChallenge(risk, req)) {
            req.checkoutChallenge = { required: false, grace: true };
            return next();
        }

        const idempotencyKey = readIdempotencyKey(req);
        const proof = readChallengeProof(req);

        if (!idempotencyKey) {
            return res.status(403).json({
                success: false,
                code: "CHALLENGE_REQUIRED",
                message:
                    "Elevated risk detected. Provide an Idempotency-Key and complete the checkout challenge.",
                requiresChallenge: true,
                riskScore: risk.score,
                riskLevel: risk.level
            });
        }

        // Already verified for this checkout attempt → grace through.
        if (await powChallengeService.isIdempotencyVerified(idempotencyKey)) {
            req.checkoutChallenge = {
                required: true,
                verified: true,
                idempotencyKey
            };
            return next();
        }

        // Private Access Token / CAPTCHA hook
        if (proof.pat) {
            const pat = await powChallengeService.verifyPrivateAccessToken({
                token: proof.pat,
                idempotencyKey,
                userId: req.user?.id || null
            });
            if (pat.ok) {
                req.checkoutChallenge = {
                    required: true,
                    verified: true,
                    method: pat.method,
                    idempotencyKey
                };
                return next();
            }
        }

        // PoW proof on the request
        if (proof.challengeId && proof.nonce !== "") {
            try {
                await powChallengeService.verifyChallenge({
                    challengeId: proof.challengeId,
                    nonce: proof.nonce,
                    idempotencyKey,
                    userId: req.user?.id || null
                });
                req.checkoutChallenge = {
                    required: true,
                    verified: true,
                    method: "pow",
                    idempotencyKey
                };
                return next();
            } catch (err) {
                return res.status(err.status || 400).json({
                    success: false,
                    code: err.code || "CHALLENGE_FAILED",
                    message: err.message || "Checkout challenge failed",
                    requiresChallenge: true
                });
            }
        }

        // Issue a fresh challenge bound to this idempotency key.
        const challenge = await powChallengeService.issueChallenge({
            idempotencyKey,
            userId: req.user?.id || null,
            riskScore: risk.score,
            riskLevel: risk.level
        });

        return res.status(403).json({
            success: false,
            code: "CHALLENGE_REQUIRED",
            message:
                "Complete the bot-resistance challenge before placing this order.",
            requiresChallenge: true,
            riskScore: risk.score,
            riskLevel: risk.level,
            challenge
        });
    } catch (error) {
        console.error("checkoutChallengeMiddleware error:", error);
        // Fail open for unexpected infra errors so checkout is not bricked,
        // but flag the request for monitoring.
        req.checkoutChallenge = {
            required: false,
            grace: true,
            error: error.message
        };
        return next();
    }
}

module.exports = {
    checkoutChallengeMiddleware,
    needsChallenge,
    scoreFromRequest,
    readIdempotencyKey,
    RISK_CHALLENGE_THRESHOLD
};
