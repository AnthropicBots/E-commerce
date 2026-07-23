// backend/services/configService.js
const fs = require('fs');
const path = require('path');
const db = require('../config/db').promise;
const crypto = require('crypto');
const EventEmitter = require('events');

// ============================================
// CONFIGURATION SERVICE
// ============================================

class ConfigService extends EventEmitter {
    constructor() {
        super();
        this.config = new Map();
        this.defaults = new Map();
        this.envOverrides = new Map();
        this.configHistory = [];
        this.watchers = new Map();
        this.reloadInProgress = false;
        this.lastReload = null;
        this.configPath = path.join(__dirname, '../config/app-config.json');
    }

    /**
     * Initialize configuration service
     */
    async initialize() {
        // Load default configuration
        await this.loadDefaults();

        // Load from environment
        this.loadEnvironmentOverrides();

        // Load from file
        await this.loadFromFile();

        // Load from database
        await this.loadFromDatabase();

        // Start watching for changes
        this.startWatching();

        console.log('✅ Configuration Service initialized');
        return this;
    }

    /**
     * Load default configuration
     */
    async loadDefaults() {
        const defaults = {
            app: {
                name: 'E-Commerce API',
                version: '1.0.0',
                env: process.env.NODE_ENV || 'development',
                debug: false
            },
            server: {
                port: process.env.PORT || 5000,
                cors: {
                    enabled: true,
                    origins: ['*']
                },
                rateLimit: {
                    enabled: true,
                    windowMs: 60000,
                    max: 100
                }
            },
            database: {
                host: process.env.DB_HOST || 'localhost',
                port: process.env.DB_PORT || 3306,
                user: process.env.DB_USER || 'root',
                password: process.env.DB_PASSWORD || '',
                name: process.env.DB_NAME || 'ecommerce'
            },
            auth: {
                jwtSecret: process.env.JWT_SECRET || 'default-secret',
                jwtExpiry: '7d',
                refreshExpiry: '30d',
                bcryptRounds: 10
            },
            redis: {
                enabled: false,
                host: process.env.REDIS_HOST || 'localhost',
                port: process.env.REDIS_PORT || 6379,
                password: process.env.REDIS_PASSWORD || ''
            },
            features: {
                recommendations: true,
                analytics: true,
                notifications: true,
                wishlist: true,
                reviews: true
            },
            email: {
                enabled: true,
                host: process.env.SMTP_HOST || 'smtp.gmail.com',
                port: process.env.SMTP_PORT || 587,
                user: process.env.SMTP_USER || '',
                pass: process.env.SMTP_PASS || ''
            },
            payment: {
                gateway: 'stripe',
                testMode: true,
                stripeSecret: process.env.STRIPE_SECRET || '',
                stripePublishable: process.env.STRIPE_PUBLISHABLE || ''
            },
            cache: {
                enabled: true,
                ttl: 300,
                maxItems: 1000
            },
            logging: {
                level: 'info',
                format: 'json',
                file: 'logs/app.log'
            }
        };

        this.defaults = new Map(Object.entries(defaults));
        
        // Set initial config from defaults
        for (const [key, value] of this.defaults) {
            this.config.set(key, { ...value });
        }
    }

    /**
     * Load environment overrides
     */
    loadEnvironmentOverrides() {
        const env = process.env.NODE_ENV || 'development';
        const overrides = {
            app: {
                env,
                debug: env === 'development'
            },
            server: {
                port: parseInt(process.env.PORT) || 5000
            },
            database: {
                host: process.env.DB_HOST || 'localhost',
                port: parseInt(process.env.DB_PORT) || 3306,
                user: process.env.DB_USER || 'root',
                password: process.env.DB_PASSWORD || '',
                name: process.env.DB_NAME || 'ecommerce'
            },
            auth: {
                jwtSecret: process.env.JWT_SECRET || 'default-secret'
            }
        };

        this.envOverrides = new Map(Object.entries(overrides));
        
        // Apply overrides
        for (const [key, value] of this.envOverrides) {
            if (this.config.has(key)) {
                this.config.set(key, {
                    ...this.config.get(key),
                    ...value
                });
            }
        }
    }

    /**
     * Load from file
     */
    async loadFromFile() {
        try {
            if (fs.existsSync(this.configPath)) {
                const content = fs.readFileSync(this.configPath, 'utf8');
                const fileConfig = JSON.parse(content);
                
                for (const [key, value] of Object.entries(fileConfig)) {
                    if (this.config.has(key)) {
                        this.config.set(key, {
                            ...this.config.get(key),
                            ...value
                        });
                    } else {
                        this.config.set(key, value);
                    }
                }
                
                console.log(`📄 Loaded config from file: ${this.configPath}`);
            }
        } catch (error) {
            console.error('Error loading config from file:', error);
        }
    }

    /**
     * Load from database
     */
    async loadFromDatabase() {
        try {
            const [rows] = await db.query(
                'SELECT * FROM app_config WHERE active = 1 ORDER BY priority DESC'
            );

            for (const row of rows) {
                const configKey = row.config_key;
                const value = JSON.parse(row.config_value);
                
                if (this.config.has(configKey)) {
                    this.config.set(configKey, {
                        ...this.config.get(configKey),
                        ...value
                    });
                } else {
                    this.config.set(configKey, value);
                }

                // Store metadata
                this.configHistory.push({
                    key: configKey,
                    value,
                    version: row.version,
                    updatedBy: row.updated_by,
                    timestamp: row.updated_at
                });
            }

            console.log(`📊 Loaded ${rows.length} config entries from database`);
        } catch (error) {
            console.error('Error loading config from database:', error);
        }
    }

    /**
     * Get configuration value
     */
    get(key, defaultValue = null) {
        // Check if key contains dot notation
        if (key.includes('.')) {
            const parts = key.split('.');
            let current = this.config.get(parts[0]);
            
            if (!current) return defaultValue;
            
            for (let i = 1; i < parts.length; i++) {
                if (current && typeof current === 'object') {
                    current = current[parts[i]];
                } else {
                    return defaultValue;
                }
            }
            
            return current !== undefined ? current : defaultValue;
        }

        const value = this.config.get(key);
        return value !== undefined ? value : defaultValue;
    }

    /**
     * Set configuration value
     */
    async set(key, value, options = {}) {
        const { override = false, persist = true, user = null, reason = null } = options;

        // Check if key exists
        const existing = this.config.get(key);
        if (!override && existing !== undefined) {
            throw new Error(`Configuration key '${key}' already exists. Use override option to update.`);
        }

        // Store old value for audit
        const oldValue = this.config.get(key);

        // Set new value
        if (key.includes('.')) {
            const parts = key.split('.');
            const mainKey = parts[0];
            const current = this.config.get(mainKey) || {};
            
            let target = current;
            for (let i = 1; i < parts.length - 1; i++) {
                if (!target[parts[i]]) {
                    target[parts[i]] = {};
                }
                target = target[parts[i]];
            }
            target[parts[parts.length - 1]] = value;
            
            this.config.set(mainKey, current);
        } else {
            this.config.set(key, value);
        }

        // Log change
        this.configHistory.push({
            key,
            oldValue,
            newValue: value,
            user,
            reason,
            timestamp: new Date().toISOString()
        });

        // Persist to database
        if (persist) {
            await this.persistConfig(key, value, user);
        }

        // Notify watchers
        this.emit('config.changed', { key, oldValue, newValue: value, user, reason });

        return true;
    }

    /**
     * Persist configuration to database
     */
    async persistConfig(key, value, user) {
        try {
            await db.query(
                `INSERT INTO app_config 
                 (config_key, config_value, version, updated_by, updated_at)
                 VALUES (?, ?, ?, ?, NOW())
                 ON DUPLICATE KEY UPDATE
                 config_value = VALUES(config_value),
                 version = version + 1,
                 updated_by = VALUES(updated_by),
                 updated_at = VALUES(updated_at)`,
                [key, JSON.stringify(value), user || 'system']
            );
        } catch (error) {
            console.error('Error persisting config:', error);
            throw error;
        }
    }

    /**
     * Watch configuration key for changes
     */
    watch(key, callback) {
        if (!this.watchers.has(key)) {
            this.watchers.set(key, []);
        }
        this.watchers.get(key).push(callback);
        
        // Return unsubscribe function
        return () => {
            const watchers = this.watchers.get(key);
            if (watchers) {
                const index = watchers.indexOf(callback);
                if (index > -1) {
                    watchers.splice(index, 1);
                }
            }
        };
    }

    /**
     * Reload configuration
     */
    async reload() {
        if (this.reloadInProgress) {
            throw new Error('Reload already in progress');
        }

        this.reloadInProgress = true;
        
        try {
            // Store old config for comparison
            const oldConfig = new Map(this.config);

            // Reload from all sources
            await this.loadDefaults();
            this.loadEnvironmentOverrides();
            await this.loadFromFile();
            await this.loadFromDatabase();

            // Notify watchers of changes
            for (const [key, value] of this.config) {
                const oldValue = oldConfig.get(key);
                if (JSON.stringify(oldValue) !== JSON.stringify(value)) {
                    this.emit('config.changed', { 
                        key, 
                        oldValue, 
                        newValue: value, 
                        source: 'reload' 
                    });

                    // Notify watchers
                    const watchers = this.watchers.get(key) || [];
                    for (const callback of watchers) {
                        try {
                            callback(value, oldValue);
                        } catch (error) {
                            console.error(`Error in watcher for ${key}:`, error);
                        }
                    }
                }
            }

            this.lastReload = new Date().toISOString();
            this.emit('config.reloaded', { 
                timestamp: this.lastReload,
                changedKeys: Array.from(this.config.keys())
                    .filter(k => JSON.stringify(this.config.get(k)) !== JSON.stringify(oldConfig.get(k)))
            });

            console.log('🔄 Configuration reloaded successfully');
            
        } finally {
            this.reloadInProgress = false;
        }
    }

    /**
     * Start watching for file changes
     */
    startWatching() {
        if (fs.existsSync(this.configPath)) {
            fs.watch(this.configPath, (eventType) => {
                if (eventType === 'change') {
                    console.log('📄 Config file changed, reloading...');
                    this.reload();
                }
            });
        }
    }

    /**
     * Get all configuration
     */
    getAll() {
        return Object.fromEntries(this.config);
    }

    /**
     * Get configuration history
     */
    getHistory(limit = 50) {
        return this.configHistory.slice(-limit);
    }

    /**
     * Get configuration statistics
     */
    getStats() {
        return {
            totalKeys: this.config.size,
            defaultKeys: this.defaults.size,
            envOverrides: this.envOverrides.size,
            historyCount: this.configHistory.length,
            watcherCount: this.watchers.size,
            lastReload: this.lastReload,
            reloadInProgress: this.reloadInProgress
        };
    }

    /**
     * Reset configuration to defaults
     */
    async reset(key = null) {
        if (key) {
            // Reset specific key
            const defaultValue = this.defaults.get(key);
            if (defaultValue !== undefined) {
                await this.set(key, defaultValue, { override: true, user: 'system', reason: 'Reset to default' });
            } else {
                throw new Error(`No default value found for key: ${key}`);
            }
        } else {
            // Reset all keys to defaults
            for (const [key, value] of this.defaults) {
                await this.set(key, value, { override: true, user: 'system', reason: 'Reset all to defaults' });
            }
        }
    }

    /**
     * Validate configuration
     */
    validate() {
        const errors = [];
        const warnings = [];

        // Check required keys
        const required = ['app', 'server', 'database', 'auth'];
        for (const key of required) {
            if (!this.config.has(key)) {
                errors.push(`Missing required configuration key: ${key}`);
            }
        }

        // Validate database config
        const dbConfig = this.get('database');
        if (dbConfig) {
            if (!dbConfig.host) warnings.push('Database host not configured');
            if (!dbConfig.user) warnings.push('Database user not configured');
            if (!dbConfig.name) warnings.push('Database name not configured');
        }

        // Validate auth config
        const authConfig = this.get('auth');
        if (authConfig && !authConfig.jwtSecret) {
            warnings.push('JWT secret not configured (using default)');
        }

        // Validate email config
        const emailConfig = this.get('email');
        if (emailConfig && emailConfig.enabled) {
            if (!emailConfig.host) warnings.push('SMTP host not configured');
            if (!emailConfig.user) warnings.push('SMTP user not configured');
        }

        return { valid: errors.length === 0, errors, warnings };
    }
}

// ============================================
// EXPORT
// ============================================

const configService = new ConfigService();

module.exports = {
    ConfigService,
    configService
};