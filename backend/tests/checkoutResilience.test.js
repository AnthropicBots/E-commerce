/**
 * Checkout resilience scenarios (#1398)
 *
 * Covers:
 *  - Chaos master switch safety (off by default / blocked in production via envValidator)
 *  - Payment 500 / chaos error → user-visible failure, retryable flag
 *  - Redis-down style injection
 *  - Inventory locks released when payment chaos fails
 */

const mockPaymentIntentCreate = jest.fn(async (params) => ({
    id: 'pi_test',
    client_secret: 'cs_test',
    ...params
}));

jest.mock('stripe', () =>
    jest.fn(() => ({
        paymentIntents: { create: mockPaymentIntentCreate },
        webhooks: { constructEvent: jest.fn() }
    }))
);

describe('chaosProxy harness', () => {
    const ORIGINAL_ENV = { ...process.env };

    afterEach(() => {
        process.env = { ...ORIGINAL_ENV };
        jest.resetModules();
        mockPaymentIntentCreate.mockClear();
    });

    function loadChaos() {
        return require('../services/chaosProxy');
    }

    test('is disabled unless CHAOS_ENABLED=true', () => {
        process.env.NODE_ENV = 'test';
        delete process.env.CHAOS_ENABLED;
        delete process.env.CHAOS_PAYMENT;

        const { isChaosEnabled, parseChaosSpec, getChaosStatus } = loadChaos();

        expect(isChaosEnabled()).toBe(false);
        expect(parseChaosSpec('payment').mode).toBe('off');
        expect(getChaosStatus().enabled).toBe(false);
    });

    test('is hard-disabled in production even if CHAOS_ENABLED=true', () => {
        process.env.NODE_ENV = 'production';
        process.env.CHAOS_ENABLED = 'true';
        process.env.CHAOS_PAYMENT = 'error';

        const { isChaosEnabled, applyChaos } = loadChaos();

        expect(isChaosEnabled()).toBe(false);
        return expect(applyChaos('payment')).resolves.toEqual({ applied: false });
    });

    test('documents timeout/retry policy for checkout deps', () => {
        const { CHAOS_POLICY } = loadChaos();

        expect(CHAOS_POLICY.payment.timeoutMs).toBe(10_000);
        expect(CHAOS_POLICY.payment.maxRetries).toBe(2);
        expect(CHAOS_POLICY.redis.timeoutMs).toBe(2_000);
        expect(CHAOS_POLICY.mysql.maxRetries).toBe(0);
    });

    test('CHAOS_PAYMENT=error injects ChaosInjectedError', async () => {
        process.env.NODE_ENV = 'test';
        process.env.CHAOS_ENABLED = 'true';
        process.env.CHAOS_PAYMENT = 'error';

        const { withChaos, ChaosInjectedError } = loadChaos();

        await expect(
            withChaos('payment', async () => ({ ok: true }), { maxRetries: 0 })
        ).rejects.toMatchObject({
            name: 'ChaosInjectedError',
            code: 'CHAOS_INJECTED',
            dependency: 'payment'
        });

        expect(() => {
            throw new ChaosInjectedError('payment', 'error');
        }).toThrow(/Chaos injected/);
    });

    test('CHAOS_REDIS=error surfaces redis dependency failure', async () => {
        process.env.NODE_ENV = 'test';
        process.env.CHAOS_ENABLED = 'true';
        process.env.CHAOS_REDIS = 'error';

        const { withChaos } = loadChaos();

        await expect(
            withChaos('redis', async () => 'pong', { maxRetries: 0 })
        ).rejects.toMatchObject({
            dependency: 'redis',
            mode: 'error'
        });
    });

    test('releaseInventoryLocksOnChaosFail calls release fn', async () => {
        const { releaseInventoryLocksOnChaosFail } = loadChaos();
        const releaseFn = jest.fn(async () => true);

        const result = await releaseInventoryLocksOnChaosFail('user-1', releaseFn);

        expect(releaseFn).toHaveBeenCalledWith('user-1');
        expect(result).toEqual({ released: true });
    });
});

describe('payment.service under chaos', () => {
    const ORIGINAL_ENV = { ...process.env };

    beforeEach(() => {
        process.env = { ...ORIGINAL_ENV };
        process.env.NODE_ENV = 'test';
        process.env.STRIPE_SECRET_KEY = 'sk_test_chaos';
        jest.resetModules();
        mockPaymentIntentCreate.mockClear();
        mockPaymentIntentCreate.mockImplementation(async (params) => ({
            id: 'pi_test',
            client_secret: 'cs_test',
            ...params
        }));
    });

    afterEach(() => {
        process.env = { ...ORIGINAL_ENV };
    });

    test('happy path creates payment intent when chaos is off', async () => {
        process.env.CHAOS_ENABLED = 'false';
        process.env.CHAOS_PAYMENT = 'off';

        const { createPaymentIntent } = require('../services/payment.service');
        const result = await createPaymentIntent(499, 'INR', { orderId: 'o1' });

        expect(result.success).toBe(true);
        expect(result.paymentIntentId).toBe('pi_test');
        expect(mockPaymentIntentCreate).toHaveBeenCalled();
    });

    test('payment 500 / chaos error returns user-visible failure without charging', async () => {
        process.env.CHAOS_ENABLED = 'true';
        process.env.CHAOS_PAYMENT = 'error';

        const { createPaymentIntent } = require('../services/payment.service');
        const result = await createPaymentIntent(499, 'INR', { orderId: 'o1' });

        expect(result.success).toBe(false);
        expect(result.errorCode).toBe('CHAOS_INJECTED');
        expect(result.dependency).toBe('payment');
        expect(result.retryable).toBe(true);
        expect(String(result.error).length).toBeGreaterThan(0);
        expect(mockPaymentIntentCreate).not.toHaveBeenCalled();
    });
});

describe('checkout resilience: inventory locks on payment chaos', () => {
    const ORIGINAL_ENV = { ...process.env };

    afterEach(() => {
        process.env = { ...ORIGINAL_ENV };
        jest.resetModules();
    });

    test('payment chaos fail path releases inventory locks (no stock corruption hold)', async () => {
        process.env.NODE_ENV = 'test';
        process.env.CHAOS_ENABLED = 'true';
        process.env.CHAOS_PAYMENT = 'error';
        process.env.STRIPE_SECRET_KEY = 'sk_test_chaos';

        const releaseUserLocks = jest.fn(async () => true);
        jest.doMock('../services/inventoryReservationService', () => ({
            releaseUserLocks,
            validateCartLocksDetailed: jest.fn(),
            consumeLocks: jest.fn()
        }));

        const { createPaymentIntent } = require('../services/payment.service');
        const { releaseInventoryLocksOnChaosFail } = require('../services/chaosProxy');
        const inventoryReservationService = require('../services/inventoryReservationService');

        const paymentResult = await createPaymentIntent(100, 'INR', { orderId: 'ord-chaos' });
        expect(paymentResult.success).toBe(false);

        // Mirror orderController createPaymentIntent failure handling
        const release = await releaseInventoryLocksOnChaosFail(
            'user-chaos',
            (uid) => inventoryReservationService.releaseUserLocks(uid)
        );

        expect(release.released).toBe(true);
        expect(releaseUserLocks).toHaveBeenCalledWith('user-chaos');
    });
});

describe('envValidator chaos safety', () => {
    const ORIGINAL_ENV = { ...process.env };

    afterEach(() => {
        process.env = { ...ORIGINAL_ENV };
        jest.resetModules();
    });

    test('ENV_CONFIG documents CHAOS_* optional flags', () => {
        const { ENV_CONFIG } = require('../config/envValidator');
        const names = ENV_CONFIG.optional.map((c) => c.name);

        expect(names).toEqual(expect.arrayContaining([
            'CHAOS_ENABLED',
            'CHAOS_PAYMENT',
            'CHAOS_REDIS',
            'CHAOS_MYSQL'
        ]));
    });
});
