// backend/tests/profile.test.js
//
// The signed-in shopper's own profile (#1548).
//
// There was no server side to this at all: both editors wrote to localStorage
// and reported success, so a saved profile was gone on the next device and the
// `phone`, `address`, `city`, `state`, `zip`, `country` and `avatar` columns on
// `users` were written by nothing but signup.
//
// The database is mocked at the module boundary, as the rest of this suite
// does. What is pinned here is not SQL text but the rules the endpoint has to
// hold whatever the SQL looks like:
//
//   * only the fields that were sent are written, so a partial save does not
//     blank the rest of the profile;
//   * email is refused rather than silently dropped, because a caller that
//     believes it changed one is the defect this replaces;
//   * an unknown field is an error, for the same reason;
//   * the widths come from the columns, so nothing that passes can be
//     truncated on the way in;
//   * an avatar can only be a scheme that is safe in an `<img src>`.

jest.mock("../config/db", () => ({
    query: jest.fn(),
    getConnection: jest.fn()
}));

const db = require("../config/db");
const profileService = require("../services/profileService");
const { ProfileError } = require("../services/profileService");

const USER = "11111111-1111-4111-8111-111111111111";

const STORED_ROW = {
    id: USER,
    name: "Ishwari D",
    email: "ishwari@example.com",
    role: "customer",
    phone: "9999999999",
    address: "12 Main St",
    city: "Kolhapur",
    state: "MH",
    zip: "416001",
    country: "India",
    avatar: "https://cdn.example.com/a.png",
    is_verified: 1,
    is_active: 1,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-02T00:00:00Z"
};

/** The UPDATE, plus the SELECT the service re-reads through afterwards. */
function stubUpdateThenRead(row = STORED_ROW, affectedRows = 1) {
    db.query.mockImplementation(async (sql) => {
        if (/^\s*UPDATE users/i.test(sql)) {
            return [{ affectedRows }];
        }
        return [[row]];
    });
}

function updateStatement() {
    return db.query.mock.calls.find(([sql]) => /^\s*UPDATE users/i.test(sql));
}

beforeEach(() => {
    jest.clearAllMocks();
    db.query.mockReset();
});

// ----------------------------------------------------------------------
// Reading
// ----------------------------------------------------------------------

describe("profileService.getProfile", () => {
    test("returns the columns a profile page edits", async () => {
        db.query.mockResolvedValue([[STORED_ROW]]);

        const profile = await profileService.getProfile(USER);

        expect(profile).toMatchObject({
            id: USER,
            name: "Ishwari D",
            email: "ishwari@example.com",
            phone: "9999999999",
            address: "12 Main St",
            city: "Kolhapur",
            state: "MH",
            zip: "416001",
            country: "India",
            avatar: "https://cdn.example.com/a.png",
            isVerified: true
        });
    });

    test("never returns the password hash", async () => {
        db.query.mockResolvedValue([[{ ...STORED_ROW, password: "$2a$hash" }]]);

        const profile = await profileService.getProfile(USER);

        expect(profile.password).toBeUndefined();
        expect(db.query.mock.calls[0][0]).not.toMatch(/\bpassword\b/);
    });

    test("unset fields come back as null, not as empty strings", async () => {
        db.query.mockResolvedValue([
            [{ ...STORED_ROW, phone: "", address: null, city: null }]
        ]);

        const profile = await profileService.getProfile(USER);

        expect(profile.phone).toBeNull();
        expect(profile.address).toBeNull();
        expect(profile.city).toBeNull();
    });

    test("is scoped to the caller and skips deleted accounts", async () => {
        db.query.mockResolvedValue([[STORED_ROW]]);

        await profileService.getProfile(USER);

        const [sql, params] = db.query.mock.calls[0];

        expect(sql).toMatch(/WHERE id = \?/);
        expect(sql).toMatch(/deleted_at IS NULL/);
        expect(params).toEqual([USER]);
    });

    test("an unknown account is a 404", async () => {
        db.query.mockResolvedValue([[]]);

        await expect(profileService.getProfile(USER)).rejects.toMatchObject({
            status: 404,
            code: "NOT_FOUND"
        });
    });

    test("a deactivated account is a 403, matching getMe", async () => {
        db.query.mockResolvedValue([[{ ...STORED_ROW, is_active: 0 }]]);

        await expect(profileService.getProfile(USER)).rejects.toMatchObject({
            status: 403,
            code: "ACCOUNT_DISABLED"
        });
    });

    test("no user id is a 401, not a query", async () => {
        await expect(profileService.getProfile(null)).rejects.toMatchObject({
            status: 401
        });

        expect(db.query).not.toHaveBeenCalled();
    });
});

// ----------------------------------------------------------------------
// Writing
// ----------------------------------------------------------------------

describe("profileService.updateProfile", () => {
    test("writes only the fields that were sent", async () => {
        stubUpdateThenRead();

        await profileService.updateProfile(USER, { name: "Ishwari Deshmukh" });

        const [sql, params] = updateStatement();

        expect(sql).toMatch(/SET name = \?/);
        expect(sql).not.toMatch(/phone = \?/);
        expect(sql).not.toMatch(/address = \?/);
        expect(params[0]).toBe("Ishwari Deshmukh");
    });

    test("a partial save does not blank the rest of the profile", async () => {
        stubUpdateThenRead();

        await profileService.updateProfile(USER, { phone: "9876543210" });

        const [sql] = updateStatement();

        expect(sql).toMatch(/phone = \?/);
        expect(sql).not.toMatch(/\bname = \?/);
    });

    test("writes every supported field when all are sent", async () => {
        stubUpdateThenRead();

        await profileService.updateProfile(USER, {
            name: "Ishwari D",
            phone: "9999999999",
            address: "12 Main St",
            city: "Kolhapur",
            state: "MH",
            zip: "416001",
            country: "India",
            avatar: "https://cdn.example.com/a.png"
        });

        const [sql] = updateStatement();

        for (const column of [
            "name", "phone", "address", "city", "state", "zip", "country", "avatar"
        ]) {
            expect(sql).toMatch(new RegExp(`${column} = \\?`));
        }
    });

    test("an explicitly emptied optional field is cleared to NULL", async () => {
        stubUpdateThenRead();

        await profileService.updateProfile(USER, { phone: "" });

        const [, params] = updateStatement();

        expect(params[0]).toBeNull();
    });

    test("the update is scoped to the caller", async () => {
        stubUpdateThenRead();

        await profileService.updateProfile(USER, { name: "Ishwari D" });

        const [sql, params] = updateStatement();

        expect(sql).toMatch(/WHERE id = \?/);
        expect(sql).toMatch(/deleted_at IS NULL/);
        expect(params[params.length - 1]).toBe(USER);
    });

    test("returns what the server stored, re-read after the write", async () => {
        stubUpdateThenRead();

        const profile = await profileService.updateProfile(USER, {
            name: "Ishwari D"
        });

        expect(profile.name).toBe(STORED_ROW.name);
        expect(
            db.query.mock.calls.filter(([sql]) => /SELECT/i.test(sql))
        ).toHaveLength(1);
    });

    test("an account that no longer exists is a 404", async () => {
        stubUpdateThenRead(STORED_ROW, 0);

        await expect(
            profileService.updateProfile(USER, { name: "Ishwari D" })
        ).rejects.toMatchObject({ status: 404 });
    });
});

// ----------------------------------------------------------------------
// What may not be written
// ----------------------------------------------------------------------

describe("profileService — refused fields", () => {
    test("email is refused, with a reason", async () => {
        await expect(
            profileService.updateProfile(USER, { email: "new@example.com" })
        ).rejects.toMatchObject({ code: "FIELD_NOT_EDITABLE" });

        expect(db.query).not.toHaveBeenCalled();
    });

    test("the email refusal explains what to do instead", async () => {
        await expect(
            profileService.updateProfile(USER, { email: "new@example.com" })
        ).rejects.toThrow(/verified/i);
    });

    test("email is refused even alongside fields that are allowed", async () => {
        await expect(
            profileService.updateProfile(USER, {
                name: "Ishwari D",
                email: "new@example.com"
            })
        ).rejects.toMatchObject({ code: "FIELD_NOT_EDITABLE" });

        // Nothing is written. A partial save that quietly drops the email is
        // how the frontend came to believe it had changed one.
        expect(db.query).not.toHaveBeenCalled();
    });

    test("role is refused", async () => {
        await expect(
            profileService.updateProfile(USER, { role: "admin" })
        ).rejects.toMatchObject({ code: "FIELD_NOT_EDITABLE" });
    });

    test("password is refused", async () => {
        await expect(
            profileService.updateProfile(USER, { password: "hunter2" })
        ).rejects.toMatchObject({ code: "FIELD_NOT_EDITABLE" });
    });

    test("an unknown field is an error, not silently ignored", async () => {
        await expect(
            profileService.updateProfile(USER, { nickname: "Ish" })
        ).rejects.toMatchObject({ code: "UNKNOWN_FIELD" });
    });

    test("the unknown-field error lists what is allowed", async () => {
        try {
            await profileService.updateProfile(USER, { nickname: "Ish" });
            throw new Error("should have thrown");
        } catch (error) {
            expect(error.details.allowed).toEqual(
                expect.arrayContaining(["name", "phone", "address", "avatar"])
            );
        }
    });

    test("an empty body is an error rather than a no-op success", async () => {
        await expect(
            profileService.updateProfile(USER, {})
        ).rejects.toMatchObject({ code: "EMPTY_UPDATE" });
    });

    test("a non-object body is refused", async () => {
        await expect(
            profileService.updateProfile(USER, "name=x")
        ).rejects.toBeInstanceOf(ProfileError);
    });
});

// ----------------------------------------------------------------------
// Validation
// ----------------------------------------------------------------------

describe("profileService — validation", () => {
    test("name cannot be emptied", async () => {
        await expect(
            profileService.updateProfile(USER, { name: "   " })
        ).rejects.toThrow(/name cannot be empty/i);
    });

    test("name has a minimum length", async () => {
        await expect(
            profileService.updateProfile(USER, { name: "I" })
        ).rejects.toThrow(/at least 2/i);
    });

    test("a value wider than its column is refused, not truncated", async () => {
        await expect(
            profileService.updateProfile(USER, { city: "x".repeat(101) })
        ).rejects.toThrow(/100 characters/);
    });

    test("the limits come from the column definitions", () => {
        expect(profileService.PROFILE_FIELDS.name.maxLength).toBe(255);
        expect(profileService.PROFILE_FIELDS.phone.maxLength).toBe(20);
        expect(profileService.PROFILE_FIELDS.city.maxLength).toBe(100);
        expect(profileService.PROFILE_FIELDS.zip.maxLength).toBe(20);
    });

    test("a nonsense phone number is refused", async () => {
        await expect(
            profileService.updateProfile(USER, { phone: "not a phone" })
        ).rejects.toThrow(/valid phone/i);
    });

    test("an ordinary phone number is accepted", async () => {
        stubUpdateThenRead();

        await expect(
            profileService.updateProfile(USER, { phone: "+91 98765 43210" })
        ).resolves.toBeDefined();
    });

    test("a javascript: avatar is refused", async () => {
        await expect(
            profileService.updateProfile(USER, {
                // eslint-disable-next-line no-script-url
                avatar: "javascript:alert(1)"
            })
        ).rejects.toThrow(/http\(s\) URL or an image data URL/i);
    });

    test("an https avatar is accepted", async () => {
        stubUpdateThenRead();

        await expect(
            profileService.updateProfile(USER, {
                avatar: "https://cdn.example.com/a.png"
            })
        ).resolves.toBeDefined();
    });

    test("an image data URL is accepted, because that is what the file picker produces", async () => {
        stubUpdateThenRead();

        await expect(
            profileService.updateProfile(USER, {
                avatar: "data:image/png;base64,iVBORw0KGgo="
            })
        ).resolves.toBeDefined();
    });

    test("a non-image data URL is refused", async () => {
        await expect(
            profileService.updateProfile(USER, {
                avatar: "data:text/html;base64,PHNjcmlwdD4="
            })
        ).rejects.toThrow(/http\(s\) URL or an image data URL/i);
    });
});

// ----------------------------------------------------------------------
// The HTTP surface
// ----------------------------------------------------------------------

describe("authController profile handlers", () => {
    const { getProfile, updateProfile } = require("../controllers/authController");

    function mockRes() {
        return {
            statusCode: null,
            body: null,
            status(code) {
                this.statusCode = code;
                return this;
            },
            json(payload) {
                this.body = payload;
                return this;
            }
        };
    }

    test("GET returns the profile", async () => {
        db.query.mockResolvedValue([[STORED_ROW]]);

        const res = mockRes();

        await getProfile({ user: { id: USER } }, res);

        expect(res.statusCode).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.profile.email).toBe("ishwari@example.com");
    });

    test("PUT saves and answers with what was stored", async () => {
        stubUpdateThenRead();

        const res = mockRes();

        await updateProfile(
            { user: { id: USER }, body: { name: "Ishwari D" } },
            res
        );

        expect(res.statusCode).toBe(200);
        expect(res.body.profile.name).toBe("Ishwari D");
    });

    test("a refused field comes back as a 400 with its code", async () => {
        const res = mockRes();

        await updateProfile(
            { user: { id: USER }, body: { email: "new@example.com" } },
            res
        );

        expect(res.statusCode).toBe(400);
        expect(res.body.code).toBe("FIELD_NOT_EDITABLE");
    });

    test("an unexpected failure is a 500 with nothing leaked", async () => {
        db.query.mockRejectedValue(new Error("ER_LOCK_WAIT_TIMEOUT: table users"));

        const res = mockRes();

        await getProfile({ user: { id: USER } }, res);

        expect(res.statusCode).toBe(500);
        expect(res.body.message).not.toMatch(/ER_LOCK_WAIT_TIMEOUT/);
    });

    test("an unauthenticated caller is a 401", async () => {
        const res = mockRes();

        await getProfile({}, res);

        expect(res.statusCode).toBe(401);
    });
});
