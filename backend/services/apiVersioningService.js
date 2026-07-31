// backend/services/apiVersioningService.js
const db = require('../config/db').promise;
const crypto = require('crypto');

// ============================================
// API VERSIONING CONFIGURATION
// ============================================

const VERSION_STATUS = {
    CURRENT: 'current',
    SUPPORTED: 'supported',
    DEPRECATED: 'deprecated',
    SUNSET: 'sunset',
    RETIRED: 'retired'
};

const VERSION_CONFIG = {
    defaultVersion: 'v1',
    supportedVersions: ['v1', 'v2', 'v3'],
    deprecatedVersions: [],
    sunsetVersions: [],
    retiredVersions: [],
    deprecationNoticeDays: 90,
    sunsetDays: 30,
    maxVersions: 5
};

// ============================================
// API VERSIONING SERVICE
// ============================================

class APIVersioningService {
    constructor() {
        this.versions = new Map();
        this.versionRoutes = new Map();
        this.deprecationWarnings = new Map();
        this.migrationDocs = new Map();
        this.compatibilityTests = new Map();
        this.apiUsage = new Map();
    }

    /**
     * Initialize API versioning
     */
    async initialize() {
        // Load versions from database
        await this.loadVersions();

        // Register default versions
        this.registerDefaultVersions();

        console.log('✅ API Versioning Service initialized');
        return this;
    }

    /**
     * Register default versions
     */
    registerDefaultVersions() {
        const versionData = [
            {
                version: 'v1',
                status: VERSION_STATUS.CURRENT,
                description: 'Initial API version',
                releaseDate: new Date('2024-01-01').toISOString(),
                sunsetDate: null,
                deprecationDate: null
            },
            {
                version: 'v2',
                status: VERSION_STATUS.SUPPORTED,
                description: 'Enhanced product filtering and pagination',
                releaseDate: new Date('2024-06-01').toISOString(),
                sunsetDate: null,
                deprecationDate: null
            },
            {
                version: 'v3',
                status: VERSION_STATUS.SUPPORTED,
                description: 'Improved authentication and rate limiting',
                releaseDate: new Date('2024-12-01').toISOString(),
                sunsetDate: null,
                deprecationDate: null
            }
        ];

        for (const data of versionData) {
            if (!this.versions.has(data.version)) {
                this.registerVersion(data);
            }
        }
    }

    /**
     * Register a new version
     */
    registerVersion(data) {
        const version = {
            version: data.version,
            status: data.status || VERSION_STATUS.SUPPORTED,
            description: data.description || '',
            releaseDate: data.releaseDate || new Date().toISOString(),
            deprecationDate: data.deprecationDate || null,
            sunsetDate: data.sunsetDate || null,
            retiredDate: null,
            routes: data.routes || [],
            changes: data.changes || [],
            dependencies: data.dependencies || []
        };

        this.versions.set(version.version, version);

        // Store in database
        this.storeVersion(version);

        console.log(`📦 API version registered: ${version.version}`);
        return version;
    }

    /**
     * Deprecate a version
     */
    async deprecateVersion(version, deprecationDate = null) {
        const versionData = this.versions.get(version);
        if (!versionData) {
            throw new Error(`Version not found: ${version}`);
        }

        versionData.status = VERSION_STATUS.DEPRECATED;
        versionData.deprecationDate = deprecationDate || new Date().toISOString();

        // Calculate sunset date (90 days after deprecation)
        const deprecation = new Date(versionData.deprecationDate);
        const sunset = new Date(deprecation);
        sunset.setDate(sunset.getDate() + VERSION_CONFIG.deprecationNoticeDays);
        versionData.sunsetDate = sunset.toISOString();

        // Add to deprecated versions list
        if (!VERSION_CONFIG.deprecatedVersions.includes(version)) {
            VERSION_CONFIG.deprecatedVersions.push(version);
        }

        await this.storeVersion(versionData);

        console.log(`⚠️ Version deprecated: ${version}`);
        return versionData;
    }

    /**
     * Sunset a version (remove from supported)
     */
    async sunsetVersion(version) {
        const versionData = this.versions.get(version);
        if (!versionData) {
            throw new Error(`Version not found: ${version}`);
        }

        versionData.status = VERSION_STATUS.SUNSET;
        versionData.sunsetDate = new Date().toISOString();

        // Add to sunset versions
        if (!VERSION_CONFIG.sunsetVersions.includes(version)) {
            VERSION_CONFIG.sunsetVersions.push(version);
        }

        await this.storeVersion(versionData);

        console.log(`🌅 Version sunset: ${version}`);
        return versionData;
    }

    /**
     * Retire a version (completely remove)
     */
    async retireVersion(version) {
        const versionData = this.versions.get(version);
        if (!versionData) {
            throw new Error(`Version not found: ${version}`);
        }

        versionData.status = VERSION_STATUS.RETIRED;
        versionData.retiredDate = new Date().toISOString();

        // Add to retired versions
        if (!VERSION_CONFIG.retiredVersions.includes(version)) {
            VERSION_CONFIG.retiredVersions.push(version);
        }

        await this.storeVersion(versionData);

        console.log(`🗑️ Version retired: ${version}`);
        return versionData;
    }

    /**
     * Get version info
     */
    getVersion(version) {
        return this.versions.get(version) || null;
    }

    /**
     * Get all versions
     */
    getAllVersions() {
        return Array.from(this.versions.values());
    }

    /**
     * Get current version
     */
    getCurrentVersion() {
        for (const [version, data] of this.versions) {
            if (data.status === VERSION_STATUS.CURRENT) {
                return version;
            }
        }
        return VERSION_CONFIG.defaultVersion;
    }

    /**
     * Get supported versions
     */
    getSupportedVersions() {
        const supported = [];
        for (const [version, data] of this.versions) {
            if (data.status === VERSION_STATUS.CURRENT || 
                data.status === VERSION_STATUS.SUPPORTED) {
                supported.push(version);
            }
        }
        return supported;
    }

    /**
     * Check if version is valid
     */
    isValidVersion(version) {
        return this.versions.has(version) && 
               this.versions.get(version).status !== VERSION_STATUS.RETIRED;
    }

    /**
     * Check if version is supported
     */
    isSupportedVersion(version) {
        const data = this.versions.get(version);
        return data && (data.status === VERSION_STATUS.CURRENT || 
                        data.status === VERSION_STATUS.SUPPORTED);
    }

    /**
     * Get deprecation warning for version
     */
    getDeprecationWarning(version) {
        const data = this.versions.get(version);
        if (!data) return null;

        if (data.status === VERSION_STATUS.DEPRECATED) {
            const deprecationDate = new Date(data.deprecationDate);
            const sunsetDate = new Date(data.sunsetDate);
            const daysUntilSunset = Math.ceil((sunsetDate - new Date()) / (1000 * 60 * 60 * 24));

            return {
                warning: `This API version (${version}) is deprecated and will be sunset on ${sunsetDate.toISOString().split('T')[0]}`,
                deprecationDate: data.deprecationDate,
                sunsetDate: data.sunsetDate,
                daysUntilSunset,
                migrationGuide: `/api/docs/migration/${version}`,
                recommendedVersion: this.getCurrentVersion()
            };
        }

        return null;
    }

    /**
     * Get sunset headers for response
     */
    getSunsetHeaders(version) {
        const data = this.versions.get(version);
        if (!data) return {};

        if (data.status === VERSION_STATUS.DEPRECATED || 
            data.status === VERSION_STATUS.SUNSET) {
            const sunsetDate = new Date(data.sunsetDate || data.deprecationDate);
            const now = new Date();
            const daysUntilSunset = Math.ceil((sunsetDate - now) / (1000 * 60 * 60 * 24));

            return {
                'Deprecation': data.status === VERSION_STATUS.DEPRECATED ? 'true' : 'false',
                'Sunset': data.sunsetDate || '',
                'Sunset-Days': daysUntilSunset.toString(),
                'Link': `</api/docs/migration/${version}>; rel="deprecation"; type="text/html"`,
                'API-Version': version,
                'API-Status': data.status
            };
        }

        return {
            'API-Version': version,
            'API-Status': data.status
        };
    }

    /**
     * Track API usage
     */
    trackUsage(version, path, method, userId) {
        const key = `${version}:${path}:${method}`;
        if (!this.apiUsage.has(key)) {
            this.apiUsage.set(key, { count: 0, users: new Set(), lastUsed: null });
        }

        const usage = this.apiUsage.get(key);
        usage.count++;
        usage.lastUsed = new Date().toISOString();
        if (userId) {
            usage.users.add(userId);
        }
    }

    /**
     * Get usage statistics
     */
    getUsageStatistics(version = null) {
        const stats = {};

        for (const [key, usage] of this.apiUsage) {
            const [v, path, method] = key.split(':');
            if (version && v !== version) continue;

            if (!stats[v]) {
                stats[v] = {
                    totalRequests: 0,
                    uniqueUsers: 0,
                    endpoints: {}
                };
            }

            stats[v].totalRequests += usage.count;
            stats[v].uniqueUsers = Math.max(stats[v].uniqueUsers, usage.users.size);
            stats[v].endpoints[`${method} ${path}`] = {
                count: usage.count,
                lastUsed: usage.lastUsed,
                users: usage.users.size
            };
        }

        return stats;
    }

    /**
     * Create migration documentation
     */
    createMigrationDocumentation(fromVersion, toVersion, changes) {
        const doc = {
            id: this.generateDocId(),
            fromVersion,
            toVersion,
            changes,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        this.migrationDocs.set(`${fromVersion}:${toVersion}`, doc);
        return doc;
    }

    /**
     * Get migration documentation
     */
    getMigrationDocumentation(fromVersion, toVersion) {
        return this.migrationDocs.get(`${fromVersion}:${toVersion}`) || null;
    }

    /**
     * Add compatibility test
     */
    addCompatibilityTest(version, test) {
        if (!this.compatibilityTests.has(version)) {
            this.compatibilityTests.set(version, []);
        }
        this.compatibilityTests.get(version).push(test);
    }

    /**
     * Run compatibility tests
     */
    async runCompatibilityTests(version) {
        const tests = this.compatibilityTests.get(version) || [];
        const results = [];

        for (const test of tests) {
            try {
                const result = await test();
                results.push({
                    name: test.name || 'Unnamed test',
                    passed: result.passed,
                    message: result.message || '',
                    duration: result.duration || 0
                });
            } catch (error) {
                results.push({
                    name: test.name || 'Unnamed test',
                    passed: false,
                    error: error.message
                });
            }
        }

        return results;
    }

    // ============================================
    // HELPER FUNCTIONS
    // ============================================

    generateDocId() {
        return `DOC_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    }

    // ============================================
    // DATABASE OPERATIONS
    // ============================================

    async loadVersions() {
        try {
            const [rows] = await db.query(
                'SELECT * FROM api_versions ORDER BY created_at'
            );

            for (const row of rows) {
                const version = {
                    version: row.version,
                    status: row.status,
                    description: row.description,
                    releaseDate: row.release_date,
                    deprecationDate: row.deprecation_date,
                    sunsetDate: row.sunset_date,
                    retiredDate: row.retired_date,
                    routes: JSON.parse(row.routes || '[]'),
                    changes: JSON.parse(row.changes || '[]'),
                    dependencies: JSON.parse(row.dependencies || '[]')
                };

                this.versions.set(version.version, version);
            }

            console.log(`📦 Loaded ${this.versions.size} API versions`);
        } catch (error) {
            console.error('Load versions error:', error);
        }
    }

    async storeVersion(version) {
        try {
            await db.query(
                `INSERT INTO api_versions 
                 (version, status, description, release_date, deprecation_date,
                  sunset_date, retired_date, routes, changes, dependencies)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE
                 status = VALUES(status), description = VALUES(description),
                 deprecation_date = VALUES(deprecation_date),
                 sunset_date = VALUES(sunset_date),
                 retired_date = VALUES(retired_date),
                 routes = VALUES(routes), changes = VALUES(changes),
                 dependencies = VALUES(dependencies)`,
                [
                    version.version,
                    version.status,
                    version.description,
                    version.releaseDate,
                    version.deprecationDate,
                    version.sunsetDate,
                    version.retiredDate || null,
                    JSON.stringify(version.routes),
                    JSON.stringify(version.changes),
                    JSON.stringify(version.dependencies)
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
        const versions = this.getAllVersions();
        const stats = {
            totalVersions: versions.length,
            currentVersions: versions.filter(v => v.status === 'current').length,
            supportedVersions: versions.filter(v => v.status === 'supported').length,
            deprecatedVersions: versions.filter(v => v.status === 'deprecated').length,
            sunsetVersions: versions.filter(v => v.status === 'sunset').length,
            retiredVersions: versions.filter(v => v.status === 'retired').length,
            usage: this.getUsageStatistics(),
            timestamp: new Date().toISOString()
        };

        return stats;
    }

    getStatus() {
        return {
            versions: this.versions.size,
            deprecationWarnings: this.deprecationWarnings.size,
            migrationDocs: this.migrationDocs.size,
            compatibilityTests: this.compatibilityTests.size,
            config: VERSION_CONFIG
        };
    }
}

// ============================================
// EXPORT
// ============================================

module.exports = {
    APIVersioningService,
    VERSION_STATUS,
    VERSION_CONFIG,
    apiVersioningService: new APIVersioningService()
};