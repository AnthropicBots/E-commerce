const { sendOrderEmail } = require('../services/emailService');

describe('EmailService - HTML Injection Sanitization', () => {
    test('sendOrderEmail should escape HTML entities in customer names and product details', async () => {
        const maliciousOrder = {
            orderNumber: 'ORD<script>alert(1)</script>',
            customerName: '<img src=x onerror=alert("XSS")>',
            customerEmail: 'test@example.com',
            shippingAddress: {
                street: '<b>123 Attack Rd</b>',
                city: 'City<script>',
                state: 'NY',
                zip: '10001'
            },
            items: [
                {
                    name: 'Product <iframe src=javascript:alert(1)>',
                    quantity: 1,
                    price: 100,
                    color: 'Red<script>',
                    size: 'XL" onmouseover="alert(1)'
                }
            ]
        };

        const result = await sendOrderEmail('test@example.com', maliciousOrder);
        expect(result.success).toBe(true);
        expect(result.html).toBeDefined();

        // Ensure raw unescaped script and HTML injection tags do not appear
        expect(result.html).not.toContain('<script>');
        expect(result.html).not.toContain('<img src=x');
        expect(result.html).not.toContain('<iframe');
        expect(result.html).toContain('&lt;script&gt;');
        expect(result.html).toContain('&lt;img src=x');
    });
});
