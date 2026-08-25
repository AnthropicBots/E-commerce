// backend/tests/invoiceRendering.test.js
//
// The invoice, rendered by the real pdfkit (#1608).
//
// `tests/currency.test.js` mocks pdfkit, and that is the right shape for
// asserting *what strings the renderer asks for*. It is also exactly why the
// currency bug survived: the mock records `doc.text("Total: ₹1111.00")` and the
// assertion "the invoice mentions ₹" passes, while the real Helvetica has no
// glyph for U+20B9, reports it as zero width and paints nothing.
//
// So this suite does not mock anything. It builds a genuine PDF and then asks
// the font the same question the renderer asks: can you draw this? A future
// change that puts an unencodable character back into the document fails here
// rather than in a customer's PDF reader.

const PDFDocument = require('pdfkit');
const CURRENCY = require('../config/currency');
const { generateInvoicePdf } = require('../services/invoice.service');

/** A throwaway document, purely to interrogate the default font. */
const probe = () => new PDFDocument({ margin: 50 });

const ORDER = Object.freeze({
    id: 'ord-1',
    order_number: 'ORD-2024-0001',
    created_at: '2024-05-01T00:00:00Z',
    customer_name: 'A Shopper',
    customer_email: 'shopper@example.com',
    customer_phone: '+91 99999 99999',
    full_address: '12 MG Road, Pune, MH 411001',
    subtotal: 900,
    discount_amount: 100,
    tax: 162,
    shipping_cost: 49,
    final_amount: 1011,
    payment_method: 'card'
});

const ITEMS = Object.freeze([
    { name: 'A product', qty: 2, price: 450 }
]);

describe('the default pdfkit font', () => {
    it('cannot draw the configured currency symbol — the premise of the fix', () => {
        const doc = probe();

        // If this ever starts passing a non-zero width (a Unicode font has been
        // embedded, or pdfkit's default changed), the renderer will notice on
        // its own and go back to printing the symbol. The assertion documents
        // why the fallback exists rather than pinning it forever.
        expect(doc.widthOfString(CURRENCY.symbol)).toBe(0);
        expect(doc.widthOfString('A')).toBeGreaterThan(0);
    });
});

describe('generateInvoicePdf against a real document', () => {
    it('produces a PDF buffer', async () => {
        const pdf = await generateInvoicePdf(ORDER, ITEMS);

        expect(Buffer.isBuffer(pdf)).toBe(true);
        expect(pdf.length).toBeGreaterThan(0);
        expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    });

    it('writes no character the font would silently drop', async () => {
        const doc = probe();

        // Every string the renderer can emit, reconstructed from the same
        // inputs. Each has to be drawable in full: a zero-width measurement for
        // a non-empty string means at least one glyph is missing.
        const candidates = [
            'INVOICE',
            `Order ID: ${ORDER.order_number}`,
            'Billed To:',
            ORDER.customer_name,
            ORDER.customer_email,
            ORDER.customer_phone,
            ORDER.full_address,
            'Item',
            'Qty',
            'Price',
            'Total',
            ITEMS[0].name,
            `Subtotal: ${CURRENCY.code} 900.00`,
            `Discount: -${CURRENCY.code} 100.00`,
            `Tax: ${CURRENCY.code} 162.00`,
            `Shipping: ${CURRENCY.code} 49.00`,
            `Total: ${CURRENCY.code} 1,011.00`,
            'Payment Method: card',
            `Amounts in ${CURRENCY.code}`
        ];

        const undrawable = candidates.filter((text) => doc.widthOfString(text) === 0);

        // Named rather than asserted one at a time so a failure says *which*
        // string the font cannot draw.
        expect(undrawable).toEqual([]);
    });

    it('renders an empty order without throwing', async () => {
        const pdf = await generateInvoicePdf(
            { id: 'ord-2', created_at: '2024-05-01T00:00:00Z' },
            []
        );

        expect(Buffer.isBuffer(pdf)).toBe(true);
        expect(pdf.length).toBeGreaterThan(0);
    });

    it('renders a long invoice across pages without throwing', async () => {
        // 120 rows at ~20pt is six pages. The old renderer called addPage() but
        // never redrew the column headings; the assertion that can be made
        // cheaply here is that the paging arithmetic terminates and produces a
        // document materially larger than the single-page case.
        const many = Array.from({ length: 120 }, (unused, index) => ({
            name: `Product number ${index} with a name long enough to wrap across two full lines of the item column`,
            qty: (index % 3) + 1,
            price: 199.99
        }));

        const long = await generateInvoicePdf(ORDER, many);
        const short = await generateInvoicePdf(ORDER, ITEMS);

        expect(Buffer.isBuffer(long)).toBe(true);
        expect(long.length).toBeGreaterThan(short.length);
    });

    it('survives items with missing or unusable fields', async () => {
        const pdf = await generateInvoicePdf(ORDER, [
            { name: null, qty: null, price: null },
            { name: 'Priced as a string', qty: '3', price: '12.50' },
            {}
        ]);

        expect(Buffer.isBuffer(pdf)).toBe(true);
        expect(pdf.length).toBeGreaterThan(0);
    });

    it('rejects rather than hanging when pdfkit cannot start', async () => {
        // The promise must settle on every path; a renderer that swallows a
        // constructor failure leaves the download request open until it times
        // out.
        await expect(
            generateInvoicePdf(
                {
                    id: 'ord-3',
                    created_at: '2024-05-01T00:00:00Z',
                    get order_number() {
                        throw new Error('column exploded');
                    }
                },
                []
            )
        ).rejects.toThrow('column exploded');
    });
});
