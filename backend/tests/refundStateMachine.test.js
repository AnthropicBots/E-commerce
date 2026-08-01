/**
 * RMA / refund state machine unit tests (#1389).
 */

const {
    RMA_STATUS,
    REASON_CODES,
    canTransition,
    assertTransition,
    isReturnWindowExpired,
    assertPolicyWindow,
    evaluateFraudVelocity,
    isValidReasonCode,
    trackingTimeline,
    addressFingerprint,
    RmaError,
    POLICY
} = require("../services/refundStateMachine");

describe("refundStateMachine (#1389)", () => {
    test("allows the happy-path FSM transitions", () => {
        expect(canTransition("requested", "approved")).toBe(true);
        expect(canTransition("pending", "approved")).toBe(true);
        expect(canTransition("approved", "in_transit")).toBe(true);
        expect(canTransition("in_transit", "received")).toBe(true);
        expect(canTransition("received", "refunded")).toBe(true);
    });

    test("rejects illegal transitions", () => {
        expect(canTransition("requested", "refunded")).toBe(false);
        expect(canTransition("refunded", "approved")).toBe(false);
        expect(() => assertTransition("requested", "in_transit")).toThrow(
            RmaError
        );
        try {
            assertTransition("refunded", "requested");
        } catch (err) {
            expect(err.code).toBe("RMA_INVALID_TRANSITION");
            expect(err.status).toBe(409);
        }
    });

    test("enforces policy window from delivered_at", () => {
        const fresh = {
            status: "delivered",
            delivered_at: new Date().toISOString()
        };
        expect(() => assertPolicyWindow(fresh)).not.toThrow();

        const old = {
            status: "delivered",
            delivered_at: new Date(
                Date.now() - (POLICY.returnWindowDays + 2) * 86400000
            ).toISOString()
        };
        expect(isReturnWindowExpired(old)).toBe(true);
        expect(() => assertPolicyWindow(old)).toThrow(/window/i);

        expect(() =>
            assertPolicyWindow({ status: "processing", delivered_at: new Date() })
        ).toThrow(/delivered/i);
    });

    test("validates reason codes", () => {
        expect(isValidReasonCode(REASON_CODES.DEFECTIVE)).toBe(true);
        expect(isValidReasonCode("nope")).toBe(false);
    });

    test("fraud velocity blocks high scores", () => {
        const soft = evaluateFraudVelocity({
            userRequestCount24h: 1,
            addressRequestCount7d: 1,
            paymentRequestCount7d: 0,
            openRequestsForUser: 1,
            priorRefundsSameProduct30d: 0
        });
        expect(soft.blocked).toBe(false);

        const hard = evaluateFraudVelocity({
            userRequestCount24h: POLICY.maxRequestsPerUser24h,
            addressRequestCount7d: POLICY.maxRequestsPerAddress7d,
            paymentRequestCount7d: POLICY.maxRequestsPerPayment7d,
            openRequestsForUser: 5,
            priorRefundsSameProduct30d: 3
        });
        expect(hard.blocked).toBe(true);
        expect(hard.score).toBeGreaterThanOrEqual(POLICY.fraudBlockScore);
        expect(hard.flags.length).toBeGreaterThan(0);
    });

    test("trackingTimeline marks current step", () => {
        const tl = trackingTimeline(RMA_STATUS.IN_TRANSIT);
        expect(tl.current).toBe("in_transit");
        expect(tl.steps.find((s) => s.status === "approved").state).toBe("done");
        expect(tl.steps.find((s) => s.status === "in_transit").state).toBe(
            "current"
        );
        expect(tl.steps.find((s) => s.status === "refunded").state).toBe(
            "pending"
        );
    });

    test("addressFingerprint is stable", () => {
        const a = addressFingerprint({
            fullAddress: "12 Main St",
            city: "Pune",
            state: "MH",
            zip: "411001"
        });
        const b = addressFingerprint({
            fullAddress: "12 Main St",
            city: "Pune",
            state: "MH",
            zip: "411001"
        });
        expect(a).toBe(b);
        expect(a).toHaveLength(32);
    });
});
