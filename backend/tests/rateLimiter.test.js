// backend/tests/rateLimiter.test.js
//
// The limiter module had no test of its own. `contactFormLimiter` was built
// from `CONTACT_FORM_MAX`, a merge dropped the declaration and kept the use,
// and the first thing to notice was the boot gate -- after the merge was on
// `main` (#1474).
//
// A `require` of this module is most of the value here: it evaluates every
// limiter definition, so an undeclared constant in any of them fails the suite
// rather than only the boot script. The assertions past that cover the part a
// require cannot, which is whether each limiter got the numbers it was supposed
// to get. `max` being `undefined` is not an error to express-rate-limit -- it
// falls back to the library default of 5 -- so a limiter can be silently
// mis-tuned without anything throwing.
//
// Redis is stubbed: `config/redisRateLimitStore` is what connects, and every
// assertion here is about configuration, which is decided before a store is
// ever consulted.

// Env has to be set before the module is required -- the maximums are read into
// consts at import time, so anything set afterwards is read too late.
process.env.RATE_LIMIT_CONTACT_FORM_MAX = "7";
process.env.RATE_LIMIT_NEWSLETTER_MAX = "11";
process.env.RATE_LIMIT_LOGIN_MAX = "4";

// `name` never reaches express-rate-limit -- createLimiter spends it on the
// store's Redis namespace (`rl:auth:<name>`) and passes the rest through. So
// the namespace is what identifies a limiter in the recorded options, and the
// stub returns a tagged object rather than undefined to carry it.
jest.mock("../config/redisRateLimitStore", () => ({
    createRateLimitStore: jest.fn((namespace) => ({ __namespace: namespace }))
}));

// express-rate-limit is replaced with a recorder. The real one is a well-tested
// third-party package; what is worth asserting is the options this repo hands
// it, and the recorder is the only way to see them.
const recordedOptions = [];

jest.mock("express-rate-limit", () => {
    const factory = jest.fn((options) => {
        recordedOptions.push(options);

        const middleware = (req, res, next) => next();
        middleware.__options = options;
        return middleware;
    });

    factory.ipKeyGenerator = jest.fn((address) => `ip:${address}`);

    return factory;
});

const limiters = require("../middleware/rateLimiter");

// The namespace createLimiter builds, and therefore the only identifier a
// limiter carries into its recorded options.
const NAMESPACE_PREFIX = "rl:auth:";

function namespaceOf(options) {
    return String(options.store?.__namespace || "").replace(NAMESPACE_PREFIX, "");
}

function optionsFor(name) {
    return recordedOptions.find((options) => namespaceOf(options) === name);
}

// Every limiter the module exports, with the express-rate-limit `name` it is
// registered under. A limiter added to the module without being added here
// fails the completeness test below, which is the point: the list is the
// inventory, and an entry missing from it is a limiter nobody is checking.
const EXPORTED_LIMITERS = [
    ["loginLimiter", "login"],
    ["signupLimiter", "signup"],
    ["refreshTokenLimiter", "refresh-token"],
    ["forgotPasswordLimiter", "forgot-password"],
    ["otpVerifyLimiter", "otp-verify"],
    ["resetPasswordLimiter", "reset-password"],
    ["otpRequestLimiter", "otp-request"],
    ["newsletterLimiter", "newsletter"],
    ["guestOrderLookupLimiter", "guest-order-lookup"],
    ["contactFormLimiter", "contact-form"],
    ["suspiciousIpLimiter", "suspicious-ip"]
];

describe("rateLimiter module", () => {
    it("imports without throwing", () => {
        // The regression. `CONTACT_FORM_MAX` was referenced by
        // `contactFormLimiter` and declared by nothing, so this require threw
        // `ReferenceError` and took `routes/authRoutes.js` -- and therefore the
        // whole server -- down with it.
        expect(() => require("../middleware/rateLimiter")).not.toThrow();
    });

    it.each(EXPORTED_LIMITERS)("exports %s as middleware", (exportName) => {
        expect(typeof limiters[exportName]).toBe("function");
    });

    it("registers exactly the limiters it exports, and no others", () => {
        const registered = recordedOptions.map(namespaceOf).sort();
        const expected = EXPORTED_LIMITERS.map(([, name]) => name).sort();

        expect(registered).toEqual(expected);
    });

    it("gives every limiter its own Redis namespace", () => {
        // Sharing a bucket means one limiter spends another's budget: five
        // failed logins would also consume the signup allowance for that client.
        const namespaces = recordedOptions.map(namespaceOf);

        expect(new Set(namespaces).size).toBe(namespaces.length);
        for (const options of recordedOptions) {
            expect(options.store.__namespace).toMatch(/^rl:auth:.+/);
        }
    });

    it("gives every limiter a max", () => {
        // express-rate-limit treats an absent `max` as its own default of 5
        // rather than as an error, so an undeclared constant reaching this far
        // would produce a quietly wrong limit instead of a loud failure. That is
        // the shape of the bug this file exists for -- assert it directly.
        for (const options of recordedOptions) {
            expect(Number.isFinite(options.max)).toBe(true);
            expect(options.max).toBeGreaterThan(0);
        }
    });

    it("gives every limiter a positive window", () => {
        for (const options of recordedOptions) {
            expect(Number.isFinite(options.windowMs)).toBe(true);
            expect(options.windowMs).toBeGreaterThan(0);
        }
    });
});

describe("environment overrides", () => {
    it("reads the contact form maximum from RATE_LIMIT_CONTACT_FORM_MAX", () => {
        expect(optionsFor("contact-form").max).toBe(7);
    });

    it("reads the newsletter maximum from RATE_LIMIT_NEWSLETTER_MAX", () => {
        expect(optionsFor("newsletter").max).toBe(11);
    });

    it("reads the login maximum from RATE_LIMIT_LOGIN_MAX", () => {
        expect(optionsFor("login").max).toBe(4);
    });
});

describe("limiter namespacing", () => {
    it("keeps the contact form in its own bucket", () => {
        // Someone who has just failed a login is exactly the person about to
        // use the contact form. Sharing a counter would mean the one locks out
        // the other.
        const contactForm = optionsFor("contact-form");
        const login = optionsFor("login");

        expect(contactForm.store.__namespace).not.toBe(login.store.__namespace);
    });

    it("gives the newsletter a longer window than the credential limiters", () => {
        // Deliberate: the newsletter limit is about volume of outbound mail
        // over an hour, not about credential guessing over fifteen minutes.
        expect(optionsFor("newsletter").windowMs)
            .toBeGreaterThan(optionsFor("login").windowMs);
    });
});
