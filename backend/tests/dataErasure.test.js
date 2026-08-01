/**
 * GDPR / DPDP erasure workflow tests (#1397).
 */

jest.mock("../config/db", () => {
    const query = jest.fn();
    const withTransaction = jest.fn();
    return {
        query,
        withTransaction,
        getConnection: jest.fn()
    };
});

jest.mock("../services/refreshTokenService", () => ({
    revokeAllUserFamilies: jest.fn(async () => ({ revokedFamilies: 1 }))
}));

beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
});

afterEach(() => {
    jest.resetModules();
});

function mockConnectionResponder() {
    const calls = [];
    const query = jest.fn(async (sql, params = []) => {
        calls.push({ sql, params });

        if (/SELECT stages_json FROM erasure_requests/i.test(sql)) {
            return [[{ stages_json: "[]" }]];
        }
        if (/UPDATE erasure_requests SET/i.test(sql)) {
            return [{ affectedRows: 1 }];
        }
        if (/UPDATE users SET/i.test(sql)) {
            return [{ affectedRows: 1 }];
        }
        if (/UPDATE orders SET/i.test(sql)) {
            return [{ affectedRows: 2 }];
        }
        if (/DELETE FROM refresh_tokens/i.test(sql)) {
            return [{ affectedRows: 3 }];
        }
        if (/DELETE FROM auth_sessions/i.test(sql)) {
            return [{ affectedRows: 1 }];
        }
        if (/DELETE FROM cart_items/i.test(sql)) {
            return [{ affectedRows: 4 }];
        }
        if (/DELETE FROM wishlist_items/i.test(sql)) {
            return [{ affectedRows: 2 }];
        }
        if (/DELETE FROM inventory_locks/i.test(sql)) {
            return [{ affectedRows: 0 }];
        }
        if (/INSERT INTO erasure_receipts/i.test(sql)) {
            return [{ affectedRows: 1 }];
        }
        return [{ affectedRows: 1 }];
    });
    return { query, calls };
}

describe("dataErasureService.requestErasure", () => {
    test("creates pending request and returns confirmation token when SMTP is off", async () => {
        const db = require("../config/db");
        db.query
            .mockResolvedValueOnce([[{
                id: "user-1",
                email: "shopper@example.com",
                name: "Shopper",
                role: "customer",
                is_active: 1,
                deleted_at: null
            }]])
            .mockResolvedValueOnce([[]])
            .mockResolvedValueOnce([{ affectedRows: 1 }]);

        const service = require("../services/dataErasureService");
        const result = await service.requestErasure("user-1", {
            reason: "Please delete my data",
            ip: "127.0.0.1"
        });

        expect(result.requestId).toBeTruthy();
        expect(result.status).toBe("pending_confirmation");
        expect(result.emailDelivered).toBe(false);
        expect(result.confirmationToken).toMatch(/^[a-f0-9]{64}$/);
        expect(db.query).toHaveBeenCalledWith(
            expect.stringMatching(/INSERT INTO erasure_requests/i),
            expect.any(Array)
        );
    });

    test("rejects admin self-erasure", async () => {
        const db = require("../config/db");
        db.query.mockResolvedValueOnce([[{
            id: "admin-1",
            email: "admin@example.com",
            name: "Admin",
            role: "admin",
            is_active: 1,
            deleted_at: null
        }]]);

        const service = require("../services/dataErasureService");
        await expect(service.requestErasure("admin-1")).rejects.toMatchObject({
            code: "ADMIN_ERASURE_FORBIDDEN",
            status: 403
        });
    });
});

describe("dataErasureService.confirmErasure", () => {
    test("soft-deletes, anonymizes orders, purges tokens/carts, issues receipt", async () => {
        const db = require("../config/db");
        const refresh = require("../services/refreshTokenService");
        const service = require("../services/dataErasureService");

        const token = "a".repeat(64);
        const tokenHash = service._internal.sha256(token);

        db.query.mockResolvedValueOnce([[{
            id: "req-1",
            user_id: "user-1",
            status: "pending_confirmation",
            confirmation_token_hash: tokenHash,
            confirmation_expires_at: new Date(Date.now() + 60_000),
            stages_json: "[]"
        }]]);

        const { query: connQuery, calls } = mockConnectionResponder();
        db.withTransaction.mockImplementation(async (fn) => fn({ query: connQuery }));

        const result = await service.confirmErasure(token, { requestId: "req-1" });

        expect(result.success).toBe(true);
        expect(result.receiptId).toMatch(/^ER-\d{8}-[A-F0-9]+$/);
        expect(result.status).toBe("completed");
        expect(result.summary.ordersAnonymized).toBe(2);
        expect(result.summary.refreshTokensPurged).toBe(3);
        expect(result.summary.cartItemsPurged).toBe(4);

        expect(calls.some(({ sql }) => /UPDATE users SET\s+is_active = 0/i.test(sql))).toBe(true);
        expect(calls.some(({ sql }) => /UPDATE orders SET/i.test(sql) && /customer_email/i.test(sql))).toBe(true);
        expect(calls.some(({ sql, params }) =>
            /DELETE FROM refresh_tokens WHERE user_id/i.test(sql) && params[0] === "user-1"
        )).toBe(true);
        expect(calls.some(({ sql }) => /INSERT INTO erasure_receipts/i.test(sql))).toBe(true);

        expect(refresh.revokeAllUserFamilies).toHaveBeenCalledWith("user-1", "gdpr_erasure");
    });

    test("rejects expired confirmation tokens", async () => {
        const db = require("../config/db");
        const service = require("../services/dataErasureService");
        const token = "b".repeat(64);

        db.query
            .mockResolvedValueOnce([[{
                id: "req-expired",
                user_id: "user-1",
                status: "pending_confirmation",
                confirmation_token_hash: service._internal.sha256(token),
                confirmation_expires_at: new Date(Date.now() - 1000)
            }]])
            .mockResolvedValueOnce([{ affectedRows: 1 }]);

        await expect(service.confirmErasure(token)).rejects.toMatchObject({
            code: "TOKEN_EXPIRED",
            status: 410
        });
    });
});

describe("admin list + receipt verify", () => {
    test("listErasureRequests returns paginated tracker rows", async () => {
        const db = require("../config/db");
        db.query
            .mockResolvedValueOnce([[{ total: 1 }]])
            .mockResolvedValueOnce([[{
                id: "req-1",
                user_id: "user-1",
                status: "completed",
                receipt_id: "ER-20260101-ABCD",
                reason: null,
                error_message: null,
                confirmed_at: new Date(),
                completed_at: new Date(),
                created_at: new Date(),
                updated_at: new Date()
            }]]);

        const service = require("../services/dataErasureService");
        const result = await service.listErasureRequests({ page: 1, limit: 10 });
        expect(result.total).toBe(1);
        expect(result.requests[0].receiptId).toBe("ER-20260101-ABCD");
    });

    test("verifyReceipt returns non-PII summary", async () => {
        const db = require("../config/db");
        db.query.mockResolvedValueOnce([[{
            receipt_id: "ER-20260101-ABCD",
            erasure_request_id: "req-1",
            summary_json: JSON.stringify({
                framework: ["GDPR", "DPDP"],
                ordersAnonymized: 2,
                completedAt: "2026-01-01T00:00:00.000Z"
            }),
            issued_at: new Date("2026-01-01T00:00:00.000Z")
        }]]);

        const service = require("../services/dataErasureService");
        const receipt = await service.verifyReceipt("ER-20260101-ABCD");
        expect(receipt.valid).toBe(true);
        expect(receipt.ordersAnonymized).toBe(2);
        expect(receipt.framework).toEqual(["GDPR", "DPDP"]);
    });
});

describe("anonymization helpers", () => {
    test("anonymized email is unique per receipt and non-deliverable", () => {
        const service = require("../services/dataErasureService");
        const email = service._internal.anonymizedEmail("ER-20260101-FFFF");
        expect(email).toBe("erased+er-20260101-ffff@erased.invalid");
    });
});
