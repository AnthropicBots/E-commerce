const promisePool = require("../config/db");
const { safeNumber } = require("../utils/helpers");

const subscriptionController = {
    // Subscribe user to a plan
    subscribe: async (req, res) => {
        let connection;
        try {
            connection = await promisePool.getConnection();
            const userId = req.user.id;
            const planId = safeNumber(req.body.planId);

            if (planId < 1) {
                return res.status(400).json({ success: false, message: "Invalid plan ID" });
            }

            const [plans] = await connection.query("SELECT * FROM billing_plans WHERE id = ? AND is_active = 1", [planId]);
            if (plans.length === 0) {
                return res.status(404).json({ success: false, message: "Billing plan not found" });
            }
            const plan = plans[0];

            // Check if already subscribed
            const [existing] = await connection.query("SELECT id FROM subscriptions WHERE user_id = ? AND status IN ('active', 'past_due', 'paused')", [userId]);
            if (existing.length > 0) {
                return res.status(400).json({ success: false, message: "User already has an active subscription" });
            }

            // Calculate period end
            const start = new Date();
            const end = new Date();
            if (plan.interval === 'monthly') end.setMonth(end.getMonth() + plan.interval_count);
            else if (plan.interval === 'yearly') end.setFullYear(end.getFullYear() + plan.interval_count);
            else if (plan.interval === 'weekly') end.setDate(end.getDate() + 7 * plan.interval_count);
            else if (plan.interval === 'daily') end.setDate(end.getDate() + plan.interval_count);

            await connection.query(
                "INSERT INTO subscriptions (user_id, plan_id, status, current_period_start, current_period_end) VALUES (?, ?, 'active', ?, ?)",
                [userId, planId, start, end]
            );

            return res.status(200).json({ success: true, message: "Subscribed successfully", periodEnd: end });
        } catch (error) {
            console.error("SUBSCRIBE ERROR:", error);
            return res.status(500).json({ success: false, message: "Failed to subscribe" });
        } finally {
            if (connection) connection.release();
        }
    },

    // Pause subscription
    pause: async (req, res) => {
        try {
            const userId = req.user.id;
            const [result] = await promisePool.query(
                "UPDATE subscriptions SET status = 'paused' WHERE user_id = ? AND status = 'active'",
                [userId]
            );

            if (result.affectedRows === 0) {
                return res.status(404).json({ success: false, message: "No active subscription found to pause" });
            }

            return res.status(200).json({ success: true, message: "Subscription paused" });
        } catch (error) {
            console.error("PAUSE SUBSCRIPTION ERROR:", error);
            return res.status(500).json({ success: false, message: "Failed to pause subscription" });
        }
    },

    // Resume subscription
    resume: async (req, res) => {
        try {
            const userId = req.user.id;
            const [result] = await promisePool.query(
                "UPDATE subscriptions SET status = 'active' WHERE user_id = ? AND status = 'paused'",
                [userId]
            );

            if (result.affectedRows === 0) {
                return res.status(404).json({ success: false, message: "No paused subscription found to resume" });
            }

            return res.status(200).json({ success: true, message: "Subscription resumed" });
        } catch (error) {
            console.error("RESUME SUBSCRIPTION ERROR:", error);
            return res.status(500).json({ success: false, message: "Failed to resume subscription" });
        }
    },

    // Cancel subscription
    cancel: async (req, res) => {
        try {
            const userId = req.user.id;
            const [result] = await promisePool.query(
                "UPDATE subscriptions SET cancel_at_period_end = 1 WHERE user_id = ? AND status IN ('active', 'paused')",
                [userId]
            );

            if (result.affectedRows === 0) {
                return res.status(404).json({ success: false, message: "No active subscription found to cancel" });
            }

            return res.status(200).json({ success: true, message: "Subscription will be canceled at the end of the billing period" });
        } catch (error) {
            console.error("CANCEL SUBSCRIPTION ERROR:", error);
            return res.status(500).json({ success: false, message: "Failed to cancel subscription" });
        }
    }
};

module.exports = subscriptionController;
