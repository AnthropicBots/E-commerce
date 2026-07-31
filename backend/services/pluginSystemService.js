// backend/services/pluginSystemService.js
const fs = require('fs');
const path = require('path');
const db = require('../config/db').promise;
const EventEmitter = require('events');

// ============================================
// PLUGIN SYSTEM CONFIGURATION
// ============================================

const PLUGIN_TYPES = {
    RECOMMENDATION: 'recommendation',
    FRAUD_DETECTION: 'fraud_detection',
    CHAT: 'chat',
    PROMO: 'promo',
    ANALYTICS: 'analytics',
    NOTIFICATION: 'notification',
    PAYMENT: 'payment',
    SECURITY: 'security',
    AI: 'ai',
    CUSTOM: 'custom'
};

const PLUGIN_STATUS = {
    ACTIVE: 'active',
    INACTIVE: 'inactive',
    ERROR: 'error',
    DEPRECATED: 'deprecated'
};

// ============================================
// PLUGIN SYSTEM CLASS
// ============================================

class PluginSystem extends EventEmitter {
    constructor() {
        super();
        this.plugins = new Map();
        this.activePlugins = new Map();
        this.pluginHooks = new Map();
        this.pluginManifests = new Map();
        this.pluginDependencies = new Map();
        this.initialized = false;
        this.pluginPath = path.join(__dirname, '../plugins');
    }

    /**
     * Initialize plugin system
     */
    async initialize() {
        if (this.initialized) return;

        // Create plugins directory if it doesn't exist
        if (!fs.existsSync(this.pluginPath)) {
            fs.mkdirSync(this.pluginPath, { recursive: true });
        }

        // Load installed plugins from database
        await this.loadInstalledPlugins();

        // Discover plugins in directory
        await this.discoverPlugins();

        this.initialized = true;
        console.log('✅ Plugin System initialized');
        this.emit('initialized');
    }

    /**
     * Discover plugins in plugins directory
     */
    async discoverPlugins() {
        try {
            const items = fs.readdirSync(this.pluginPath);

            for (const item of items) {
                const pluginDir = path.join(this.pluginPath, item);
                const stats = fs.statSync(pluginDir);

                if (stats.isDirectory()) {
                    const manifestPath = path.join(pluginDir, 'manifest.json');
                    if (fs.existsSync(manifestPath)) {
                        await this.loadPluginManifest(manifestPath, pluginDir);
                    }
                }
            }
        } catch (error) {
            console.error('Plugin discovery error:', error);
        }
    }

    /**
     * Load plugin manifest
     */
    async loadPluginManifest(manifestPath, pluginDir) {
        try {
            const manifestContent = fs.readFileSync(manifestPath, 'utf8');
            const manifest = JSON.parse(manifestContent);

            // Validate manifest
            if (!this.validateManifest(manifest)) {
                console.error(`Invalid manifest: ${manifestPath}`);
                return;
            }

            const plugin = {
                id: manifest.id || `plugin_${Date.now()}`,
                name: manifest.name,
                version: manifest.version,
                description: manifest.description || '',
                author: manifest.author || 'Unknown',
                type: manifest.type || PLUGIN_TYPES.CUSTOM,
                dependencies: manifest.dependencies || [],
                hooks: manifest.hooks || [],
                routes: manifest.routes || [],
                services: manifest.services || [],
                status: PLUGIN_STATUS.ACTIVE,
                path: pluginDir,
                manifest,
                loaded: false,
                instance: null
            };

            this.plugins.set(plugin.id, plugin);
            this.pluginManifests.set(plugin.id, manifest);

            // Check dependencies
            await this.checkPluginDependencies(plugin);

            console.log(`📦 Plugin discovered: ${plugin.name} (${plugin.id})`);
            this.emit('plugin_discovered', plugin);

            return plugin;
        } catch (error) {
            console.error(`Error loading manifest ${manifestPath}:`, error);
            return null;
        }
    }

    /**
     * Register a plugin programmatically
     */
    async registerPlugin(pluginData) {
        const plugin = {
            id: pluginData.id || `plugin_${Date.now()}`,
            name: pluginData.name,
            version: pluginData.version || '1.0.0',
            description: pluginData.description || '',
            author: pluginData.author || 'Unknown',
            type: pluginData.type || PLUGIN_TYPES.CUSTOM,
            dependencies: pluginData.dependencies || [],
            hooks: pluginData.hooks || [],
            routes: pluginData.routes || [],
            services: pluginData.services || [],
            status: PLUGIN_STATUS.ACTIVE,
            path: null,
            manifest: pluginData,
            loaded: false,
            instance: null
        };

        // Validate plugin
        if (!this.validatePlugin(plugin)) {
            throw new Error('Invalid plugin data');
        }

        this.plugins.set(plugin.id, plugin);
        await this.storePlugin(plugin);

        console.log(`✅ Plugin registered: ${plugin.name} (${plugin.id})`);
        this.emit('plugin_registered', plugin);

        return plugin;
    }

    /**
     * Load a plugin
     */
    async loadPlugin(pluginId) {
        const plugin = this.plugins.get(pluginId);
        if (!plugin) {
            throw new Error(`Plugin not found: ${pluginId}`);
        }

        if (plugin.loaded) {
            return plugin;
        }

        // Check dependencies
        const depsLoaded = await this.ensureDependencies(plugin);
        if (!depsLoaded) {
            throw new Error(`Dependencies not met for plugin: ${plugin.name}`);
        }

        try {
            // Load plugin module
            if (plugin.path) {
                const pluginModule = require(path.join(plugin.path, 'index.js'));
                if (typeof pluginModule === 'function') {
                    plugin.instance = new pluginModule();
                } else {
                    plugin.instance = pluginModule;
                }
            }

            // Register hooks
            if (plugin.hooks && plugin.hooks.length > 0) {
                for (const hook of plugin.hooks) {
                    await this.registerHook(plugin.id, hook);
                }
            }

            // Initialize plugin
            if (plugin.instance && typeof plugin.instance.initialize === 'function') {
                await plugin.instance.initialize();
            }

            plugin.loaded = true;
            plugin.status = PLUGIN_STATUS.ACTIVE;
            this.activePlugins.set(plugin.id, plugin);

            console.log(`✅ Plugin loaded: ${plugin.name}`);
            this.emit('plugin_loaded', plugin);

            return plugin;
        } catch (error) {
            plugin.status = PLUGIN_STATUS.ERROR;
            console.error(`Error loading plugin ${plugin.name}:`, error);
            this.emit('plugin_error', { plugin, error });
            throw error;
        }
    }

    /**
     * Unload a plugin
     */
    async unloadPlugin(pluginId) {
        const plugin = this.plugins.get(pluginId);
        if (!plugin) {
            throw new Error(`Plugin not found: ${pluginId}`);
        }

        if (!plugin.loaded) {
            return plugin;
        }

        try {
            // Cleanup plugin
            if (plugin.instance && typeof plugin.instance.cleanup === 'function') {
                await plugin.instance.cleanup();
            }

            // Remove hooks
            for (const hook of plugin.hooks || []) {
                await this.unregisterHook(plugin.id, hook);
            }

            plugin.loaded = false;
            plugin.status = PLUGIN_STATUS.INACTIVE;
            this.activePlugins.delete(plugin.id);

            console.log(`✅ Plugin unloaded: ${plugin.name}`);
            this.emit('plugin_unloaded', plugin);

            return plugin;
        } catch (error) {
            console.error(`Error unloading plugin ${plugin.name}:`, error);
            throw error;
        }
    }

    /**
     * Register a hook
     */
    async registerHook(pluginId, hook) {
        const plugin = this.plugins.get(pluginId);
        if (!plugin) {
            throw new Error(`Plugin not found: ${pluginId}`);
        }

        if (!this.pluginHooks.has(hook.name)) {
            this.pluginHooks.set(hook.name, []);
        }

        const hookEntry = {
            pluginId,
            hook,
            handler: hook.handler || null
        };

        this.pluginHooks.get(hook.name).push(hookEntry);

        console.log(`🔗 Hook registered: ${hook.name} from ${plugin.name}`);
        this.emit('hook_registered', { pluginId, hook });
    }

    /**
     * Unregister a hook
     */
    async unregisterHook(pluginId, hook) {
        if (this.pluginHooks.has(hook.name)) {
            const hooks = this.pluginHooks.get(hook.name);
            this.pluginHooks.set(
                hook.name,
                hooks.filter(h => h.pluginId !== pluginId)
            );
        }

        console.log(`🔗 Hook unregistered: ${hook.name}`);
    }

    /**
     * Execute a hook
     */
    async executeHook(hookName, data) {
        if (!this.pluginHooks.has(hookName)) {
            return null;
        }

        const hooks = this.pluginHooks.get(hookName);
        const results = [];

        for (const hookEntry of hooks) {
            try {
                const plugin = this.plugins.get(hookEntry.pluginId);
                if (!plugin || !plugin.loaded) {
                    continue;
                }

                if (hookEntry.hook.handler) {
                    const result = await hookEntry.hook.handler(data);
                    results.push({
                        pluginId: hookEntry.pluginId,
                        pluginName: plugin.name,
                        result
                    });
                }
            } catch (error) {
                console.error(`Error executing hook ${hookName} for plugin ${hookEntry.pluginId}:`, error);
                results.push({
                    pluginId: hookEntry.pluginId,
                    error: error.message
                });
            }
        }

        return results;
    }

    /**
     * Get all plugins
     */
    getAllPlugins(filters = {}) {
        let plugins = Array.from(this.plugins.values());

        if (filters.type) {
            plugins = plugins.filter(p => p.type === filters.type);
        }

        if (filters.status) {
            plugins = plugins.filter(p => p.status === filters.status);
        }

        if (filters.loaded !== undefined) {
            plugins = plugins.filter(p => p.loaded === filters.loaded);
        }

        return plugins;
    }

    /**
     * Get active plugins
     */
    getActivePlugins() {
        return Array.from(this.activePlugins.values());
    }

    /**
     * Get plugin by ID
     */
    getPlugin(pluginId) {
        return this.plugins.get(pluginId) || null;
    }

    /**
     * Install a plugin
     */
    async installPlugin(pluginData) {
        // Create plugin directory
        const pluginDir = path.join(this.pluginPath, pluginData.id || pluginData.name);
        if (!fs.existsSync(pluginDir)) {
            fs.mkdirSync(pluginDir, { recursive: true });
        }

        // Save manifest
        const manifestPath = path.join(pluginDir, 'manifest.json');
        fs.writeFileSync(manifestPath, JSON.stringify(pluginData, null, 2));

        // Register plugin
        const plugin = await this.registerPlugin({
            ...pluginData,
            path: pluginDir
        });

        return plugin;
    }

    /**
     * Uninstall a plugin
     */
    async uninstallPlugin(pluginId) {
        const plugin = this.plugins.get(pluginId);
        if (!plugin) {
            throw new Error(`Plugin not found: ${pluginId}`);
        }

        // Unload if loaded
        if (plugin.loaded) {
            await this.unloadPlugin(pluginId);
        }

        // Remove from database
        await this.deletePlugin(pluginId);

        // Remove plugin directory
        if (plugin.path && fs.existsSync(plugin.path)) {
            fs.rmSync(plugin.path, { recursive: true, force: true });
        }

        this.plugins.delete(pluginId);
        this.pluginManifests.delete(pluginId);

        console.log(`✅ Plugin uninstalled: ${plugin.name}`);
        this.emit('plugin_uninstalled', plugin);

        return { success: true };
    }

    // ============================================
    // VALIDATION FUNCTIONS
    // ============================================

    validateManifest(manifest) {
        return manifest.name && manifest.version;
    }

    validatePlugin(plugin) {
        return plugin.name && plugin.type && plugin.version;
    }

    async checkPluginDependencies(plugin) {
        if (!plugin.dependencies || plugin.dependencies.length === 0) {
            return true;
        }

        const missing = [];
        for (const dep of plugin.dependencies) {
            if (!this.plugins.has(dep)) {
                missing.push(dep);
            }
        }

        if (missing.length > 0) {
            plugin.status = PLUGIN_STATUS.ERROR;
            console.warn(`Plugin ${plugin.name} missing dependencies: ${missing.join(', ')}`);
            return false;
        }

        return true;
    }

    async ensureDependencies(plugin) {
        if (!plugin.dependencies || plugin.dependencies.length === 0) {
            return true;
        }

        for (const depId of plugin.dependencies) {
            const dep = this.plugins.get(depId);
            if (!dep || !dep.loaded) {
                console.warn(`Dependency ${depId} not loaded for plugin ${plugin.name}`);
                return false;
            }
        }

        return true;
    }

    // ============================================
    // DATABASE OPERATIONS
    // ============================================

    async loadInstalledPlugins() {
        try {
            const [plugins] = await db.query(
                'SELECT * FROM plugins WHERE status != "deprecated"'
            );

            for (const row of plugins) {
                const plugin = {
                    id: row.plugin_id,
                    name: row.name,
                    version: row.version,
                    description: row.description,
                    author: row.author,
                    type: row.type,
                    dependencies: JSON.parse(row.dependencies || '[]'),
                    hooks: JSON.parse(row.hooks || '[]'),
                    routes: JSON.parse(row.routes || '[]'),
                    services: JSON.parse(row.services || '[]'),
                    status: row.status,
                    path: row.path,
                    loaded: false,
                    instance: null
                };

                this.plugins.set(plugin.id, plugin);
            }

            console.log(`📦 Loaded ${this.plugins.size} plugins from database`);
        } catch (error) {
            console.error('Load installed plugins error:', error);
        }
    }

    async storePlugin(plugin) {
        try {
            await db.query(
                `INSERT INTO plugins 
                 (plugin_id, name, version, description, author, type,
                  dependencies, hooks, routes, services, status, path)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE
                 name = VALUES(name), version = VALUES(version),
                 description = VALUES(description), author = VALUES(author),
                 type = VALUES(type), dependencies = VALUES(dependencies),
                 hooks = VALUES(hooks), routes = VALUES(routes),
                 services = VALUES(services), status = VALUES(status),
                 path = VALUES(path)`,
                [
                    plugin.id,
                    plugin.name,
                    plugin.version,
                    plugin.description,
                    plugin.author,
                    plugin.type,
                    JSON.stringify(plugin.dependencies),
                    JSON.stringify(plugin.hooks),
                    JSON.stringify(plugin.routes),
                    JSON.stringify(plugin.services),
                    plugin.status,
                    plugin.path
                ]
            );
        } catch (error) {
            console.error('Store plugin error:', error);
        }
    }

    async deletePlugin(pluginId) {
        try {
            await db.query(
                'DELETE FROM plugins WHERE plugin_id = ?',
                [pluginId]
            );
        } catch (error) {
            console.error('Delete plugin error:', error);
        }
    }

    // ============================================
    // STATISTICS
    // ============================================

    async getStatistics() {
        try {
            const [stats] = await db.query(
                `SELECT 
                    COUNT(*) as total_plugins,
                    COUNT(DISTINCT type) as plugin_types,
                    SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_plugins,
                    SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as error_plugins,
                    COUNT(DISTINCT author) as authors
                 FROM plugins`
            );

            return {
                plugins: stats[0],
                active: this.activePlugins.size,
                hooks: this.pluginHooks.size,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            console.error('Statistics error:', error);
            throw error;
        }
    }

    getStatus() {
        return {
            totalPlugins: this.plugins.size,
            activePlugins: this.activePlugins.size,
            pluginTypes: Object.values(PLUGIN_TYPES),
            hooks: this.pluginHooks.size,
            initialized: this.initialized
        };
    }
}

// ============================================
// EXPORT
// ============================================

module.exports = {
    PluginSystem,
    PLUGIN_TYPES,
    PLUGIN_STATUS,
    pluginSystem: new PluginSystem()
};