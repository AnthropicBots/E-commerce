/**
 * Admin impersonation (#1393) unit tests.
 */

jest.mock("../config/db", () => ({
    query: jest.fn()
}));

const jwt = require("jsonwebtoken");
const db = require("../config/db");
const impersonationService = require("../services/impersonationService");
const { impersonationMiddleware } = require("../middleware/impersonationMiddleware");

const SECRET = "test_jwt_secret_at_least_32_characters_long";

beforeEach(() => {
    jest.clearAllMocks();
    process.env.JWT_SECRET = SECRET;
});

function mockRes() {
    const headers = {};
    const res = {
        statusCode: 200,
        body: null,
        headers,
        setHeader(k, v) {
            headers[k.toLowerCase()] = v;
        },
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(payload) {
            this.body = payload;
            return this;
        },
        on(event, cb) {
            if (event === "finish") {
                this._finish = cb;
            }
            return this;
        },
        finish() {
            if (this._finish) this._finish();
        }
    };
    return res;
}

describe("mintImpersonationToken", () => {
    test("requires reason and ticket id", async () => {
        await expect(
            impersonationService.mintImpersonationToken({
                actorAdmin: { id: "admin-1" },
                subjectUserId: "user-1",
                reason: "short",
                ticketId: "AB"
            })
        ).rejects.toMatchObject({ code: "REASON_REQUIRED" });
    });

    test("mints a time-boxed JWT with impersonation claims", async () => {
        db.query
            .mockResolvedValueOnce([[{
                id: "user-1",
                email: "shopper@example.com",
                name: "Shopper",
                role: "customer",
                is_active: 1,
                deleted_at: null
            }]])
            .mockResolvedValueOnce([{ affectedRows: 1 }]) // insert grant
            .mockResolvedValueOnce([{ affectedRows: 1 }]); // audit mint

        const result = await impersonationService.mintImpersonationToken({
            actorAdmin: { id: "admin-1", role: "admin" },
            subjectUserId: "user-1",
            reason: "Investigating checkout bug for support",
            ticketId: "SUP-1234",
            ttlMinutes: 5
        });

        expect(result.token).toBeTruthy();
        expect(result.ttlMinutes).toBe(5);
        expect(result.actorAdminId).toBe("admin-1");
        expect(result.subjectUserId).toBe("user-1");

        const decoded = jwt.verify(result.token, SECRET);
        expect(decoded.impersonation).toBe(true);
        expect(decoded.actorAdminId).toBe("admin-1");
        expect(decoded.subjectUserId).toBe("user-1");
        expect(decoded.id).toBe("user-1");
        expect(decoded.ticketId).toBe("SUP-1234");
        expect(decoded.jti).toBeTruthy();
    });

    test("refuses to impersonate admin subjects", async () => {
        db.query.mockResolvedValueOnce([[{
            id: "admin-2",
            email: "other@example.com",
            name: "Other Admin",
            role: "admin",
            is_active: 1,
            deleted_at: null
        }]]);

        await expect(
            impersonationService.mintImpersonationToken({
                actorAdmin: { id: "admin-1" },
                subjectUserId: "admin-2",
                reason: "Should not be allowed here",
                ticketId: "SUP-9"
            })
        ).rejects.toMatchObject({ code: "ADMIN_SUBJECT_FORBIDDEN" });
    });
});

describe("revokeImpersonationGrant", () => {
    test("marks grant revoked and audits", async () => {
        db.query
            .mockResolvedValueOnce([[{
                id: "grant-1",
                actor_admin_id: "admin-1",
                subject_user_id: "user-1",
                jti: "jti-1",
                revoked_at: null
            }]])
            .mockResolvedValueOnce([{ affectedRows: 1 }])
            .mockResolvedValueOnce([{ affectedRows: 1 }]);

        const result = await impersonationService.revokeImpersonationGrant({
            grantId: "grant-1",
            revokedBy: { id: "admin-1" }
        });

        expect(result.alreadyRevoked).toBe(false);
        expect(db.query).toHaveBeenCalledWith(
            expect.stringMatching(/SET revoked_at = NOW()/i),
            expect.any(Array)
        );
    });
});

describe("impersonationMiddleware", () => {
    test("no-ops for normal sessions", async () => {
        const req = { user: { id: "user-1", role: "customer" } };
        const res = mockRes();
        const next = jest.fn();
        await impersonationMiddleware(req, res, next);
        expect(next).toHaveBeenCalled();
        expect(res.headers["x-impersonating"]).toBeUndefined();
    });

    test("watermarks response and audits requests for valid grants", async () => {
        const grant = {
            id: "grant-1",
            actor_admin_id: "admin-1",
            subject_user_id: "user-1",
            reason: "Support ticket investigation",
            ticket_id: "SUP-1",
            jti: "jti-1",
            expires_at: new Date(Date.now() + 60_000),
            revoked_at: null
        };

        db.query
            .mockResolvedValueOnce([[grant]]) // validate by jti
            .mockResolvedValueOnce([{ affectedRows: 1 }]); // audit on finish

        const req = {
            method: "GET",
            originalUrl: "/api/orders/my-orders",
            ip: "127.0.0.1",
            headers: { "user-agent": "jest" },
            user: {
                id: "user-1",
                impersonation: true,
                actorAdminId: "admin-1",
                subjectUserId: "user-1",
                grantId: "grant-1",
                jti: "jti-1",
                ticketId: "SUP-1"
            }
        };
        const res = mockRes();
        const next = jest.fn();

        await impersonationMiddleware(req, res, next);

        expect(next).toHaveBeenCalled();
        expect(res.headers["x-impersonating"]).toBe("user-1");
        expect(res.headers["x-impersonation-actor"]).toBe("admin-1");
        expect(req.impersonation.actorAdminId).toBe("admin-1");
        expect(req.actorAdminId).toBe("admin-1");

        res.statusCode = 200;
        res.finish();
        // allow async audit
        await new Promise((r) => setImmediate(r));
        expect(db.query).toHaveBeenCalledWith(
            expect.stringMatching(/INSERT INTO admin_impersonation_audit/i),
            expect.arrayContaining(["grant-1", "admin-1", "user-1", "request"])
        );
    });

    test("rejects revoked grants", async () => {
        db.query
            .mockResolvedValueOnce([[{
                id: "grant-1",
                actor_admin_id: "admin-1",
                subject_user_id: "user-1",
                jti: "jti-1",
                expires_at: new Date(Date.now() + 60_000),
                revoked_at: new Date()
            }]])
            .mockResolvedValueOnce([{ affectedRows: 1 }]);

        const req = {
            method: "GET",
            url: "/api/cart",
            headers: {},
            user: {
                id: "user-1",
                impersonation: true,
                actorAdminId: "admin-1",
                subjectUserId: "user-1",
                grantId: "grant-1",
                jti: "jti-1"
            }
        };
        const res = mockRes();
        const next = jest.fn();

        await impersonationMiddleware(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(401);
        expect(res.body.code).toBe("IMPERSONATION_REVOKED");
    });
});
