// backend/tests/orderConfirmationEmail.test.js
//
// The order flow actually sends the confirmation (#1698).
//
// #1668 shipped emailService, the HTML template, the admin log viewer, the
// robots.txt entry and the vercel.json header rule -- and no caller. The only
// references to `sendOrderEmail` in the repo were its definition, its export
// and one unit test that called it directly, so the feature was complete
// everywhere except where it mattered.
//
// The suite that shipped with it could not have caught that: it tested the
// service in isolation, which is exactly the shape of test that passes while
// nothing calls the thing under test. These cover the wiring instead.

jest.mock('../services/emailService', () => ({
    sendOrderEmail: jest.fn(async () => ({ success: true, delivered: true, channel: 'smtp' })),
    recordEmailLog: jest.fn(async () => ({})),
    getEmailLogs: jest.fn(async () => [])
}));

const fs = require('fs');
const path = require('path');

const emailService = require('../services/emailService');
const {
    buildOrderEmailPayload,
    dispatchOrderConfirmation
} = require('../services/orderNotificationService');

/** A `createOrderService` return value, in the shape the real one produces. */
const ORDER_RESULT = {
    success: true,
    orderId: 'a1b2c3d4-0000-4000-8000-000000000001',
    orderNumber: 'ORD-2026-000123',
    subtotal: 2400,
    total: 2652,
    finalAmount: 2652,
    discountAmount: 200,
    promoCode: 'WELCOME200',
    breakdown: {
        subtotal: 2400,
        discount: 200,
        tax: 396,
        shipping: 56,
        total: 2652,
        promoCode: 'WELCOME200'
    },
    items: [
        { id: 'p1', name: 'Linen Shirt', price: 1200, qty: 2, color: 'Ecru', size: 'M' },
        { id: 'p2', name: 'Canvas Tote', price: 0, qty: 1, color: null, size: null }
    ]
};

const CUSTOMER = {
    name: 'Asha Menon',
    email: 'asha@example.com',
    phone: '9876543210'
};

const ADDRESS = {
    fullAddress: '12 Residency Road',
    city: 'Bengaluru',
    state: 'Karnataka',
    zip: '560025'
};

const dispatchArgs = (overrides = {}) => ({
    result: ORDER_RESULT,
    customer: CUSTOMER,
    address: ADDRESS,
    paymentMethod: 'cod',
    ...overrides
});

beforeEach(() => {
    jest.clearAllMocks();
});

describe('the order flow calls the mailer', () => {
    // Read straight from the controller. A unit test of the service can pass
    // with no caller at all -- that is the failure this file exists for -- so
    // the wiring is asserted at the source.
    const controller = fs.readFileSync(
        path.join(__dirname, '..', 'controllers', 'orderController.js'),
        'utf8'
    );

    test('orderController requires the notification service', () => {
        expect(controller).toMatch(
            /require\(\s*["']\.\.\/services\/orderNotificationService["']\s*\)/
        );
    });

    test('every createOrderService call site dispatches a confirmation', () => {
        const creates = (controller.match(/createOrderService\(/g) || []).length;
        const dispatches = (controller.match(/dispatchOrderConfirmation\(/g) || []).length;

        // Both call sites -- the main checkout and the card path -- and one
        // dispatch each. A third call site added later without a dispatch
        // fails here rather than shipping silently.
        expect(creates).toBe(2);
        expect(dispatches).toBe(creates);
    });

    test('the dispatch happens after the commit, never before', () => {
        // An email cannot be un-sent. Sending inside the transaction risks
        // telling a customer about an order that then rolls back, which is
        // strictly worse than a missing email.
        const segments = controller.split('dispatchOrderConfirmation(');

        segments.slice(0, -1).forEach((before) => {
            const lastCommit = before.lastIndexOf('connection.commit()');
            const lastCreate = before.lastIndexOf('createOrderService(');

            expect(lastCommit).toBeGreaterThan(-1);
            expect(lastCommit).toBeGreaterThan(lastCreate);
        });
    });

    test('the dispatch is not awaited into the order response', () => {
        // dispatchOrderConfirmation never rejects, but it can wait on an SMTP
        // handshake. The shopper should not sit on a spinner for it.
        expect(controller).not.toMatch(/await\s+orderNotificationService\.dispatchOrderConfirmation/);
    });
});

describe('buildOrderEmailPayload', () => {
    test('carries the identifiers the template renders', () => {
        const payload = buildOrderEmailPayload(dispatchArgs());

        expect(payload.orderNumber).toBe('ORD-2026-000123');
        expect(payload.orderId).toBe(ORDER_RESULT.orderId);
        expect(payload.customerName).toBe('Asha Menon');
        expect(payload.email).toBe('asha@example.com');
        expect(payload.paymentMethod).toBe('cod');
    });

    test('takes the money from the breakdown, not the convenience fields', () => {
        // The breakdown is what the pricing engine charged. The top-level
        // fields are copies of it, and a confirmation quoting a different
        // number from the invoice is a support ticket.
        const payload = buildOrderEmailPayload(dispatchArgs());

        expect(payload.subtotal).toBe(2400);
        expect(payload.discount).toBe(200);
        expect(payload.tax).toBe(396);
        expect(payload.shipping).toBe(56);
        expect(payload.total).toBe(2652);
    });

    test('prefers the breakdown when the two disagree', () => {
        const payload = buildOrderEmailPayload(
            dispatchArgs({
                result: {
                    ...ORDER_RESULT,
                    total: 9999,
                    subtotal: 8888
                }
            })
        );

        expect(payload.total).toBe(2652);
        expect(payload.subtotal).toBe(2400);
    });

    test('carries the lines as priced', () => {
        const payload = buildOrderEmailPayload(dispatchArgs());

        expect(payload.items).toHaveLength(2);
        expect(payload.items[0]).toEqual({
            name: 'Linen Shirt',
            qty: 2,
            price: 1200,
            color: 'Ecru',
            size: 'M'
        });
    });

    test('keeps a zero-priced line rather than dropping it', () => {
        // A free gift is still a line on the confirmation.
        const payload = buildOrderEmailPayload(dispatchArgs());

        expect(payload.items[1].name).toBe('Canvas Tote');
        expect(payload.items[1].price).toBe(0);
    });

    test('assembles the shipping address the template joins', () => {
        const payload = buildOrderEmailPayload(dispatchArgs());

        expect(payload.shippingAddress).toMatchObject({
            street: '12 Residency Road',
            city: 'Bengaluru',
            state: 'Karnataka',
            zip: '560025'
        });
    });

    test('survives a result with no items and no breakdown', () => {
        const payload = buildOrderEmailPayload({
            result: { orderId: 'x', orderNumber: 'ORD-1' },
            customer: CUSTOMER,
            address: {}
        });

        expect(payload.items).toEqual([]);
        expect(payload.total).toBe(0);
        expect(payload.subtotal).toBe(0);
    });
});

describe('dispatchOrderConfirmation', () => {
    test('sends to the customer email', async () => {
        await dispatchOrderConfirmation(dispatchArgs());

        expect(emailService.sendOrderEmail).toHaveBeenCalledTimes(1);

        const [recipient, payload] = emailService.sendOrderEmail.mock.calls[0];
        expect(recipient).toBe('asha@example.com');
        expect(payload.orderNumber).toBe('ORD-2026-000123');
    });

    test('skips, without throwing, when there is no recipient', async () => {
        const outcome = await dispatchOrderConfirmation(
            dispatchArgs({ customer: { name: 'Asha' } })
        );

        expect(outcome).toEqual({ success: false, reason: 'missing_recipient' });
        expect(emailService.sendOrderEmail).not.toHaveBeenCalled();
    });

    test('never rejects when the transport throws', async () => {
        // The checkout has committed: the customer has been charged, stock has
        // moved and the cart is closed. Throwing here would turn a completed
        // order into a 500 and invite the shopper to pay twice.
        emailService.sendOrderEmail.mockRejectedValueOnce(
            Object.assign(new Error('connect ETIMEDOUT smtp.example.com:587'), {
                code: 'ETIMEDOUT'
            })
        );

        await expect(dispatchOrderConfirmation(dispatchArgs())).resolves.toEqual({
            success: false,
            reason: 'send_failed'
        });
    });

    test('never rejects when the payload cannot be built', async () => {
        await expect(
            dispatchOrderConfirmation({ result: null, customer: CUSTOMER })
        ).resolves.toBeDefined();
    });

    test('passes the transport outcome back to the caller', async () => {
        emailService.sendOrderEmail.mockResolvedValueOnce({
            success: true,
            delivered: false,
            channel: 'log'
        });

        const outcome = await dispatchOrderConfirmation(dispatchArgs());

        expect(outcome).toMatchObject({ channel: 'log', delivered: false });
    });
});

describe('the payload satisfies the template', () => {
    // The template is substituted by literal {{name}} replacement, so a
    // placeholder the payload cannot fill renders as the raw {{token}} in the
    // customer's inbox.
    const template = fs.readFileSync(
        path.join(__dirname, '..', 'templates', 'order-confirmation.html'),
        'utf8'
    );

    const placeholders = [
        ...new Set((template.match(/{{\s*([A-Za-z0-9_]+)\s*}}/g) || [])
            .map((token) => token.replace(/[{}\s]/g, '')))
    ];

    test('the template still has placeholders to fill', () => {
        expect(placeholders.length).toBeGreaterThan(0);
    });

    test('every placeholder is one sendOrderEmail substitutes', () => {
        const service = fs.readFileSync(
            path.join(__dirname, '..', 'services', 'emailService.js'),
            'utf8'
        );

        const unsubstituted = placeholders.filter(
            (name) => !new RegExp(`{{${name}}}`).test(service)
        );

        expect(unsubstituted).toEqual([]);
    });
});

describe('the admin email log is reachable', () => {
    const frontend = (...parts) =>
        path.join(__dirname, '..', '..', 'frontend', ...parts);

    test('admin.html links to admin-email-logs.html', () => {
        // The page existed, was excluded from the sitemap and disallowed in
        // robots.txt -- and nothing linked to it, so an operator had to know
        // the filename (#1698).
        const adminHtml = fs.readFileSync(frontend('admin.html'), 'utf8');

        expect(adminHtml).toMatch(/href="admin-email-logs\.html"/);
    });

    test('the link is not a tab, so the switcher leaves it alone', () => {
        // admin.js switches panels on `.admin-tab`. A link carrying that class
        // would have its navigation swallowed.
        const adminHtml = fs.readFileSync(frontend('admin.html'), 'utf8');
        const item = adminHtml.match(
            /<li class="admin-nav-link">[\s\S]*?<\/li>/
        );

        expect(item).not.toBeNull();
        expect(item[0]).not.toMatch(/admin-tab/);
    });

    test('the email log page links back to the dashboard', () => {
        const logsHtml = fs.readFileSync(frontend('admin-email-logs.html'), 'utf8');

        expect(logsHtml).toMatch(/href="admin\.html"/);
    });
});
