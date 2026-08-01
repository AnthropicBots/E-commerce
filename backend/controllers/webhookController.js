const db = require("../config/db");
const paymentService = require("../services/payment.service");

// Handle Stripe Webhook Events
const stripeWebhook = async (req, res) => {
    const signature = req.headers['stripe-signature'];
    
    // Verify the event using the payment service
    const verifyResult = paymentService.constructWebhookEvent(req.body, signature);
    
    if (!verifyResult.success) {
        return res.status(400).send(`Webhook Error: ${verifyResult.error}`);
    }

    const event = verifyResult.event;
    
    try {
        switch (event.type) {
            case 'payment_intent.succeeded':
                const paymentIntent = event.data.object;
                
                // Get order related to this payment intent
                if (paymentIntent.metadata && paymentIntent.metadata.orderId) {
                    const orderId = paymentIntent.metadata.orderId;
                    
                    // Update order status to paid
                    await db.query(
                        "UPDATE orders SET payment_status = ?, transaction_id = ? WHERE id = ?",
                        ['paid', paymentIntent.id, orderId]
                    );
                    
                    // You could also emit an event here to trigger emails, clear cart, etc.
                    console.log(`Payment succeeded for order ${orderId}`);
                }
                break;
                
            case 'payment_intent.payment_failed':
                const failedIntent = event.data.object;
                if (failedIntent.metadata && failedIntent.metadata.orderId) {
                    await db.query(
                        "UPDATE orders SET payment_status = ? WHERE id = ?",
                        ['failed', failedIntent.metadata.orderId]
                    );
                    console.log(`Payment failed for order ${failedIntent.metadata.orderId}`);
                }
                break;
                
            default:
                // Unhandled event type
                console.log(`Unhandled event type ${event.type}`);
        }

        // Return a response to acknowledge receipt of the event
        res.json({received: true});
    } catch (error) {
        console.error("Webhook processing error:", error);
        res.status(500).json({ error: "Webhook handler failed" });
    }
};

module.exports = {
    stripeWebhook
};
