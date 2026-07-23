const promisePool = require("../config/db");
const { performMockPayment } = require("../utils/helpers"); // Assume this exists or we mock it here

/**
 * Daily cron job to process subscription renewals
 */
async function processRenewals() {
    console.log("🔄 Starting subscription renewal job...");
    let connection;
    try {
        connection = await promisePool.getConnection();
        const now = new Date();
        
        // Find subscriptions due for renewal today (active or past_due)
        const [dueSubscriptions] = await connection.query(`
            SELECT s.*, p.price, p.interval, p.interval_count 
            FROM subscriptions s
            JOIN billing_plans p ON s.plan_id = p.id
            WHERE s.current_period_end <= ?
            AND s.status IN ('active', 'past_due')
        `, [now]);

        console.log(`Found ${dueSubscriptions.length} subscriptions due for renewal.`);

        for (const sub of dueSubscriptions) {
            await connection.beginTransaction();

            try {
                if (sub.cancel_at_period_end) {
                    await connection.query("UPDATE subscriptions SET status = 'canceled', canceled_at = ? WHERE id = ?", [now, sub.id]);
                    await connection.commit();
                    continue;
                }

                // Mock payment
                const paymentSuccess = Math.random() > 0.2; // 80% success rate
                
                if (paymentSuccess) {
                    // Update period end
                    const end = new Date(sub.current_period_end);
                    if (sub.interval === 'monthly') end.setMonth(end.getMonth() + sub.interval_count);
                    else if (sub.interval === 'yearly') end.setFullYear(end.getFullYear() + sub.interval_count);
                    else if (sub.interval === 'weekly') end.setDate(end.getDate() + 7 * sub.interval_count);
                    else if (sub.interval === 'daily') end.setDate(end.getDate() + sub.interval_count);

                    await connection.query(
                        "UPDATE subscriptions SET status = 'active', current_period_start = current_period_end, current_period_end = ?, dunning_retry_count = 0 WHERE id = ?",
                        [end, sub.id]
                    );
                    
                    // Create order (omitted for brevity, assume saga handles this later)
                    // ...
                    
                } else {
                    // Dunning management
                    const retries = sub.dunning_retry_count + 1;
                    if (retries >= 3) {
                        await connection.query("UPDATE subscriptions SET status = 'canceled', canceled_at = ?, dunning_retry_count = ? WHERE id = ?", [now, retries, sub.id]);
                    } else {
                        // Extend period by a bit or keep same but set past_due
                        await connection.query("UPDATE subscriptions SET status = 'past_due', dunning_retry_count = ? WHERE id = ?", [retries, sub.id]);
                    }
                }
                
                await connection.commit();
            } catch (err) {
                await connection.rollback();
                console.error(`Error processing subscription ${sub.id}:`, err);
            }
        }
    } catch (error) {
        console.error("RENEWAL JOB ERROR:", error);
    } finally {
        if (connection) connection.release();
    }
}

module.exports = processRenewals;
