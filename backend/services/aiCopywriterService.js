const Anthropic = require('@anthropic-ai/sdk');
const db = require('../config/db').promise;
const NodeCache = require('node-cache');

const config = {
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: process.env.AI_COPYWRITER_MODEL || 'claude-3-haiku-20240307',
    maxTokens: parseInt(process.env.AI_COPYWRITER_MAX_TOKENS) || 500,
    temperature: parseFloat(process.env.AI_COPYWRITER_TEMPERATURE) || 0.8,
    timeout: parseInt(process.env.AI_COPYWRITER_TIMEOUT) || 30000,
    maxRetries: parseInt(process.env.AI_COPYWRITER_MAX_RETRIES) || 3,
    rateLimitWindow: parseInt(process.env.AI_COPYWRITER_RATE_LIMIT_WINDOW) || 60000,
    maxRequestsPerUser: parseInt(process.env.AI_COPYWRITER_MAX_REQUESTS) || 20,
    cacheTTL: parseInt(process.env.AI_COPYWRITER_CACHE_TTL) || 3600,
    maxKeywords: parseInt(process.env.AI_COPYWRITER_MAX_KEYWORDS) || 10
};

const anthropic = new Anthropic({
    apiKey: config.apiKey,
    timeout: config.timeout
});

const copyCache = new NodeCache({ stdTTL: config.cacheTTL, checkperiod: 600 });
const rateLimiter = new Map();

const COPYWRITER_SYSTEM_PROMPT = {
    type: "text",
    text: `You are an expert e-commerce product copywriter for AnthropicBots E-commerce.

Your task is to create compelling product listings that convert visitors into buyers.

Guidelines:
- Product Name: Max 8 words, attention-grabbing, include key benefit
- Product Description: Max 80 words, warm and appealing tone
- Highlight: Key features, benefits, and use cases
- Include: Emotional benefits alongside practical features
- Style: Professional, confident, yet approachable
- SEO: Include relevant keywords naturally
- Target Audience: General customers unless specified

Response must be valid JSON with these fields:
{
    "name": "Product Name",
    "description": "Detailed description",
    "shortDescription": "Short summary",
    "bulletPoints": ["feature1", "feature2"],
    "seoKeywords": ["keyword1", "keyword2"]
}`,
    cache_control: { type: "ephemeral" }
};

function validateKeywords(keywords) {
    if (!keywords || !Array.isArray(keywords) || keywords.length === 0) {
        throw new Error('Keywords array is required');
    }
    if (keywords.length > config.maxKeywords) {
        throw new Error(`Maximum ${config.maxKeywords} keywords allowed`);
    }
    return keywords.filter(k => k && typeof k === 'string' && k.trim().length > 0);
}

function validateInputs({ keywords, category, targetAudience, tone, language }) {
    const validTones = ['Professional', 'Warm & Friendly', 'Luxury & Premium', 'Minimalist', 'Energetic', 'Playful', 'Authoritative'];
    const validLanguages = ['en', 'hi', 'es', 'fr', 'de', 'zh'];

    if (tone && !validTones.includes(tone)) {
        throw new Error(`Invalid tone. Allowed: ${validTones.join(', ')}`);
    }

    if (language && !validLanguages.includes(language)) {
        throw new Error(`Invalid language. Allowed: ${validLanguages.join(', ')}`);
    }

    return true;
}

function checkRateLimit(userId = 'anonymous') {
    const now = Date.now();
    const key = `copywriter_${userId}`;

    if (!rateLimiter.has(key)) {
        rateLimiter.set(key, [now]);
        return true;
    }

    const requests = rateLimiter.get(key).filter(time => now - time < config.rateLimitWindow);
    if (requests.length >= config.maxRequestsPerUser) {
        return false;
    }

    requests.push(now);
    rateLimiter.set(key, requests);
    return true;
}

function getCacheKey(keywords, category, tone, language) {
    return `copy_${keywords.sort().join('_')}_${category || 'general'}_${tone || 'professional'}_${language || 'en'}`;
}

function validateResponse(response) {
    const requiredFields = ['name', 'description', 'shortDescription'];
    for (const field of requiredFields) {
        if (!response[field] || typeof response[field] !== 'string' || response[field].trim().length === 0) {
            throw new Error(`Missing or invalid field: ${field}`);
        }
    }
    if (response.bulletPoints && !Array.isArray(response.bulletPoints)) {
        throw new Error('bulletPoints must be an array');
    }
    if (response.seoKeywords && !Array.isArray(response.seoKeywords)) {
        throw new Error('seoKeywords must be an array');
    }
    return true;
}

function parseAIResponse(text, keywords) {
    let jsonStart = text.indexOf('{');
    let jsonEnd = text.lastIndexOf('}') + 1;

    if (jsonStart === -1 || jsonEnd === 0) {
        throw new Error('No JSON object found in response');
    }

    const jsonStr = text.substring(jsonStart, jsonEnd);
    try {
        const parsed = JSON.parse(jsonStr);
        validateResponse(parsed);
        return parsed;
    } catch (error) {
        console.warn('JSON parsing failed:', error.message);
        return extractCopyFromText(text, keywords);
    }
}

async function withRetry(fn, retries = config.maxRetries) {
    let lastError;
    for (let i = 0; i < retries; i++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;
            if (i < retries - 1) {
                const delay = Math.pow(2, i) * 1000;
                console.log(`Retry ${i + 1}/${retries} after ${delay}ms`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }
    throw lastError;
}

async function generateProductCopy({ keywords, category, targetAudience, tone, language = 'en', userId = 'anonymous' }) {
    const startTime = Date.now();

    try {
        const validKeywords = validateKeywords(keywords);
        validateInputs({ keywords: validKeywords, category, targetAudience, tone, language });

        if (!checkRateLimit(userId)) {
            return {
                success: false,
                error: 'Rate limit exceeded. Please try again later.',
                retryAfter: Math.ceil(config.rateLimitWindow / 1000)
            };
        }

        const cacheKey = getCacheKey(validKeywords, category, tone, language);
        const cached = copyCache.get(cacheKey);
        if (cached) {
            console.log(`Cache hit for keywords: ${validKeywords.join(', ')}`);
            return {
                success: true,
                data: cached,
                cached: true,
                usage: { cache: true }
            };
        }

        const result = await withRetry(async () => {
            const timeout = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Request timeout')), config.timeout);
            });

            const apiCall = anthropic.messages.create({
                model: config.model,
                system: [
                    COPYWRITER_SYSTEM_PROMPT,
                    {
                        type: "text",
                        text: `Context:
Keywords: ${validKeywords.join(', ')}
Category: ${category || 'General'}
Target Audience: ${targetAudience || 'General customers'}
Tone: ${tone || 'Professional'}
Language: ${language}

Generate product name and description based on the above context.`
                    }
                ],
                messages: [
                    {
                        role: "user",
                        content: `Generate a compelling product name and description for a product with these keywords: ${validKeywords.join(', ')}. 
Category: ${category || 'General'}
Target Audience: ${targetAudience || 'General customers'}
Tone: ${tone || 'Professional'}
Language: ${language}`
                    }
                ],
                max_tokens: config.maxTokens,
                temperature: config.temperature,
                headers: {
                    'anthropic-version': '2023-06-01'
                }
            });

            return await Promise.race([apiCall, timeout]);
        });

        const responseText = result.content[0].text;
        const copyData = parseAIResponse(responseText, validKeywords);

        copyCache.set(cacheKey, copyData);

        await logCopyGeneration({
            keywords: validKeywords,
            category,
            targetAudience,
            tone,
            language,
            generated: copyData,
            userId,
            duration: Date.now() - startTime
        });

        return {
            success: true,
            data: copyData,
            usage: result.usage,
            cached: false,
            duration: Date.now() - startTime
        };

    } catch (error) {
        console.error('AI Copywriter Error:', error);
        return {
            success: false,
            error: error.message,
            fallback: getFallbackCopy(keywords, category)
        };
    }
}

function getFallbackCopy(keywords, category) {
    const name = `${keywords.slice(0, 3).join(' ')} ${category || 'Product'}`;
    return {
        name: name.substring(0, 80),
        description: `Premium quality ${category || 'product'} featuring ${keywords.slice(0, 3).join(', ')}. Perfect for your needs.`,
        shortDescription: `High-quality ${category || 'product'} with ${keywords[0] || 'excellent'} features.`,
        bulletPoints: keywords.slice(0, 5).map(k => `Premium ${k} quality`),
        seoKeywords: keywords.slice(0, 5)
    };
}

async function generateMultipleVersions({ keywords, category, count = 3, userId = 'anonymous' }) {
    try {
        const validKeywords = validateKeywords(keywords);
        if (count < 1 || count > 5) {
            throw new Error('Count must be between 1 and 5');
        }

        const tones = ['Professional', 'Warm & Friendly', 'Luxury & Premium', 'Minimalist', 'Energetic'];
        const selectedTones = tones.slice(0, Math.min(count, tones.length));

        const versions = [];
        for (const tone of selectedTones) {
            const result = await generateProductCopy({
                keywords: validKeywords,
                category,
                targetAudience: 'General customers',
                tone,
                userId
            });

            if (result.success) {
                versions.push({
                    version: versions.length + 1,
                    tone,
                    ...result.data
                });
            }
        }

        return {
            success: true,
            versions,
            count: versions.length
        };

    } catch (error) {
        console.error('Multiple Versions Error:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

async function generateMultilingualCopy({ keywords, category, languages = ['en', 'hi', 'es'], userId = 'anonymous' }) {
    try {
        const validKeywords = validateKeywords(keywords);
        const validLanguages = ['en', 'hi', 'es', 'fr', 'de', 'zh'];
        const selectedLanguages = languages.filter(l => validLanguages.includes(l));

        if (selectedLanguages.length === 0) {
            throw new Error('No valid languages selected');
        }

        const translations = {};
        for (const lang of selectedLanguages) {
            const result = await generateProductCopy({
                keywords: validKeywords,
                category,
                targetAudience: 'General customers',
                tone: 'Professional',
                language: lang,
                userId
            });

            if (result.success) {
                translations[lang] = result.data;
            }
        }

        return {
            success: true,
            translations
        };

    } catch (error) {
        console.error('Multilingual Copy Error:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

function extractCopyFromText(text, keywords = []) {
    return {
        name: extractSection(text, "Product Name") || extractSection(text, "Name") || keywords[0] || 'Product',
        description: extractSection(text, "Description") || extractSection(text, "Product Description") || '',
        shortDescription: extractSection(text, "Short Description") || extractSection(text, "Summary") || '',
        bulletPoints: extractBulletPoints(text) || keywords.slice(0, 3),
        seoKeywords: keywords.slice(0, 5)
    };
}

function extractSection(text, label) {
    const regex = new RegExp(`${label}[\\s:]+([^\\n]+)`, 'i');
    const match = text.match(regex);
    return match ? match[1].trim() : null;
}

function extractBulletPoints(text) {
    const points = [];
    const lines = text.split('\n');
    for (const line of lines) {
        if (line.trim().startsWith('-') || line.trim().startsWith('•') || line.trim().startsWith('*')) {
            const point = line.replace(/^[-\•\*]\s*/, '').trim();
            if (point.length > 0) points.push(point);
        }
    }
    return points.length > 0 ? points : null;
}

async function logCopyGeneration({ keywords, category, targetAudience, tone, language, generated, userId, duration }) {
    try {
        await db.query(
            `INSERT INTO ai_copy_generations 
             (keywords, category, target_audience, tone, language, user_id,
              generated_name, generated_description, generated_short, 
              bullet_points, seo_keywords, duration_ms, timestamp)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
            [
                JSON.stringify(keywords),
                category || 'General',
                targetAudience || 'General',
                tone || 'Professional',
                language || 'en',
                userId || 'anonymous',
                generated.name || '',
                generated.description || '',
                generated.shortDescription || '',
                JSON.stringify(generated.bulletPoints || []),
                JSON.stringify(generated.seoKeywords || []),
                duration || 0
            ]
        );
    } catch (error) {
        console.error('Error logging copy generation:', error);
    }
}

async function updateCopyUsage(copyId, productId) {
    try {
        await db.query(
            `UPDATE ai_copy_generations 
             SET was_used = TRUE, product_id = ?, used_at = NOW()
             WHERE id = ?`,
            [productId, copyId]
        );
    } catch (error) {
        console.error('Error updating copy usage:', error);
    }
}

async function getCopywriterAnalytics(timeRange = '30d') {
    try {
        let dateCondition;
        switch (timeRange) {
            case '7d': dateCondition = "INTERVAL 7 DAY"; break;
            case '30d': dateCondition = "INTERVAL 30 DAY"; break;
            case '90d': dateCondition = "INTERVAL 90 DAY"; break;
            default: dateCondition = "INTERVAL 30 DAY";
        }

        const [results] = await db.query(`
            SELECT 
                DATE(timestamp) as date,
                COUNT(*) as total_generations,
                SUM(CASE WHEN was_used = TRUE THEN 1 ELSE 0 END) as used_count,
                ROUND((SUM(CASE WHEN was_used = TRUE THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0)) * 100, 2) as adoption_rate,
                GROUP_CONCAT(DISTINCT category) as categories,
                AVG(duration_ms) as avg_duration_ms
            FROM ai_copy_generations
            WHERE timestamp > DATE_SUB(NOW(), ${dateCondition})
            GROUP BY DATE(timestamp)
            ORDER BY date DESC
        `);

        return {
            success: true,
            data: results,
            summary: {
                total_generations: results.reduce((sum, r) => sum + r.total_generations, 0),
                total_used: results.reduce((sum, r) => sum + r.used_count, 0),
                avg_adoption_rate: results.length > 0 ? results.reduce((sum, r) => sum + r.adoption_rate, 0) / results.length : 0,
                avg_duration_ms: results.length > 0 ? results.reduce((sum, r) => sum + r.avg_duration_ms, 0) / results.length : 0
            }
        };
    } catch (error) {
        console.error('Error getting analytics:', error);
        throw error;
    }
}

async function healthCheck() {
    try {
        const timeout = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Health check timeout')), 5000);
        });

        const apiCall = anthropic.messages.create({
            model: "claude-3-haiku-20240307",
            messages: [{ role: 'user', content: 'ping' }],
            max_tokens: 10
        });

        await Promise.race([apiCall, timeout]);

        return {
            status: 'healthy',
            timestamp: new Date().toISOString(),
            model: config.model,
            cacheSize: copyCache.keys().length
        };
    } catch (error) {
        return {
            status: 'unhealthy',
            error: error.message,
            timestamp: new Date().toISOString()
        };
    }
}

function clearCache() {
    copyCache.flushAll();
    rateLimiter.clear();
    console.log('Copywriter cache cleared');
    return { success: true, timestamp: new Date().toISOString() };
}

module.exports = {
    generateProductCopy,
    generateMultipleVersions,
    generateMultilingualCopy,
    getCopywriterAnalytics,
    updateCopyUsage,
    logCopyGeneration,
    healthCheck,
    clearCache,
    config
}; 