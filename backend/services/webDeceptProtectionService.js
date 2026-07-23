// backend/services/webDeceptProtectionService.js
const crypto = require('crypto');
const db = require('../config/db').promise;
const dns = require('dns').promises;
const https = require('https');
const url = require('url');

// ============================================
// CONFIGURATION
// ============================================

const DECEPTION_CONFIG = {
    // URL Validation
    allowedDomains: [
        'bhuvansh.xyz',
        'anthropicbots.com',
        'ecommerce.anthropicbots.com',
        'localhost',
        '127.0.0.1'
    ],
    blockedDomains: [
        'fake-checkout.com',
        'scam-site.net',
        'phishing-xyz.com',
        'malware-site.org'
    ],
    
    // SSL/TLS
    requireSSL: true,
    sslValidation: true,
    
    // Trust Scoring
    trustThreshold: 60,
    maxRedirects: 3,
    
    // Phishing Detection
    phishingPatterns: [
        /checkout|payment|login|signin|verify|secure/i,
        /account|banking|credit|card|paypal/i,
        /update|confirm|validate|authenticate/i
    ]
};

// ============================================
// WEB DECEPT PROTECTION CLASS
// ============================================

class WebDeceptProtection {
    constructor() {
        this.urlCache = new Map();
        this.trustCache = new Map();
        this.domainHistory = new Map();
        this.suspiciousRedirects = [];
    }

    /**
     * Validate URL for agent navigation
     */
    async validateURL(targetUrl, context = {}) {
        const results = {
            isValid: false,
            trustScore: 0,
            flags: [],
            warnings: [],
            details: {}
        };

        try {
            // 1. Parse URL
            const parsedUrl = new URL(targetUrl);
            results.details.parsedUrl = parsedUrl;

            // 2. Check allowlist
            const isAllowed = this.checkAllowedDomains(parsedUrl.hostname);
            if (!isAllowed) {
                results.flags.push({
                    type: 'domain_not_allowed',
                    severity: 'critical',
                    details: `Domain ${parsedUrl.hostname} is not in allowlist`
                });
                results.trustScore -= 50;
            }

            // 3. Check blocklist
            const isBlocked = this.checkBlockedDomains(parsedUrl.hostname);
            if (isBlocked) {
                results.flags.push({
                    type: 'domain_blocked',
                    severity: 'critical',
                    details: `Domain ${parsedUrl.hostname} is in blocklist`
                });
                results.trustScore -= 80;
                results.isValid = false;
                return results;
            }

            // 4. SSL/TLS Validation
            if (DECEPTION_CONFIG.requireSSL) {
                const sslResult = await this.validateSSL(parsedUrl.hostname);
                results.details.ssl = sslResult;
                if (!sslResult.valid) {
                    results.flags.push({
                        type: 'ssl_invalid',
                        severity: 'high',
                        details: sslResult.reason
                    });
                    results.trustScore -= 30;
                }
            }

            // 5. Phishing Detection
            const phishingResult = await this.detectPhishing(targetUrl, parsedUrl);
            if (phishingResult.isPhishing) {
                results.flags.push({
                    type: 'phishing_detected',
                    severity: 'critical',
                    details: phishingResult.reason
                });
                results.trustScore -= 60;
            }

            // 6. Domain Reputation Check
            const reputation = await this.checkDomainReputation(parsedUrl.hostname);
            results.details.reputation = reputation;
            if (reputation.trustScore < 50) {
                results.flags.push({
                    type: 'poor_reputation',
                    severity: 'high',
                    details: `Domain trust score: ${reputation.trustScore}`
                });
                results.trustScore -= 20;
            }

            // 7. Redirect Chain Analysis
            if (context.redirectCount && context.redirectCount > DECEPTION_CONFIG.maxRedirects) {
                results.flags.push({
                    type: 'excessive_redirects',
                    severity: 'high',
                    details: `More than ${DECEPTION_CONFIG.maxRedirects} redirects detected`
                });
                results.trustScore -= 25;
            }

            // 8. URL Pattern Analysis
            const patternResult = this.analyzeURLPatterns(targetUrl);
            if (patternResult.issues.length > 0) {
                results.flags.push(...patternResult.issues);
                results.trustScore -= patternResult.penalty;
            }

            // Calculate final trust score
            results.trustScore = Math.max(0, 100 + results.trustScore);
            results.trustScore = Math.min(100, results.trustScore);
            
            results.isValid = results.trustScore >= DECEPTION_CONFIG.trustThreshold;
            results.details.trustScore = results.trustScore;
            results.details.threshold = DECEPTION_CONFIG.trustThreshold;

            // Log the validation
            await this.logValidation(targetUrl, results, context);

            return results;
        } catch (error) {
            console.error('URL validation error:', error);
            return {
                isValid: false,
                trustScore: 0,
                flags: [{
                    type: 'validation_error',
                    severity: 'critical',
                    details: error.message
                }],
                warnings: [],
                details: { error: error.message }
            };
        }
    }

    /**
     * Check allowed domains
     */
    checkAllowedDomains(hostname) {
        return DECEPTION_CONFIG.allowedDomains.some(domain => 
            hostname === domain || hostname.endsWith(`.${domain}`)
        );
    }

    /**
     * Check blocked domains
     */
    checkBlockedDomains(hostname) {
        return DECEPTION_CONFIG.blockedDomains.some(domain => 
            hostname === domain || hostname.endsWith(`.${domain}`)
        );
    }

    /**
     * Validate SSL certificate
     */
    async validateSSL(hostname) {
        return new Promise((resolve) => {
            const req = https.request({
                hostname,
                port: 443,
                method: 'GET',
                path: '/',
                rejectUnauthorized: true,
                timeout: 5000
            }, (res) => {
                const cert = res.socket.getPeerCertificate();
                if (!cert || Object.keys(cert).length === 0) {
                    resolve({ valid: false, reason: 'No certificate provided' });
                    return;
                }

                // Check expiration
                const now = new Date();
                const validFrom = new Date(cert.valid_from);
                const validTo = new Date(cert.valid_to);

                if (now < validFrom) {
                    resolve({ valid: false, reason: 'Certificate not yet valid' });
                    return;
                }

                if (now > validTo) {
                    resolve({ valid: false, reason: 'Certificate expired' });
                    return;
                }

                resolve({
                    valid: true,
                    issuer: cert.issuer,
                    subject: cert.subject,
                    validFrom: cert.valid_from,
                    validTo: cert.valid_to
                });
            });

            req.on('error', (err) => {
                resolve({ valid: false, reason: err.message });
            });

            req.end();
        });
    }

    /**
     * Detect phishing
     */
    async detectPhishing(url, parsedUrl) {
        const results = {
            isPhishing: false,
            reason: '',
            confidence: 0
        };

        // Check for suspicious patterns
        for (const pattern of DECEPTION_CONFIG.phishingPatterns) {
            if (pattern.test(url)) {
                results.confidence += 20;
                results.reason = `URL matches phishing pattern: ${pattern}`;
            }
        }

        // Check for domain spoofing
        if (this.isDomainSpoofing(parsedUrl.hostname)) {
            results.confidence += 40;
            results.reason = 'Domain spoofing detected';
        }

        // Check for URL shortening services
        if (this.isURLShortener(parsedUrl.hostname)) {
            results.confidence += 15;
            results.reason = 'URL shortening service detected';
        }

        // Check for IP address usage (suspicious)
        if (parsedUrl.hostname.match(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/)) {
            results.confidence += 25;
            results.reason = 'IP address used instead of domain';
        }

        results.isPhishing = results.confidence > 50;
        return results;
    }

    /**
     * Check domain reputation
     */
    async checkDomainReputation(hostname) {
        // Check cache
        if (this.trustCache.has(hostname)) {
            return this.trustCache.get(hostname);
        }

        let trustScore = 100;
        const history = [];

        try {
            // Check domain age
            const whois = await this.getDomainWhois(hostname);
            if (whois) {
                const ageDays = (Date.now() - new Date(whois.creationDate).getTime()) / (1000 * 60 * 60 * 24);
                if (ageDays < 30) {
                    trustScore -= 30;
                    history.push('Domain is less than 30 days old');
                }
            }

            // Check DNS records
            const mxRecords = await dns.resolveMx(hostname).catch(() => []);
            if (mxRecords.length === 0) {
                trustScore -= 20;
                history.push('No MX records found');
            }

            // Check A records
            const aRecords = await dns.resolve4(hostname).catch(() => []);
            if (aRecords.length === 0) {
                trustScore -= 20;
                history.push('No A records found');
            }

            // Check domain history from database
            const [dbHistory] = await db.query(
                'SELECT * FROM domain_reputation WHERE domain = ?',
                [hostname]
            );

            if (dbHistory.length > 0) {
                trustScore -= dbHistory[0].penalty || 0;
                history.push(`Previous violations: ${dbHistory[0].violation_count || 0}`);
            }

        } catch (error) {
            console.error('Reputation check error:', error);
            trustScore -= 10;
        }

        const result = {
            trustScore: Math.max(0, trustScore),
            history,
            lastChecked: new Date().toISOString()
        };

        this.trustCache.set(hostname, result);
        return result;
    }

    /**
     * Get domain WHOIS info (simplified)
     */
    async getDomainWhois(domain) {
        // Placeholder - would use WHOIS API
        return {
            creationDate: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString()
        };
    }

    /**
     * Analyze URL patterns
     */
    analyzeURLPatterns(url) {
        const issues = [];
        let penalty = 0;

        // Check for unusual characters
        if (url.includes('%00') || url.includes('%0a') || url.includes('%0d')) {
            issues.push({
                type: 'encoding_attack',
                severity: 'critical',
                details: 'URL encoding attack detected'
            });
            penalty += 40;
        }

        // Check for protocol mixing
        if (url.includes('http://') && url.includes('https://')) {
            issues.push({
                type: 'protocol_mixing',
                severity: 'medium',
                details: 'Mixed HTTP/HTTPS protocols detected'
            });
            penalty += 10;
        }

        // Check for excessive query parameters
        const queryCount = (url.match(/[?&]/g) || []).length;
        if (queryCount > 10) {
            issues.push({
                type: 'excessive_parameters',
                severity: 'medium',
                details: `Too many query parameters: ${queryCount}`
            });
            penalty += 10;
        }

        // Check for suspicious path segments
        const suspiciousPaths = ['login', 'signin', 'verify', 'confirm', 'auth'];
        for (const path of suspiciousPaths) {
            if (url.includes(`/${path}`) || url.includes(`=${path}`)) {
                issues.push({
                    type: 'suspicious_path',
                    severity: 'low',
                    details: `Contains suspicious path: ${path}`
                });
                penalty += 5;
            }
        }

        return { issues, penalty: Math.min(50, penalty) };
    }

    /**
     * Detect domain spoofing
     */
    isDomainSpoofing(hostname) {
        const spoofingPatterns = [
            /paypal\.com\./i,
            /amazon\.com\./i,
            /google\.com\./i,
            /microsoft\.com\./i,
            /apple\.com\./i,
            /facebook\.com\./i,
            /twitter\.com\./i,
            /instagram\.com\./i,
            /whatsapp\.com\./i,
            /netflix\.com\./i
        ];

        return spoofingPatterns.some(pattern => 
            pattern.test(hostname) && !hostname.includes('paypal.com') && 
            !hostname.includes('amazon.com') && !hostname.includes('google.com')
        );
    }

    /**
     * Detect URL shorteners
     */
    isURLShortener(hostname) {
        const shorteners = [
            'bit.ly', 'goo.gl', 'tinyurl.com', 'ow.ly', 'is.gd',
            'buff.ly', 'bitly.com', 'tiny.cc', 'short.link', 'shorturl.at'
        ];
        return shorteners.includes(hostname);
    }

    /**
     * Log validation
     */
    async logValidation(url, results, context) {
        try {
            await db.query(
                `INSERT INTO webdecept_validation_logs 
                 (url, trust_score, flags, warnings, context, timestamp)
                 VALUES (?, ?, ?, ?, ?, NOW())`,
                [
                    url,
                    results.trustScore,
                    JSON.stringify(results.flags),
                    JSON.stringify(results.warnings),
                    JSON.stringify(context)
                ]
            );
        } catch (error) {
            console.error('Log validation error:', error);
        }
    }

    /**
     * Get URL trust score
     */
    getTrustScore(url) {
        if (this.urlCache.has(url)) {
            return this.urlCache.get(url);
        }
        return null;
    }

    /**
     * Add suspicious redirect
     */
    addSuspiciousRedirect(fromUrl, toUrl, reason) {
        this.suspiciousRedirects.push({
            fromUrl,
            toUrl,
            reason,
            timestamp: new Date().toISOString()
        });
    }

    /**
     * Get suspicious redirects
     */
    getSuspiciousRedirects() {
        return this.suspiciousRedirects;
    }

    /**
     * Get statistics
     */
    getStatistics() {
        return {
            urlCacheSize: this.urlCache.size,
            trustCacheSize: this.trustCache.size,
            suspiciousRedirects: this.suspiciousRedirects.length,
            domainHistorySize: this.domainHistory.size
        };
    }
}

// ============================================
// EXPORT
// ============================================

module.exports = new WebDeceptProtection();