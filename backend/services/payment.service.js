let stripeInstance = null;

const getStripe = () => {
    if (!stripeInstance) {
        // In Jest, Stripe is mocked; allow a dummy key so unit tests do not
        // need a real secret. Production / staging still require STRIPE_SECRET_KEY.
        const apiKey = process.env.STRIPE_SECRET_KEY
            || (process.env.NODE_ENV === 'test' ? 'sk_test_dummy' : null);
        if (!apiKey) {
            throw new Error("STRIPE_SECRET_KEY is not defined in the environment variables.");
        }
        stripeInstance = require('stripe')(apiKey);
    }
    return stripeInstance;
};

const CURRENCY = require('../config/currency');
const {
    withChaos,
    CHAOS_POLICY,
    ChaosInjectedError
} = require('./chaosProxy');

/**
 * Payment Service Abstraction
 * This wrapper encapsulates Stripe logic to allow easier testing and
 * future migration to other payment providers if needed.
 *
 * Resilience policy (see chaosProxy.CHAOS_POLICY.payment):
 *   - timeoutMs: 10000
 *   - maxRetries: 2
 *   - retryBackoffMs: 200
 * Chaos injection (dev/staging only): CHAOS_ENABLED=true + CHAOS_PAYMENT=error|latency:N|timeout
 */

/**
 * Convert a decimal amount to the smallest unit the provider bills in.
 *
 * The exponent comes from the currency configuration rather than a hardcoded
 * hundred, because zero-decimal currencies would otherwise be charged a
 * hundred times over.
 *
 * @param {number} amount
 * @param {number} [minorUnitExponent]
 * @returns {number}
 */
const toMinorUnits = (amount, minorUnitExponent = CURRENCY.minorUnitExponent) => {
    const factor = 10 ** minorUnitExponent;
    return Math.round((Number(amount) || 0) * factor);
};

const createPaymentIntent = async (amount, currency = CURRENCY.code, metadata = {}) => {
    try {
        const result = await withChaos(
            'payment',
            async () => {
                const stripe = getStripe();
                const paymentIntent = await stripe.paymentIntents.create({
                    amount: toMinorUnits(amount),
                    // Stripe wants the ISO code lowercased; the configuration holds it
                    // in its canonical uppercase form.
                    currency: String(currency).toLowerCase(),
                    metadata,
                });

                return {
                    success: true,
                    clientSecret: paymentIntent.client_secret,
                    paymentIntentId: paymentIntent.id
                };
            },
            CHAOS_POLICY.payment
        );

        return result;
    } catch (error) {
        console.error('Error creating payment intent:', error);

        const isChaos = error instanceof ChaosInjectedError || error.code === 'CHAOS_INJECTED';
        return {
            success: false,
            error: isChaos
                ? (error.userMessage || error.message)
                : error.message,
            errorCode: isChaos ? 'CHAOS_INJECTED' : 'PAYMENT_ERROR',
            dependency: isChaos ? 'payment' : undefined,
            retryable: error.retryable !== false
        };
    }
};

const constructWebhookEvent = (rawBody, signature) => {
    try {
        const stripe = getStripe();
        const event = stripe.webhooks.constructEvent(
            rawBody,
            signature,
            process.env.STRIPE_WEBHOOK_SECRET
        );
        return { success: true, event };
    } catch (error) {
        console.error('Webhook signature verification failed.', error.message);
        return { success: false, error: error.message };
    }
};

module.exports = {
    toMinorUnits,
    createPaymentIntent,
    constructWebhookEvent,
    /** @deprecated test helper — exposes policy for resilience docs/tests */
    PAYMENT_RESILIENCE_POLICY: CHAOS_POLICY.payment
};
