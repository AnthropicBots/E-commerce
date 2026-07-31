let stripeInstance = null;

const getStripe = () => {
    if (!stripeInstance) {
        const apiKey = process.env.STRIPE_SECRET_KEY;
        if (!apiKey) {
            throw new Error("STRIPE_SECRET_KEY is not defined in the environment variables.");
        }
        stripeInstance = require('stripe')(apiKey);
    }
    return stripeInstance;
};

const CURRENCY = require('../config/currency');

/**
 * Payment Service Abstraction
 * This wrapper encapsulates Stripe logic to allow easier testing and 
 * future migration to other payment providers if needed.
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
    } catch (error) {
        console.error('Error creating payment intent:', error);
        return {
            success: false,
            error: error.message
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
    constructWebhookEvent
};
