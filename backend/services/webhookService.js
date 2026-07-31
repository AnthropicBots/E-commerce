// backend/services/webhookService.js
const axios = require('axios');
const logger = require('../config/logger');
const auditConfig = require('../config/auditConfig');

class WebhookService {
    constructor() {
        this.queue = [];
        this.processing = false;
        this.maxRetries = 3;
    }

    /**
     * Send Webhook Notification
     */
    async sendWebhook(data) {
        if (!auditConfig.webhook.enabled) {
            return;
        }

        const event = data.event || 'unknown';
        if (!auditConfig.webhook.events.includes(event)) {
            return;
        }

        const payload = {
            event: event,
            data: data.data,
            timestamp: data.timestamp || new Date().toISOString(),
            source: 'ai_audit_trail',
            environment: process.env.NODE_ENV || 'development'
        };

        // Add to queue
        this.queue.push({
            payload,
            retries: 0,
            endpoints: Object.values(auditConfig.webhook.endpoints).filter(Boolean)
        });

        if (!this.processing) {
            this.processQueue();
        }
    }

    /**
     * Send Alert
     */
    async sendAlert(alertData) {
        const payload = {
            type: 'alert',
            alert: alertData,
            timestamp: new Date().toISOString(),
            severity: this.getSeverity(alertData.type)
        };

        await this.sendWebhook({
            event: 'alert',
            data: payload,
            priority: 'high'
        });

        // Send critical alerts immediately
        if (alertData.type === 'circuit_breaker_opened' || 
            alertData.type === 'compliance_violation') {
            await this.sendImmediateAlert(payload);
        }
    }

    /**
     * Process Queue
     */
    async processQueue() {
        if (this.queue.length === 0) {
            this.processing = false;
            return;
        }

        this.processing = true;
        const item = this.queue.shift();

        try {
            await this.sendToEndpoints(item.payload, item.endpoints);
            logger.info(`Webhook sent successfully: ${item.payload.event}`);
        } catch (error) {
            logger.error('Webhook send error:', error);
            item.retries++;
            if (item.retries < this.maxRetries) {
                this.queue.push(item);
                logger.info(`Webhook requeued (attempt ${item.retries})`);
            } else {
                logger.error('Webhook failed after max retries:', item.payload);
            }
        }

        setTimeout(() => this.processQueue(), 100);
    }

    /**
     * Send to Multiple Endpoints
     */
    async sendToEndpoints(payload, endpoints) {
        const promises = endpoints.map(endpoint => {
            return axios.post(endpoint, payload, {
                timeout: 5000,
                headers: {
                    'Content-Type': 'application/json',
                    'X-Webhook-Source': 'ai_audit_trail'
                }
            }).catch(error => {
                logger.error(`Webhook endpoint error (${endpoint}):`, error.message);
                throw error;
            });
        });

        await Promise.allSettled(promises);
    }

    /**
     * Send Immediate Alert
     */
    async sendImmediateAlert(payload) {
        try {
            // Send to high-priority endpoints
            const priorityEndpoints = [
                auditConfig.webhook.endpoints.alert,
                auditConfig.webhook.endpoints.slack
            ].filter(Boolean);

            await this.sendToEndpoints(payload, priorityEndpoints);
        } catch (error) {
            logger.error('Immediate alert failed:', error);
        }
    }

    /**
     * Get Severity Level
     */
    getSeverity(type) {
        const severityMap = {
            'circuit_breaker_opened': 'critical',
            'compliance_violation': 'high',
            'certificate_revoked': 'high',
            'audit_critical_log': 'high',
            'certificate_creation_failed': 'medium',
            'session_started': 'low'
        };
        return severityMap[type] || 'medium';
    }
}

module.exports = new WebhookService();