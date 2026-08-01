/**
 * Mid-session FX rate lock for multi-currency checkout (#1392).
 *
 * Settlement (charge) currency is always the configured base (INR).
 * Display currency rates are locked into a signed token for a TTL so the
 * amount the shopper saw at quote time cannot silently drift before pay.
 */

"use strict";

const crypto = require("crypto");
const CURRENCY = require("../config/currency");
const {
    SETTLEMENT_CURRENCY,
    FALLBACK_RATES,
    SUPPORTED_CURRENCIES,
    isSupportedCurrency,
    getCurrencyMeta,
    getFallbackRate
} = CURRENCY;

const FX_LOCK_TTL_SEC = Math.max(
    60,
    parseInt(process.env.FX_LOCK_TTL_SEC, 10) || 15 * 60
);

const FX_LOCK_SECRET =
    process.env.FX_LOCK_SECRET ||
    process.env.JWT_SECRET ||
    "fx-lock-dev-secret";

/** In-memory audit of lock vs spot at capture (also returned to callers). */
const captureAuditLog = [];

class FxLockError extends Error {
    constructor(message, { status = 400, code = "FX_LOCK_ERROR" } = {}) {
        super(message);
        this.name = "FxLockError";
        this.status = status;
        this.code = code;
    }
}

/**
 * FX provider adapter — tries live fetch, falls back to configured rates.
 * Override via FX_PROVIDER_URL (JSON: { rates: { USD: 0.012, ... } } relative to INR).
 */
async function fetchProviderRates() {
    const url = process.env.FX_PROVIDER_URL;
    if (!url) {
        return {
            source: "fallback",
            base: SETTLEMENT_CURRENCY.code,
            rates: { ...FALLBACK_RATES },
            fetchedAt: new Date().toISOString()
        };
    }

    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 4000);
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timer);
        if (!res.ok) {
            throw new Error(`FX provider HTTP ${res.status}`);
        }
        const body = await res.json();
        const rates = body.rates || body;
        const normalized = { INR: 1 };
        for (const code of Object.keys(SUPPORTED_CURRENCIES)) {
            if (code === "INR") continue;
            const value = Number(rates[code]);
            if (Number.isFinite(value) && value > 0) {
                normalized[code] = value;
            } else {
                normalized[code] = FALLBACK_RATES[code];
            }
        }
        return {
            source: "provider",
            base: SETTLEMENT_CURRENCY.code,
            rates: normalized,
            fetchedAt: new Date().toISOString()
        };
    } catch (err) {
        console.warn("FX provider unavailable, using fallback rates:", err.message);
        return {
            source: "fallback",
            base: SETTLEMENT_CURRENCY.code,
            rates: { ...FALLBACK_RATES },
            fetchedAt: new Date().toISOString(),
            providerError: err.message
        };
    }
}

async function getSpotRate(displayCurrency) {
    const code = String(displayCurrency || SETTLEMENT_CURRENCY.code).toUpperCase();
    if (!isSupportedCurrency(code)) {
        throw new FxLockError(`Unsupported currency: ${code}`, {
            status: 400,
            code: "FX_CURRENCY_UNSUPPORTED"
        });
    }
    if (code === SETTLEMENT_CURRENCY.code) {
        return {
            displayCurrency: code,
            baseCurrency: SETTLEMENT_CURRENCY.code,
            rate: 1,
            source: "settlement",
            fetchedAt: new Date().toISOString()
        };
    }

    const bundle = await fetchProviderRates();
    const rate = bundle.rates[code] ?? getFallbackRate(code);
    if (!rate) {
        throw new FxLockError(`No rate for ${code}`, {
            status: 503,
            code: "FX_RATE_UNAVAILABLE"
        });
    }
    return {
        displayCurrency: code,
        baseCurrency: SETTLEMENT_CURRENCY.code,
        rate: Number(rate),
        source: bundle.source,
        fetchedAt: bundle.fetchedAt
    };
}

function signPayload(payload) {
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const sig = crypto
        .createHmac("sha256", FX_LOCK_SECRET)
        .update(body)
        .digest("base64url");
    return `${body}.${sig}`;
}

function verifySignedToken(token) {
    if (!token || typeof token !== "string" || !token.includes(".")) {
        throw new FxLockError("FX lock token is required", {
            status: 400,
            code: "FX_LOCK_MISSING"
        });
    }
    const [body, sig] = token.split(".");
    const expected = crypto
        .createHmac("sha256", FX_LOCK_SECRET)
        .update(body)
        .digest("base64url");
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        throw new FxLockError("FX lock token signature is invalid", {
            status: 400,
            code: "FX_LOCK_TAMPERED"
        });
    }
    try {
        return JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    } catch (_) {
        throw new FxLockError("FX lock token is malformed", {
            status: 400,
            code: "FX_LOCK_MALFORMED"
        });
    }
}

/**
 * Create a signed mid-session FX lock for checkout.
 *
 * @param {object} opts
 * @param {string} opts.displayCurrency
 * @param {number} [opts.baseTotal]  Basket total in settlement currency (INR)
 * @param {string} [opts.quoteId]
 */
async function createFxLock({
    displayCurrency,
    baseTotal = null,
    quoteId = null
} = {}) {
    const spot = await getSpotRate(displayCurrency);
    const now = Date.now();
    const expiresAt = now + FX_LOCK_TTL_SEC * 1000;
    const lockId = crypto.randomUUID();

    const payload = {
        v: 1,
        lockId,
        quoteId: quoteId || lockId,
        displayCurrency: spot.displayCurrency,
        baseCurrency: spot.baseCurrency,
        rate: spot.rate,
        source: spot.source,
        baseTotal:
            baseTotal === null || baseTotal === undefined
                ? null
                : Number(baseTotal),
        lockedAt: new Date(now).toISOString(),
        expiresAt: new Date(expiresAt).toISOString()
    };

    const token = signPayload(payload);
    const meta = getCurrencyMeta(spot.displayCurrency);

    return {
        token,
        lock: {
            ...payload,
            currency: meta,
            ttlSec: FX_LOCK_TTL_SEC,
            displayTotal:
                payload.baseTotal !== null
                    ? roundMoney(payload.baseTotal * payload.rate, meta.minorUnitExponent)
                    : null
        }
    };
}

function roundMoney(amount, exponent = 2) {
    const factor = 10 ** exponent;
    return Math.round((Number(amount) || 0) * factor) / factor;
}

/**
 * Validate a lock token for checkout. Rejects expired / tampered / currency mismatch.
 * Optionally compares claimed base total within tolerance.
 */
async function validateFxLock(token, {
    displayCurrency = null,
    baseTotal = null,
    tolerance = 0.05
} = {}) {
    const payload = verifySignedToken(token);

    if (payload.v !== 1) {
        throw new FxLockError("Unsupported FX lock version", {
            status: 400,
            code: "FX_LOCK_VERSION"
        });
    }

    if (new Date(payload.expiresAt).getTime() <= Date.now()) {
        throw new FxLockError(
            "FX rate lock has expired. Please refresh checkout to lock a new rate.",
            { status: 409, code: "FX_LOCK_EXPIRED" }
        );
    }

    if (
        displayCurrency &&
        String(displayCurrency).toUpperCase() !== payload.displayCurrency
    ) {
        throw new FxLockError("Currency switcher changed after the FX lock was issued", {
            status: 409,
            code: "FX_LOCK_CURRENCY_MISMATCH"
        });
    }

    if (
        baseTotal !== null &&
        baseTotal !== undefined &&
        payload.baseTotal !== null &&
        payload.baseTotal !== undefined
    ) {
        const delta = Math.abs(Number(baseTotal) - Number(payload.baseTotal));
        if (delta > tolerance) {
            throw new FxLockError("Basket total no longer matches the FX-locked quote", {
                status: 409,
                code: "FX_LOCK_TOTAL_MISMATCH"
            });
        }
    }

    return payload;
}

/**
 * At payment capture: compare locked rate to current spot and record audit.
 * Settlement amount is always in base currency (INR).
 */
async function auditCapture({
    fxLockToken,
    settlementTotal,
    orderId = null
} = {}) {
    const locked = await validateFxLock(fxLockToken);
    const spot = await getSpotRate(locked.displayCurrency);

    const entry = {
        id: crypto.randomUUID(),
        orderId,
        lockId: locked.lockId,
        displayCurrency: locked.displayCurrency,
        baseCurrency: locked.baseCurrency,
        lockedRate: locked.rate,
        spotRate: spot.rate,
        rateDelta: Number((spot.rate - locked.rate).toFixed(8)),
        settlementTotal: Number(settlementTotal),
        displayTotalLocked: roundMoney(
            Number(settlementTotal) * locked.rate,
            getCurrencyMeta(locked.displayCurrency).minorUnitExponent
        ),
        displayTotalSpot: roundMoney(
            Number(settlementTotal) * spot.rate,
            getCurrencyMeta(locked.displayCurrency).minorUnitExponent
        ),
        capturedAt: new Date().toISOString(),
        lockSource: locked.source,
        spotSource: spot.source
    };

    captureAuditLog.push(entry);
    if (captureAuditLog.length > 500) {
        captureAuditLog.shift();
    }

    return entry;
}

function listRecentCaptureAudits(limit = 20) {
    return captureAuditLog.slice(-limit).reverse();
}

/** Convert settlement (INR) amount to display using a locked or spot rate. */
function toDisplayAmount(baseAmount, rate, displayCurrency) {
    const meta = getCurrencyMeta(displayCurrency);
    return roundMoney(Number(baseAmount) * Number(rate), meta.minorUnitExponent);
}

module.exports = {
    FX_LOCK_TTL_SEC,
    FxLockError,
    fetchProviderRates,
    getSpotRate,
    createFxLock,
    validateFxLock,
    auditCapture,
    listRecentCaptureAudits,
    toDisplayAmount,
    signPayload,
    verifySignedToken,
    // test seam
    _captureAuditLog: captureAuditLog
};
