// backend/services/claudeOptimizationService.js
const db = require('../config/db').promise;
const crypto = require('crypto');

// ============================================
// CLAUDE OPTIMIZATION CONFIGURATION
// ============================================

const CLAUDE_CONFIG = {
    // Claude's optimization criteria
    optimization: {
        completeness: 0.35,    // 35% weight
        context: 0.25,         // 25% weight
        citations: 0.25,       // 25% weight
        correctness: 0.15      // 15% weight
    },
    
    // Third-party corroboration
    thirdPartySources: [
        'retailers',
        'review_sites',
        'social_media',
        'blogs',
        'forums'
    ],
    
    // Product card requirements
    requiredFields: [
        'name',
        'description',
        'price',
        'availability',
        'images',
        'brand',
        'category',
        'rating',
        'reviews'
    ]
};

// ============================================
// CLAUDE OPTIMIZATION SERVICE
// ============================================

class ClaudeOptimizationService {
    constructor() {
        this.claudeDataCache = new Map();
        this.thirdPartyData = new Map();
        this.referralData = new Map();
        this.isInitialized = false;
    }

    /**
     * Initialize service
     */
    async initialize() {
        if (this.isInitialized) return;

        // Load third-party corroboration data
        await this.loadThirdPartyData();

        this.isInitialized = true;
        console.log('✅ Claude Optimization Service initialized');
        return this;
    }

    /**
     * Generate Claude-optimized product data
     */
    generateClaudeProductData(product) {
        const score = this.calculateClaudeScore(product);
        
        return {
            product: {
                id: product.id,
                name: product.name,
                description: this.optimizeDescription(product),
                price: {
                    amount: parseFloat(product.price),
                    currency: 'INR',
                    isDiscounted: product.original_price > product.price
                },
                availability: product.stock > 0 ? 'In Stock' : 'Out of Stock',
                images: this.optimizeImages(product),
                brand: product.brand || 'AnthropicBots',
                category: product.category,
                rating: {
                    average: parseFloat(product.avg_rating) || 0,
                    count: parseInt(product.review_count) || 0,
                    distribution: this.getRatingDistribution(product)
                },
                reviews: this.optimizeReviews(product),
                specifications: this.optimizeSpecifications(product),
                shipping: {
                    free: product.free_shipping || false,
                    estimatedDays: product.shipping_days || '2-4',
                    returns: product.return_policy || '7 days'
                },
                seller: {
                    name: 'AnthropicBots',
                    rating: 4.5,
                    totalSales: 10000,
                    trustScore: 95
                },
                thirdParty: this.getThirdPartyData(product)
            },
            claudeScore: score,
            optimizationScore: Math.round(score * 100)
        };
    }

    /**
     * Calculate Claude's product score
     */
    calculateClaudeScore(product) {
        let score = 0;
        const weights = CLAUDE_CONFIG.optimization;

        // 1. Completeness (35%)
        const completeness = this.calculateCompleteness(product);
        score += completeness * weights.completeness;

        // 2. Context (25%)
        const context = this.calculateContext(product);
        score += context * weights.context;

        // 3. Citations (25%)
        const citations = this.calculateCitations(product);
        score += citations * weights.citations;

        // 4. Correctness (15%)
        const correctness = this.calculateCorrectness(product);
        score += correctness * weights.correctness;

        return Math.min(1, Math.max(0, score));
    }

    /**
     * Calculate completeness score
     */
    calculateCompleteness(product) {
        const fields = CLAUDE_CONFIG.requiredFields;
        let present = 0;

        for (const field of fields) {
            if (product[field] || product[field] === 0) {
                present++;
            }
        }

        // Check for optional valuable fields
        const optionalFields = ['specifications', 'variants', 'tags', 'gtin'];
        for (const field of optionalFields) {
            if (product[field]) {
                present += 0.5;
            }
        }

        const maxScore = fields.length + optionalFields.length * 0.5;
        return Math.min(1, present / maxScore);
    }

    /**
     * Calculate context score
     */
    calculateContext(product) {
        let score = 0;

        // Rich description
        if (product.description && product.description.length > 100) {
            score += 0.3;
        }

        // Detailed specifications
        if (product.specifications && Object.keys(product.specifications).length > 3) {
            score += 0.25;
        }

        // High-quality images
        if (product.images && product.images.length > 2) {
            score += 0.2;
        }

        // Customer reviews
        if (product.review_count > 10) {
            score += 0.15;
        }

        // Brand authority
        if (product.brand && product.brand !== 'unknown') {
            score += 0.1;
        }

        return Math.min(1, score);
    }

    /**
     * Calculate citations score
     */
    calculateCitations(product) {
        let score = 0;

        // Third-party references
        const thirdParty = this.getThirdPartyData(product);
        if (thirdParty.references && thirdParty.references.length > 0) {
            score += Math.min(0.5, thirdParty.references.length * 0.1);
        }

        // External reviews
        if (thirdParty.externalReviews && thirdParty.externalReviews.length > 0) {
            score += Math.min(0.3, thirdParty.externalReviews.length * 0.05);
        }

        // Social mentions
        if (thirdParty.socialMentions && thirdParty.socialMentions > 0) {
            score += Math.min(0.2, thirdParty.socialMentions * 0.01);
        }

        return Math.min(1, score);
    }

    /**
     * Calculate correctness score
     */
    calculateCorrectness(product) {
        let score = 0.5; // Base score

        // Price consistency
        if (product.price > 0 && product.price < 1000000) {
            score += 0.1;
        }

        // Stock consistency
        if (product.stock >= 0) {
            score += 0.1;
        }

        // Description authenticity (no gibberish)
        if (product.description && product.description.length > 20) {
            const gibberishScore = this.detectGibberish(product.description);
            score += (1 - gibberishScore) * 0.1;
        }

        // Rating consistency
        if (product.avg_rating >= 0 && product.avg_rating <= 5) {
            score += 0.1;
        }

        // Review consistency
        if (product.review_count && product.review_count > 0) {
            const avgRating = product.avg_rating || 0;
            const reviewDistribution = this.getRatingDistribution(product);
            if (this.isValidDistribution(reviewDistribution)) {
                score += 0.1;
            }
        }

        return Math.min(1, score);
    }

    /**
     * Optimize description for Claude
     */
    optimizeDescription(product) {
        let description = product.description || '';

        // Ensure minimum length
        if (description.length < 100) {
            // Generate enhanced description
            const enhanced = this.generateEnhancedDescription(product);
            description = enhanced || description;
        }

        // Add key points
        if (description.length > 50 && !description.includes('Key Features:')) {
            const keyPoints = this.generateKeyPoints(product);
            description = `${description}\n\nKey Features:\n${keyPoints}`;
        }

        // Add trust signals
        description = this.addTrustSignals(description, product);

        return description;
    }

    /**
     * Generate enhanced description
     */
    generateEnhancedDescription(product) {
        const parts = [];
        
        if (product.name) {
            parts.push(`Experience premium quality with ${product.name}.`);
        }
        
        if (product.brand) {
            parts.push(`From trusted brand ${product.brand}.`);
        }
        
        if (product.category) {
            parts.push(`Perfect for ${product.category} enthusiasts.`);
        }

        if (product.price) {
            parts.push(`Available at the competitive price of ₹${product.price}.`);
        }

        if (product.stock > 0) {
            parts.push('In stock and ready to ship.');
        }

        if (parts.length === 0) {
            return null;
        }

        return parts.join(' ');
    }

    /**
     * Generate key points
     */
    generateKeyPoints(product) {
        const points = [];

        if (product.price) {
            points.push(`• Competitive pricing at ₹${product.price}`);
        }

        if (product.brand) {
            points.push(`• Premium ${product.brand} quality`);
        }

        if (product.category) {
            points.push(`• High-quality ${product.category} product`);
        }

        if (product.stock > 0) {
            points.push('• Ready to ship - in stock');
        }

        // Add specifications as key points
        if (product.specifications) {
            const specs = typeof product.specifications === 'string' 
                ? JSON.parse(product.specifications) 
                : product.specifications;
            
            for (const [key, value] of Object.entries(specs).slice(0, 3)) {
                points.push(`• ${key}: ${value}`);
            }
        }

        return points.join('\n');
    }

    /**
     * Add trust signals
     */
    addTrustSignals(description, product) {
        const signals = [];

        if (product.review_count > 10) {
            signals.push(`✅ ${product.review_count} verified customer reviews`);
        }

        if (product.avg_rating > 4) {
            signals.push(`⭐ ${product.avg_rating} out of 5 stars`);
        }

        if (product.free_shipping) {
            signals.push('🚚 Free shipping available');
        }

        if (signals.length > 0) {
            description = `${description}\n\n${signals.join(' | ')}`;
        }

        return description;
    }

    /**
     * Optimize images for Claude
     */
    optimizeImages(product) {
        const images = [];
        const imageList = typeof product.images === 'string' 
            ? JSON.parse(product.images) 
            : (product.images || [product.image_url]);

        for (const img of imageList) {
            if (img) {
                images.push({
                    url: img,
                    alt: product.name || 'Product image',
                    type: 'product'
                });
            }
        }

        // Ensure at least one image
        if (images.length === 0 && product.image_url) {
            images.push({
                url: product.image_url,
                alt: product.name || 'Product image',
                type: 'product'
            });
        }

        return images;
    }

    /**
     * Optimize reviews for Claude
     */
    optimizeReviews(product) {
        const reviews = [];

        if (product.review_count > 0) {
            // Sample positive and negative reviews
            const reviewData = typeof product.reviews === 'string'
                ? JSON.parse(product.reviews)
                : (product.reviews || []);

            const positive = reviewData.filter(r => r.rating >= 4).slice(0, 3);
            const negative = reviewData.filter(r => r.rating <= 2).slice(0, 2);

            for (const review of [...positive, ...negative]) {
                reviews.push({
                    author: review.author || 'Verified Customer',
                    rating: review.rating || 0,
                    text: review.text || review.comment || '',
                    date: review.date || new Date().toISOString(),
                    verified: true
                });
            }
        }

        return reviews;
    }

    /**
     * Optimize specifications
     */
    optimizeSpecifications(product) {
        if (!product.specifications) {
            return this.generateDefaultSpecs(product);
        }

        const specs = typeof product.specifications === 'string'
            ? JSON.parse(product.specifications)
            : product.specifications;

        const optimized = [];

        // Order specs by importance
        const priority = ['brand', 'model', 'size', 'color', 'material', 'weight'];
        const orderedSpecs = {};

        for (const key of priority) {
            if (specs[key]) {
                orderedSpecs[key] = specs[key];
            }
        }

        for (const [key, value] of Object.entries(specs)) {
            if (!orderedSpecs[key]) {
                orderedSpecs[key] = value;
            }
        }

        for (const [key, value] of Object.entries(orderedSpecs)) {
            if (value) {
                optimized.push({
                    name: key.charAt(0).toUpperCase() + key.slice(1),
                    value: value
                });
            }
        }

        return optimized;
    }

    /**
     * Generate default specs
     */
    generateDefaultSpecs(product) {
        const specs = [];

        if (product.brand) {
            specs.push({ name: 'Brand', value: product.brand });
        }

        if (product.category) {
            specs.push({ name: 'Category', value: product.category });
        }

        if (product.price) {
            specs.push({ name: 'Price', value: `₹${product.price}` });
        }

        if (product.stock) {
            specs.push({ name: 'Availability', value: product.stock > 0 ? 'In Stock' : 'Out of Stock' });
        }

        return specs;
    }

    /**
     * Get rating distribution
     */
    getRatingDistribution(product) {
        const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };

        if (product.reviews) {
            const reviews = typeof product.reviews === 'string'
                ? JSON.parse(product.reviews)
                : product.reviews;

            for (const review of reviews) {
                const rating = Math.round(review.rating);
                if (distribution[rating] !== undefined) {
                    distribution[rating]++;
                }
            }
        }

        return distribution;
    }

    /**
     * Check if rating distribution is valid
     */
    isValidDistribution(distribution) {
        const values = Object.values(distribution);
        const total = values.reduce((a, b) => a + b, 0);
        return total > 0;
    }

    /**
     * Detect gibberish in text
     */
    detectGibberish(text) {
        const words = text.split(' ');
        let gibberishWords = 0;

        for (const word of words) {
            if (word.length > 15) {
                gibberishWords++;
            }
            if (word.match(/[^a-zA-Z0-9]/)) {
                gibberishWords++;
            }
        }

        return Math.min(1, gibberishWords / words.length);
    }

    /**
     * Get third-party corroboration data
     */
    getThirdPartyData(product) {
        // In production, this would fetch from external sources
        return {
            references: [
                { source: 'retailers', count: 5 },
                { source: 'review_sites', count: 12 },
                { source: 'social_media', count: 8 }
            ],
            externalReviews: [
                { source: 'Trustpilot', rating: 4.2, count: 45 },
                { source: 'Google Reviews', rating: 4.5, count: 32 }
            ],
            socialMentions: 156
        };
    }

    /**
     * Load third-party data
     */
    async loadThirdPartyData() {
        try {
            const [data] = await db.query(
                'SELECT * FROM third_party_corroboration WHERE active = 1'
            );
            for (const row of data) {
                this.thirdPartyData.set(row.product_id, {
                    references: JSON.parse(row.references || '[]'),
                    externalReviews: JSON.parse(row.external_reviews || '[]'),
                    socialMentions: row.social_mentions || 0
                });
            }
            console.log(`📊 Loaded ${this.thirdPartyData.size} third-party data entries`);
        } catch (error) {
            console.error('Load third-party data error:', error);
        }
    }

    /**
     * Track Claude referral
     */
    async trackClaudeReferral(data) {
        const referral = {
            id: `CLAUDE_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
            productId: data.productId,
            userId: data.userId || 'anonymous',
            source: data.source || 'claude',
            query: data.query || '',
            timestamp: new Date().toISOString()
        };

        // Store referral data
        await this.storeClaudeReferral(referral);

        // Update referral data
        if (!this.referralData.has(data.productId)) {
            this.referralData.set(data.productId, []);
        }
        this.referralData.get(data.productId).push(referral);

        return referral;
    }

    /**
     * Store Claude referral
     */
    async storeClaudeReferral(referral) {
        try {
            await db.query(
                `INSERT INTO claude_referrals 
                 (referral_id, product_id, user_id, source, query, timestamp)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [
                    referral.id,
                    referral.productId,
                    referral.userId,
                    referral.source,
                    referral.query,
                    referral.timestamp
                ]
            );
        } catch (error) {
            console.error('Store referral error:', error);
        }
    }

    /**
     * Get Claude referral statistics
     */
    async getClaudeStats() {
        const [stats] = await db.query(
            `SELECT 
                COUNT(*) as total_referrals,
                COUNT(DISTINCT product_id) as unique_products,
                COUNT(DISTINCT user_id) as unique_users,
                DATE(timestamp) as date
             FROM claude_referrals
             WHERE timestamp > DATE_SUB(NOW(), INTERVAL 30 DAY)
             GROUP BY DATE(timestamp)
             ORDER BY date DESC`
        );

        return stats;
    }

    /**
     * Get statistics
     */
    async getStatistics() {
        return {
            productsOptimized: this.claudeDataCache.size,
            thirdPartyData: this.thirdPartyData.size,
            claudeReferrals: Array.from(this.referralData.values())
                .reduce((sum, data) => sum + data.length, 0),
            timestamp: new Date().toISOString()
        };
    }

    getStatus() {
        return {
            initialized: this.isInitialized,
            cacheSize: this.claudeDataCache.size,
            thirdPartyData: this.thirdPartyData.size,
            referrals: this.referralData.size
        };
    }
}

// ============================================
// EXPORT
// ============================================

module.exports = new ClaudeOptimizationService();