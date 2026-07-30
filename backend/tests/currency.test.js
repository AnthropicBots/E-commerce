// Tests that display, invoicing and payment all trace back to one currency
// configuration (#1256), and that converting to the smallest unit is driven by
// the configured exponent rather than an assumed factor of a hundred.
//
// Stripe and pdfkit are mocked: neither is exercised, we only assert what the
// two layers hand them.

const mockPaymentIntentCreate = jest.fn(async (params) => ({
    id: "pi_test",
    client_secret: "cs_test",
    ...params
}));

jest.mock("stripe", () =>
    jest.fn(() => ({
        paymentIntents: { create: mockPaymentIntentCreate },
        webhooks: { constructEvent: jest.fn() }
    }))
);

const mockPdfDocuments = [];

jest.mock("pdfkit", () =>
    jest.fn(() => {
        const texts = [];
        const handlers = {};

        const doc = {
            texts,
            on: (event, handler) => {
                handlers[event] = handler;
                return doc;
            },
            text: (value) => {
                texts.push(String(value));
                return doc;
            },
            fillColor: () => doc,
            fontSize: () => doc,
            font: () => doc,
            moveTo: () => doc,
            lineTo: () => doc,
            stroke: () => doc,
            addPage: () => doc,
            end: () => {
                if (handlers.end) handlers.end();
            }
        };

        mockPdfDocuments.push(doc);
        return doc;
    })
);

const CURRENCY = require("../config/currency");
const PRICING_CONFIG = require("../config/pricingConfig");
const { toMinorUnits, createPaymentIntent } = require("../services/payment.service");
const { generateInvoicePdf } = require("../services/invoice.service");

describe("currency configuration", () => {
    it("is frozen so no caller can reassign the currency at runtime", () => {
        expect(Object.isFrozen(CURRENCY)).toBe(true);
    });

    it("is the same object the pricing engine stamps onto a breakdown", () => {
        expect(PRICING_CONFIG.CURRENCY).toBe(CURRENCY);
    });
});

describe("minor-unit conversion", () => {
    it("uses the configured exponent", () => {
        expect(CURRENCY.minorUnitExponent).toBe(2);
        expect(toMinorUnits(1234.56)).toBe(123456);
    });

    it("leaves a zero-decimal currency unmultiplied", () => {
        expect(toMinorUnits(1234, 0)).toBe(1234);
    });

    it("scales a three-decimal currency by a thousand", () => {
        expect(toMinorUnits(1.234, 3)).toBe(1234);
    });

    it("always yields a whole number of minor units", () => {
        expect(toMinorUnits(19.99)).toBe(1999);
        expect(Number.isInteger(toMinorUnits(0.1 + 0.2))).toBe(true);
    });

    it("treats an unusable amount as zero rather than NaN", () => {
        expect(toMinorUnits(undefined)).toBe(0);
    });
});

describe("payment layer", () => {
    beforeEach(() => {
        mockPaymentIntentCreate.mockClear();
    });

    it("defaults to the configured currency", async () => {
        await createPaymentIntent(1111);

        expect(mockPaymentIntentCreate).toHaveBeenCalledWith(
            expect.objectContaining({
                currency: CURRENCY.code.toLowerCase(),
                amount: 111100
            })
        );
    });

    it("does not charge in a hardcoded foreign currency", async () => {
        await createPaymentIntent(1111);

        const { currency } = mockPaymentIntentCreate.mock.calls[0][0];
        expect(currency).not.toBe("usd");
    });
});

describe("invoice layer", () => {
    beforeEach(() => {
        mockPdfDocuments.length = 0;
    });

    it("prints the configured symbol and never a dollar sign", async () => {
        await generateInvoicePdf(
            {
                id: 42,
                created_at: "2024-05-01T00:00:00Z",
                customer_name: "A Shopper",
                subtotal: 900,
                discount_amount: 100,
                tax: 162,
                shipping_cost: 49,
                final_amount: 1111,
                payment_method: "card"
            },
            [{ name: "A product", qty: 2, price: 450 }]
        );

        const [doc] = mockPdfDocuments;
        const printed = doc.texts.join("\n");

        expect(printed).toContain(CURRENCY.symbol);
        expect(printed).not.toContain("$");
        expect(printed).toContain(CURRENCY.code);
    });

    it("reports the tax and shipping recorded against the order", async () => {
        await generateInvoicePdf(
            {
                id: 43,
                created_at: "2024-05-01T00:00:00Z",
                subtotal: 900,
                tax: 162,
                shipping_cost: 49,
                final_amount: 1111
            },
            []
        );

        const [doc] = mockPdfDocuments;
        const printed = doc.texts.join("\n");

        expect(printed).toContain(`Tax: ${CURRENCY.symbol}162.00`);
        expect(printed).toContain(`Shipping: ${CURRENCY.symbol}49.00`);
        expect(printed).toContain(`Total: ${CURRENCY.symbol}1111.00`);
    });
});
