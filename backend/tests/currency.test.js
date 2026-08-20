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

// Whether the stand-in document claims to be able to draw a non-Latin-1
// character. Default false, which is what pdfkit's built-in Helvetica actually
// does: it carries WinAnsiEncoding, so U+20B9 (the rupee sign) has no glyph and
// `widthOfString` reports zero (#1608). Flipped to true by the one test that
// exercises the symbol path.
let mockFontHasUnicodeGlyphs = false;

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
            // The measurement surface the renderer probes. A WinAnsi font
            // returns 0 for anything outside Latin-1, which is precisely the
            // signal `resolveMoneyStyle` keys off.
            widthOfString: (value) => {
                const text = String(value ?? "");
                if (!text) return 0;
                if (!mockFontHasUnicodeGlyphs && /[^\u0000-\u00ff]/.test(text)) {
                    return 0;
                }
                return text.length * 5;
            },
            heightOfString: (value, options = {}) => {
                const width = options.width || 200;
                const perLine = Math.max(1, Math.floor(width / 5));
                return Math.ceil(String(value ?? "").length / perLine) * 12;
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
const {
    generateInvoicePdf,
    canRenderText,
    resolveMoneyStyle,
    formatAmount,
    resolveTotals,
    resolveAddress
} = require("../services/invoice.service");

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

describe("invoice money rendering", () => {
    beforeEach(() => {
        mockPdfDocuments.length = 0;
        mockFontHasUnicodeGlyphs = false;
    });

    it("falls back to the ISO code when the font cannot draw the symbol", async () => {
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

        // The symbol is dropped by the font, so it must not be the only thing
        // identifying the currency -- that was the whole of #1608.
        expect(printed).toContain(`${CURRENCY.code} 1,111.00`);
        expect(printed).not.toContain(CURRENCY.symbol);
        expect(printed).not.toContain("$");
    });

    it("uses the symbol when the font can draw it", async () => {
        mockFontHasUnicodeGlyphs = true;

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
        expect(printed).toContain(`Total: ${CURRENCY.symbol}1,111.00`);
    });

    it("never prints a bare amount with no currency at all", async () => {
        await generateInvoicePdf(
            { id: 44, created_at: "2024-05-01T00:00:00Z", subtotal: 10, final_amount: 10 },
            []
        );

        const [doc] = mockPdfDocuments;
        const printed = doc.texts.join("\n");

        expect(printed).toMatch(/Subtotal: (INR |\u20b9)10\.00/);
        expect(printed).toContain(`Amounts in ${CURRENCY.code}`);
    });

    it("reports the tax and shipping recorded against the order", async () => {
        await generateInvoicePdf(
            {
                id: 45,
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

        expect(printed).toContain(`Tax: ${CURRENCY.code} 162.00`);
        expect(printed).toContain(`Shipping: ${CURRENCY.code} 49.00`);
        expect(printed).toContain(`Total: ${CURRENCY.code} 1,111.00`);
    });

    it("omits a zero discount, tax and shipping rather than printing zeroes", async () => {
        await generateInvoicePdf(
            { id: 46, created_at: "2024-05-01T00:00:00Z", subtotal: 500, total: 500 },
            []
        );

        const [doc] = mockPdfDocuments;
        const printed = doc.texts.join("\n");

        expect(printed).not.toMatch(/Discount:/);
        expect(printed).not.toMatch(/Tax:/);
        expect(printed).not.toMatch(/Shipping:/);
        expect(printed).toContain(`Total: ${CURRENCY.code} 500.00`);
    });
});

describe("invoice helpers", () => {
    it("treats an unmeasurable glyph as unrenderable", () => {
        expect(canRenderText({}, "x")).toBe(false);
        expect(canRenderText({ widthOfString: () => { throw new Error("no font"); } }, "x")).toBe(false);
        expect(canRenderText({ widthOfString: () => 0 }, "x")).toBe(false);
        expect(canRenderText({ widthOfString: () => 4 }, "x")).toBe(true);
        expect(canRenderText({ widthOfString: () => 4 }, "")).toBe(false);
    });

    it("picks the style from what the document can draw", () => {
        expect(resolveMoneyStyle({ widthOfString: () => 6 })).toEqual({
            prefix: CURRENCY.symbol,
            usesSymbol: true
        });

        expect(resolveMoneyStyle({ widthOfString: () => 0 })).toEqual({
            prefix: `${CURRENCY.code} `,
            usesSymbol: false
        });
    });

    it("groups amounts for the configured locale", () => {
        // en-IN groups in lakhs, which is the point of reading the locale
        // rather than hard-coding a thousands separator.
        expect(formatAmount(1234567.5)).toBe("12,34,567.50");
        expect(formatAmount("49")).toBe("49.00");
        expect(formatAmount(undefined)).toBe("0.00");
        expect(formatAmount("not a number")).toBe("0.00");
    });

    it("prefers the explicit column but keeps a recorded zero", () => {
        expect(resolveTotals({ total: 0, final_amount: undefined }).total).toBe(0);
        expect(resolveTotals({ total: 10, final_amount: 25 }).total).toBe(25);
        expect(resolveTotals({ discount: 0, discount_amount: 40 }).discount).toBe(0);
        expect(resolveTotals({ discount_amount: 40 }).discount).toBe(40);
        expect(resolveTotals({}).subtotal).toBe(0);
    });

    it("builds one address line and survives a malformed blob", () => {
        expect(resolveAddress({ full_address: "12 MG Road, Pune" })).toBe("12 MG Road, Pune");
        expect(resolveAddress({ full_address: ", 12 MG Road" })).toBe("12 MG Road");
        expect(
            resolveAddress({ shipping_address: '{"street":"12 MG Road","city":"Pune","state":"MH","zip":"411001"}' })
        ).toBe("12 MG Road, Pune, MH 411001");
        expect(resolveAddress({ shipping_address: "{not json" })).toBe("");
        expect(resolveAddress({ shipping_address: { city: "Pune" } })).toBe("Pune");
        expect(resolveAddress({})).toBe("");
    });
});
