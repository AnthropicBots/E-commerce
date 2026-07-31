const NodeCache = require('node-cache');
const logger = require('../utils/logger');

const patternCache = new NodeCache({ stdTTL: 3600, checkperiod: 600 });

const INJECTION_PATTERNS = {
    system_override: [
        /ignore (?:all|previous|above|below|the above|the previous|the system) instructions/i,
        /you are now (?:acting as|role playing|pretending to be)/i,
        /forget (?:all|everything|previous|the previous) instructions/i,
        /new (?:role|mission|task|goal) for you/i,
        /i am your (?:new|real|actual|true) (?:creator|master|owner|user)/i,
        /the (?:admin|system|owner) said/i,
        /(?:fake|false|pretend) (?:employee|supplier|partner|staff)/i,
        /(?:ceo|cfo|founder|director|executive) (?:approved|authorized|allowed|said)/i
    ],
    authority_impersonation: [
        /i am (?:the|your) (?:ceo|founder|admin|owner|manager|executive)/i,
        /i (?:work|am) (?:from|with) (?:the|our) (?:company|organization|team)/i,
        /my (?:role|position|job title|designation) is/i,
        /i represent (?:the|our) (?:company|organization|brand)/i,
        /as (?:the|a) (?:admin|manager|supervisor|executive)/i
    ],
    request_manipulation: [
        /ignore (?:the|all) (?:rules|guidelines|policies|restrictions)/i,
        /give me (?:free|unlimited|infinite|all|max) (?:access|products|discounts)/i,
        /grant (?:me|everyone) (?:free|unlimited|max) (?:discounts|products|access)/i,
        /bypass (?:the|our) (?:system|security|validation|check)/i,
        /override (?:the|our) (?:system|security|validation|check)/i
    ],
    social_engineering: [
        /urgent (?:request|need|help|action) (?:from|for)/i,
        /this is (?:critical|urgent|important|emergency)/i,
        /don't tell (?:anyone|anybody|others)/i,
        /keep this (?:between us|confidential|secret)/i,
        /trust me (?:on|about) this/i,
        /i have (?:special|exclusive|insider) (?:access|knowledge)/i
    ],
    suspicious_entities: [
        /(?:fake|false|made-up|imaginary) (?:employee|staff|person)/i,
        /(?:invented|created|made) (?:company|organization|business)/i,
        /(?:fictional|nonexistent) (?:product|service|offer)/i
    ]
};

const MAX_PROMPT_LENGTH = parseInt(process.env.MAX_PROMPT_LENGTH) || 10000;
const CACHE_TTL = parseInt(process.env.PATTERN_CACHE_TTL) || 3600;

function compilePatterns() {
    const cacheKey = 'compiled_patterns';
    const cached = patternCache.get(cacheKey);
    if (cached) return cached;

    const compiled = {};
    for (const [category, patterns] of Object.entries(INJECTION_PATTERNS)) {
        compiled[category] = patterns.map(p => new RegExp(p.source, p.flags));
    }
    patternCache.set(cacheKey, compiled, CACHE_TTL);
    return compiled;
}

function validatePrompt(prompt) {
    if (!prompt || typeof prompt !== 'string') {
        throw new Error('Prompt must be a non-empty string');
    }
    if (prompt.length > MAX_PROMPT_LENGTH) {
        throw new Error(`Prompt exceeds maximum length of ${MAX_PROMPT_LENGTH} characters`);
    }
    return prompt.trim();
}

function extractEntities(text) {
    const entities = [];
    
    const namePattern = /\b[A-Z][a-z]+ (?:[A-Z][a-z]+ )*(?:from|at|of) [A-Z][a-z]+/g;
    const matches = text.match(namePattern) || [];
    entities.push(...matches);

    const companyPattern = /\b[A-Z][a-z]+ (?:Inc|Labs|Corp|Company|LLC|Ltd)\b/g;
    const companyMatches = text.match(companyPattern) || [];
    entities.push(...companyMatches);

    const rolePattern = /\b(?:CEO|CFO|COO|CTO|Founder|Director|Manager|Executive|Admin|Owner)\b/gi;
    const roleMatches = text.match(rolePattern) || [];
    entities.push(...roleMatches);

    return entities;
}

function sanitizePrompt(prompt) {
    let sanitized = prompt;
    sanitized = sanitized.replace(/```[\s\S]*?```/g, '[CODE_BLOCK_REMOVED]');
    sanitized = sanitized.replace(/`[^`]*`/g, '[INLINE_CODE_REMOVED]');
    sanitized = sanitized.replace(/\/\*[\s\S]*?\*\//g, '[COMMENT_REMOVED]');
    sanitized = sanitized.replace(/[.!?]{3,}/g, '...');
    sanitized = sanitized.replace(/\s+/g, ' ').trim();
    return sanitized;
}

async function analyzeUserIntent(prompt, userId, context = {}) {
    const startTime = Date.now();
    const results = {
        safe: true,
        riskScore: 0,
        riskLevel: 'low',
        detectedPatterns: [],
        sanitizedPrompt: prompt,
        suspiciousEntities: [],
        requiresConfirmation: false,
        duration: 0
    };

    try {
        const validatedPrompt = validatePrompt(prompt);
        const compiledPatterns = compilePatterns();

        for (const [category, patterns] of Object.entries(compiledPatterns)) {
            for (const pattern of patterns) {
                if (pattern.test(validatedPrompt)) {
                    const match = validatedPrompt.match(pattern);
                    results.detectedPatterns.push({
                        category,
                        pattern: pattern.toString(),
                        match: match ? match[0] : 'unknown'
                    });
                    results.riskScore += 1;
                }
            }
        }

        const entities = extractEntities(validatedPrompt);
        results.suspiciousEntities = entities.filter(e =>
            INJECTION_PATTERNS.suspicious_entities.some(p => p.test(e))
        );

        if (results.riskScore >= 5) {
            results.riskLevel = 'critical';
            results.requiresConfirmation = true;
            results.safe = false;
        } else if (results.riskScore >= 3) {
            results.riskLevel = 'high';
            results.requiresConfirmation = true;
            results.safe = false;
        } else if (results.riskScore >= 1) {
            results.riskLevel = 'medium';
            results.requiresConfirmation = true;
        }

        results.sanitizedPrompt = sanitizePrompt(validatedPrompt);
        results.duration = Date.now() - startTime;

        await logPromptAnalysis(userId, results, context);

        return results;

    } catch (error) {
        logger.error('Prompt analysis error:', {
            userId,
            error: error.message,
            stack: error.stack
        });
        return {
            ...results,
            safe: false,
            error: error.message,
            duration: Date.now() - startTime
        };
    }
}

async function requestAuthorization(userId, action, data) {
    try {
        const db = require('../config/db').promise;
        const [result] = await db.query(
            `INSERT INTO ai_authorization_requests 
             (user_id, action, data, status, created_at)
             VALUES (?, ?, ?, 'pending', NOW())`,
            [userId, action, JSON.stringify(data)]
        );
        return {
            status: 'pending_authorization',
            authId: result.insertId,
            message: 'This action requires authorization confirmation'
        };
    } catch (error) {
        logger.error('Authorization request error:', error);
        throw error;
    }
}

async function confirmAuthorization(authId, adminId, decision, notes) {
    try {
        const db = require('../config/db').promise;
        await db.query(
            `UPDATE ai_authorization_requests 
             SET status = ?, 
                 admin_id = ?, 
                 admin_notes = ?,
                 confirmed_at = NOW()
             WHERE id = ?`,
            [decision ? 'confirmed' : 'rejected', adminId, notes, authId]
        );
        logger.info(`Authorization ${decision ? 'confirmed' : 'rejected'}`, {
            authId,
            adminId,
            notes
        });
    } catch (error) {
        logger.error('Authorization confirmation error:', error);
        throw error;
    }
}

const RBAC_RULES = {
    admin: { canExecute: true, maxDiscount: 50, maxOrderValue: 100000, requireAuth: false },
    merchant: { canExecute: true, maxDiscount: 30, maxOrderValue: 50000, requireAuth: true },
    customer: { canExecute: true, maxDiscount: 20, maxOrderValue: 25000, requireAuth: true },
    guest: { canExecute: false, maxDiscount: 0, maxOrderValue: 0, requireAuth: true }
};

function checkRBAC(userRole, action, data) {
    const rules = RBAC_RULES[userRole] || RBAC_RULES.guest;

    if (!rules.canExecute) {
        return { allowed: false, reason: 'Insufficient permissions' };
    }

    if (data.discount && data.discount > rules.maxDiscount) {
        return {
            allowed: false,
            reason: `Discount exceeds ${rules.maxDiscount}% limit for ${userRole}`
        };
    }

    if (data.orderTotal && data.orderTotal > rules.maxOrderValue) {
        return {
            allowed: false,
            reason: `Order value exceeds ₹${rules.maxOrderValue} limit for ${userRole}`
        };
    }

    return { allowed: true };
}

async function logPromptAnalysis(userId, results, context) {
    try {
        const db = require('../config/db').promise;
        await db.query(
            `INSERT INTO ai_prompt_analytics 
             (user_id, risk_score, risk_level, detected_patterns, 
              suspicious_entities, sanitized_prompt, context, duration_ms, timestamp)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
            [
                userId,
                results.riskScore,
                results.riskLevel,
                JSON.stringify(results.detectedPatterns),
                JSON.stringify(results.suspiciousEntities),
                results.sanitizedPrompt,
                JSON.stringify(context),
                results.duration || 0
            ]
        );
    } catch (error) {
        logger.error('Error logging prompt analysis:', error);
    }
}

async function promptInjectionGuard(req, res, next) {
    try {
        const { prompt, action, data } = req.body;
        const userId = req.user?.id || 'anonymous';
        const userRole = req.user?.role || 'guest';

        if (!prompt) {
            return next();
        }

        const analysis = await analyzeUserIntent(prompt, userId, {
            action,
            ip: req.ip,
            userAgent: req.headers['user-agent']
        });

        if (analysis.error) {
            return res.status(400).json({
                success: false,
                error: 'Invalid prompt',
                details: analysis.error
            });
        }

        const rbacCheck = checkRBAC(userRole, action, data);
        if (!rbacCheck.allowed) {
            logger.warn('RBAC denied', { userId, userRole, action, reason: rbacCheck.reason });
            return res.status(403).json({
                success: false,
                error: 'Access denied',
                reason: rbacCheck.reason
            });
        }

        if (analysis.riskLevel === 'critical') {
            logger.warn('Critical prompt injection detected', {
                userId,
                riskLevel: analysis.riskLevel,
                patterns: analysis.detectedPatterns
            });
            return res.status(403).json({
                success: false,
                error: 'Prompt detected as potentially malicious',
                riskLevel: analysis.riskLevel,
                detectedPatterns: analysis.detectedPatterns
            });
        }

        if (analysis.requiresConfirmation && analysis.riskLevel !== 'low') {
            const authRequest = await requestAuthorization(userId, action, data);
            return res.status(202).json({
                success: true,
                message: 'Prompt requires authorization confirmation',
                riskLevel: analysis.riskLevel,
                authId: authRequest.authId,
                detectedPatterns: analysis.detectedPatterns
            });
        }

        req.sanitizedPrompt = analysis.sanitizedPrompt;
        req.promptAnalysis = analysis;
        next();

    } catch (error) {
        logger.error('Prompt injection guard error:', error);
        return res.status(500).json({
            success: false,
            error: 'Prompt validation failed',
            message: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}

function clearCache() {
    patternCache.flushAll();
    logger.info('Prompt injection pattern cache cleared');
    return { success: true };
}

function getCacheStats() {
    return {
        keys: patternCache.keys(),
        size: patternCache.keys().length,
        hits: patternCache.getStats?.().hits || 0,
        misses: patternCache.getStats?.().misses || 0
    };
}

async function healthCheck() {
    try {
        const compiled = compilePatterns();
        const patternCount = Object.values(compiled).reduce((sum, arr) => sum + arr.length, 0);
        return {
            status: 'healthy',
            patternCount,
            cacheSize: patternCache.keys().length,
            timestamp: new Date().toISOString()
        };
    } catch (error) {
        return {
            status: 'unhealthy',
            error: error.message,
            timestamp: new Date().toISOString()
        };
    }
}

module.exports = {
    promptInjectionGuard,
    analyzeUserIntent,
    confirmAuthorization,
    checkRBAC,
    INJECTION_PATTERNS,
    RBAC_RULES,
    clearCache,
    getCacheStats,
    healthCheck,
    compilePatterns
};