const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

/**
 * Payment Service Abstraction
 * This wrapper encapsulates Stripe logic to allow easier testing and 
 * future migration to other payment providers if needed.
 */

const createPaymentIntent = async (amount, currency = 'usd', metadata = {}) => {
    try {
        const paymentIntent = await stripe.paymentIntents.create({
            amount: Math.round(amount * 100), // Stripe expects amounts in cents
            currency,
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
    createPaymentIntent,
    constructWebhookEvent
};
