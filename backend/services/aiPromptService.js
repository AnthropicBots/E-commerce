const Anthropic = require('@anthropic-ai/sdk');
const db = require('../config/db').promise;

const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
});

const COST_PER_INPUT_TOKEN = 0.00003;
const COST_PER_OUTPUT_TOKEN = 0.00015;

const config = {
    model: process.env.AI_MODEL || 'claude-3-sonnet-20241022',
    maxTokens: parseInt(process.env.AI_MAX_TOKENS) || 1024,
    temperature: parseFloat(process.env.AI_TEMPERATURE) || 0.7,
    timeout: parseInt(process.env.AI_TIMEOUT) || 30000,
    maxQueryLength: parseInt(process.env.AI_MAX_QUERY_LENGTH) || 5000,
    rateLimitWindow: parseInt(process.env.AI_RATE_LIMIT_WINDOW) || 60000,
    maxRequestsPerUser: parseInt(process.env.AI_MAX_REQUESTS_PER_USER) || 10,
    maxRetries: parseInt(process.env.AI_MAX_RETRIES) || 3,
    retryDelay: parseInt(process.env.AI_RETRY_DELAY) || 1000
};

const rateLimiter = new Map();

function checkRateLimit(userId) {
    const now = Date.now();
    const key = `ai_${userId}`;

    if (!rateLimiter.has(key)) {
        rateLimiter.set(key, [now]);
        return true;
    }

    const requests = rateLimiter.get(key).filter(
        time => now - time < config.rateLimitWindow
    );

    if (requests.length >= config.maxRequestsPerUser) {
        return false;
    }

    requests.push(now);
    rateLimiter.set(key, requests);
    return true;
}

function validateQuery(query) {
    if (!query || typeof query !== 'string') {
        throw new Error('Query must be a non-empty string');
    }

    const trimmed = query.trim();
    if (trimmed.length === 0) {
        throw new Error('Query cannot be empty');
    }

    if (trimmed.length > config.maxQueryLength) {
        throw new Error(`Query exceeds maximum length of ${config.maxQueryLength} characters`);
    }

    return trimmed;
}

function validateContext(context) {
    if (context && typeof context !== 'object') {
        throw new Error('Context must be an object');
    }

    const contextStr = JSON.stringify(context || {});
    if (contextStr.length > 10000) {
        throw new Error('Context too large (max 10KB)');
    }

    return context || {};
}

async function withRetry(fn, retries = config.maxRetries) {
    let lastError;

    for (let i = 0; i < retries; i++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;

            if (error.message && error.message.includes('Query')) {
                throw error;
            }

            if (error.status === 429) {
                throw error;
            }

            if (i < retries - 1) {
                const delay = config.retryDelay * Math.pow(2, i);
                console.warn(`Retry ${i + 1}/${retries} after ${delay}ms`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }

    throw lastError;
}

const STATIC_SYSTEM_PROMPT = {
    type: "text",
    text: `You are an e-commerce shopping assistant for AnthropicBots E-commerce.

Rules:
- Always recommend products from our catalog
- Never suggest external products
- Stay within the price range of ₹500-₹50,000
- Provide honest product comparisons
- Ask clarifying questions before recommending
- Be friendly, helpful, and professional

Product Categories:
- Electronics (Smartphones, Laptops, Accessories)
- Fashion (Mens, Womens, Accessories)
- Home & Living (Furniture, Decor, Kitchen)
- Beauty (Skincare, Makeup, Fragrances)

Response Guidelines:
- Keep responses concise (max 200 words)
- Always include product names and prices
- Suggest alternatives when available
- Ask follow-up questions to understand user needs`,
    cache_control: { type: "ephemeral" }
};

function buildDynamicContext(req) {
    const user = req.user || {};
    const session = req.session || {};

    return {
        type: "text",
        text: `Current User Context:
- User ID: ${user.id || 'anonymous'}
- User Name: ${user.name || 'Guest'}
- User Email: ${user.email || 'Not provided'}
- User Role: ${user.role || 'customer'}
- Session ID: ${session.id || 'N/A'}
- Timestamp: ${new Date().toISOString()}
- IP Address: ${req.ip || 'Unknown'}`
    };
}

async function getAIRecommendation(userQuery, contextData = {}) {
    const startTime = Date.now();
    const requestId = Math.random().toString(36).substring(7);

    try {
        const query = validateQuery(userQuery);
        const context = validateContext(contextData);

        const userId = contextData.userId || 'anonymous';
        if (!checkRateLimit(userId)) {
            return {
                success: false,
                error: 'Rate limit exceeded. Please try again later.',
                requestId
            };
        }

        const systemPrompt = [
            STATIC_SYSTEM_PROMPT,
            {
                type: "text",
                text: `Additional Context:
Timestamp: ${new Date().toISOString()}
User ID: ${userId}
${Object.entries(context).map(([key, value]) => `${key}: ${value}`).join('\n')}`
            }
        ];

        const result = await withRetry(async () => {
            const timeout = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Request timeout')), config.timeout);
            });

            const apiCall = anthropic.messages.create({
                model: config.model,
                system: systemPrompt,
                messages: [
                    {
                        role: "user",
                        content: query
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

        const savings = calculateCostSavings(result);

        await logAICostSavings({
            userId,
            endpoint: 'getAIRecommendation',
            ...savings,
            requestId
        });

        return {
            success: true,
            data: result.content[0].text,
            usage: result.usage,
            savings,
            requestId,
            duration: Date.now() - startTime
        };

    } catch (error) {
        console.error('AI Recommendation Error:', {
            requestId,
            userId: contextData.userId || 'anonymous',
            error: error.message
        });

        return {
            success: false,
            error: error.message === 'Request timeout'
                ? 'AI service is taking too long. Please try again.'
                : error.message.includes('Rate limit')
                    ? 'Too many requests. Please try again later.'
                    : 'Failed to get AI recommendation. Please try again.',
            requestId,
            fallback: true
        };
    }
}

async function getAIProductRecommendation(userId, productId, userQuery) {
    const startTime = Date.now();
    const requestId = Math.random().toString(36).substring(7);

    try {
        if (!userId) {
            throw new Error('User ID is required');
        }
        if (!productId) {
            throw new Error('Product ID is required');
        }
        const query = validateQuery(userQuery);

        if (!checkRateLimit(userId)) {
            return {
                success: false,
                error: 'Rate limit exceeded. Please try again later.',
                requestId
            };
        }

        const [user] = await db.query(
            'SELECT * FROM users WHERE id = ?',
            [userId]
        );

        const contextData = {
            userId: userId,
            userEmail: user[0]?.email || 'unknown',
            productId: productId,
            query: query,
            timestamp: new Date().toISOString()
        };

        const systemPrompt = {
            type: "text",
            text: `You are a product recommendation expert for AnthropicBots.

User Context:
- User ID: ${userId}
- User Email: ${user[0]?.email || 'unknown'}

Recommendation Guidelines:
1. Analyze the product details
2. Suggest similar products
3. Provide personalized recommendations
4. Include pricing information
5. Highlight key features`,
            cache_control: { type: "ephemeral" }
        };

        const result = await withRetry(async () => {
            const timeout = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Request timeout')), config.timeout);
            });

            const apiCall = anthropic.messages.create({
                model: config.model,
                system: [
                    systemPrompt,
                    {
                        type: "text",
                        text: `Current Request Context:
${JSON.stringify(contextData, null, 2)}`
                    }
                ],
                messages: [
                    {
                        role: "user",
                        content: `Recommend products similar to product ID ${productId}. User query: ${query}`
                    }
                ],
                max_tokens: config.maxTokens,
                temperature: 0.8,
                headers: {
                    'anthropic-version': '2023-06-01'
                }
            });

            return await Promise.race([apiCall, timeout]);
        });

        const savings = calculateCostSavings(result);

        await logAICostSavings({
            userId,
            endpoint: 'getAIProductRecommendation',
            ...savings,
            requestId
        });

        return {
            success: true,
            data: result.content[0].text,
            usage: result.usage,
            savings,
            requestId,
            duration: Date.now() - startTime
        };

    } catch (error) {
        console.error('Product Recommendation Error:', {
            requestId,
            userId,
            error: error.message
        });

        return {
            success: false,
            error: error.message === 'Request timeout'
                ? 'AI service is taking too long. Please try again.'
                : 'Failed to get product recommendation. Please try again.',
            requestId,
            fallback: true
        };
    }
}

async function getAIProductDescription(productData, keywords) {
    const startTime = Date.now();
    const requestId = Math.random().toString(36).substring(7);

    try {
        if (!productData || typeof productData !== 'object') {
            throw new Error('Product data is required');
        }
        if (!keywords || !Array.isArray(keywords) || keywords.length === 0) {
            throw new Error('Keywords are required');
        }
        if (keywords.length > 10) {
            throw new Error('Maximum 10 keywords allowed');
        }

        const systemPrompt = {
            type: "text",
            text: `You are a professional e-commerce copywriter.

Writing Guidelines:
1. Create compelling product descriptions
2. Highlight key features and benefits
3. Use persuasive language
4. Include SEO keywords naturally
5. Keep it between 100-150 words
6. Focus on customer benefits

Style Guide:
- Professional yet friendly tone
- Use active voice
- Include emotional benefits
- Address customer pain points`,
            cache_control: { type: "ephemeral" }
        };

        const result = await withRetry(async () => {
            const timeout = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Request timeout')), config.timeout);
            });

            const apiCall = anthropic.messages.create({
                model: "claude-3-haiku-20240307",
                system: [
                    systemPrompt,
                    {
                        type: "text",
                        text: `Product Data:
${JSON.stringify(productData, null, 2)}

Keywords: ${keywords.join(', ')}`
                    }
                ],
                messages: [
                    {
                        role: "user",
                        content: `Write a product description for the above product using these keywords: ${keywords.join(', ')}`
                    }
                ],
                max_tokens: 500,
                temperature: 0.8,
                headers: {
                    'anthropic-version': '2023-06-01'
                }
            });

            return await Promise.race([apiCall, timeout]);
        });

        const savings = calculateCostSavings(result);

        return {
            success: true,
            data: result.content[0].text,
            usage: result.usage,
            savings,
            requestId,
            duration: Date.now() - startTime
        };

    } catch (error) {
        console.error('Product Description Error:', {
            requestId,
            error: error.message
        });

        return {
            success: false,
            error: error.message === 'Request timeout'
                ? 'AI service is taking too long. Please try again.'
                : 'Failed to generate product description. Please try again.',
            requestId,
            fallback: true
        };
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
            version: '1.0.0'
        };
    } catch (error) {
        return {
            status: 'unhealthy',
            error: error.message,
            timestamp: new Date().toISOString()
        };
    }
}

function calculateCostSavings(response) {
    const totalTokens = response.usage.input_tokens || 0;
    const cachedTokens = response.usage.cache_creation_input_tokens || 0;
    const outputTokens = response.usage.output_tokens || 0;

    const originalCost = (totalTokens * COST_PER_INPUT_TOKEN) +
        (outputTokens * COST_PER_OUTPUT_TOKEN);

    const nonCachedTokens = totalTokens - cachedTokens;
    const actualCost = (nonCachedTokens * COST_PER_INPUT_TOKEN) +
        (outputTokens * COST_PER_OUTPUT_TOKEN);

    const savingsAmount = originalCost - actualCost;
    const savingsPercentage = originalCost > 0 ?
        ((savingsAmount / originalCost) * 100) : 0;

    const result = {
        totalTokens,
        cachedTokens,
        nonCachedTokens,
        outputTokens,
        originalCost: parseFloat(originalCost.toFixed(6)),
        actualCost: parseFloat(actualCost.toFixed(6)),
        savingsAmount: parseFloat(savingsAmount.toFixed(6)),
        savingsPercentage: parseFloat(savingsPercentage.toFixed(2))
    };

    const cachedTokenPercentage =
        result.totalTokens > 0
            ? (result.cachedTokens / result.totalTokens) * 100
            : 0;

    console.log(`Cost Savings: ${result.savingsPercentage}%`);
    console.log(`Original: $${result.originalCost} -> Actual: $${result.actualCost}`);
    console.log(
        `📊 Cached Tokens: ${result.cachedTokens}/${result.totalTokens} (${cachedTokenPercentage.toFixed(1)}%)`
    );

    return result;
}

async function logAICostSavings({ userId, endpoint, originalCost, actualCost, savingsPercentage, totalTokens, outputTokens, cachedTokens, requestId }) {
    try {
        await db.query(
            `INSERT INTO ai_cost_analytics 
             (user_id, endpoint, original_cost, actual_cost, 
              savings_percentage, input_tokens, output_tokens, cached_tokens, request_id, timestamp)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
            [
                userId,
                endpoint,
                originalCost,
                actualCost,
                savingsPercentage,
                totalTokens,
                outputTokens,
                cachedTokens,
                requestId
            ]
        );

        console.log(`Cost savings logged for user ${userId}: ${savingsPercentage}% savings`);
    } catch (error) {
        console.error('Error logging cost savings:', error);
    }
}

async function getCostSavingsAnalytics(timeRange = '30d') {
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
                COUNT(*) as total_requests,
                SUM(original_cost) as total_original_cost,
                SUM(actual_cost) as total_actual_cost,
                AVG(savings_percentage) as avg_savings,
                SUM(input_tokens) as total_input_tokens,
                SUM(cached_tokens) as total_cached_tokens,
                SUM(output_tokens) as total_output_tokens
            FROM ai_cost_analytics
            WHERE timestamp > DATE_SUB(NOW(), ${dateCondition})
            GROUP BY DATE(timestamp)
            ORDER BY date DESC
        `);

        return {
            success: true,
            data: results,
            summary: {
                total_requests: results.reduce((sum, r) => sum + r.total_requests, 0),
                total_savings: results.reduce((sum, r) => sum + (r.total_original_cost - r.total_actual_cost), 0),
                avg_savings: results.reduce((sum, r) => sum + r.avg_savings, 0) / (results.length || 1),
                total_cached_tokens: results.reduce((sum, r) => sum + r.total_cached_tokens, 0),
                total_input_tokens: results.reduce((sum, r) => sum + r.total_input_tokens, 0)
            }
        };
    } catch (error) {
        console.error('Error getting analytics:', error);
        throw error;
    }
}

function cleanup() {
    rateLimiter.clear();
    console.log('AI service cleanup completed');
}

module.exports = {
    getAIRecommendation,
    getAIProductRecommendation,
    getAIProductDescription,
    calculateCostSavings,
    logAICostSavings,
    getCostSavingsAnalytics,
    healthCheck,
    cleanup,
    STATIC_SYSTEM_PROMPT,
    config
};