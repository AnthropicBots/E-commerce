/**
 * WebAuthn challenge store unit tests (#1385).
 * Avoids loading webauthnController (pulls JWT/db) so coverage stays focused.
 */

"use strict";

const challengeStore = require("../services/webauthnChallengeService");

describe("webauthnChallengeService (#1385)", () => {
    const type = "registration";
    const subject = "user-test-uuid";

    afterEach(async () => {
        await challengeStore.consumeChallenge(type, subject);
        await challengeStore.consumeChallenge("authentication", subject);
    });

    it("stores and loads a challenge with TTL metadata", async () => {
        await challengeStore.storeChallenge(type, subject, {
            challenge: "abc123challenge"
        });
        const loaded = await challengeStore.loadChallenge(type, subject);
        expect(loaded).toBeTruthy();
        expect(loaded.challenge).toBe("abc123challenge");
        expect(loaded.type).toBe(type);
        expect(loaded.subject).toBe(subject);
    });

    it("consumes a challenge so it cannot be reused", async () => {
        await challengeStore.storeChallenge(type, subject, {
            challenge: "once-only"
        });
        await challengeStore.consumeChallenge(type, subject);
        const loaded = await challengeStore.loadChallenge(type, subject);
        expect(loaded).toBeNull();
    });

    it("isolates registration vs authentication challenges", async () => {
        await challengeStore.storeChallenge("registration", subject, {
            challenge: "reg"
        });
        await challengeStore.storeChallenge("authentication", subject, {
            challenge: "auth"
        });
        expect((await challengeStore.loadChallenge("registration", subject)).challenge).toBe(
            "reg"
        );
        expect(
            (await challengeStore.loadChallenge("authentication", subject)).challenge
        ).toBe("auth");
    });

    it("builds typed challenge keys", () => {
        expect(challengeStore.makeChallengeKey("registration", "u1")).toBe(
            "registration:u1"
        );
    });
});
