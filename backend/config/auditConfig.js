// backend/config/auditConfig.js

module.exports = {
    // Version
    version: '1.0.0',
    
    // Algorithm settings
    algorithm: 'sha256',
    encoding: 'hex',
    
    // Log levels
    logLevels: ['info', 'warning', 'error', 'critical'],
    
    // Retention
    retentionDays: 365 * 7, // 7 years
    complianceThreshold: 80, // 80% for compliance
    
    // Retry configuration
    retry: {
        maxAttempts: 3,
        baseDelay: 1000, // 1 second
        maxDelay: 10000 // 10 seconds
    },
    
    // Cache configuration
    cache: {
        ttl: 300, // 5 minutes
        enabled: true,
        maxKeys: 1000
    },
    
    // Rate limiting
    rateLimits: {
        maxRequests: 100,
        timeWindow: 60, // 1 minute
        blockDuration: 300 // 5 minutes
    },
    
    // Liability configuration
    liabilityConfig: {
        maxLiability: 1000000,
        defaultLiability: 10000,
        liabilityTiers: [
            {
                tier: 'low',
                amount: 10000,
                conditions: ['negotiation', 'information']
            },
            {
                tier: 'medium',
                amount: 50000,
                conditions: ['transaction', 'agreement']
            },
            {
                tier: 'high',
                amount: 100000,
                conditions: ['contract', 'legal']
            }
        ]
    },
    
    // Webhook configuration
    webhook: {
        enabled: true,
        endpoints: {
            slack: process.env.SLACK_WEBHOOK_URL,
            email: process.env.EMAIL_WEBHOOK_URL,
            alert: process.env.ALERT_WEBHOOK_URL
        },
        events: [
            'session_started',
            'certificate_created',
            'certificate_revoked',
            'compliance_violation',
            'circuit_breaker_opened'
        ]
    },
    
    // Monitoring
    monitoring: {
        enabled: true,
        metricsPrefix: 'audit_',
        collectDefault: true
    }
};