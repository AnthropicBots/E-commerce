// backend/middleware/webDeceptMiddleware.js
const webDeceptProtection = require('../services/webDeceptProtectionService');

/**
 * Middleware to validate URLs for agent navigation
 */
async function validateAgentNavigation(req, res, next) {
    try {
        const { targetUrl, context = {} } = req.body;

        if (!targetUrl) {
            return res.status(400).json({
                success: false,
                error: 'Target URL is required'
            });
        }

        // Validate the URL
        const validation = await webDeceptProtection.validateURL(targetUrl, {
            ...context,
            userId: req.user?.id,
            sessionId: req.session?.id
        });

        // Attach validation to request
        req.urlValidation = validation;

        // Block if invalid
        if (!validation.isValid) {
            return res.status(403).json({
                success: false,
                error: 'URL validation failed',
                trustScore: validation.trustScore,
                flags: validation.flags,
                threshold: DECEPTION_CONFIG.trustThreshold
            });
        }

        // Warn if low trust
        if (validation.trustScore < DECEPTION_CONFIG.trustThreshold + 10) {
            res.setHeader('X-Trust-Score', validation.trustScore);
            res.setHeader('X-URL-Status', 'low-trust');
        }

        next();
    } catch (error) {
        console.error('Agent navigation validation error:', error);
        res.status(500).json({
            success: false,
            error: 'URL validation failed'
        });
    }
}

/**
 * Middleware to detect redirect chain attacks
 */
async function detectRedirectChain(req, res, next) {
    try {
        const { redirects, targetUrl } = req.body;

        if (!redirects || !Array.isArray(redirects)) {
            return next();
        }

        const suspiciousRedirects = [];
        let redirectCount = 0;

        for (const redirect of redirects) {
            redirectCount++;
            
            // Check for redirect loops
            if (redirects.filter(r => r.url === redirect.url).length > 2) {
                suspiciousRedirects.push({
                    url: redirect.url,
                    reason: 'Redirect loop detected'
                });
            }

            // Check for domain changes
            if (redirectCount > 1) {
                const prevDomain = new URL(redirects[redirectCount - 2].url).hostname;
                const currentDomain = new URL(redirect.url).hostname;
                
                if (prevDomain !== currentDomain) {
                    suspiciousRedirects.push({
                        url: redirect.url,
                        reason: `Domain changed from ${prevDomain} to ${currentDomain}`
                    });
                    
                    webDeceptProtection.addSuspiciousRedirect(
                        redirects[redirectCount - 2].url,
                        redirect.url,
                        'Domain change during redirect chain'
                    );
                }
            }

            // Check for price manipulation
            if (redirect.price && redirect.originalPrice) {
                const priceChange = ((redirect.price - redirect.originalPrice) / redirect.originalPrice) * 100;
                if (priceChange > 50) {
                    suspiciousRedirects.push({
                        url: redirect.url,
                        reason: `Price changed by ${priceChange.toFixed(0)}%`
                    });
                }
            }
        }

        if (suspiciousRedirects.length > 0) {
            req.redirectChainWarnings = suspiciousRedirects;
            
            return res.status(403).json({
                success: false,
                error: 'Suspicious redirect chain detected',
                warnings: suspiciousRedirects,
                redirectCount
            });
        }

        next();
    } catch (error) {
        console.error('Redirect chain detection error:', error);
        next();
    }
}

module.exports = {
    validateAgentNavigation,
    detectRedirectChain
};