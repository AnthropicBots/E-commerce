/**
 * Fixture ↔ OpenAPI schema contract tests (#1395).
 * Example payloads for 401 / 409 / 422 (and happy paths) must match the spec.
 */

const fs = require("fs");
const path = require("path");
const {
    loadOpenApi,
    createAjv,
    compileSchema,
    assertValid
} = require("./helpers/loadOpenApi");

const FIXTURES = path.join(__dirname, "fixtures");

function readFixture(name) {
    return JSON.parse(fs.readFileSync(path.join(FIXTURES, name), "utf8"));
}

describe("contract fixtures vs OpenAPI schemas", () => {
    let openapi;
    let ajv;

    beforeAll(() => {
        openapi = loadOpenApi();
        ajv = createAjv();
    });

    test("401 unauthorized matches ErrorEnvelope", () => {
        const validate = compileSchema(ajv, openapi, "ErrorEnvelope");
        assertValid(validate, readFixture("401.unauthorized.json"), "401 fixture");
    });

    test("409 inventory conflict matches InventoryConflictEnvelope", () => {
        const validate = compileSchema(ajv, openapi, "InventoryConflictEnvelope");
        assertValid(
            validate,
            readFixture("409.inventory-conflict.json"),
            "409 inventory fixture"
        );
    });

    test("409 total mismatch matches TotalMismatchEnvelope", () => {
        const validate = compileSchema(ajv, openapi, "TotalMismatchEnvelope");
        assertValid(
            validate,
            readFixture("409.total-mismatch.json"),
            "409 total mismatch fixture"
        );
    });

    test("422 validation matches ValidationErrorEnvelope", () => {
        const validate = compileSchema(ajv, openapi, "ValidationErrorEnvelope");
        assertValid(validate, readFixture("422.validation.json"), "422 fixture");
    });

    test("200 login success matches LoginSuccess", () => {
        const validate = compileSchema(ajv, openapi, "LoginSuccess");
        assertValid(validate, readFixture("200.login-success.json"), "login fixture");
    });

    test("200 checkout quote matches CheckoutQuoteSuccess", () => {
        const validate = compileSchema(ajv, openapi, "CheckoutQuoteSuccess");
        assertValid(
            validate,
            readFixture("200.checkout-quote.json"),
            "checkout quote fixture"
        );
    });

    test("rejecting a broken envelope (missing success) fails validation", () => {
        const validate = compileSchema(ajv, openapi, "ErrorEnvelope");
        expect(validate({ message: "no success flag" })).toBe(false);
    });
});
