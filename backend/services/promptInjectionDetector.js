const NodeCache = require('node-cache');
const logger = require('../utils/logger');
const crypto = require('crypto');
const db = require('../config/db').promise;

const patternCache = new NodeCache({ stdTTL: 3600, checkperiod: 600 });

const MAX_PROMPT_LENGTH = parseInt(process.env.MAX_PROMPT_LENGTH) || 10000;
const CACHE_TTL = parseInt(process.env.PATTERN_CACHE_TTL) || 3600;
const ENTROPY_THRESHOLD = parseFloat(process.env.ENTROPY_THRESHOLD) || 0.7;
const PERPLEXITY_THRESHOLD = parseFloat(process.env.PERPLEXITY_THRESHOLD) || 2.5;

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
        /system override:?/i,
        /override (?:all|current|previous) (?:rules|policies|constraints|restrictions)/i,
        /deactivate (?:safety|security|validation|check) protocols/i,
        /bypass (?:system|security|validation|fraud) checks/i
    ],
    
    authority_impersonation: [
        /i am (?:the|your) (?:ceo|founder|admin|owner|manager|executive|director)/i,
        /i (?:work|am) (?:from|with) (?:the|our) (?:company|organization|team)/i,
        /my (?:role|position|job title|designation) is/i,
        /i represent (?:the|our) (?:company|organization|brand)/i,
        /as (?:the|a) (?:admin|manager|supervisor|executive)/i,
        /authorized by (?:the|our) (?:management|leadership|board|director)/i,
        /acting on behalf of (?:the|our) (?:company|organization)/i
    ],
    
    request_manipulation: [
        /ignore (?:the|all) (?:rules|guidelines|policies|restrictions|constraints)/i,
        /give me (?:free|unlimited|infinite|all|max) (?:access|products|discounts|refunds)/i,
        /grant (?:me|everyone) (?:free|unlimited|max) (?:discounts|products|access)/i,
        /bypass (?:the|our) (?:system|security|validation|check|verification)/i,
        /override (?:the|our) (?:system|security|validation|check|verification)/i,
        /refund (?:full|complete|all) amount/i,
        /waive (?:all|any) (?:fees|charges|restrictions|limits)/i,
        /approve immediately without (?:check|review|validation|verification)/i
    ],
    
    social_engineering: [
        /urgent (?:request|need|help|action) (?:from|for)/i,
        /this is (?:critical|urgent|important|emergency)/i,
        /don't tell (?:anyone|anybody|others)/i,
        /keep this (?:between us|confidential|secret)/i,
        /trust me (?:on|about) this/i,
        /i have (?:special|exclusive|insider) (?:access|knowledge|information)/i,
        /(?:unusual|irregular) (?:circumstances|situation|case) requires exception/i,
        /escalate to (?:management|supervisor|leadership) immediately/i
    ],
    
    suspicious_entities: [
        /(?:fake|false|made-up|imaginary) (?:employee|staff|person|user)/i,
        /(?:invented|created|made) (?:company|organization|business)/i,
        /(?:fictional|nonexistent) (?:product|service|offer|order)/i,
        /(?:previously|never) (?:existed|was created|was made)/i,
        /(?:forged|fabricated|counterfeit) (?:document|receipt|invoice|order)/i
    ],
    
    hidden_instructions: [
        /<!--[\s\S]*?-->/g,  // HTML comments
        /\/\*[\s\S]*?\*\//g,  // C-style comments
        /`[^`]*`/g,  // Inline code
        /```[\s\S]*?```/g,  // Code blocks
        /\[hide\][\s\S]*?\[\/hide\]/gi,  // Hidden sections
        /\[secret\][\s\S]*?\[\/secret\]/gi,  // Secret sections
        /\[system\][\s\S]*?\[\/system\]/gi,  // System sections
        /<[^>]*>/g,  // HTML tags
        /\b(?:instruction|command|order|directive)[\s:]+(?!.*?\.)(.*?)(?:\n|$)/gi
    ],
    
    // Layer 7: Context Poisoning
    context_poisoning: [
        /(?:context|background|history|previous).*?ignore/i,
        /(?:forget|ignore|disregard).*?(?:all|everything|previous|above|below)/i,
        /(?:assume|pretend|imagine).*?(?:you are|you're).*?(?:admin|system|owner)/i,
        /(?:redefine|reinterpret|reimagine).*?(?:policy|rule|guideline)/i,
        /(?:reframe|recontextualize).*?(?:request|order|transaction)/i,
        /(?:actual|real|true).*?(?:intent|meaning|purpose).*?is/i
    ],
    
    boundary_tags: [
        /<system>[\s\S]*?<\/system>/gi,
        /<instruction>[\s\S]*?<\/instruction>/gi,
        /<command>[\s\S]*?<\/command>/gi,
        /<override>[\s\S]*?<\/override>/gi,
        /<rule>[\s\S]*?<\/rule>/gi,
        /<policy>[\s\S]*?<\/policy>/gi,
        /#system[\s\S]*?(?:\n|$)/gi,
        /#instruction[\s\S]*?(?:\n|$)/gi,
        /#override[\s\S]*?(?:\n|$)/gi,
        /##[\s\S]*?system[\s\S]*?(?:\n|$)/gi
    ]
};

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

function calculateEntropy(text) {
    const length = text.length;
    if (length === 0) return 0;
    
    const charCount = {};
    for (const char of text) {
        charCount[char] = (charCount[char] || 0) + 1;
    }
    
    let entropy = 0;
    for (const char in charCount) {
        const probability = charCount[char] / length;
        entropy -= probability * Math.log2(probability);
    }
    
    return entropy;
}

function calculatePerplexity(text) {
    const length = text.length;
    if (length < 3) return 0;
    
    // Calculate bigram entropy
    const bigrams = {};
    let totalBigrams = 0;
    
    for (let i = 0; i < length - 1; i++) {
        const bigram = text.substring(i, i + 2);
        bigrams[bigram] = (bigrams[bigram] || 0) + 1;
        totalBigrams++;
    }
    
    let entropy = 0;
    for (const bigram in bigrams) {
        const probability = bigrams[bigram] / totalBigrams;
        entropy -= probability * Math.log2(probability);
    }
    
    // Perplexity = 2^entropy
    return Math.pow(2, entropy);
}

function detectHiddenInstructions(text) {
    const hiddenPatterns = INJECTION_PATTERNS.hidden_instructions;
    const detections = [];
    
    for (const pattern of hiddenPatterns) {
        const matches = text.match(pattern);
        if (matches) {
            for (const match of matches) {
                detections.push({
                    type: 'hidden_instruction',
                    pattern: pattern.toString(),
                    match: match,
                    length: match.length
                });
            }
        }
    }
    
    return detections;
}

function isolateBoundaries(text) {
    const boundaryPatterns = INJECTION_PATTERNS.boundary_tags;
    const boundaries = [];
    let isolatedText = text;
    
    for (const pattern of boundaryPatterns) {
        const matches = text.match(pattern);
        if (matches) {
            for (const match of matches) {
                boundaries.push({
                    type: 'boundary_tag',
                    pattern: pattern.toString(),
                    match: match,
                    content: match.replace(/<[^>]*>|#[a-z]+/g, '').trim()
                });
                // Remove boundary content from isolation text
                isolatedText = isolatedText.replace(match, '[BOUNDARY_REMOVED]');
            }
        }
    }
    
    return { boundaries, isolatedText };
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
    
    // Extract names
    const namePattern = /\b[A-Z][a-z]+ (?:[A-Z][a-z]+ )*(?:from|at|of) [A-Z][a-z]+/g;
    const matches = text.match(namePattern) || [];
    entities.push(...matches);

    // Extract companies
    const companyPattern = /\b[A-Z][a-z]+ (?:Inc|Labs|Corp|Company|LLC|Ltd|Technologies|Solutions)\b/g;
    const companyMatches = text.match(companyPattern) || [];
    entities.push(...companyMatches);

    // Extract roles
    const rolePattern = /\b(?:CEO|CFO|COO|CTO|Founder|Director|Manager|Executive|Admin|Owner|Supervisor)\b/gi;
    const roleMatches = text.match(rolePattern) || [];
    entities.push(...roleMatches);

    // Extract emails
    const emailPattern = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
    const emailMatches = text.match(emailPattern) || [];
    entities.push(...emailMatches);

    return entities;
}

function sanitizePrompt(prompt) {
    let sanitized = prompt;
    
    // Remove code blocks
    sanitized = sanitized.replace(/```[\s\S]*?```/g, '[CODE_BLOCK_REMOVED]');
    sanitized = sanitized.replace(/`[^`]*`/g, '[INLINE_CODE_REMOVED]');
    
    // Remove comments
    sanitized = sanitized.replace(/\/\*[\s\S]*?\*\//g, '[COMMENT_REMOVED]');
    sanitized = sanitized.replace(/<!--[\s\S]*?-->/g, '[HTML_COMMENT_REMOVED]');
    
    // Normalize whitespace
    sanitized = sanitized.replace(/[.!?]{3,}/g, '...');
    sanitized = sanitized.replace(/\s+/g, ' ').trim();
    
    // Remove boundary tags
    for (const pattern of INJECTION_PATTERNS.boundary_tags) {
        sanitized = sanitized.replace(pattern, '[BOUNDARY_REMOVED]');
    }
    
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
        hiddenInstructions: [],
        boundaryTags: [],
        entropy: 0,
        perplexity: 0,
        requiresConfirmation: false,
        quarantineTriggered: false,
        duration: 0,
        userId
    };

    try {
        const validatedPrompt = validatePrompt(prompt);
        const compiledPatterns = compilePatterns();

        // 1. Calculate entropy and perplexity
        results.entropy = calculateEntropy(validatedPrompt);
        results.perplexity = calculatePerplexity(validatedPrompt);

        // 2. Check for abnormal entropy (potential hidden instructions)
        if (results.entropy > ENTROPY_THRESHOLD) {
            results.detectedPatterns.push({
                category: 'abnormal_entropy',
                pattern: 'entropy_threshold',
                match: `Entropy: ${results.entropy.toFixed(2)} (threshold: ${ENTROPY_THRESHOLD})`,
                severity: 'high'
            });
            results.riskScore += 3;
        }

        // 3. Check for abnormal perplexity (potential adversarial content)
        if (results.perplexity > PERPLEXITY_THRESHOLD) {
            results.detectedPatterns.push({
                category: 'abnormal_perplexity',
                pattern: 'perplexity_threshold',
                match: `Perplexity: ${results.perplexity.toFixed(2)} (threshold: ${PERPLEXITY_THRESHOLD})`,
                severity: 'medium'
            });
            results.riskScore += 2;
        }

        // 4. Detect hidden instructions
        results.hiddenInstructions = detectHiddenInstructions(validatedPrompt);
        if (results.hiddenInstructions.length > 0) {
            for (const instruction of results.hiddenInstructions) {
                results.detectedPatterns.push({
                    category: 'hidden_instruction',
                    pattern: instruction.pattern,
                    match: instruction.match.substring(0, 100),
                    severity: 'critical'
                });
                results.riskScore += 4;
            }
        }

        // 5. Isolate boundary tags
        const boundaryResult = isolateBoundaries(validatedPrompt);
        results.boundaryTags = boundaryResult.boundaries;
        if (results.boundaryTags.length > 0) {
            for (const boundary of results.boundaryTags) {
                results.detectedPatterns.push({
                    category: 'boundary_tag',
                    pattern: boundary.pattern,
                    match: boundary.match.substring(0, 100),
                    content: boundary.content,
                    severity: 'critical'
                });
                results.riskScore += 5;
            }
        }

        // 6. Detect system override vectors
        for (const [category, patterns] of Object.entries(compiledPatterns)) {
            for (const pattern of patterns) {
                if (pattern.test(validatedPrompt)) {
                    const match = validatedPrompt.match(pattern);
                    let severity = 'medium';
                    
                    // Critical patterns
                    if (['system_override', 'boundary_tags'].includes(category)) {
                        severity = 'critical';
                    } else if (['authority_impersonation', 'context_poisoning'].includes(category)) {
                        severity = 'high';
                    } else if (['request_manipulation'].includes(category)) {
                        severity = 'high';
                    }
                    
                    results.detectedPatterns.push({
                        category,
                        pattern: pattern.toString(),
                        match: match ? match[0].substring(0, 200) : 'unknown',
                        severity
                    });
                    results.riskScore += severity === 'critical' ? 5 : 
                                       severity === 'high' ? 3 : 1;
                }
            }
        }

        // 7. Extract and validate entities
        const entities = extractEntities(validatedPrompt);
        results.suspiciousEntities = entities.filter(e =>
            INJECTION_PATTERNS.suspicious_entities.some(p => p.test(e))
        );

        if (results.suspiciousEntities.length > 0) {
            results.riskScore += results.suspiciousEntities.length * 2;
        }

        // 8. Determine risk level
        if (results.riskScore >= 10 || results.hiddenInstructions.length > 0 || results.boundaryTags.length > 0) {
            results.riskLevel = 'critical';
            results.requiresConfirmation = true;
            results.safe = false;
            results.quarantineTriggered = true;
        } else if (results.riskScore >= 5) {
            results.riskLevel = 'high';
            results.requiresConfirmation = true;
            results.safe = false;
        } else if (results.riskScore >= 2) {
            results.riskLevel = 'medium';
            results.requiresConfirmation = true;
        }

        // 9. Sanitize prompt
        results.sanitizedPrompt = sanitizePrompt(validatedPrompt);
        results.duration = Date.now() - startTime;

        // 10. Log analysis
        await logPromptAnalysis(userId, results, context);

        // 11. Trigger quarantine if critical
        if (results.quarantineTriggered) {
            await triggerAgentQuarantine(userId, results, context);
        }

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

async function triggerAgentQuarantine(userId, analysis, context) {
    try {
        const quarantineId = crypto.randomBytes(16).toString('hex');
        
        await db.query(
            `INSERT INTO agent_quarantine 
             (quarantine_id, user_id, risk_score, risk_level, 
              detected_patterns, context, status, created_at)
             VALUES (?, ?, ?, ?, ?, ?, 'active', NOW())`,
            [
                quarantineId,
                userId,
                analysis.riskScore,
                analysis.riskLevel,
                JSON.stringify(analysis.detectedPatterns),
                JSON.stringify(context)
            ]
        );

        logger.warn('⚠️ Agent quarantined', {
            quarantineId,
            userId,
            riskScore: analysis.riskScore,
            riskLevel: analysis.riskLevel,
            patternCount: analysis.detectedPatterns.length
        });

        // Send alert to security team
        await sendSecurityAlert(quarantineId, userId, analysis);

        return quarantineId;
    } catch (error) {
        logger.error('Quarantine trigger error:', error);
        throw error;
    }
}

async function sendSecurityAlert(quarantineId, userId, analysis) {
    try {
        const alert = {
            type: 'AGENT_QUARANTINE',
            quarantineId,
            userId,
            timestamp: new Date().toISOString(),
            riskScore: analysis.riskScore,
            riskLevel: analysis.riskLevel,
            patterns: analysis.detectedPatterns.map(p => p.category).filter((v, i, a) => a.indexOf(v) === i)
        };

        // Store alert in database
        await db.query(
            `INSERT INTO security_alerts 
             (alert_type, alert_data, severity, created_at)
             VALUES (?, ?, ?, NOW())`,
            ['AGENT_QUARANTINE', JSON.stringify(alert), analysis.riskLevel]
        );

        // Log to console for monitoring
        console.log('🚨 SECURITY ALERT:', JSON.stringify(alert, null, 2));
    } catch (error) {
        logger.error('Security alert error:', error);
    }
}

async function logPromptAnalysis(userId, results, context) {
    try {
        await db.query(
            `INSERT INTO ai_prompt_analytics 
             (user_id, risk_score, risk_level, detected_patterns, 
              suspicious_entities, hidden_instructions, boundary_tags,
              entropy, perplexity, sanitized_prompt, context, 
              quarantine_triggered, duration_ms, timestamp)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
            [
                userId,
                results.riskScore,
                results.riskLevel,
                JSON.stringify(results.detectedPatterns),
                JSON.stringify(results.suspiciousEntities),
                JSON.stringify(results.hiddenInstructions),
                JSON.stringify(results.boundaryTags),
                results.entropy,
                results.perplexity,
                results.sanitizedPrompt,
                JSON.stringify(context),
                results.quarantineTriggered ? 1 : 0,
                results.duration || 0
            ]
        );
    } catch (error) {
        logger.error('Error logging prompt analysis:', error);
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
            userAgent: req.headers['user-agent'],
            referer: req.headers['referer'],
            path: req.path,
            method: req.method
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
                patterns: analysis.detectedPatterns,
                entropy: analysis.entropy,
                perplexity: analysis.perplexity
            });
            return res.status(403).json({
                success: false,
                error: 'Prompt detected as potentially malicious',
                riskLevel: analysis.riskLevel,
                detectedPatterns: analysis.detectedPatterns,
                entropy: analysis.entropy,
                perplexity: analysis.perplexity,
                quarantineTriggered: analysis.quarantineTriggered
            });
        }

        // High risk - require authorization
        if (analysis.riskLevel === 'high') {
            const authRequest = await requestAuthorization(userId, action, data);
            return res.status(202).json({
                success: true,
                message: 'Prompt requires authorization confirmation',
                riskLevel: analysis.riskLevel,
                authId: authRequest.authId,
                detectedPatterns: analysis.detectedPatterns,
                entropy: analysis.entropy,
                perplexity: analysis.perplexity
            });
        }

        // Medium risk - requires confirmation
        if (analysis.requiresConfirmation && analysis.riskLevel === 'medium') {
            const authRequest = await requestAuthorization(userId, action, data);
            return res.status(202).json({
                success: true,
                message: 'Prompt requires confirmation',
                riskLevel: analysis.riskLevel,
                authId: authRequest.authId,
                detectedPatterns: analysis.detectedPatterns
            });
        }

        // Safe - proceed with sanitized prompt
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
            entropyThreshold: ENTROPY_THRESHOLD,
            perplexityThreshold: PERPLEXITY_THRESHOLD,
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
    compilePatterns,
    calculateEntropy,
    calculatePerplexity,
    detectHiddenInstructions,
    isolateBoundaries,
    triggerAgentQuarantine
};