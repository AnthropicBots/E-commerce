const CardActivity = require('../models/CardActivity');

class VelocityMonitoringService {
    constructor() {
        this.velocityWindows = {
            minute: 60 * 1000,
            hour: 60 * 60 * 1000,
            day: 24 * 60 * 60 * 1000
        };

        this.thresholds = {
            cardAddition: {
                minute: 1,
                hour: 3,
                day: 5
            },
            paymentAttempt: {
                minute: 2,
                hour: 10,
                day: 25
            },
            paymentFailure: {
                minute: 1,
                hour: 3,
                day: 5
            }
        };
    }

    /**
     * Monitor velocity for a specific action
     */
    async monitorVelocity(userId, action, metadata = {}) {
        const results = {};

        for (const [window, duration] of Object.entries(this.velocityWindows)) {
            const threshold = this.thresholds[action]?.[window];
            if (!threshold) continue;

            const count = await this.getActionCount(userId, action, duration);
            const isExceeded = count >= threshold;

            results[window] = {
                count,
                threshold,
                isExceeded,
                remaining: Math.max(0, threshold - count)
            };

            if (isExceeded) {
                // Log velocity violation
                await this.logVelocityViolation(userId, action, window, count, threshold, metadata);
            }
        }

        return results;
    }

    /**
     * Get action count for a user within a time window
     */
    async getActionCount(userId, action, duration) {
        const windowStart = new Date(Date.now() - duration);

        return await CardActivity.countDocuments({
            userId,
            action,
            timestamp: { $gte: windowStart }
        });
    }

    /**
     * Log velocity violation
     */
    async logVelocityViolation(userId, action, window, count, threshold, metadata) {
        console.warn(`🚨 Velocity violation detected:`, {
            userId,
            action,
            window,
            count,
            threshold,
            metadata,
            timestamp: new Date()
        });

        // Could also send alerts, emails, or webhooks here
    }

    /**
     * Get velocity summary for a user
     */
    async getVelocitySummary(userId) {
        const summary = {};

        for (const [action, thresholds] of Object.entries(this.thresholds)) {
            summary[action] = {};

            for (const [window, threshold] of Object.entries(thresholds)) {
                const duration = this.velocityWindows[window];
                const count = await this.getActionCount(userId, action, duration);

                summary[action][window] = {
                    count,
                    threshold,
                    percentage: Math.min(100, (count / threshold) * 100)
                };
            }
        }

        return summary;
    }

    /**
     * Check if user has high velocity overall
     */
    async isHighVelocityUser(userId) {
        const summary = await this.getVelocitySummary(userId);

        // Check if any action is near or over threshold
        for (const [action, windows] of Object.entries(summary)) {
            for (const [window, data] of Object.entries(windows)) {
                if (data.percentage >= 80) {
                    return true;
                }
            }
        }

        return false;
    }

    /**
     * Get all users with high velocity
     */
    async getHighVelocityUsers() {
        // This would be a more complex query in production
        // For now, just return a placeholder
        return [];
    }
}

module.exports = new VelocityMonitoringService();