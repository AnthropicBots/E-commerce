// backend/modules/index.js
const fs = require('fs');
const path = require('path');

// Registry of all bounded contexts
const modules = {};

/**
 * Load all modules dynamically
 */
function loadModules() {
    const moduleDir = __dirname;
    const items = fs.readdirSync(moduleDir);

    for (const item of items) {
        const itemPath = path.join(moduleDir, item);
        const stats = fs.statSync(itemPath);

        // Skip core and index files
        if (item === 'core' || item === 'index.js') continue;

        if (stats.isDirectory()) {
            try {
                const module = require(itemPath);
                modules[item] = module;
                console.log(`📦 Loaded module: ${item}`);
            } catch (error) {
                console.error(`Failed to load module ${item}:`, error.message);
            }
        }
    }

    // Also check for individual module files
    for (const item of items) {
        if (item.endsWith('.js') && item !== 'index.js' && item !== 'core/index.js') {
            const moduleName = path.basename(item, '.js');
            try {
                const module = require(path.join(moduleDir, item));
                if (!modules[moduleName]) {
                    modules[moduleName] = module;
                    console.log(`📦 Loaded module: ${moduleName}`);
                }
            } catch (error) {
                console.error(`Failed to load module ${moduleName}:`, error.message);
            }
        }
    }
}

/**
 * Initialize all modules
 */
async function initializeModules() {
    console.log('🚀 Initializing DDD modules...');

    for (const [name, module] of Object.entries(modules)) {
        console.log(`📦 Initializing: ${name}`);
        // Initialize module if it has init function
        if (module.initialize) {
            await module.initialize();
        }
    }

    console.log('✅ All DDD modules initialized');
}

/**
 * Get module by name
 */
function getModule(name) {
    return modules[name] || null;
}

/**
 * Get all modules
 */
function getAllModules() {
    return modules;
}

// Auto-load modules
loadModules();

module.exports = {
    initializeModules,
    getModule,
    getAllModules,
    modules
};