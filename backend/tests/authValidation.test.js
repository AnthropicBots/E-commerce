// The signup-verification and password-reset validators.
//
// Both of these middlewares were unreachable in the sense that mattered: every
// request that got as far as the OTP check left the process through the error
// handler as a 500, because `isValidOTP` was destructured off a module that
// does not export it and the resulting `undefined()` threw (#1671).
//
// `npm run check:syntax` parses the file happily -- a name that is never
// exported is only unresolved at call time -- and nothing in the suite touched
// this module, so 120 green suites said nothing about it. Hence this file.
//
// The tests drive the middlewares the way Express does: a plain `req` carrying
// a body, a `res` that records what it was told to send, and a `next` spy. No
// database and no network, so these are pure assertions about the validation
// contract.

const {
    validateSignup,
    validateVerifySignup,
    validateLogin,
    validateForgotPassword,
    validateResetPassword,
    validateRefreshToken,
    validateChangePassword
} = require("../middleware/authValidation");

// ---------------------------------------------------------------------------
// Express doubles
// ---------------------------------------------------------------------------

const makeRes = () => {
    const res = { statusCode: null, body: null };

    res.status = (code) => {
        res.statusCode = code;
        return res;
    };

    res.json = (payload) => {
        res.body = payload;
        return res;
    };

    return res;
};

/** Run a middleware and report whether it passed the request on. */
const run = (middleware, body) => {
    const req = { body };
    const res = makeRes();
    let passed = false;

    middleware(req, res, () => {
        passed = true;
    });

    return { passed, status: res.statusCode, message: res.body?.message };
};

/** A password that satisfies validatePassword, so it never confuses a case. */
const GOOD_PASSWORD = "Abcd1234!";

/** Appwrite's `ID.unique()` shape -- alphanumeric, opaque, not a number. */
const APPWRITE_ID = "65a1b2c3d4e5f6789012";

// ---------------------------------------------------------------------------
// The regression that started this
// ---------------------------------------------------------------------------

describe("the OTP helper the validators call", () => {
    test("is not exported by utils/validators", () => {
        // Pinning the fact the bug rested on. If someone later adds an
        // `isValidOTP` to this module, the import in authValidation.js is
        // still the wrong one to reach for and this test says so.
        const validators = require("../utils/validators");

        expect(validators.isValidOTP).toBeUndefined();
    });

    test("is a boolean, single-argument check in utils/otpvalidators", () => {
        const { isOTPFormatValid } = require("../utils/otpvalidators");

        expect(typeof isOTPFormatValid).toBe("function");
        expect(isOTPFormatValid("123456")).toBe(true);
        expect(isOTPFormatValid("12345")).toBe(false);
    });

    test("isValidOTP is a different function, and not the one to use here", () => {
        // It takes (userId, otp) and returns a result object. An object is
        // always truthy, so `if (!isValidOTP(otp))` would never reject even
        // once the import was pointed at the right module -- and it would
        // spend a rate-limit attempt on every validation pass.
        const { isValidOTP } = require("../utils/otpvalidators");

        expect(typeof isValidOTP).toBe("function");
        expect(typeof isValidOTP("some-user", "123456")).toBe("object");
    });
});

describe("the email helper the validators call", () => {
    test("answers with an object, not a boolean", () => {
        // The second defect in this file, and the same shape as the first: a
        // helper consumed against the wrong contract. `if (!isValidEmail(x))`
        // negates an object, which is always false, so the address check never
        // fired in any of the four validators that made it.
        const { isValidEmail } = require("../utils/validators");

        expect(typeof isValidEmail("nope")).toBe("object");
        expect(isValidEmail("nope").isValid).toBe(false);
        expect(isValidEmail("shopper@example.com").isValid).toBe(true);
    });

    test("negating it directly would accept anything", () => {
        const { isValidEmail } = require("../utils/validators");

        // Pinning why the old code was silently inert.
        expect(!isValidEmail("definitely not an address")).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// The address checks, across every validator that makes one
// ---------------------------------------------------------------------------

describe("email format is enforced", () => {
    const MALFORMED = [
        ["no at sign", "nope"],
        ["no domain dot", "shopper@example"],
        ["nothing before the at", "@example.com"],
        ["nothing after the at", "shopper@"],
        ["an inner space", "shop per@example.com"],
        ["two at signs", "a@b@example.com"]
    ];

    describe.each(MALFORMED)("a %s address", (_label, email) => {
        test("is rejected by validateSignup", () => {
            const result = run(validateSignup, {
                name: "Shopper",
                email,
                password: GOOD_PASSWORD
            });

            expect(result.status).toBe(400);
            expect(result.message).toBe("Invalid email format");
        });

        test("is rejected by validateVerifySignup", () => {
            const result = run(validateVerifySignup, { email, otp: "123456" });

            expect(result.status).toBe(400);
            expect(result.message).toBe("Invalid email format");
        });

        test("is rejected by validateLogin", () => {
            const result = run(validateLogin, { email, password: "whatever" });

            expect(result.status).toBe(400);
            expect(result.message).toBe("Invalid email format");
        });

        test("is rejected by validateForgotPassword", () => {
            const result = run(validateForgotPassword, { email });

            expect(result.status).toBe(400);
            expect(result.message).toBe("Invalid email format");
        });
    });

    test("a well-formed address still passes every one of them", () => {
        const email = "shopper@example.com";

        expect(
            run(validateSignup, { name: "Shopper", email, password: GOOD_PASSWORD }).passed
        ).toBe(true);
        expect(run(validateVerifySignup, { email, otp: "123456" }).passed).toBe(true);
        expect(run(validateLogin, { email, password: "whatever" }).passed).toBe(true);
        expect(run(validateForgotPassword, { email }).passed).toBe(true);
    });

    test("an address with a plus tag passes", () => {
        // Sub-addressing is legitimate and a validator that rejects it locks
        // real shoppers out of their own accounts.
        expect(
            run(validateForgotPassword, { email: "shopper+orders@example.com" }).passed
        ).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// validateVerifySignup
// ---------------------------------------------------------------------------

describe("validateVerifySignup", () => {
    const valid = { email: "shopper@example.com", otp: "123456" };

    test("passes a well-formed email and six-digit code", () => {
        const result = run(validateVerifySignup, valid);

        expect(result.passed).toBe(true);
        expect(result.status).toBeNull();
    });

    test("does not throw on a malformed code -- it answers 400", () => {
        // The defect: this threw `TypeError: isValidOTP is not a function`,
        // which Express turned into a 500.
        const result = run(validateVerifySignup, { ...valid, otp: "12345" });

        expect(result.passed).toBe(false);
        expect(result.status).toBe(400);
        expect(result.message).toBe("OTP must be 6 digits");
    });

    test.each([
        ["too short", "12345"],
        ["too long", "1234567"],
        ["non-numeric", "12345a"],
        ["punctuation", "123-45"],
        ["spaces inside", "123 45"]
    ])("rejects a code that is %s", (_label, otp) => {
        const result = run(validateVerifySignup, { ...valid, otp });

        expect(result.status).toBe(400);
        expect(result.message).toBe("OTP must be 6 digits");
    });

    test("accepts a code that is padded with whitespace", () => {
        // getMissingFields already sanitizes, and the format check trims, so a
        // code pasted out of an email with a stray space still verifies.
        const result = run(validateVerifySignup, { ...valid, otp: " 123456 " });

        expect(result.passed).toBe(true);
    });

    test("reports a missing field before looking at the format", () => {
        const result = run(validateVerifySignup, { email: valid.email });

        expect(result.status).toBe(400);
        expect(result.message).toMatch(/otp/);
    });

    test("rejects a malformed email", () => {
        const result = run(validateVerifySignup, { ...valid, email: "not-an-email" });

        expect(result.status).toBe(400);
        expect(result.message).toBe("Invalid email format");
    });
});

// ---------------------------------------------------------------------------
// validateResetPassword
// ---------------------------------------------------------------------------

describe("validateResetPassword", () => {
    const valid = {
        userId: APPWRITE_ID,
        otp: "123456",
        newPassword: GOOD_PASSWORD
    };

    test("passes the id shape Appwrite actually issues", () => {
        // The defect: `isNaN(Number(userId))` rejected this with
        // "Invalid user ID format", so the endpoint refused every real reset
        // even after the OTP import was fixed.
        const result = run(validateResetPassword, valid);

        expect(result.passed).toBe(true);
        expect(result.status).toBeNull();
    });

    test("passes a CHAR(36) UUID too", () => {
        // users.id is CHAR(36). Whichever of the two ids reaches this handler,
        // the validator must not be the thing that stops it.
        const result = run(validateResetPassword, {
            ...valid,
            userId: "3f1b9c2a-7d4e-4b8a-9f10-2c5e6a7b8c9d"
        });

        expect(result.passed).toBe(true);
    });

    test.each([
        ["an Appwrite unique id", "65a1b2c3d4e5f6789012"],
        ["a UUID", "3f1b9c2a-7d4e-4b8a-9f10-2c5e6a7b8c9d"],
        ["an id with an underscore", "user_12345"],
        ["an id with a period", "user.12345"],
        ["a purely numeric id", "12345"]
    ])("accepts %s", (_label, userId) => {
        expect(run(validateResetPassword, { ...valid, userId }).passed).toBe(true);
    });

    test.each([
        ["a leading hyphen", "-abc123"],
        ["a leading period", ".abc123"],
        ["a leading underscore", "_abc123"],
        ["a slash", "abc/123"],
        ["a space", "abc 123"],
        ["an at sign", "abc@123"],
        ["more than 36 characters", "a".repeat(37)]
    ])("rejects an id with %s", (_label, userId) => {
        const result = run(validateResetPassword, { ...valid, userId });

        expect(result.status).toBe(400);
        expect(result.message).toBe("Invalid user ID format");
    });

    test("accepts an id of exactly 36 characters", () => {
        const result = run(validateResetPassword, {
            ...valid,
            userId: "a".repeat(36)
        });

        expect(result.passed).toBe(true);
    });

    test("does not throw on a malformed code -- it answers 400", () => {
        const result = run(validateResetPassword, { ...valid, otp: "abcdef" });

        expect(result.passed).toBe(false);
        expect(result.status).toBe(400);
        expect(result.message).toBe("OTP must be 6 digits");
    });

    test("rejects a weak password", () => {
        const result = run(validateResetPassword, { ...valid, newPassword: "short" });

        expect(result.status).toBe(400);
        expect(result.message).not.toBe("OTP must be 6 digits");
    });

    test.each(["userId", "otp", "newPassword"])(
        "reports %s when it is missing",
        (field) => {
            const body = { ...valid };
            delete body[field];

            const result = run(validateResetPassword, body);

            expect(result.status).toBe(400);
            expect(result.message).toMatch(new RegExp(field));
        }
    );

    test("says nothing about whether the account exists", () => {
        // forgotPassword answers uniformly on purpose so it cannot be used to
        // enumerate addresses. A validator that distinguished a real id from a
        // well-formed one would reopen that oracle one step further along.
        const wellFormedButUnknown = run(validateResetPassword, {
            ...valid,
            userId: "zzzzzzzzzzzzzzzzzzzz"
        });

        expect(wellFormedButUnknown.passed).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// The validators either side of the two that were broken
// ---------------------------------------------------------------------------

describe("the rest of the auth validators still hold", () => {
    test("validateSignup passes a complete, valid body", () => {
        expect(
            run(validateSignup, {
                name: "Shopper",
                email: "shopper@example.com",
                password: GOOD_PASSWORD
            }).passed
        ).toBe(true);
    });

    test("validateSignup rejects a one-character name", () => {
        const result = run(validateSignup, {
            name: "S",
            email: "shopper@example.com",
            password: GOOD_PASSWORD
        });

        expect(result.status).toBe(400);
        expect(result.message).toMatch(/at least 2 characters/);
    });

    test("validateSignup rejects an under-age signup", () => {
        const result = run(validateSignup, {
            name: "Shopper",
            email: "shopper@example.com",
            password: GOOD_PASSWORD,
            age: 15
        });

        expect(result.status).toBe(400);
        expect(result.message).toMatch(/Age must be between 18 and 100/);
    });

    test("validateLogin needs both an address and a password", () => {
        expect(run(validateLogin, { email: "a@b.com" }).status).toBe(400);
        expect(
            run(validateLogin, { email: "a@b.com", password: "x" }).passed
        ).toBe(true);
    });

    test("validateForgotPassword rejects a malformed address", () => {
        expect(run(validateForgotPassword, { email: "nope" }).status).toBe(400);
    });

    test("validateRefreshToken rejects a token of the wrong shape", () => {
        expect(run(validateRefreshToken, { refreshToken: "nope" }).status).toBe(400);
    });

    test("validateChangePassword needs both passwords", () => {
        expect(
            run(validateChangePassword, { newPassword: GOOD_PASSWORD }).status
        ).toBe(400);

        expect(
            run(validateChangePassword, {
                currentPassword: "whatever",
                newPassword: GOOD_PASSWORD
            }).passed
        ).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// The module surface the routes import
// ---------------------------------------------------------------------------

describe("the exported surface", () => {
    test("every name authRoutes destructures is a function", () => {
        // routes/authRoutes.js destructures these seven. A missing one is
        // `undefined` in a router.post() argument list, which Express reports
        // at mount time as a confusing "Route.post() requires a callback".
        const exported = require("../middleware/authValidation");

        for (const name of [
            "validateSignup",
            "validateVerifySignup",
            "validateLogin",
            "validateForgotPassword",
            "validateResetPassword",
            "validateRefreshToken",
            "validateChangePassword"
        ]) {
            expect(typeof exported[name]).toBe("function");
        }
    });
});
