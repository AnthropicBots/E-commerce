/**
 * Pact-like consumer contract checks (#1395).
 *
 * These encode what the vanilla JS storefront (consumer) expects from the
 * Express API (provider). They do not spin a live server — they freeze the
 * response shapes the UI already depends on and validate them against the
 * published OpenAPI schemas so frontend/backend drift fails in CI.
 */

const {
    loadOpenApi,
    createAjv,
    compileSchema,
    assertValid
} = require("./helpers/loadOpenApi");

describe("consumer contracts (storefront expectations)", () => {
    let openapi;
    let ajv;

    beforeAll(() => {
        openapi = loadOpenApi();
        ajv = createAjv();
    });

    describe("auth consumer", () => {
        test("login success exposes token + user for localStorage", () => {
            const body = {
                success: true,
                message: "Login successful",
                token: "access.jwt.token",
                refreshToken: "refresh.jwt.token",
                user: {
                    id: "u-1",
                    name: "Ada",
                    email: "ada@example.com",
                    role: "customer"
                }
            };
            assertValid(
                compileSchema(ajv, openapi, "LoginSuccess"),
                body,
                "auth login consumer"
            );
            expect(body.token || body.accessToken).toBeTruthy();
            expect(body.user.email).toContain("@");
        });

        test("401 login failure is a flat error envelope (no nested data required)", () => {
            const body = { success: false, message: "Invalid credentials" };
            assertValid(
                compileSchema(ajv, openapi, "ErrorEnvelope"),
                body,
                "auth 401 consumer"
            );
            expect(body.success).toBe(false);
        });
    });

    describe("products consumer", () => {
        test("list payload keeps pagination fields the shop grid reads", () => {
            const body = {
                success: true,
                products: [
                    {
                        id: "550e8400-e29b-41d4-a716-446655440010",
                        name: "Tee",
                        price: 499,
                        stock: 12,
                        category: "mens"
                    }
                ],
                total: 1,
                page: 1,
                limit: 20,
                totalPages: 1,
                hasNextPage: false,
                hasPrevPage: false
            };
            assertValid(
                compileSchema(ajv, openapi, "ProductListSuccess"),
                body,
                "products list consumer"
            );
        });
    });

    describe("cart consumer", () => {
        test("add-to-cart success is a SuccessEnvelope the toast can show", () => {
            const body = {
                success: true,
                message: "Product added to cart and reserved for 15 minutes"
            };
            assertValid(
                compileSchema(ajv, openapi, "SuccessEnvelope"),
                body,
                "cart add consumer"
            );
        });

        test("inventory 409 carries code the checkout UI branches on", () => {
            const body = {
                success: false,
                code: "INVENTORY_CONFLICT",
                message: "Insufficient stock",
                productId: "p-1",
                availableStock: 0,
                requested: 2
            };
            assertValid(
                compileSchema(ajv, openapi, "InventoryConflictEnvelope"),
                body,
                "cart 409 consumer"
            );
            expect(body.code).toBe("INVENTORY_CONFLICT");
        });
    });

    describe("checkout consumer", () => {
        test("quote returns breakdown.total used to submit orders", () => {
            const body = {
                success: true,
                breakdown: {
                    subtotal: 1000,
                    tax: 180,
                    shipping: 0,
                    discount: 50,
                    total: 1130,
                    promoCode: "SAVE50",
                    currency: "INR"
                },
                promoMessage: null
            };
            assertValid(
                compileSchema(ajv, openapi, "CheckoutQuoteSuccess"),
                body,
                "checkout quote consumer"
            );
            expect(typeof body.breakdown.total).toBe("number");
        });
    });

    describe("orders consumer", () => {
        test("create order success exposes orderId for success.html redirect", () => {
            const body = {
                success: true,
                message: "Order placed successfully",
                orderId: "550e8400-e29b-41d4-a716-446655440099",
                breakdown: {
                    subtotal: 1000,
                    tax: 180,
                    shipping: 49,
                    discount: 0,
                    total: 1229
                },
                addressId: null
            };
            assertValid(
                compileSchema(ajv, openapi, "OrderCreatedSuccess"),
                body,
                "orders create consumer"
            );
            expect(body.orderId).toBeTruthy();
        });

        test("TOTAL_MISMATCH 409 matches what checkout.js refreshes on", () => {
            const body = {
                success: false,
                code: "TOTAL_MISMATCH",
                message: "Submitted total does not match server price",
                submittedTotal: 100,
                computedTotal: 120
            };
            assertValid(
                compileSchema(ajv, openapi, "TotalMismatchEnvelope"),
                body,
                "orders 409 consumer"
            );
        });
    });
});
