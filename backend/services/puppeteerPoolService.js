// backend/services/puppeteerPoolService.js
const puppeteer = require('puppeteer');
const EventEmitter = require('events');

// ============================================
// PUPPETEER POOL CONFIGURATION
// ============================================

const POOL_CONFIG = {
    minInstances: 2,
    maxInstances: 5,
    idleTimeout: 60000, // 60 seconds
    maxRetries: 3,
    retryDelay: 1000,
    browserOptions: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu',
            '--window-size=1920,1080'
        ]
    }
};

// ============================================
// PUPPETEER POOL SERVICE
// ============================================

class PuppeteerPoolService extends EventEmitter {
    constructor(config = {}) {
        super();
        this.config = { ...POOL_CONFIG, ...config };
        this.pool = [];
        this.activeInstances = new Map();
        this.pendingRequests = [];
        this.isInitialized = false;
        this.browserCounter = 0;
        this.stats = {
            totalRequests: 0,
            successfulRequests: 0,
            failedRequests: 0,
            avgResponseTime: 0,
            poolHits: 0,
            poolMisses: 0
        };
    }

    /**
     * Initialize the pool
     */
    async initialize() {
        if (this.isInitialized) return;

        // Create minimum instances
        for (let i = 0; i < this.config.minInstances; i++) {
            await this.createBrowserInstance();
        }

        // Start idle cleanup
        setInterval(() => this.cleanupIdleInstances(), 30000);

        this.isInitialized = true;
        console.log(`✅ Puppeteer Pool initialized with ${this.pool.length} instances`);
        return this;
    }

    /**
     * Create a browser instance
     */
    async createBrowserInstance() {
        try {
            const browser = await puppeteer.launch(this.config.browserOptions);
            const instanceId = `browser_${++this.browserCounter}`;
            
            const instance = {
                id: instanceId,
                browser,
                isBusy: false,
                lastUsed: Date.now(),
                createdAt: Date.now(),
                usageCount: 0,
                pages: []
            };

            // Set up cleanup
            browser.on('disconnected', () => {
                this.removeInstance(instanceId);
            });

            this.pool.push(instance);
            this.activeInstances.set(instanceId, instance);

            console.log(`🔄 Browser instance created: ${instanceId}`);
            return instance;
        } catch (error) {
            console.error('Failed to create browser instance:', error);
            this.emit('error', { action: 'create', error });
            throw error;
        }
    }

    /**
     * Acquire a browser instance from the pool
     */
    async acquire(timeout = 30000) {
        const startTime = Date.now();

        return new Promise((resolve, reject) => {
            const checkPool = () => {
                // Find available instance
                const available = this.pool.find(i => !i.isBusy);
                
                if (available) {
                    available.isBusy = true;
                    available.lastUsed = Date.now();
                    available.usageCount++;
                    this.stats.poolHits++;
                    
                    this.emit('instance.acquired', { 
                        instanceId: available.id, 
                        poolSize: this.pool.length 
                    });
                    
                    resolve(this.createPage(available));
                    return;
                }

                // Check if we can grow the pool
                if (this.pool.length < this.config.maxInstances) {
                    this.createBrowserInstance()
                        .then(instance => {
                            const newInstance = this.pool.find(i => i.id === instance.id);
                            if (newInstance) {
                                newInstance.isBusy = true;
                                newInstance.lastUsed = Date.now();
                                newInstance.usageCount++;
                                this.stats.poolMisses++;
                                resolve(this.createPage(newInstance));
                            }
                        })
                        .catch(error => {
                            reject(error);
                        });
                    return;
                }

                // Check if we've timed out
                if (Date.now() - startTime > timeout) {
                    this.stats.failedRequests++;
                    reject(new Error('Timeout waiting for browser instance'));
                    return;
                }

                // Wait and retry
                setTimeout(checkPool, 100);
            };

            checkPool();
        });
    }

    /**
     * Create a page from browser instance
     */
    async createPage(instance) {
        try {
            const page = await instance.browser.newPage();
            
            // Set default timeout
            page.setDefaultTimeout(30000);
            
            // Add to instance pages
            instance.pages.push(page);

            this.emit('page.created', { instanceId: instance.id });
            
            return {
                instanceId: instance.id,
                page,
                release: () => this.release(instance.id, page)
            };
        } catch (error) {
            console.error('Failed to create page:', error);
            this.emit('error', { action: 'createPage', error });
            throw error;
        }
    }

    /**
     * Release a browser instance back to the pool
     */
    release(instanceId, page) {
        const instance = this.activeInstances.get(instanceId);
        if (!instance) {
            console.warn(`Instance ${instanceId} not found for release`);
            return;
        }

        // Close the page
        if (page && !page.isClosed()) {
            page.close().catch(() => {});
        }

        // Remove from pages list
        const pageIndex = instance.pages.indexOf(page);
        if (pageIndex > -1) {
            instance.pages.splice(pageIndex, 1);
        }

        instance.isBusy = false;
        instance.lastUsed = Date.now();

        this.emit('instance.released', { 
            instanceId, 
            poolSize: this.pool.length 
        });
    }

    /**
     * Execute a scraping task with retry logic
     */
    async execute(task, retries = 0) {
        this.stats.totalRequests++;
        const startTime = Date.now();

        try {
            const { page, release, instanceId } = await this.acquire();

            try {
                const result = await task(page);
                const duration = Date.now() - startTime;
                
                this.stats.successfulRequests++;
                this.stats.avgResponseTime = 
                    (this.stats.avgResponseTime * (this.stats.successfulRequests - 1) + duration) / 
                    this.stats.successfulRequests;

                this.emit('task.completed', { 
                    instanceId, 
                    duration, 
                    success: true 
                });

                return result;
            } finally {
                release();
            }
        } catch (error) {
            this.stats.failedRequests++;
            
            this.emit('task.failed', { 
                error: error.message,
                retries: retries
            });

            // Retry logic
            if (retries < this.config.maxRetries) {
                console.log(`Retrying task (attempt ${retries + 1}/${this.config.maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, this.config.retryDelay));
                return this.execute(task, retries + 1);
            }

            throw error;
        }
    }

    /**
     * Remove a browser instance from the pool
     */
    async removeInstance(instanceId) {
        const instance = this.activeInstances.get(instanceId);
        if (!instance) return;

        try {
            await instance.browser.close();
        } catch (error) {
            console.error(`Error closing browser ${instanceId}:`, error);
        }

        // Remove from pool
        const poolIndex = this.pool.findIndex(i => i.id === instanceId);
        if (poolIndex > -1) {
            this.pool.splice(poolIndex, 1);
        }

        this.activeInstances.delete(instanceId);

        console.log(`🗑️ Browser instance removed: ${instanceId}`);
        this.emit('instance.removed', { instanceId, poolSize: this.pool.length });
    }

    /**
     * Clean up idle instances
     */
    async cleanupIdleInstances() {
        const now = Date.now();
        const toRemove = [];

        for (const instance of this.pool) {
            if (instance.isBusy) continue;
            if (now - instance.lastUsed > this.config.idleTimeout) {
                toRemove.push(instance.id);
            }
        }

        // Keep minimum instances
        const removeCount = Math.min(toRemove.length, this.pool.length - this.config.minInstances);

        for (let i = 0; i < removeCount && i < toRemove.length; i++) {
            await this.removeInstance(toRemove[i]);
        }

        if (removeCount > 0) {
            console.log(`🧹 Cleaned up ${removeCount} idle instances`);
        }
    }

    /**
     * Get pool status
     */
    getStatus() {
        return {
            poolSize: this.pool.length,
            activeInstances: this.pool.filter(i => i.isBusy).length,
            idleInstances: this.pool.filter(i => !i.isBusy).length,
            maxInstances: this.config.maxInstances,
            minInstances: this.config.minInstances,
            totalRequests: this.stats.totalRequests,
            successRate: this.stats.totalRequests > 0 
                ? ((this.stats.successfulRequests / this.stats.totalRequests) * 100).toFixed(2) + '%'
                : '0%',
            avgResponseTime: this.stats.avgResponseTime.toFixed(2) + 'ms',
            poolHits: this.stats.poolHits,
            poolMisses: this.stats.poolMisses,
            hitRate: this.stats.totalRequests > 0
                ? ((this.stats.poolHits / (this.stats.poolHits + this.stats.poolMisses)) * 100).toFixed(2) + '%'
                : '0%'
        };
    }

    /**
     * Get instance details
     */
    getInstanceDetails() {
        return this.pool.map(instance => ({
            id: instance.id,
            isBusy: instance.isBusy,
            usageCount: instance.usageCount,
            age: Math.round((Date.now() - instance.createdAt) / 1000) + 's',
            pages: instance.pages.length
        }));
    }

    /**
     * Shutdown the pool
     */
    async shutdown() {
        console.log('🔄 Shutting down Puppeteer pool...');
        
        for (const instance of this.pool) {
            try {
                await instance.browser.close();
            } catch (error) {
                console.error(`Error closing browser ${instance.id}:`, error);
            }
        }

        this.pool = [];
        this.activeInstances.clear();
        this.isInitialized = false;

        console.log('✅ Puppeteer pool shut down');
        this.emit('pool.shutdown');
    }
}

// ============================================
// SCRAPING TASK EXAMPLES
// ============================================

/**
 * Example scraping task: Extract product data
 */
async function scrapeProductPage(url) {
    return pool.execute(async (page) => {
        await page.goto(url, { waitUntil: 'networkidle2' });
        
        const product = await page.evaluate(() => {
            return {
                name: document.querySelector('.product-name')?.textContent?.trim() || '',
                price: document.querySelector('.product-price')?.textContent?.trim() || '',
                description: document.querySelector('.product-description')?.textContent?.trim() || '',
                images: Array.from(document.querySelectorAll('.product-image')).map(img => img.src)
            };
        });

        return product;
    });
}

/**
 * Example scraping task: Extract multiple products
 */
async function scrapeProductList(urls) {
    const results = [];

    for (const url of urls) {
        const product = await scrapeProductPage(url);
        results.push(product);
    }

    return results;
}

// ============================================
// EXPORT
// ============================================

const pool = new PuppeteerPoolService();

module.exports = {
    PuppeteerPoolService,
    pool,
    scrapeProductPage,
    scrapeProductList,
    POOL_CONFIG
};