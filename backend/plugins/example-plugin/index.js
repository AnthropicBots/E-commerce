// backend/plugins/example-plugin/index.js

class ExamplePlugin {
    constructor() {
        this.name = 'Example Plugin';
        this.version = '1.0.0';
        this.initialized = false;
    }

    async initialize() {
        console.log('🔌 Example Plugin initializing...');
        this.initialized = true;
        return this;
    }

    async handleOrderCreated(data) {
        console.log('📦 Example Plugin: Order created', data.orderId);
        return { processed: true, data };
    }

    async handleProductViewed(data) {
        console.log('👁️ Example Plugin: Product viewed', data.productId);
        return { processed: true, data };
    }

    async getExampleData(req, res) {
        return res.json({
            success: true,
            data: {
                plugin: this.name,
                version: this.version,
                message: 'Example plugin is working!'
            }
        });
    }

    async cleanup() {
        console.log('🔌 Example Plugin cleaning up...');
        this.initialized = false;
    }
}

module.exports = ExamplePlugin;