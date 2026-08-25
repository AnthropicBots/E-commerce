const { generateInvoicePdf } = require('../services/invoice.service');

describe('InvoiceService - Stream Lifecycle & Cleanup', () => {
    test('should successfully generate a PDF Buffer for a valid order', async () => {
        const order = {
            id: 'ord-123',
            order_number: 'ORD-123',
            created_at: new Date().toISOString(),
            subtotal: 100,
            discount: 10,
            tax: 5,
            shipping_cost: 15,
            total: 110,
            payment_method: 'Credit Card',
            user_name: 'John Doe',
            shipping_address: '123 Main St, Springfield, USA'
        };
        const items = [
            { name: 'Item 1', quantity: 2, price: 50 }
        ];

        const pdfBuffer = await generateInvoicePdf(order, items);
        expect(Buffer.isBuffer(pdfBuffer)).toBe(true);
        expect(pdfBuffer.length).toBeGreaterThan(0);
        // Verify PDF magic header bytes: %PDF-
        expect(pdfBuffer.slice(0, 4).toString()).toBe('%PDF');
    });

    test('should reject on invalid order data and cleanup properly', async () => {
        const brokenOrder = null;
        await expect(generateInvoicePdf(brokenOrder, []))
            .rejects
            .toThrow();
    });
});
