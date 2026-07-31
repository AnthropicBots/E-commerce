// backend/services/semanticVersionService.js
const fs = require('fs');
const path = require('path');
const db = require('../config/db').promise;
const crypto = require('crypto');
const EventEmitter = require('events');

// ============================================
// SEMANTIC VERSION CONFIGURATION
// ============================================

const VERSION_TYPES = {
    SERVICE: 'service',
    API: 'api',
    LIBRARY: 'library',
    UTILITY: 'utility',
    MODULE: 'module'
};

const CHANGE_TYPES = {
    MAJOR: 'major',      // Breaking changes
    MINOR: 'minor',      // New features (backward compatible)
    PATCH: 'patch',      // Bug fixes (backward compatible)
    PRERELEASE: 'prerelease' // Alpha/beta/rc
};

const VERSION_STATUS = {
    DRAFT: 'draft',
    PUBLISHED: 'published',
    DEPRECATED: 'deprecated',
    RETIRED: 'retired'
};

// ============================================
// SEMANTIC VERSION SERVICE
// ============================================

class SemanticVersionService extends EventEmitter {
    constructor() {
        super();
        this.modules = new Map();
        this.versions = new Map();
        this.dependencies = new Map();
        this.breakingChanges = [];
        this.versionHistory = [];
        this.modulePath = path.join(__dirname, '../modules');
        this.isScanning = false;
    }

    /**
     * Initialize semantic version service
     */
    async initialize() {
        // Scan for modules
        await this.scanModules();

        // Load from database
        await this.loadFromDatabase();

        console.log('✅ Semantic Version Service initialized');
        return this;
    }

    /**
     * Scan for modules in the codebase
     */
    async scanModules() {
        if (this.isScanning) return;

        this.isScanning = true;
        console.log('🔍 Scanning modules...');

        try {
            const modules = await this.findModules();
            
            for (const modulePath of modules) {
                const moduleInfo = await this.analyzeModule(modulePath);
                if (moduleInfo) {
                    this.modules.set(moduleInfo.name, moduleInfo);
                    console.log(`📦 Found module: ${moduleInfo.name} v${moduleInfo.version}`);
                }
            }

            console.log(`✅ Found ${this.modules.size} modules`);
        } catch (error) {
            console.error('Scan modules error:', error);
        } finally {
            this.isScanning = false;
        }
    }

    /**
     * Find modules in codebase
     */
    async findModules() {
        const modules = [];
        const projectRoot = path.join(__dirname, '..');

        const walkDir = (dir) => {
            const items = fs.readdirSync(dir);
            for (const item of items) {
                const fullPath = path.join(dir, item);
                const stats = fs.statSync(fullPath);

                if (stats.isDirectory()) {
                    if (['node_modules', '.git', 'logs', 'uploads', 'dist', 'build'].includes(item)) continue;
                    
                    // Check for module manifest
                    const manifestPath = path.join(fullPath, 'package.json');
                    const moduleManifest = path.join(fullPath, 'module.json');
                    
                    if (fs.existsSync(manifestPath)) {
                        modules.push(manifestPath);
                    } else if (fs.existsSync(moduleManifest)) {
                        modules.push(moduleManifest);
                    } else {
                        walkDir(fullPath);
                    }
                }
            }
        };

        walkDir(projectRoot);
        return modules;
    }

    /**
     * Analyze a module
     */
    async analyzeModule(manifestPath) {
        try {
            const content = fs.readFileSync(manifestPath, 'utf8');
            const manifest = JSON.parse(content);

            // Determine module type
            const type = this.determineModuleType(manifestPath);

            const moduleInfo = {
                name: manifest.name || path.basename(path.dirname(manifestPath)),
                version: manifest.version || '0.0.0',
                type: type,
                path: path.dirname(manifestPath),
                manifest: manifest,
                description: manifest.description || '',
                author: manifest.author || '',
                dependencies: manifest.dependencies || {},
                devDependencies: manifest.devDependencies || {},
                peerDependencies: manifest.peerDependencies || {},
                exports: manifest.exports || {},
                status: VERSION_STATUS.PUBLISHED,
                updatedAt: new Date().toISOString(),
                createdAt: new Date().toISOString()
            };

            // Validate version
            if (!this.isValidVersion(moduleInfo.version)) {
                console.warn(`⚠️ Invalid version for ${moduleInfo.name}: ${moduleInfo.version}`);
                moduleInfo.version = '0.0.0';
            }

            return moduleInfo;
        } catch (error) {
            console.error(`Analyze module error for ${manifestPath}:`, error);
            return null;
        }
    }

    /**
     * Determine module type from path
     */
    determineModuleType(manifestPath) {
        const pathLower = manifestPath.toLowerCase();
        if (pathLower.includes('/services/')) return VERSION_TYPES.SERVICE;
        if (pathLower.includes('/api/')) return VERSION_TYPES.API;
        if (pathLower.includes('/libraries/')) return VERSION_TYPES.LIBRARY;
        if (pathLower.includes('/utils/')) return VERSION_TYPES.UTILITY;
        return VERSION_TYPES.MODULE;
    }

    /**
     * Validate semantic version
     */
    isValidVersion(version) {
        const semverRegex = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
        return semverRegex.test(version);
    }

    /**
     * Parse version into components
     */
    parseVersion(version) {
        const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/);
        if (!match) return null;

        return {
            major: parseInt(match[1]),
            minor: parseInt(match[2]),
            patch: parseInt(match[3]),
            prerelease: match[4] || null,
            build: match[5] || null
        };
    }

    /**
     * Compare two versions
     */
    compareVersions(v1, v2) {
        const p1 = this.parseVersion(v1);
        const p2 = this.parseVersion(v2);

        if (!p1 || !p2) return 0;

        if (p1.major !== p2.major) return p1.major - p2.major;
        if (p1.minor !== p2.minor) return p1.minor - p2.minor;
        if (p1.patch !== p2.patch) return p1.patch - p2.patch;

        // Handle prerelease
        if (p1.prerelease && !p2.prerelease) return -1;
        if (!p1.prerelease && p2.prerelease) return 1;
        if (p1.prerelease && p2.prerelease) {
            return p1.prerelease.localeCompare(p2.prerelease);
        }

        return 0;
    }

    /**
     * Check if version is compatible (no breaking changes)
     */
    isCompatible(v1, v2) {
        const p1 = this.parseVersion(v1);
        const p2 = this.parseVersion(v2);

        if (!p1 || !p2) return false;

        // Same major version = compatible
        return p1.major === p2.major;
    }

    /**
     * Detect breaking changes between versions
     */
    detectBreakingChanges(moduleName, oldVersion, newVersion) {
        const changes = [];
        const oldModule = this.modules.get(moduleName);
        if (!oldModule) return changes;

        const p1 = this.parseVersion(oldVersion);
        const p2 = this.parseVersion(newVersion);

        if (!p1 || !p2) return changes;

        // Check major version change
        if (p2.major > p1.major) {
            changes.push({
                type: CHANGE_TYPES.MAJOR,
                description: `Major version upgrade from ${oldVersion} to ${newVersion}`,
                reason: 'Breaking changes expected'
            });
        }

        // Check API changes
        const oldExports = JSON.stringify(oldModule.exports || {});
        const newExports = JSON.stringify(oldModule.exports || {}); // Would need to load new version

        // In production, compare actual exports
        // This is a simplified version

        // Check dependency changes
        const oldDeps = JSON.stringify(oldModule.dependencies || {});
        const newDeps = JSON.stringify(oldModule.dependencies || {});

        if (oldDeps !== newDeps) {
            changes.push({
                type: CHANGE_TYPES.MINOR,
                description: 'Dependencies have changed',
                reason: 'May affect compatibility'
            });
        }

        return changes;
    }

    /**
     * Register a new version
     */
    async registerVersion(moduleName, version, data = {}) {
        const module = this.modules.get(moduleName);
        if (!module) {
            throw new Error(`Module not found: ${moduleName}`);
        }

        // Validate version
        if (!this.isValidVersion(version)) {
            throw new Error(`Invalid version: ${version}`);
        }

        // Check if version already exists
        const existing = this.versions.get(`${moduleName}@${version}`);
        if (existing) {
            throw new Error(`Version ${version} already exists for ${moduleName}`);
        }

        // Detect breaking changes
        const breakingChanges = this.detectBreakingChanges(
            moduleName,
            module.version,
            version
        );

        const versionInfo = {
            moduleName,
            version,
            previousVersion: module.version,
            breakingChanges,
            status: VERSION_STATUS.PUBLISHED,
            data,
            timestamp: new Date().toISOString(),
            hash: this.generateHash(moduleName, version, data)
        };

        // Update module version
        module.version = version;
        module.updatedAt = new Date().toISOString();

        // Store version
        this.versions.set(`${moduleName}@${version}`, versionInfo);
        this.versionHistory.push(versionInfo);

        // Store in database
        await this.storeModule(module);
        await this.storeVersion(versionInfo);

        this.emit('version.registered', { 
            moduleName, 
            version, 
            breakingChanges: breakingChanges.length 
        });

        console.log(`📦 Version ${version} registered for ${moduleName}`);
        return versionInfo;
    }

    /**
     * Check compatibility between modules
     */
    checkCompatibility(sourceModule, targetModule, sourceVersion = null, targetVersion = null) {
        const source = this.modules.get(sourceModule);
        const target = this.modules.get(targetModule);

        if (!source || !target) {
            return {
                compatible: false,
                reason: 'Module not found'
            };
        }

        const sourceVer = sourceVersion || source.version;
        const targetVer = targetVersion || target.version;

        // Check if versions are valid
        if (!this.isValidVersion(sourceVer) || !this.isValidVersion(targetVer)) {
            return {
                compatible: false,
                reason: 'Invalid version format'
            };
        }

        // Check compatibility
        const compatible = this.isCompatible(sourceVer, targetVer);

        // Check if target version is in source dependencies
        const deps = source.dependencies || {};
        const depVersion = deps[targetModule];

        if (depVersion && !this.satisfiesVersion(targetVer, depVersion)) {
            return {
                compatible: false,
                reason: `Version ${targetVer} does not satisfy dependency constraint ${depVersion}`
            };
        }

        return {
            compatible,
            sourceVersion: sourceVer,
            targetVersion: targetVer,
            message: compatible ? 'Compatible' : 'Breaking changes detected'
        };
    }

    /**
     * Check if version satisfies constraint
     */
    satisfiesVersion(version, constraint) {
        // Simple implementation for common patterns
        if (constraint.startsWith('^')) {
            const major = this.parseVersion(version)?.major;
            const constraintMajor = this.parseVersion(constraint.substring(1))?.major;
            return major === constraintMajor;
        }

        if (constraint.startsWith('~')) {
            const p1 = this.parseVersion(version);
            const p2 = this.parseVersion(constraint.substring(1));
            return p1.major === p2.major && p1.minor === p2.minor;
        }

        // Exact version
        return version === constraint;
    }

    /**
     * Get dependency graph
     */
    getDependencyGraph() {
        const graph = {};

        for (const [name, module] of this.modules) {
            graph[name] = {
                version: module.version,
                dependencies: Object.keys(module.dependencies || {}),
                devDependencies: Object.keys(module.devDependencies || {}),
                type: module.type
            };
        }

        return graph;
    }

    /**
     * Generate hash for version
     */
    generateHash(moduleName, version, data) {
        const string = `${moduleName}:${version}:${JSON.stringify(data)}`;
        return crypto.createHash('sha256').update(string).digest('hex');
    }

    // ============================================
    // DATABASE OPERATIONS
    // ============================================

    async loadFromDatabase() {
        try {
            const [rows] = await db.query(
                'SELECT * FROM module_versions ORDER BY created_at DESC'
            );

            for (const row of rows) {
                const versionInfo = {
                    moduleName: row.module_name,
                    version: row.version,
                    previousVersion: row.previous_version,
                    breakingChanges: JSON.parse(row.breaking_changes || '[]'),
                    status: row.status,
                    data: JSON.parse(row.data || '{}'),
                    timestamp: row.created_at,
                    hash: row.version_hash
                };

                this.versions.set(`${row.module_name}@${row.version}`, versionInfo);
                this.versionHistory.push(versionInfo);
            }

            console.log(`📦 Loaded ${rows.length} versions from database`);
        } catch (error) {
            console.error('Load from database error:', error);
        }
    }

    async storeModule(module) {
        try {
            await db.query(
                `INSERT INTO modules 
                 (module_name, version, type, path, description, author,
                  dependencies, dev_dependencies, peer_dependencies, 
                  exports, status, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE
                 version = VALUES(version), type = VALUES(type),
                 path = VALUES(path), description = VALUES(description),
                 author = VALUES(author), dependencies = VALUES(dependencies),
                 dev_dependencies = VALUES(dev_dependencies),
                 peer_dependencies = VALUES(peer_dependencies),
                 exports = VALUES(exports), status = VALUES(status),
                 updated_at = VALUES(updated_at)`,
                [
                    module.name,
                    module.version,
                    module.type,
                    module.path,
                    module.description,
                    module.author,
                    JSON.stringify(module.dependencies),
                    JSON.stringify(module.devDependencies),
                    JSON.stringify(module.peerDependencies),
                    JSON.stringify(module.exports),
                    module.status,
                    module.createdAt,
                    module.updatedAt
                ]
            );
        } catch (error) {
            console.error('Store module error:', error);
        }
    }

    async storeVersion(versionInfo) {
        try {
            await db.query(
                `INSERT INTO module_versions 
                 (module_name, version, previous_version, breaking_changes,
                  status, data, version_hash, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    versionInfo.moduleName,
                    versionInfo.version,
                    versionInfo.previousVersion,
                    JSON.stringify(versionInfo.breakingChanges),
                    versionInfo.status,
                    JSON.stringify(versionInfo.data),
                    versionInfo.hash,
                    versionInfo.timestamp
                ]
            );
        } catch (error) {
            console.error('Store version error:', error);
        }
    }

    // ============================================
    // STATISTICS
    // ============================================

    async getStatistics() {
        const modules = Array.from(this.modules.values());

        return {
            totalModules: modules.length,
            byType: modules.reduce((acc, m) => {
                acc[m.type] = (acc[m.type] || 0) + 1;
                return acc;
            }, {}),
            totalVersions: this.versions.size,
            breakingChanges: this.versionHistory.reduce((acc, v) => 
                acc + (v.breakingChanges?.length || 0), 0),
            lastUpdated: modules.length > 0 ? 
                modules.reduce((latest, m) => 
                    m.updatedAt > latest ? m.updatedAt : latest, 
                    modules[0].updatedAt
                ) : null,
            timestamp: new Date().toISOString()
        };
    }

    getStatus() {
        return {
            modules: this.modules.size,
            versions: this.versions.size,
            types: Object.values(VERSION_TYPES),
            statuses: Object.values(VERSION_STATUS)
        };
    }
}

// ============================================
// EXPORT
// ============================================

module.exports = {
    SemanticVersionService,
    VERSION_TYPES,
    CHANGE_TYPES,
    VERSION_STATUS,
    semanticVersionService: new SemanticVersionService()
};