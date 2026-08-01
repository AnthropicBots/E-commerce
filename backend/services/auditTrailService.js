const Negotiation = require('../models/Negotiation');
const crypto = require('crypto');

class AuditTrailService {
    constructor() {
        this.auditLogs = [];
        this.maxLogSize = 10000;
    }

    /**
     * Log audit event
     */
    async logEvent(negotiationId, event, details, actor = 'system') {
        const negotiation = await Negotiation.findOne({ negotiationId });
        if (!negotiation) {
            throw new Error('Negotiation not found');
        }

        const eventData = {
            event,
            details,
            timestamp: new Date(),
            actor,
            eventId: this.generateEventId()
        };

        await negotiation.addAuditEvent(event, details, actor);

        // Store in memory for quick access
        this.auditLogs.push(eventData);
        if (this.auditLogs.length > this.maxLogSize) {
            this.auditLogs = this.auditLogs.slice(-this.maxLogSize);
        }

        return eventData;
    }

    /**
     * Get audit trail for negotiation
     */
    async getAuditTrail(negotiationId, options = {}) {
        const { startDate, endDate, limit = 100, offset = 0 } = options;

        const query = { negotiationId };
        if (startDate || endDate) {
            query['auditTrail.timestamp'] = {};
            if (startDate) query['auditTrail.timestamp'].$gte = new Date(startDate);
            if (endDate) query['auditTrail.timestamp'].$lte = new Date(endDate);
        }

        const negotiation = await Negotiation.findOne(query)
            .select('auditTrail negotiationId');

        if (!negotiation) {
            throw new Error('Negotiation not found');
        }

        let auditTrail = negotiation.auditTrail || [];
        
        // Apply pagination
        auditTrail = auditTrail
            .sort((a, b) => b.timestamp - a.timestamp)
            .slice(offset, offset + limit);

        return {
            negotiationId,
            total: negotiation.auditTrail?.length || 0,
            data: auditTrail,
            pagination: {
                limit,
                offset,
                hasMore: (offset + limit) < (negotiation.auditTrail?.length || 0)
            }
        };
    }

    /**
     * Generate event ID
     */
    generateEventId() {
        return `EVT-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    }

    /**
     * Export audit trail for compliance
     */
    async exportAuditTrail(negotiationId, format = 'json') {
        const negotiation = await Negotiation.findOne({ negotiationId });
        if (!negotiation) {
            throw new Error('Negotiation not found');
        }

        const auditData = {
            negotiationId: negotiation.negotiationId,
            exportedAt: new Date(),
            format,
            data: negotiation.auditTrail || []
        };

        if (format === 'json') {
            return JSON.stringify(auditData, null, 2);
        } else if (format === 'csv') {
            return this.convertToCSV(auditData.data);
        }

        return auditData;
    }

    /**
     * Convert audit trail to CSV
     */
    convertToCSV(auditTrail) {
        if (!auditTrail || auditTrail.length === 0) {
            return 'No audit data available';
        }

        const headers = ['Event', 'Details', 'Timestamp', 'Actor'];
        const rows = auditTrail.map(event => [
            event.event,
            JSON.stringify(event.details || {}),
            event.timestamp,
            event.actor || 'system'
        ]);

        return [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
    }

    /**
     * Get audit summary
     */
    async getAuditSummary(negotiationId) {
        const negotiation = await Negotiation.findOne({ negotiationId });
        if (!negotiation) {
            throw new Error('Negotiation not found');
        }

        const trail = negotiation.auditTrail || [];
        
        // Count by event type
        const eventCounts = {};
        trail.forEach(event => {
            eventCounts[event.event] = (eventCounts[event.event] || 0) + 1;
        });

        return {
            negotiationId,
            totalEvents: trail.length,
            eventTypes: eventCounts,
            timeRange: {
                start: trail.length > 0 ? trail[0].timestamp : null,
                end: trail.length > 0 ? trail[trail.length - 1].timestamp : null
            },
            actors: [...new Set(trail.map(e => e.actor || 'system'))]
        };
    }

    /**
     * Generate audit report
     */
    async generateAuditReport(negotiationId) {
        const summary = await this.getAuditSummary(negotiationId);
        const fullTrail = await this.getAuditTrail(negotiationId, { limit: 1000 });

        return {
            reportId: `AUDIT-${crypto.randomBytes(4).toString('hex')}`,
            generatedAt: new Date(),
            summary,
            fullTrail: fullTrail.data,
            hash: this.generateReportHash(summary, fullTrail.data)
        };
    }

    generateReportHash(summary, trail) {
        const content = JSON.stringify({ summary, trail });
        return crypto.createHash('SHA256').update(content).digest('hex');
    }
}

module.exports = new AuditTrailService();