// backend/services/hallucinationDetectionService.js
const crypto = require('crypto');
const db = require('../config/db').promise;
const EventEmitter = require('events');

// ============================================
// HALLUCINATION DETECTION CONFIGURATION
// ============================================

const HALLUCINATION_CONFIG = {
    validationThreshold: 0.7,
    confidenceThreshold: 0.6,
    maxUnverifiedFields: 2,
    priceDeviationThreshold: 0.3, // 30% deviation from market
    stockDeviationThreshold: 0.5, // 50% deviation from typical
    suspiciousPatterns: [
        /free/i,
        /unlimited/i,
        /infinite/i,
        /unbelievable/i,
        /too good to be true/i,
        /best ever/i,
        /perfect/i,
        /100%/i,
        /guaranteed/i,
        /magic/i
    ]
};

const DATA_SOURCES = {
    VERIFIED: 'verified',
    AI_GENERATED: 'ai_generated',
    USER_SUBMITTED: 'user_submitted',
    PARTNER: 'partner',
    SCRAPED: 'scraped'
};

// ============================================
// HALLUCINATION DETECTION SERVICE
// ============================================

class HallucinationDetectionService extends EventEmitter {
    constructor() {
        super();
        this.validatedData = new Map();
        this.detectionLogs = [];
        this.productProfiles = new Map();
        this.marketData = new Map();
        this.hallucinationAlerts = [];
        this.isInitialized = false;
    }

    /**
     * Initialize hallucination detection service
     */
    async initialize() {
        if (this.isInitialized) return;

        // Load verified product data
        await this.loadVerifiedData();

        // Load market benchmarks
        await this.loadMarketData();

        this.isInitialized = true;
        console.log('✅ Hallucination Detection Service initialized');
        return this;
    }

    /**
     * Validate AI-generated product data
     */
    async validateProductData(productData, source = DATA_SOURCES.AI_GENERATED) {
        const validation = {
            isValid: true,
            confidence: 0,
            flags: [],
            warnings: [],
            suggestedCorrections: [],
            timestamp: new Date().toISOString(),
            source,
            productId: productData.id || productData.name
        };

        // 1. Check price hallucinations
        const priceValidation = await this.validatePrice(productData);
        validation.flags.push(...priceValidation.flags);
        validation.confidence += priceValidation.confidence;
        if (priceValidation.corrections) {
            validation.suggestedCorrections.push(...priceValidation.corrections);
        }

        // 2. Check stock hallucinations
        const stockValidation = await this.validateStock(productData);
        validation.flags.push(...stockValidation.flags);
        validation.confidence += stockValidation.confidence;

        // 3. Check description hallucinations
        const descriptionValidation = this.validateDescription(productData);
        validation.flags.push(...descriptionValidation.flags);
        validation.confidence += descriptionValidation.confidence;

        // 4. Check category consistency
        const categoryValidation = await this.validateCategory(productData);
        validation.flags.push(...categoryValidation.flags);
        validation.confidence += categoryValidation.confidence;

        // 5. Check specification hallucinations
        const specValidation = this.validateSpecifications(productData);
        validation.flags.push(...specValidation.flags);
        validation.confidence += specValidation.confidence;

        // 6. Check for suspicious patterns
        const patternValidation = this.detectSuspiciousPatterns(productData);
        validation.flags.push(...patternValidation.flags);
        validation.confidence += patternValidation.confidence;

        // Calculate final confidence
        validation.confidence = validation.confidence / 6; // Average of all checks

        // Determine if valid
        validation.isValid = validation.confidence >= HALLUCINATION_CONFIG.confidenceThreshold &&
                             validation.flags.filter(f => f.severity === 'critical').length === 0;

        // Log validation
        await this.logValidation(productData, validation);

        // Generate alert if hallucination detected
        if (!validation.isValid || validation.confidence < 0.5) {
            await this.createHallucinationAlert(productData, validation);
        }

        return validation;
    }

    /**
     * Validate price against market data
     */
    async validatePrice(productData) {
        const flags = [];
        let confidence = 0;
        const corrections = [];

        if (!productData.price) {
            flags.push({
                field: 'price',
                severity: 'critical',
                message: 'Price is missing',
                suggestion: 'Price is required'
            });
            confidence += 0.2;
            return { flags, confidence, corrections };
        }

        const price = parseFloat(productData.price);
        
        // Check for unreasonable prices
        if (price <= 0) {
            flags.push({
                field: 'price',
                severity: 'critical',
                message: `Price (${price}) is invalid - must be positive`,
                suggestion: 'Enter a valid positive price'
            });
            confidence += 0.2;
        }

        // Check against market data
        const category = productData.category || 'general';
        const market = await this.getMarketData(category);
        
        if (market) {
            const deviation = Math.abs(price - market.averagePrice) / market.averagePrice;
            
            if (deviation > HALLUCINATION_CONFIG.priceDeviationThreshold) {
                flags.push({
                    field: 'price',
                    severity: 'high',
                    message: `Price (${price}) deviates ${(deviation * 100).toFixed(0)}% from market average (${market.averagePrice})`,
                    suggestion: `Consider pricing around ${market.averagePrice}`
                });
                corrections.push({
                    field: 'price',
                    suggestedValue: market.averagePrice,
                    reason: 'Market average'
                });
                confidence += 0.4;
            } else {
                confidence += 0.8;
            }
        }

        // Check for price hallucinations (unrealistic discounts)
        if (productData.originalPrice) {
            const discount = 1 - (price / parseFloat(productData.originalPrice));
            if (discount > 0.9) {
                flags.push({
                    field: 'discount',
                    severity: 'critical',
                    message: `Discount (${(discount * 100).toFixed(0)}%) is unrealistically high`,
                    suggestion: 'Discount should not exceed 90%'
                });
                confidence += 0.2;
            }
        }

        return { flags, confidence: Math.min(1, confidence), corrections };
    }

    /**
     * Validate stock information
     */
    async validateStock(productData) {
        const flags = [];
        let confidence = 0;

        if (!productData.stock && productData.stock !== 0) {
            flags.push({
                field: 'stock',
                severity: 'medium',
                message: 'Stock information is missing',
                suggestion: 'Provide stock quantity'
            });
            confidence += 0.3;
            return { flags, confidence };
        }

        const stock = parseInt(productData.stock);

        // Check for unrealistic stock
        if (stock > 10000) {
            flags.push({
                field: 'stock',
                severity: 'high',
                message: `Stock (${stock}) seems unrealistically high`,
                suggestion: 'Verify stock quantity'
            });
            confidence += 0.4;
        } else if (stock < 0) {
            flags.push({
                field: 'stock',
                severity: 'critical',
                message: `Stock (${stock}) cannot be negative`,
                suggestion: 'Enter a valid positive stock quantity'
            });
            confidence += 0.2;
        } else {
            confidence += 0.8;
        }

        return { flags, confidence: Math.min(1, confidence) };
    }

    /**
     * Validate product description
     */
    validateDescription(productData) {
        const flags = [];
        let confidence = 0;

        if (!productData.description) {
            flags.push({
                field: 'description',
                severity: 'medium',
                message: 'Description is missing',
                suggestion: 'Provide a product description'
            });
            confidence += 0.3;
            return { flags, confidence };
        }

        const desc = productData.description;

        // Check for suspicious length
        if (desc.length < 10) {
            flags.push({
                field: 'description',
                severity: 'high',
                message: 'Description is too short',
                suggestion: 'Provide more detailed description'
            });
            confidence += 0.4;
        } else if (desc.length > 5000) {
            flags.push({
                field: 'description',
                severity: 'medium',
                message: 'Description is unusually long',
                suggestion: 'Keep description concise'
            });
            confidence += 0.5;
        } else {
            confidence += 0.8;
        }

        // Check for suspicious keywords
        const suspiciousKeywords = ['best', 'perfect', 'amazing', 'unbelievable', 'incredible'];
        let suspiciousCount = 0;
        for (const keyword of suspiciousKeywords) {
            if (desc.toLowerCase().includes(keyword)) {
                suspiciousCount++;
            }
        }

        if (suspiciousCount > 5) {
            flags.push({
                field: 'description',
                severity: 'medium',
                message: 'Description contains excessive promotional language',
                suggestion: 'Use more factual and specific language'
            });
            confidence += 0.5;
        }

        // Check for hallucinated claims
        const hallucinationIndicators = ['guaranteed', '100%', 'free', 'unlimited', 'best ever'];
        let indicatorCount = 0;
        for (const indicator of hallucinationIndicators) {
            if (desc.toLowerCase().includes(indicator)) {
                indicatorCount++;
            }
        }

        if (indicatorCount > 3) {
            flags.push({
                field: 'description',
                severity: 'high',
                message: 'Description contains multiple claims that may be hallucinations',
                suggestion: 'Verify and substantiate all claims'
            });
            confidence += 0.3;
        }

        return { flags, confidence: Math.min(1, confidence) };
    }

    /**
     * Validate category consistency
     */
    async validateCategory(productData) {
        const flags = [];
        let confidence = 0;

        if (!productData.category) {
            flags.push({
                field: 'category',
                severity: 'medium',
                message: 'Category is missing',
                suggestion: 'Select a valid category'
            });
            confidence += 0.3;
            return { flags, confidence };
        }

        // Check if category exists in our system
        const validCategories = await this.getValidCategories();
        if (!validCategories.includes(productData.category)) {
            flags.push({
                field: 'category',
                severity: 'high',
                message: `Category "${productData.category}" is not recognized`,
                suggestion: `Select from: ${validCategories.join(', ')}`
            });
            confidence += 0.4;
        } else {
            confidence += 0.8;
        }

        // Check price-category consistency
        const categoryPriceRange = await this.getCategoryPriceRange(productData.category);
        if (categoryPriceRange && productData.price) {
            const price = parseFloat(productData.price);
            if (price < categoryPriceRange.min * 0.2 || price > categoryPriceRange.max * 2) {
                flags.push({
                    field: 'price',
                    severity: 'high',
                    message: `Price (${price}) is outside typical range for category "${productData.category}"`,
                    suggestion: `Typical range: ${categoryPriceRange.min} - ${categoryPriceRange.max}`
                });
                confidence += 0.5;
            }
        }

        return { flags, confidence: Math.min(1, confidence) };
    }

    /**
     * Validate specifications
     */
    validateSpecifications(productData) {
        const flags = [];
        let confidence = 0;

        if (!productData.specifications || productData.specifications.length === 0) {
            flags.push({
                field: 'specifications',
                severity: 'low',
                message: 'No specifications provided',
                suggestion: 'Add product specifications'
            });
            confidence += 0.5;
            return { flags, confidence };
        }

        // Check for unrealistic specifications
        const specs = productData.specifications;
        const suspiciousSpecs = [];

        for (const spec of specs) {
            if (this.isSuspiciousSpec(spec)) {
                suspiciousSpecs.push(spec);
            }
        }

        if (suspiciousSpecs.length > 0) {
            flags.push({
                field: 'specifications',
                severity: 'high',
                message: `Suspicious specifications detected: ${suspiciousSpecs.map(s => s.name).join(', ')}`,
                suggestion: 'Verify these specifications'
            });
            confidence += 0.3;
        }

        // Check if specifications match category
        if (productData.category) {
            const expectedSpecs = this.getCategorySpecs(productData.category);
            const missingSpecs = expectedSpecs.filter(es => 
                !specs.some(s => s.name.toLowerCase() === es.toLowerCase())
            );

            if (missingSpecs.length > 0) {
                flags.push({
                    field: 'specifications',
                    severity: 'medium',
                    message: `Missing expected specifications: ${missingSpecs.join(', ')}`,
                    suggestion: `Add: ${missingSpecs.join(', ')}`
                });
                confidence += 0.5;
            }
        }

        return { flags, confidence: Math.min(1, confidence) };
    }

    /**
     * Detect suspicious patterns in data
     */
    detectSuspiciousPatterns(productData) {
        const flags = [];
        let confidence = 0;
        const text = JSON.stringify(productData).toLowerCase();

        for (const pattern of HALLUCINATION_CONFIG.suspiciousPatterns) {
            if (pattern.test(text)) {
                flags.push({
                    field: 'general',
                    severity: 'medium',
                    message: `Suspicious pattern detected: ${pattern}`,
                    suggestion: 'Review content for accuracy'
                });
                confidence += 0.1;
            }
        }

        return { flags, confidence: Math.min(1, confidence) };
    }

    /**
     * Check if a specification is suspicious
     */
    isSuspiciousSpec(spec) {
        const suspiciousValues = [
            /9999/,
            /unlimited/i,
            /infinite/i,
            /zero/i,
            /negative/i,
            /impossible/i
        ];

        const text = `${spec.name} ${spec.value}`.toLowerCase();
        return suspiciousValues.some(pattern => pattern.test(text));
    }

    /**
     * Get market data for a category
     */
    async getMarketData(category) {
        if (this.marketData.has(category)) {
            return this.marketData.get(category);
        }

        try {
            const [data] = await db.query(
                `SELECT 
                    AVG(price) as averagePrice,
                    MIN(price) as minPrice,
                    MAX(price) as maxPrice,
                    COUNT(*) as productCount
                 FROM products 
                 WHERE category = ? AND price > 0 AND verified = 1`,
                [category]
            );

            if (data && data.productCount > 0) {
                const marketData = {
                    averagePrice: parseFloat(data.averagePrice),
                    minPrice: parseFloat(data.minPrice),
                    maxPrice: parseFloat(data.maxPrice),
                    productCount: data.productCount
                };
                this.marketData.set(category, marketData);
                return marketData;
            }
        } catch (error) {
            console.error('Get market data error:', error);
        }

        return null;
    }

    /**
     * Get valid categories
     */
    async getValidCategories() {
        try {
            const [rows] = await db.query(
                'SELECT DISTINCT category FROM products WHERE verified = 1'
            );
            return rows.map(r => r.category);
        } catch (error) {
            console.error('Get valid categories error:', error);
            return ['Electronics', 'Fashion', 'Home', 'Beauty', 'Books'];
        }
    }

    /**
     * Get category price range
     */
    async getCategoryPriceRange(category) {
        const data = await this.getMarketData(category);
        if (data) {
            return { min: data.minPrice, max: data.maxPrice };
        }
        return null;
    }

    /**
     * Get category specifications
     */
    getCategorySpecs(category) {
        const categorySpecs = {
            'Electronics': ['Brand', 'Model', 'Weight', 'Dimensions', 'Color', 'Battery'],
            'Fashion': ['Brand', 'Size', 'Material', 'Color', 'Style', 'Fabric'],
            'Home': ['Brand', 'Material', 'Dimensions', 'Weight', 'Color', 'Assembly'],
            'Beauty': ['Brand', 'Type', 'Ingredients', 'Volume', 'Skin Type', 'Expiry'],
            'Books': ['Author', 'ISBN', 'Pages', 'Publisher', 'Year', 'Language']
        };
        return categorySpecs[category] || [];
    }

    /**
     * Load verified data
     */
    async loadVerifiedData() {
        try {
            const [rows] = await db.query(
                'SELECT * FROM products WHERE verified = 1 AND price > 0'
            );

            for (const row of rows) {
                this.productProfiles.set(row.id, row);
                this.marketData.set(row.category, {
                    averagePrice: parseFloat(row.price),
                    minPrice: parseFloat(row.price),
                    maxPrice: parseFloat(row.price),
                    productCount: 1
                });
            }

            console.log(`📊 Loaded ${rows.length} verified products`);
        } catch (error) {
            console.error('Load verified data error:', error);
        }
    }

    /**
     * Load market data
     */
    async loadMarketData() {
        try {
            const [rows] = await db.query(
                `SELECT 
                    category,
                    AVG(price) as avgPrice,
                    MIN(price) as minPrice,
                    MAX(price) as maxPrice,
                    COUNT(*) as count
                 FROM products 
                 WHERE verified = 1 AND price > 0
                 GROUP BY category`
            );

            for (const row of rows) {
                this.marketData.set(row.category, {
                    averagePrice: parseFloat(row.avgPrice),
                    minPrice: parseFloat(row.minPrice),
                    maxPrice: parseFloat(row.maxPrice),
                    productCount: row.count
                });
            }

            console.log(`📊 Loaded market data for ${rows.length} categories`);
        } catch (error) {
            console.error('Load market data error:', error);
        }
    }

    /**
     * Log validation
     */
    async logValidation(productData, validation) {
        try {
            await db.query(
                `INSERT INTO hallucination_detection_logs 
                 (product_id, confidence, flags, warnings, suggestions, source, validation_result, timestamp)
                 VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
                [
                    productData.id || productData.name,
                    validation.confidence,
                    JSON.stringify(validation.flags),
                    JSON.stringify(validation.warnings),
                    JSON.stringify(validation.suggestedCorrections),
                    validation.source,
                    validation.isValid ? 'pass' : 'fail'
                ]
            );
        } catch (error) {
            console.error('Log validation error:', error);
        }
    }

    /**
     * Create hallucination alert
     */
    async createHallucinationAlert(productData, validation) {
        const alert = {
            id: `HALL_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
            productId: productData.id || productData.name,
            confidence: validation.confidence,
            flags: validation.flags,
            timestamp: new Date().toISOString(),
            resolved: false
        };

        this.hallucinationAlerts.push(alert);
        this.emit('hallucination.detected', alert);

        if (validation.confidence < 0.3) {
            console.error(`🚨 CRITICAL: Hallucination detected for ${alert.productId}`);
            console.error(`Confidence: ${validation.confidence}`);
            console.error('Flags:', validation.flags);
        }

        return alert;
    }

    /**
     * Get hallucinations
     */
    getHallucinations(limit = 50) {
        return this.hallucinationAlerts.slice(-limit);
    }

    /**
     * Resolve hallucination alert
     */
    async resolveHallucination(alertId, resolution) {
        const alert = this.hallucinationAlerts.find(a => a.id === alertId);
        if (!alert) {
            throw new Error('Alert not found');
        }

        alert.resolved = true;
        alert.resolvedAt = new Date().toISOString();
        alert.resolution = resolution;

        await this.updateAlert(alert);
        return alert;
    }

    /**
     * Update alert in database
     */
    async updateAlert(alert) {
        try {
            await db.query(
                `UPDATE hallucination_detection_logs 
                 SET resolved = 1, resolved_at = NOW(), resolution = ?
                 WHERE id = ?`,
                [alert.resolution, alert.id]
            );
        } catch (error) {
            console.error('Update alert error:', error);
        }
    }

    /**
     * Get statistics
     */
    async getStatistics() {
        return {
            validatedProducts: this.productProfiles.size,
            marketCategories: this.marketData.size,
            hallucinationAlerts: this.hallucinationAlerts.length,
            pendingAlerts: this.hallucinationAlerts.filter(a => !a.resolved).length,
            detectionLogs: this.detectionLogs.length,
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Get status
     */
    getStatus() {
        return {
            initialized: this.isInitialized,
            validatedProducts: this.productProfiles.size,
            marketCategories: this.marketData.size,
            alerts: this.hallucinationAlerts.length,
            pendingAlerts: this.hallucinationAlerts.filter(a => !a.resolved).length
        };
    }
}

// ============================================
// EXPORT
// ============================================

module.exports = {
    HallucinationDetectionService,
    DATA_SOURCES,
    hallucinationDetectionService: new HallucinationDetectionService()
};