const NodeCache = require('node-cache');
const logger = require('../utils/logger');

const patternCache = new NodeCache({ stdTTL: 3600, checkperiod: 600 });

/** In-memory quarantine registry for agents / users that inject poisoned context */
const quarantineRegistry = new Map();

const INJECTION_PATTERNS = {
    system_override: [
        /ignore (?:all|previous|above|below|the above|the previous|the system) instructions/i,
        /you are now (?:acting as|role playing|pretending to be)/i,
        /forget (?:all|everything|previous|the previous) instructions/i,
        /new (?:role|mission|task|goal) for you/i,
        /i am your (?:new|real|actual|true) (?:creator|master|owner|user)/i,
        /the (?:admin|system|owner) said/i,
        /(?:fake|false|pretend) (?:employee|supplier|partner|staff)/i,
        /(?:ceo|cfo|founder|director|executive) (?:approved|authorized|allowed|said)/i,
        /system\s*override\s*:/i,
        /\[(?:system|admin|developer)\s*(?:override|prompt|message)\]/i,
        /(?:disregard|discard|skip)\s+(?:all\s+)?(?:safety|prior|earlier)\s+(?:rules|guards|instructions)/i,
        /approve\s+(?:full|entire|complete)\s+refund/i,
        /do\s+not\s+follow\s+(?:your|the)\s+(?:system|original)\s+prompt/i
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
    ],
    /** Indirect / context-poisoning vectors embedded in user-generated fields */
    context_poisoning: [
        /<\/?(?:system|assistant|instruction|prompt|policy)[^>]*>/i,
        /```(?:system|instruction|prompt)/i,
        /#+\s*(?:system|instructions?|developer)\s*(?:prompt|message)?/i,
        /(?:BEGIN|END)\s+(?:SYSTEM|INSTRUCTION|PROMPT)\b/i,
        /(?:untrusted|user)\s*data\s*(?:ends?|starts?)\s*(?:here)?/i,
        /\[\s*(?:INST|SYS|SYSTEM)\s*\]/i,
        /(?:act|respond)\s+as\s+(?:if\s+)?(?:you\s+are\s+)?(?:an?\s+)?(?:admin|root|god\s*mode)/i,
        /hidden\s+(?:instruction|directive|command)/i
    ]
};

const USER_CONTENT_FIELDS = [
    'review', 'reviews', 'comment', 'message', 'chatMessage', 'address',
    'shippingAddress', 'billingAddress', 'notes', 'description', 'content',
    'prompt', 'userText', 'supportMessage', 'feedback'
];

const MAX_PROMPT_LENGTH = parseInt(process.env.MAX_PROMPT_LENGTH, 10) || 10000;
const CACHE_TTL = parseInt(process.env.PATTERN_CACHE_TTL, 10) || 3600;
const ENTROPY_THRESHOLD = parseFloat(process.env.PROMPT_ENTROPY_THRESHOLD) || 4.8;
const QUARANTINE_TTL_MS = parseInt(process.env.AGENT_QUARANTINE_TTL_MS, 10) || 30 * 60 * 1000;
const QUARANTINE_RISK_LEVELS = new Set(['high', 'critical']);

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

/**
 * Shannon entropy over character distribution — high entropy often flags
 * obfuscated / encoded adversarial payloads mixed into natural language.
 */
function calculateShannonEntropy(text) {
    if (!text || text.length === 0) return 0;
    const freq = Object.create(null);
    for (const ch of text) {
        freq[ch] = (freq[ch] || 0) + 1;
    }
    const len = text.length;
    let entropy = 0;
    for (const count of Object.values(freq)) {
        const p = count / len;
        entropy -= p * Math.log2(p);
    }
    return entropy;
}

/**
 * Cheap perplexity-style heuristic: ratio of rare / mixed-case tokens
 * and non-alphanumeric density vs. plain prose.
 */
function estimateTokenPerplexity(text) {
    const tokens = text.split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return 0;

    let suspicious = 0;
    for (const token of tokens) {
        const hasMixedCase = /[a-z]/.test(token) && /[A-Z]/.test(token) && token.length > 4;
        const hasSpecials = (token.match(/[^a-zA-Z0-9]/g) || []).length / token.length > 0.3;
        const looksEncoded = /^[A-Za-z0-9+/=]{20,}$/.test(token);
        const looksHex = /^[0-9a-fA-F]{16,}$/.test(token);
        if (hasMixedCase || hasSpecials || looksEncoded || looksHex) {
            suspicious += 1;
        }
    }

    return suspicious / tokens.length;
}

/**
 * Wrap untrusted user data in structural delimiters so downstream LLMs
 * treat it as data, not instructions (instruction–data separation).
 */
function wrapWithBoundaryTags(text, fieldName = 'user_content') {
    const safeField = String(fieldName).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
    return [
        `<!-- UNTRUSTED_DATA_START:${safeField} -->`,
        `<untrusted_user_data field="${safeField}" trust="untrusted">`,
        '```user-data',
        text,
        '```',
        '</untrusted_user_data>',
        `<!-- UNTRUSTED_DATA_END:${safeField} -->`
    ].join('\n');
}

/**
 * Strip common injection wrappers and neutralize role-play markers
 * without destroying the original customer message meaning.
 */
function sanitizePrompt(prompt) {
    let sanitized = prompt;
    sanitized = sanitized.replace(/```[\s\S]*?```/g, '[CODE_BLOCK_REMOVED]');
    sanitized = sanitized.replace(/`[^`]*`/g, '[INLINE_CODE_REMOVED]');
    sanitized = sanitized.replace(/\/\*[\s\S]*?\*\//g, '[COMMENT_REMOVED]');
    sanitized = sanitized.replace(/<\/?(?:system|assistant|instruction|prompt|policy)[^>]*>/gi, '[TAG_REMOVED]');
    sanitized = sanitized.replace(/\[(?:SYSTEM|ADMIN|INST|SYS)\s*(?:OVERRIDE|PROMPT|MESSAGE)?\]/gi, '[MARKER_REMOVED]');
    sanitized = sanitized.replace(/system\s*override\s*:/gi, '[OVERRIDE_REMOVED]:');
    sanitized = sanitized.replace(/[.!?]{3,}/g, '...');
    sanitized = sanitized.replace(/\s+/g, ' ').trim();
    return sanitized;
}

function collectUserContentFromPayload(payload, prefix = '') {
    const collected = [];
    if (payload == null) return collected;

    if (typeof payload === 'string') {
        if (payload.trim()) {
            collected.push({ field: prefix || 'text', text: payload });
        }
        return collected;
    }

    if (Array.isArray(payload)) {
        payload.forEach((item, index) => {
            collected.push(...collectUserContentFromPayload(item, `${prefix}[${index}]`));
        });
        return collected;
    }

    if (typeof payload === 'object') {
        for (const [key, value] of Object.entries(payload)) {
            const path = prefix ? `${prefix}.${key}` : key;
            if (USER_CONTENT_FIELDS.includes(key) && typeof value === 'string') {
                collected.push({ field: path, text: value });
            } else if (value && typeof value === 'object') {
                collected.push(...collectUserContentFromPayload(value, path));
            }
        }
    }

    return collected;
}

function isQuarantined(subjectId) {
    if (!subjectId) return false;
    const entry = quarantineRegistry.get(String(subjectId));
    if (!entry) return false;
    if (Date.now() > entry.expiresAt) {
        quarantineRegistry.delete(String(subjectId));
        return false;
    }
    return true;
}

function quarantineAgent(subjectId, reason, meta = {}) {
    if (!subjectId) return null;
    const entry = {
        subjectId: String(subjectId),
        reason,
        meta,
        quarantinedAt: new Date().toISOString(),
        expiresAt: Date.now() + QUARANTINE_TTL_MS
    };
    quarantineRegistry.set(entry.subjectId, entry);
    logger.warn('Agent/user quarantined for prompt injection', entry);
    return entry;
}

function clearQuarantine(subjectId) {
    if (!subjectId) {
        quarantineRegistry.clear();
        return { success: true, cleared: 'all' };
    }
    quarantineRegistry.delete(String(subjectId));
    return { success: true, cleared: String(subjectId) };
}

function getQuarantineStatus(subjectId) {
    if (!subjectId) {
        return {
            count: quarantineRegistry.size,
            entries: [...quarantineRegistry.values()]
        };
    }
    const entry = quarantineRegistry.get(String(subjectId));
    return {
        quarantined: isQuarantined(subjectId),
        entry: entry || null
    };
}

/**
 * Multi-layer scan for direct prompts and indirect context poisoning.
 */
async function analyzeUserIntent(prompt, userId, context = {}) {
    const startTime = Date.now();
    const results = {
        safe: true,
        riskScore: 0,
        riskLevel: 'low',
        detectedPatterns: [],
        sanitizedPrompt: prompt,
        containedPrompt: null,
        suspiciousEntities: [],
        entropy: 0,
        perplexityHeuristic: 0,
        requiresConfirmation: false,
        quarantineTriggered: false,
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
                    // Context poisoning & system overrides weigh heavier
                    results.riskScore += (category === 'system_override' || category === 'context_poisoning') ? 2 : 1;
                }
            }
        }

        const entities = extractEntities(validatedPrompt);
        results.suspiciousEntities = entities.filter(e =>
            INJECTION_PATTERNS.suspicious_entities.some(p => p.test(e))
        );

        results.entropy = Number(calculateShannonEntropy(validatedPrompt).toFixed(3));
        results.perplexityHeuristic = Number(estimateTokenPerplexity(validatedPrompt).toFixed(3));

        if (results.entropy >= ENTROPY_THRESHOLD && validatedPrompt.length > 80) {
            results.detectedPatterns.push({
                category: 'entropy_anomaly',
                pattern: 'shannon_entropy',
                match: `entropy=${results.entropy}`
            });
            results.riskScore += 2;
        }

        if (results.perplexityHeuristic >= 0.35) {
            results.detectedPatterns.push({
                category: 'perplexity_anomaly',
                pattern: 'token_perplexity_heuristic',
                match: `ratio=${results.perplexityHeuristic}`
            });
            results.riskScore += 2;
        }

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

        const fieldName = context.fieldName || context.source || 'user_content';
        results.sanitizedPrompt = sanitizePrompt(validatedPrompt);
        results.containedPrompt = wrapWithBoundaryTags(results.sanitizedPrompt, fieldName);
        results.duration = Date.now() - startTime;

        if (QUARANTINE_RISK_LEVELS.has(results.riskLevel)) {
            const subject = context.agentId || userId;
            if (subject) {
                quarantineAgent(subject, 'prompt_injection_detected', {
                    riskLevel: results.riskLevel,
                    patterns: results.detectedPatterns.map(p => p.category)
                });
                results.quarantineTriggered = true;
            }
        }

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

/**
 * Scan product reviews, chat, address text, and nested agent payloads
 * for indirect prompt injection / context poisoning.
 */
async function detectContextPoisoning(payload, userId = 'anonymous', context = {}) {
    const fields = collectUserContentFromPayload(payload);
    const aggregate = {
        safe: true,
        riskLevel: 'low',
        riskScore: 0,
        fieldResults: [],
        quarantined: false,
        sanitizedPayload: payload
    };

    if (fields.length === 0) {
        return aggregate;
    }

    const sanitizedClone = (payload && typeof payload === 'object')
        ? JSON.parse(JSON.stringify(payload))
        : payload;

    for (const { field, text } of fields) {
        const analysis = await analyzeUserIntent(text, userId, {
            ...context,
            fieldName: field,
            source: 'context_poisoning_scan'
        });

        aggregate.fieldResults.push({
            field,
            riskLevel: analysis.riskLevel,
            riskScore: analysis.riskScore,
            safe: analysis.safe,
            detectedPatterns: analysis.detectedPatterns,
            sanitized: analysis.sanitizedPrompt,
            contained: analysis.containedPrompt
        });

        aggregate.riskScore = Math.max(aggregate.riskScore, analysis.riskScore);
        if (!analysis.safe) aggregate.safe = false;
        if (analysis.quarantineTriggered) aggregate.quarantined = true;

        const levelRank = { low: 0, medium: 1, high: 2, critical: 3 };
        if ((levelRank[analysis.riskLevel] || 0) > (levelRank[aggregate.riskLevel] || 0)) {
            aggregate.riskLevel = analysis.riskLevel;
        }

        // Apply sanitized text back onto clone when possible
        if (sanitizedClone && typeof sanitizedClone === 'object') {
            applySanitizedField(sanitizedClone, field, analysis.sanitizedPrompt);
        }
    }

    aggregate.sanitizedPayload = sanitizedClone;
    return aggregate;
}

function applySanitizedField(obj, path, value) {
    const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
    let cursor = obj;
    for (let i = 0; i < parts.length - 1; i++) {
        const key = parts[i];
        if (cursor[key] == null) return;
        cursor = cursor[key];
    }
    const last = parts[parts.length - 1];
    if (cursor && Object.prototype.hasOwnProperty.call(cursor, last)) {
        cursor[last] = value;
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
                JSON.stringify({
                    ...context,
                    entropy: results.entropy,
                    perplexityHeuristic: results.perplexityHeuristic,
                    quarantineTriggered: results.quarantineTriggered,
                    containedPrompt: results.containedPrompt
                        ? '[BOUNDARY_WRAPPED]'
                        : null
                }),
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
        const agentId = req.body?.agentId || req.headers['x-agent-id'];

        if (isQuarantined(agentId) || isQuarantined(userId)) {
            return res.status(403).json({
                success: false,
                error: 'Subject is quarantined due to prior prompt injection activity',
                errorCode: 'AGENT_QUARANTINED'
            });
        }

        // Indirect poisoning: scan nested user fields even without top-level prompt
        if (!prompt && data) {
            const poisonScan = await detectContextPoisoning(data, userId, {
                action,
                agentId,
                ip: req.ip,
                userAgent: req.headers['user-agent']
            });
            req.contextPoisoningScan = poisonScan;
            if (!poisonScan.safe && QUARANTINE_RISK_LEVELS.has(poisonScan.riskLevel)) {
                return res.status(403).json({
                    success: false,
                    error: 'Context poisoning detected in user-supplied fields',
                    riskLevel: poisonScan.riskLevel,
                    fields: poisonScan.fieldResults.map(f => ({
                        field: f.field,
                        riskLevel: f.riskLevel,
                        patterns: f.detectedPatterns
                    }))
                });
            }
            if (poisonScan.sanitizedPayload) {
                req.body.data = poisonScan.sanitizedPayload;
            }
            return next();
        }

        if (!prompt) {
            return next();
        }

        const analysis = await analyzeUserIntent(prompt, userId, {
            action,
            agentId,
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

        const rbacCheck = checkRBAC(userRole, action, data || {});
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
                detectedPatterns: analysis.detectedPatterns,
                quarantineTriggered: analysis.quarantineTriggered
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
        req.containedPrompt = analysis.containedPrompt;
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
            quarantineCount: quarantineRegistry.size,
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
    detectContextPoisoning,
    wrapWithBoundaryTags,
    calculateShannonEntropy,
    estimateTokenPerplexity,
    sanitizePrompt,
    quarantineAgent,
    clearQuarantine,
    getQuarantineStatus,
    isQuarantined,
    collectUserContentFromPayload,
    confirmAuthorization,
    checkRBAC,
    INJECTION_PATTERNS,
    USER_CONTENT_FIELDS,
    RBAC_RULES,
    clearCache,
    getCacheStats,
    healthCheck,
    compilePatterns
};
