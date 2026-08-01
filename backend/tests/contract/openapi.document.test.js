/**
 * OpenAPI document structure contract (#1395).
 */

const path = require("path");
const fs = require("fs");
const {
    OPENAPI_PATH,
    loadOpenApi,
    listCorePaths,
    responseStatusesFor
} = require("./helpers/loadOpenApi");

describe("OpenAPI document", () => {
    test("ecommerce.openapi.yaml exists", () => {
        expect(fs.existsSync(OPENAPI_PATH)).toBe(true);
    });

    test("is OpenAPI 3.0.3 with core tags and security scheme", () => {
        const doc = loadOpenApi();
        expect(doc.info.title).toMatch(/e-commerce/i);
        expect(doc.tags.map((t) => t.name)).toEqual(
            expect.arrayContaining(["Auth", "Products", "Cart", "Checkout", "Orders"])
        );
        expect(doc.components.securitySchemes.bearerAuth.scheme).toBe("bearer");
    });

    test("publishes core auth/cart/checkout/products/orders paths", () => {
        const doc = loadOpenApi();
        const paths = listCorePaths(doc);
        expect(paths).toEqual(
            expect.arrayContaining([
                "/auth/login",
                "/auth/me",
                "/auth/status",
                "/products",
                "/products/{id}",
                "/cart",
                "/cart/add",
                "/checkout/quote",
                "/orders",
                "/orders/create-payment-intent",
                "/orders/my-orders"
            ])
        );
    });

    test("documents 401/409/422 on critical write paths", () => {
        const doc = loadOpenApi();
        expect(responseStatusesFor(doc, "/auth/login", "post")).toEqual(
            expect.arrayContaining(["200", "401", "422"])
        );
        expect(responseStatusesFor(doc, "/cart/add", "post")).toEqual(
            expect.arrayContaining(["200", "401", "409"])
        );
        expect(responseStatusesFor(doc, "/orders", "post")).toEqual(
            expect.arrayContaining(["201", "401", "409", "422"])
        );
    });

    test("defines shared envelope and pagination schemas", () => {
        const doc = loadOpenApi();
        const schemas = Object.keys(doc.components.schemas);
        expect(schemas).toEqual(
            expect.arrayContaining([
                "SuccessEnvelope",
                "ErrorEnvelope",
                "ValidationErrorEnvelope",
                "InventoryConflictEnvelope",
                "TotalMismatchEnvelope",
                "PaginationMeta",
                "PriceBreakdown",
                "CreateOrderRequest"
            ])
        );
    });
});
