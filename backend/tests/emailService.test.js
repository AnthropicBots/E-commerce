'use strict';

const emailService = require('../services/emailService');

describe('emailService', () => {
    const originalEnv = process.env;

    beforeEach(() => {
        process.env = { ...originalEnv };
    });

    afterAll(() => {
        process.env = originalEnv;
    });

    it('gracefully logs email when SMTP is unconfigured', async () => {
        delete process.env.SMTP_HOST;
        delete process.env.SMTP_USER;
        delete process.env.SMTP_PASS;

        const orderData = {
            id: 'ord-test-100',
            orderNumber: 'ORD-1001',
            customerName: 'Test Customer',
            email: 'customer@example.com',
            subtotal: 1000,
            discountAmount: 100,
            tax: 50,
            shipping: 50,
            total: 1000,
            items: [
                { name: 'Product A', qty: 2, price: 500, color: 'Blue', size: 'M' }
            ]
        };

        const result = await emailService.sendOrderEmail('customer@example.com', orderData);

        expect(result.success).toBe(true);
        expect(result.delivered).toBe(false);
        expect(result.channel).toBe('log');
    });

    it('records logs and returns them via getEmailLogs', async () => {
        await emailService.recordEmailLog({
            recipient: 'audit@example.com',
            subject: 'Audit Email Test',
            orderNumber: 'ORD-9999',
            status: 'sent',
            channel: 'log'
        });

        const logs = await emailService.getEmailLogs(10);
        expect(Array.isArray(logs)).toBe(true);
        expect(logs.length).toBeGreaterThan(0);
        
        const matched = logs.find((l) => l.recipient === 'audit@example.com');
        expect(matched).toBeDefined();
        expect(matched.subject).toBe('Audit Email Test');
    });
});
