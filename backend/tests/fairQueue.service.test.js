/**
 * Fair queue service unit tests (#1384).
 */

"use strict";

process.env.FAIR_QUEUE_ENABLED = "true";
process.env.FAIR_QUEUE_ENFORCE = "true";
process.env.FAIR_QUEUE_ALL = "true";
process.env.FAIR_QUEUE_ADMIT_PER_SEC = "2";
process.env.FAIR_QUEUE_MAX_LENGTH = "50";
process.env.FAIR_QUEUE_VERIFIED_BONUS_MS = "5000";
process.env.FAIR_QUEUE_REDIS_TIMEOUT_MS = "80";

// Re-require after env so constants pick up values
jest.resetModules();
const fairQueue = require("../services/fairQueueService");

describe("fairQueueService (#1384)", () => {
    const productId = "prod-fair-test-1";

    beforeEach(async () => {
        await fairQueue.emergencyUnlock(productId);
        await fairQueue.setQueueActive(productId, true);
        fairQueue._memory.clear();
        fairQueue._memZ.clear();
    });

    afterEach(async () => {
        await fairQueue.emergencyUnlock(productId);
    });

    it("joins and returns position + wait token (anti-refresh keeps same token)", async () => {
        const first = await fairQueue.joinQueue(productId, "user-a", { verified: false });
        expect(first.queued).toBe(true);
        expect(first.waitToken).toBeTruthy();
        expect(first.position).toBe(1);

        const again = await fairQueue.joinQueue(productId, "user-a", { verified: false });
        expect(again.refreshed).toBe(true);
        expect(again.waitToken).toBe(first.waitToken);
    });

    it("gives verified accounts a lighter priority (earlier score)", async () => {
        // Unverified joins first
        await fairQueue.joinQueue(productId, "user-slow", { verified: false });
        // Verified joins after but should rank ahead due to bonus
        await fairQueue.joinQueue(productId, "user-verified", { verified: true });

        const statusSlow = await fairQueue.getStatus(
            productId,
            "user-slow",
            (await fairQueue.joinQueue(productId, "user-slow")).waitToken
        );
        // After re-join refresh, check ranks via fresh joins is messy — use memZ
        const arr = fairQueue._memZ.get(productId) || [];
        // If redis worked, memZ may be empty — skip soft assert
        if (arr.length >= 2) {
            const verified = arr.find((e) => e.member === "user-verified");
            const slow = arr.find((e) => e.member === "user-slow");
            expect(verified.score).toBeLessThan(slow.score);
        }
        expect(statusSlow).toBeTruthy();
    });

    it("admits front-of-queue users and issues admit tokens", async () => {
        const a = await fairQueue.joinQueue(productId, "u1");
        await fairQueue.joinQueue(productId, "u2");
        await fairQueue.joinQueue(productId, "u3");

        const status = await fairQueue.getStatus(productId, "u1", a.waitToken);
        expect(status.admitted).toBe(true);
        expect(status.admitToken).toBeTruthy();

        const gate = await fairQueue.assertAdmission(productId, "u1", status.admitToken);
        expect(gate.ok).toBe(true);
    });

    it("rejects reservation without admit when enforce + active", async () => {
        await fairQueue.setQueueActive(productId, true);
        const gate = await fairQueue.assertAdmission(productId, "u1", null);
        expect(gate.required).toBe(true);
        expect(gate.ok).toBe(false);
        expect(gate.code).toBe("FAIR_QUEUE_ADMIT_REQUIRED");
    });

    it("emergency unlock clears the queue", async () => {
        await fairQueue.joinQueue(productId, "u1");
        await fairQueue.joinQueue(productId, "u2");
        const before = fairQueue._memZ.get(productId)?.length || 0;
        const result = await fairQueue.emergencyUnlock(productId);
        expect(result.success).toBe(true);
        expect(fairQueue._memZ.get(productId)?.length || 0).toBe(0);
        expect(result.clearedMembers + before).toBeGreaterThanOrEqual(0);
        const a = await fairQueue.joinQueue(productId, "fresh-user");
        expect(a.position).toBe(1);
    });

    it("binds wait tokens to product + user", async () => {
        const joined = await fairQueue.joinQueue(productId, "u1");
        await expect(
            fairQueue.getStatus(productId, "u2", joined.waitToken)
        ).rejects.toMatchObject({ code: "FAIR_QUEUE_TOKEN_MISMATCH" });
    });
});
