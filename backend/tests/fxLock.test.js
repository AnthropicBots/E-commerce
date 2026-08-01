/**
 * Mid-session FX lock (#1392) — signed rate tokens, TTL expiry, capture audit.
 */

process.env.FX_LOCK_SECRET = "test-fx-lock-secret";
process.env.FX_LOCK_TTL_SEC = "900";
delete process.env.FX_PROVIDER_URL;

const fxLockService = require("../services/fxLockService");
const CURRENCY = require("../config/currency");

describe("fxLockService (#1392)", () => {
    test("currency catalog exposes settlement INR and fallback rates", () => {
        expect(CURRENCY.code).toBe("INR");
        expect(CURRENCY.isSupportedCurrency("USD")).toBe(true);
        expect(CURRENCY.getFallbackRate("USD")).toBeGreaterThan(0);
        expect(CURRENCY.FALLBACK_RATES.INR).toBe(1);
    });

    test("createFxLock returns a signed token with TTL metadata", async () => {
        const { token, lock } = await fxLockService.createFxLock({
            displayCurrency: "USD",
            baseTotal: 1000
        });

        expect(typeof token).toBe("string");
        expect(token.includes(".")).toBe(true);
        expect(lock.displayCurrency).toBe("USD");
        expect(lock.baseCurrency).toBe("INR");
        expect(lock.rate).toBeGreaterThan(0);
        expect(lock.baseTotal).toBe(1000);
        expect(lock.displayTotal).toBeCloseTo(1000 * lock.rate, 4);
        expect(lock.ttlSec).toBeGreaterThanOrEqual(60);
    });

    test("validateFxLock accepts a fresh token", async () => {
        const { token, lock } = await fxLockService.createFxLock({
            displayCurrency: "EUR",
            baseTotal: 500
        });

        const payload = await fxLockService.validateFxLock(token, {
            displayCurrency: "EUR",
            baseTotal: 500
        });

        expect(payload.lockId).toBe(lock.lockId);
        expect(payload.rate).toBe(lock.rate);
    });

    test("validateFxLock rejects expired locks", async () => {
        const { token } = await fxLockService.createFxLock({
            displayCurrency: "GBP",
            baseTotal: 200
        });

        const payload = fxLockService.verifySignedToken(token);
        payload.expiresAt = new Date(Date.now() - 1000).toISOString();
        const expiredToken = fxLockService.signPayload(payload);

        await expect(
            fxLockService.validateFxLock(expiredToken, { displayCurrency: "GBP" })
        ).rejects.toMatchObject({ code: "FX_LOCK_EXPIRED", status: 409 });
    });

    test("validateFxLock rejects currency mismatch after switcher change", async () => {
        const { token } = await fxLockService.createFxLock({
            displayCurrency: "USD",
            baseTotal: 100
        });

        await expect(
            fxLockService.validateFxLock(token, { displayCurrency: "EUR" })
        ).rejects.toMatchObject({ code: "FX_LOCK_CURRENCY_MISMATCH", status: 409 });
    });

    test("validateFxLock rejects tampered tokens", async () => {
        const { token } = await fxLockService.createFxLock({
            displayCurrency: "USD",
            baseTotal: 50
        });
        const [body] = token.split(".");
        const tampered = `${body}.not-a-valid-signature`;

        await expect(fxLockService.validateFxLock(tampered)).rejects.toMatchObject({
            code: "FX_LOCK_TAMPERED"
        });
    });

    test("auditCapture records locked vs spot delta", async () => {
        const { token } = await fxLockService.createFxLock({
            displayCurrency: "USD",
            baseTotal: 2500
        });

        const audit = await fxLockService.auditCapture({
            fxLockToken: token,
            settlementTotal: 2500,
            orderId: "order-fx-test"
        });

        expect(audit.orderId).toBe("order-fx-test");
        expect(audit.lockedRate).toBeGreaterThan(0);
        expect(audit.spotRate).toBeGreaterThan(0);
        expect(typeof audit.rateDelta).toBe("number");
        expect(audit.settlementTotal).toBe(2500);
        expect(audit.displayTotalLocked).toBeCloseTo(2500 * audit.lockedRate, 4);
    });

    test("fetchProviderRates falls back when FX_PROVIDER_URL is unset", async () => {
        const bundle = await fxLockService.fetchProviderRates();
        expect(bundle.source).toBe("fallback");
        expect(bundle.base).toBe("INR");
        expect(bundle.rates.USD).toBe(CURRENCY.FALLBACK_RATES.USD);
    });
});
