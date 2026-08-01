/**
 * OpenAPI loader + AJV helpers for contract tests (#1395).
 */

"use strict";

const fs = require("fs");
const path = require("path");

const OPENAPI_PATH = path.join(
    __dirname,
    "..",
    "..",
    "..",
    "openapi",
    "ecommerce.openapi.yaml"
);

function loadYaml(filePath) {
    const raw = fs.readFileSync(filePath, "utf8");
    let yaml;
    try {
        yaml = require("js-yaml");
    } catch (err) {
        throw new Error(
            "js-yaml is required for OpenAPI contract tests. Run `npm install` in backend/."
        );
    }
    return yaml.load(raw);
}

function loadOpenApi() {
    const doc = loadYaml(OPENAPI_PATH);
    if (!doc || doc.openapi !== "3.0.3") {
        throw new Error("Expected OpenAPI 3.0.3 document at openapi/ecommerce.openapi.yaml");
    }
    return doc;
}

function createAjv() {
    const Ajv = require("ajv");
    const addFormats = require("ajv-formats");
    const ajv = new Ajv({
        allErrors: true,
        strict: false,
        validateSchema: false
    });
    addFormats(ajv);
    return ajv;
}

/**
 * Compile a component schema by name, resolving local $refs within components.
 */
function compileSchema(ajv, openapi, schemaName) {
    const components = openapi.components || {};
    const schemas = components.schemas || {};
    if (!schemas[schemaName]) {
        throw new Error(`Unknown schema: ${schemaName}`);
    }

    // Register every component schema once so $ref resolution works.
    if (!ajv.getSchema("https://ecommerce.local/openapi.json")) {
        ajv.addSchema(
            {
                $id: "https://ecommerce.local/openapi.json",
                components: { schemas }
            },
            "https://ecommerce.local/openapi.json"
        );
    }

    const ref = {
        $ref: `https://ecommerce.local/openapi.json#/components/schemas/${schemaName}`
    };
    return ajv.compile(ref);
}

function assertValid(validate, payload, label) {
    const ok = validate(payload);
    if (!ok) {
        const details = (validate.errors || [])
            .map((e) => `${e.instancePath || "/"} ${e.message}`)
            .join("; ");
        throw new Error(`${label} failed schema validation: ${details}`);
    }
}

function listCorePaths(openapi) {
    return Object.keys(openapi.paths || {}).sort();
}

function responseStatusesFor(openapi, pathKey, method) {
    const op = openapi.paths?.[pathKey]?.[method];
    if (!op) return [];
    return Object.keys(op.responses || {}).map(String);
}

module.exports = {
    OPENAPI_PATH,
    loadOpenApi,
    createAjv,
    compileSchema,
    assertValid,
    listCorePaths,
    responseStatusesFor
};
