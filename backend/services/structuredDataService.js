const NodeCache = require('node-cache');
const validator = require('validator');

const schemaCache = new NodeCache({ stdTTL: 3600, checkperiod: 600 });

class StructuredDataService {
    constructor() {
        this.baseUrl = process.env.FRONTEND_URL || 'https://anthropicbots.com';
        this.cacheEnabled = process.env.STRUCTURED_DATA_CACHE !== 'false';
    }

    validateProduct(product) {
        if (!product || typeof product !== 'object') {
            throw new Error('Invalid product data: product is required');
        }
        if (!product.id && !product.sku) {
            throw new Error('Invalid product: id or sku is required');
        }
        if (!product.name || typeof product.name !== 'string' || product.name.trim().length === 0) {
            throw new Error('Invalid product: name is required');
        }
        if (typeof product.price !== 'number' || product.price < 0) {
            throw new Error('Invalid product: price must be a positive number');
        }
        return true;
    }

    sanitizeString(value) {
        if (!value || typeof value !== 'string') return '';
        return validator.escape(value.trim());
    }

    validateUrl(url) {
        if (!url) return '';
        return validator.isURL(url) ? url : '';
    }

    getCacheKey(type, id) {
        return `structured_${type}_${id}`;
    }

    generateProductSchema(product) {
        try {
            this.validateProduct(product);

            const cacheKey = this.getCacheKey('product', product.id);
            if (this.cacheEnabled) {
                const cached = schemaCache.get(cacheKey);
                if (cached) return cached;
            }

            const productUrl = `${this.baseUrl}/product/${product.id}`;
            const imageUrl = this.validateUrl(product.imageUrl || product.images?.[0] || '');
            const description = this.sanitizeString(product.description || product.shortDescription || '');
            const name = this.sanitizeString(product.name);
            const category = this.sanitizeString(product.category || '');
            const brand = this.sanitizeString(product.brand || 'AnthropicBots');

            const schema = {
                "@context": "https://schema.org/",
                "@type": "Product",
                "name": name,
                "description": description,
                "image": imageUrl,
                "sku": product.sku || product.id,
                "mpn": product.mpn || product.id,
                "brand": {
                    "@type": "Brand",
                    "name": brand
                },
                "offers": {
                    "@type": "Offer",
                    "url": productUrl,
                    "priceCurrency": "INR",
                    "price": product.price,
                    "priceValidUntil": new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
                    "availability": product.stock > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
                    "seller": {
                        "@type": "Organization",
                        "name": "AnthropicBots E-Commerce"
                    }
                },
                "category": category
            };

            if (product.avgRating && product.reviewCount) {
                schema.aggregateRating = {
                    "@type": "AggregateRating",
                    "ratingValue": product.avgRating,
                    "reviewCount": product.reviewCount
                };
            }

            if (product.reviews && Array.isArray(product.reviews) && product.reviews.length > 0) {
                schema.review = product.reviews.slice(0, 10).map(review => ({
                    "@type": "Review",
                    "reviewRating": {
                        "@type": "Rating",
                        "ratingValue": review.rating || 0,
                        "bestRating": "5"
                    },
                    "author": {
                        "@type": "Person",
                        "name": this.sanitizeString(review.author || 'Anonymous')
                    }
                }));
            }

            if (product.specifications && Array.isArray(product.specifications)) {
                schema.additionalProperty = product.specifications.map(spec => ({
                    "@type": "PropertyValue",
                    "name": this.sanitizeString(spec.name || ''),
                    "value": this.sanitizeString(spec.value || '')
                }));
            }

            if (this.cacheEnabled) {
                schemaCache.set(cacheKey, schema);
            }

            return schema;

        } catch (error) {
            console.error('Generate product schema error:', error.message);
            return this.generateFallbackSchema(product);
        }
    }

    generateFallbackSchema(product) {
        return {
            "@context": "https://schema.org/",
            "@type": "Product",
            "name": product?.name || 'Product',
            "description": product?.description || '',
            "offers": {
                "@type": "Offer",
                "priceCurrency": "INR",
                "price": product?.price || 0
            }
        };
    }

    generateOrganizationSchema() {
        const cacheKey = this.getCacheKey('organization', 'global');
        if (this.cacheEnabled) {
            const cached = schemaCache.get(cacheKey);
            if (cached) return cached;
        }

        const schema = {
            "@context": "https://schema.org",
            "@type": "Organization",
            "name": "AnthropicBots E-Commerce",
            "url": this.baseUrl,
            "logo": `${this.baseUrl}/assets/images/logo.png`,
            "description": "AnthropicBots - Your trusted e-commerce platform for electronics, fashion, home & living, and beauty products.",
            "sameAs": [
                "https://github.com/AnthropicBots",
                "https://twitter.com/anthropicbots",
                "https://linkedin.com/company/anthropicbots"
            ],
            "contactPoint": {
                "@type": "ContactPoint",
                "telephone": "+91-XXXXXXXXXX",
                "contactType": "customer service",
                "availableLanguage": ["English", "Hindi"]
            }
        };

        if (this.cacheEnabled) {
            schemaCache.set(cacheKey, schema);
        }

        return schema;
    }

    generateWebSiteSchema() {
        const cacheKey = this.getCacheKey('website', 'global');
        if (this.cacheEnabled) {
            const cached = schemaCache.get(cacheKey);
            if (cached) return cached;
        }

        const schema = {
            "@context": "https://schema.org",
            "@type": "WebSite",
            "name": "AnthropicBots E-Commerce",
            "url": this.baseUrl,
            "potentialAction": {
                "@type": "SearchAction",
                "target": `${this.baseUrl}/search?q={search_term_string}`,
                "query-input": "required name=search_term_string"
            }
        };

        if (this.cacheEnabled) {
            schemaCache.set(cacheKey, schema);
        }

        return schema;
    }

    generateBreadcrumbSchema(items) {
        if (!items || !Array.isArray(items) || items.length === 0) {
            throw new Error('Breadcrumb items are required');
        }

        const cacheKey = this.getCacheKey('breadcrumb', items.map(i => i.name).join('_'));
        if (this.cacheEnabled) {
            const cached = schemaCache.get(cacheKey);
            if (cached) return cached;
        }

        const schema = {
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            "itemListElement": items.slice(0, 10).map((item, index) => ({
                "@type": "ListItem",
                "position": index + 1,
                "name": this.sanitizeString(item.name || ''),
                "item": this.validateUrl(item.url || this.baseUrl)
            }))
        };

        if (this.cacheEnabled) {
            schemaCache.set(cacheKey, schema);
        }

        return schema;
    }

    generateCategorySchema(category) {
        try {
            if (!category || !category.name) {
                throw new Error('Category name is required');
            }

            const cacheKey = this.getCacheKey('category', category.slug || category.name);
            if (this.cacheEnabled) {
                const cached = schemaCache.get(cacheKey);
                if (cached) return cached;
            }

            const schema = {
                "@context": "https://schema.org",
                "@type": "CollectionPage",
                "name": this.sanitizeString(category.name),
                "description": this.sanitizeString(category.description || ''),
                "url": `${this.baseUrl}/category/${category.slug || category.name.toLowerCase().replace(/\s+/g, '-')}`,
                "about": {
                    "@type": "Thing",
                    "name": this.sanitizeString(category.name)
                }
            };

            if (category.products && Array.isArray(category.products)) {
                schema.mainEntity = {
                    "@type": "ItemList",
                    "itemListElement": category.products.slice(0, 100).map((product, index) => ({
                        "@type": "ListItem",
                        "position": index + 1,
                        "url": `${this.baseUrl}/product/${product.id}`
                    }))
                };
            }

            if (this.cacheEnabled) {
                schemaCache.set(cacheKey, schema);
            }

            return schema;

        } catch (error) {
            console.error('Generate category schema error:', error.message);
            return {
                "@context": "https://schema.org",
                "@type": "CollectionPage",
                "name": category?.name || 'Category'
            };
        }
    }

    generateAIFeed(products) {
        if (!products || !Array.isArray(products)) {
            throw new Error('Products array is required');
        }

        return products.slice(0, 1000).map(product => ({
            id: product.id,
            name: this.sanitizeString(product.name || ''),
            description: this.sanitizeString(product.description || ''),
            price: {
                amount: product.price || 0,
                currency: "INR"
            },
            category: this.sanitizeString(product.category || ''),
            images: (product.images || [product.imageUrl]).filter(img => this.validateUrl(img)),
            availability: product.stock > 0 ? "in_stock" : "out_of_stock",
            brand: this.sanitizeString(product.brand || "AnthropicBots"),
            rating: {
                average: product.avgRating || 0,
                count: product.reviewCount || 0
            },
            url: `${this.baseUrl}/product/${product.id}`,
            specs: product.specifications || [],
            variants: (product.variants || []).map(v => ({
                name: this.sanitizeString(v.name || ''),
                price: v.price || 0,
                availability: v.stock > 0 ? "in_stock" : "out_of_stock"
            })),
            dateAdded: product.createdAt || new Date().toISOString(),
            lastUpdated: product.updatedAt || new Date().toISOString(),
            tags: (product.tags || []).map(t => this.sanitizeString(t)),
            weight: product.weight,
            dimensions: product.dimensions
        }));
    }

    generateSitemap(products) {
        if (!products || !Array.isArray(products)) {
            throw new Error('Products array is required');
        }

        const urls = [];
        const categories = ['mens', 'womens', 'electronics', 'home', 'beauty'];

        urls.push(
            { loc: this.baseUrl, priority: 1.0, changefreq: 'daily' },
            { loc: `${this.baseUrl}/shop`, priority: 0.9, changefreq: 'daily' },
            { loc: `${this.baseUrl}/about`, priority: 0.6, changefreq: 'monthly' },
            { loc: `${this.baseUrl}/contact`, priority: 0.5, changefreq: 'monthly' }
        );

        categories.forEach(cat => {
            urls.push({
                loc: `${this.baseUrl}/${cat}`,
                priority: 0.8,
                changefreq: 'daily'
            });
        });

        products.slice(0, 50000).forEach(product => {
            urls.push({
                loc: `${this.baseUrl}/product/${product.id}`,
                priority: 0.9,
                changefreq: 'weekly',
                lastmod: product.updatedAt || new Date().toISOString()
            });
        });

        return urls;
    }

    generateMetaTags(product) {
        try {
            this.validateProduct(product);

            return {
                title: `${this.sanitizeString(product.name)} - AnthropicBots E-Commerce`,
                description: this.sanitizeString(product.description || product.shortDescription || `${product.name} available at AnthropicBots. Shop now!`),
                keywords: (product.tags?.join(', ') || product.category || ''),
                ogTitle: this.sanitizeString(product.name),
                ogDescription: this.sanitizeString(product.description || product.shortDescription || ''),
                ogImage: this.validateUrl(product.imageUrl || ''),
                ogUrl: `${this.baseUrl}/product/${product.id}`,
                ogType: 'product',
                twitterCard: 'summary_large_image',
                twitterTitle: this.sanitizeString(product.name),
                twitterDescription: this.sanitizeString(product.description || product.shortDescription || ''),
                twitterImage: this.validateUrl(product.imageUrl || ''),
                price: product.price,
                currency: 'INR',
                availability: product.stock > 0 ? 'In Stock' : 'Out of Stock'
            };

        } catch (error) {
            console.error('Generate meta tags error:', error.message);
            return {
                title: 'Product - AnthropicBots E-Commerce',
                description: 'Shop now at AnthropicBots',
                price: product?.price || 0,
                currency: 'INR',
                availability: 'Unknown'
            };
        }
    }

    clearCache(type, id) {
        if (type && id) {
            const key = this.getCacheKey(type, id);
            schemaCache.del(key);
            return { cleared: 1 };
        }
        schemaCache.flushAll();
        return { cleared: 'all' };
    }

    getCacheStats() {
        return {
            keys: schemaCache.keys(),
            size: schemaCache.keys().length,
            hits: schemaCache.getStats?.().hits || 0,
            misses: schemaCache.getStats?.().misses || 0
        };
    }
}

module.exports = new StructuredDataService();