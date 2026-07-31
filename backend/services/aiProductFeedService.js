// backend/services/aiProductFeedService.js
const db = require('../config/db').promise;
const crypto = require('crypto');

// ============================================
// AI PRODUCT FEED CONFIGURATION
// ============================================

const FEED_CONFIG = {
    maxItems: 1000,
    cacheTTL: 300, // 5 minutes
    defaultLimit: 100,
    formats: ['json', 'xml', 'csv']
};

// ============================================
// AI PRODUCT FEED SERVICE
// ============================================

class AIProductFeedService {
    constructor() {
        this.feedCache = new Map();
        this.structuredDataCache = new Map();
        this.isInitialized = false;
    }

    /**
     * Initialize service
     */
    async initialize() {
        if (this.isInitialized) return;

        console.log('✅ AI Product Feed Service initialized');
        return this;
    }

    /**
     * Generate AI product feed
     */
    async generateFeed(filters = {}) {
        const cacheKey = this.generateCacheKey(filters);
        const cached = this.getFromCache(cacheKey);
        if (cached) return cached;

        const products = await this.fetchProducts(filters);
        const feed = this.formatFeed(products, filters);

        this.setCache(cacheKey, feed);
        return feed;
    }

    /**
     * Fetch products with filters
     */
    async fetchProducts(filters = {}) {
        const {
            category,
            minPrice,
            maxPrice,
            limit = FEED_CONFIG.defaultLimit,
            offset = 0,
            sort = 'created_at_desc',
            inStock = true
        } = filters;

        let query = 'SELECT * FROM products WHERE 1=1';
        const params = [];

        if (category) {
            query += ' AND category = ?';
            params.push(category);
        }

        if (minPrice) {
            query += ' AND price >= ?';
            params.push(parseFloat(minPrice));
        }

        if (maxPrice) {
            query += ' AND price <= ?';
            params.push(parseFloat(maxPrice));
        }

        if (inStock) {
            query += ' AND stock > 0';
        }

        // Sorting
        switch(sort) {
            case 'price_asc':
                query += ' ORDER BY price ASC';
                break;
            case 'price_desc':
                query += ' ORDER BY price DESC';
                break;
            case 'name_asc':
                query += ' ORDER BY name ASC';
                break;
            case 'rating_desc':
                query += ' ORDER BY avg_rating DESC';
                break;
            default:
                query += ' ORDER BY created_at DESC';
        }

        query += ' LIMIT ? OFFSET ?';
        params.push(parseInt(limit), parseInt(offset));

        const [products] = await db.query(query, params);
        return products;
    }

    /**
     * Format feed for AI consumption
     */
    formatFeed(products, filters) {
        return {
            feed: {
                version: '2.0.0',
                generatedAt: new Date().toISOString(),
                totalItems: products.length,
                filters: filters,
                products: products.map(product => this.formatProduct(product))
            }
        };
    }

    /**
     * Format single product for AI
     */
    formatProduct(product) {
        return {
            id: product.id,
            name: product.name,
            description: product.description || '',
            price: {
                amount: parseFloat(product.price),
                currency: 'INR'
            },
            category: product.category,
            brand: product.brand || 'AnthropicBots',
            images: product.images ? JSON.parse(product.images) : [product.image_url],
            availability: product.stock > 0 ? 'in_stock' : 'out_of_stock',
            rating: {
                average: parseFloat(product.avg_rating) || 0,
                count: parseInt(product.review_count) || 0
            },
            url: `${process.env.FRONTEND_URL}/product.html?id=${product.id}`,
            sku: product.sku || product.id,
            specifications: product.specifications ? JSON.parse(product.specifications) : [],
            variants: product.variants ? JSON.parse(product.variants) : [],
            tags: product.tags ? JSON.parse(product.tags) : [],
            createdAt: product.created_at,
            updatedAt: product.updated_at
        };
    }

    /**
     * Generate JSON-LD structured data for product
     */
    generateStructuredData(product) {
        const schema = {
            "@context": "https://schema.org/",
            "@type": "Product",
            "name": product.name,
            "description": product.description || product.short_description || "",
            "image": product.image_url || product.images?.[0] || "",
            "sku": product.sku || product.id,
            "brand": {
                "@type": "Brand",
                "name": product.brand || "AnthropicBots"
            },
            "offers": {
                "@type": "Offer",
                "url": `${process.env.FRONTEND_URL}/product.html?id=${product.id}`,
                "priceCurrency": "INR",
                "price": product.price,
                "priceValidUntil": new Date(Date.now() + 30*24*60*60*1000).toISOString().split('T')[0],
                "availability": product.stock > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
                "seller": {
                    "@type": "Organization",
                    "name": "AnthropicBots E-Commerce"
                }
            },
            "aggregateRating": product.avg_rating ? {
                "@type": "AggregateRating",
                "ratingValue": product.avg_rating,
                "reviewCount": product.review_count || 0
            } : undefined,
            "category": product.category
        };

        return schema;
    }

    /**
     * Generate organization structured data
     */
    generateOrganizationData() {
        return {
            "@context": "https://schema.org",
            "@type": "Organization",
            "name": "AnthropicBots E-Commerce",
            "url": process.env.FRONTEND_URL,
            "logo": `${process.env.FRONTEND_URL}/assets/images/logo.png`,
            "description": "AnthropicBots - Your trusted e-commerce platform",
            "contactPoint": {
                "@type": "ContactPoint",
                "contactType": "customer service",
                "availableLanguage": ["English", "Hindi"]
            }
        };
    }

    /**
     * Generate website structured data
     */
    generateWebSiteData() {
        return {
            "@context": "https://schema.org",
            "@type": "WebSite",
            "name": "AnthropicBots E-Commerce",
            "url": process.env.FRONTEND_URL,
            "potentialAction": {
                "@type": "SearchAction",
                "target": `${process.env.FRONTEND_URL}/search?q={search_term_string}`,
                "query-input": "required name=search_term_string"
            }
        };
    }

    /**
     * Generate sitemap
     */
    async generateSitemap() {
        const [products] = await db.query(
            'SELECT id, updated_at FROM products WHERE stock > 0'
        );

        const baseUrl = process.env.FRONTEND_URL;
        const urls = [];

        // Static pages
        urls.push(
            { loc: baseUrl, priority: 1.0, changefreq: 'daily' },
            { loc: `${baseUrl}/shop`, priority: 0.9, changefreq: 'daily' },
            { loc: `${baseUrl}/about`, priority: 0.6, changefreq: 'monthly' }
        );

        // Category pages
        const categories = ['mens', 'womens', 'electronics', 'home', 'beauty'];
        categories.forEach(cat => {
            urls.push({
                loc: `${baseUrl}/${cat}`,
                priority: 0.8,
                changefreq: 'daily'
            });
        });

        // Product pages
        products.forEach(product => {
            urls.push({
                loc: `${baseUrl}/product.html?id=${product.id}`,
                priority: 0.9,
                changefreq: 'weekly',
                lastmod: product.updated_at || new Date().toISOString()
            });
        });

        return urls;
    }

    /**
     * Generate XML sitemap
     */
    generateXMLSitemap(urls) {
        let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
        xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';

        urls.forEach(url => {
            xml += '  <url>\n';
            xml += `    <loc>${url.loc}</loc>\n`;
            xml += `    <priority>${url.priority}</priority>\n`;
            xml += `    <changefreq>${url.changefreq}</changefreq>\n`;
            if (url.lastmod) {
                xml += `    <lastmod>${url.lastmod}</lastmod>\n`;
            }
            xml += '  </url>\n';
        });

        xml += '</urlset>';
        return xml;
    }

    /**
     * Get product feed statistics
     */
    async getStatistics() {
        const [stats] = await db.query(
            `SELECT 
                COUNT(*) as total_products,
                SUM(CASE WHEN stock > 0 THEN 1 ELSE 0 END) as in_stock,
                COUNT(DISTINCT category) as total_categories,
                MIN(price) as min_price,
                MAX(price) as max_price,
                AVG(price) as avg_price
             FROM products`
        );

        return {
            ...stats[0],
            feedCacheSize: this.feedCache.size,
            structuredDataCache: this.structuredDataCache.size,
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Cache management
     */
    getFromCache(key) {
        const cached = this.feedCache.get(key);
        if (cached && cached.expiresAt > Date.now()) {
            return cached.data;
        }
        this.feedCache.delete(key);
        return null;
    }

    setCache(key, data) {
        this.feedCache.set(key, {
            data,
            expiresAt: Date.now() + FEED_CONFIG.cacheTTL * 1000
        });
    }

    generateCacheKey(filters) {
        const sorted = Object.keys(filters).sort().reduce((acc, key) => {
            acc[key] = filters[key];
            return acc;
        }, {});
        return crypto.createHash('sha256')
            .update(JSON.stringify(sorted))
            .digest('hex');
    }

    /**
     * Clear cache
     */
    clearCache() {
        this.feedCache.clear();
        this.structuredDataCache.clear();
    }
}

// ============================================
// EXPORT
// ============================================

module.exports = new AIProductFeedService();