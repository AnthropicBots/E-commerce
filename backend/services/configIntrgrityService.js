// backend/services/configIntegrityService.js
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const db = require('../config/db').promise;
const EventEmitter = require('events');

// ============================================
// INTEGRITY CONFIGURATION
// ============================================

const INTEGRITY_CONFIG = {
    // Algorithm settings
    algorithm: 'sha256',
    signatureAlgorithm: 'rsa',
    keySize: 2048,
    
    // File patterns to verify
    criticalFiles: [
        'config/*.json',
        'config/*.yaml',
        '.env',
        'package.json',
        'package-lock.json'
    ],
    
    // Verification settings
    strictMode: true,
    autoRecover: false,
    alertOnFailure: true,
    
    // Manifest settings
    manifestVersion: '1.0.0',
    manifestLocation: '.integrity-manifest.json'
};

// ============================================
// INTEGRITY VERIFICATION SERVICE
// ============================================

class ConfigIntegrityService extends EventEmitter {
    constructor() {
        super();
        this.manifest = null;
        this.signatures = new Map();
        this.verificationResults = [];
        this.alertHistory = [];
        this.publicKey = null;
        this.privateKey = null;
        this.isInitialized = false;
        this.keyPath = path.join(__dirname, '../keys');
    }

    /**
     * Initialize integrity service
     */
    async initialize() {
        if (this.isInitialized) return;

        // Ensure key directory exists
        if (!fs.existsSync(this.keyPath)) {
            fs.mkdirSync(this.keyPath, { recursive: true });
        }

        // Load or generate keys
        await this.loadOrGenerateKeys();

        // Load manifest
        await this.loadManifest();

        // Verify initial configuration
        await this.verifyConfiguration();

        // Start periodic verification
        setInterval(() => this.verifyConfiguration(), 3600000); // 1 hour

        this.isInitialized = true;
        console.log('✅ Config Integrity Service initialized');
        return this;
    }

    /**
     * Load or generate cryptographic keys
     */
    async loadOrGenerateKeys() {
        const publicKeyPath = path.join(this.keyPath, 'public.pem');
        const privateKeyPath = path.join(this.keyPath, 'private.pem');

        try {
            if (fs.existsSync(publicKeyPath) && fs.existsSync(privateKeyPath)) {
                this.publicKey = fs.readFileSync(publicKeyPath, 'utf8');
                this.privateKey = fs.readFileSync(privateKeyPath, 'utf8');
                console.log('🔑 Loaded existing cryptographic keys');
            } else {
                await this.generateKeys(publicKeyPath, privateKeyPath);
            }
        } catch (error) {
            console.error('Load/generate keys error:', error);
            await this.generateKeys(publicKeyPath, privateKeyPath);
        }
    }

    /**
     * Generate cryptographic keys
     */
    async generateKeys(publicKeyPath, privateKeyPath) {
        console.log('🔑 Generating new cryptographic keys...');

        const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
            modulusLength: INTEGRITY_CONFIG.keySize,
            publicKeyEncoding: {
                type: 'spki',
                format: 'pem'
            },
            privateKeyEncoding: {
                type: 'pkcs8',
                format: 'pem'
            }
        });

        this.publicKey = publicKey;
        this.privateKey = privateKey;

        fs.writeFileSync(publicKeyPath, publicKey);
        fs.writeFileSync(privateKeyPath, privateKey);

        console.log('✅ Cryptographic keys generated');
    }

    /**
     * Load integrity manifest
     */
    async loadManifest() {
        const manifestPath = path.join(__dirname, '..', INTEGRITY_CONFIG.manifestLocation);

        try {
            if (fs.existsSync(manifestPath)) {
                const content = fs.readFileSync(manifestPath, 'utf8');
                this.manifest = JSON.parse(content);
                console.log(`📋 Loaded manifest: ${manifestPath}`);
            } else {
                // Create initial manifest
                await this.createManifest();
            }
        } catch (error) {
            console.error('Load manifest error:', error);
            await this.createManifest();
        }
    }

    /**
     * Create integrity manifest
     */
    async createManifest() {
        console.log('📋 Creating integrity manifest...');

        const files = await this.findCriticalFiles();
        const entries = {};

        for (const file of files) {
            entries[file] = {
                hash: await this.hashFile(file),
                size: fs.statSync(file).size,
                modified: fs.statSync(file).mtime.toISOString()
            };
        }

        const manifest = {
            version: INTEGRITY_CONFIG.manifestVersion,
            created: new Date().toISOString(),
            entries,
            signature: await this.signData(JSON.stringify(entries))
        };

        this.manifest = manifest;

        // Save manifest
        const manifestPath = path.join(__dirname, '..', INTEGRITY_CONFIG.manifestLocation);
        fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

        console.log(`✅ Manifest created with ${Object.keys(entries).length} entries`);
        this.emit('manifest.created', { entries: Object.keys(entries).length });
    }

    /**
     * Find critical configuration files
     */
    async findCriticalFiles() {
        const files = [];
        const projectRoot = path.join(__dirname, '..');

        for (const pattern of INTEGRITY_CONFIG.criticalFiles) {
            const globPattern = pattern.includes('*') ? pattern : pattern;
            // Simple pattern matching - in production use glob library
            const fullPath = path.join(projectRoot, globPattern);
            
            try {
                if (fs.existsSync(fullPath)) {
                    const stats = fs.statSync(fullPath);
                    if (stats.isFile()) {
                        files.push(fullPath);
                    }
                }
            } catch (error) {
                console.error(`Error finding files for pattern ${pattern}:`, error);
            }
        }

        return files;
    }

    /**
     * Hash a file
     */
    async hashFile(filePath) {
        try {
            const content = fs.readFileSync(filePath);
            return crypto
                .createHash(INTEGRITY_CONFIG.algorithm)
                .update(content)
                .digest('hex');
        } catch (error) {
            console.error(`Hash file error (${filePath}):`, error);
            return null;
        }
    }

    /**
     * Hash data
     */
    hashData(data) {
        return crypto
            .createHash(INTEGRITY_CONFIG.algorithm)
            .update(JSON.stringify(data))
            .digest('hex');
    }

    /**
     * Sign data
     */
    async signData(data) {
        const sign = crypto.createSign(INTEGRITY_CONFIG.signatureAlgorithm);
        sign.update(JSON.stringify(data));
        sign.end();
        return sign.sign(this.privateKey, 'hex');
    }

    /**
     * Verify signature
     */
    verifySignature(data, signature) {
        const verify = crypto.createVerify(INTEGRITY_CONFIG.signatureAlgorithm);
        verify.update(JSON.stringify(data));
        verify.end();
        return verify.verify(this.publicKey, signature, 'hex');
    }

    /**
     * Verify configuration integrity
     */
    async verifyConfiguration() {
        console.log('🔍 Verifying configuration integrity...');

        const results = {
            verified: true,
            entries: [],
            errors: [],
            warnings: [],
            timestamp: new Date().toISOString()
        };

        try {
            if (!this.manifest) {
                await this.createManifest();
                results.verified = true;
                results.warnings.push('Manifest was created');
                return results;
            }

            const files = await this.findCriticalFiles();
            let allVerified = true;

            for (const file of files) {
                const relativePath = path.relative(path.join(__dirname, '..'), file);
                const manifestEntry = this.manifest.entries[relativePath];

                if (!manifestEntry) {
                    results.warnings.push(`File not in manifest: ${relativePath}`);
                    results.entries.push({
                        file: relativePath,
                        status: 'new',
                        verified: false
                    });
                    allVerified = false;
                    continue;
                }

                const currentHash = await this.hashFile(file);
                const currentSize = fs.statSync(file).size;
                const currentModified = fs.statSync(file).mtime.toISOString();

                const entryResult = {
                    file: relativePath,
                    expectedHash: manifestEntry.hash,
                    currentHash,
                    expectedSize: manifestEntry.size,
                    currentSize,
                    expectedModified: manifestEntry.modified,
                    currentModified,
                    status: 'ok',
                    verified: true
                };

                // Check integrity
                if (currentHash !== manifestEntry.hash) {
                    entryResult.status = 'modified';
                    entryResult.verified = false;
                    allVerified = false;
                    results.errors.push(`File modified: ${relativePath}`);
                }

                // Check size
                if (currentSize !== manifestEntry.size) {
                    entryResult.status = 'size_changed';
                    entryResult.verified = false;
                    allVerified = false;
                }

                results.entries.push(entryResult);
            }

            // Verify manifest signature
            const manifestData = { ...this.manifest };
            const signature = manifestData.signature;
            delete manifestData.signature;

            if (!this.verifySignature(manifestData, signature)) {
                results.errors.push('Manifest signature verification failed');
                allVerified = false;
            }

            results.verified = allVerified;

            if (!results.verified && INTEGRITY_CONFIG.alertOnFailure) {
                this.emit('integrity.failure', results);
                await this.alertFailure(results);
            }

            // Store results
            this.verificationResults.push(results);
            if (this.verificationResults.length > 100) {
                this.verificationResults.shift();
            }

            // Store in database
            await this.storeVerificationResult(results);

            this.emit('integrity.verified', results);

            console.log(`✅ Integrity verification: ${results.verified ? 'PASSED' : 'FAILED'}`);
            return results;

        } catch (error) {
            console.error('Verification error:', error);
            results.verified = false;
            results.errors.push(`Verification error: ${error.message}`);
            this.emit('integrity.error', { error, results });
            return results;
        }
    }

    /**
     * Alert on verification failure
     */
    async alertFailure(results) {
        const alert = {
            id: `ALT_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
            type: 'integrity_failure',
            severity: 'critical',
            results,
            timestamp: new Date().toISOString(),
            resolved: false
        };

        this.alertHistory.push(alert);

        // Store alert
        await this.storeAlert(alert);

        // Log critical alert
        console.error('🚨 CRITICAL: Configuration integrity verification failed!');
        console.error('Errors:', results.errors);

        this.emit('alert.triggered', alert);
    }

    /**
     * Update manifest with new file hashes
     */
    async updateManifest() {
        console.log('📋 Updating integrity manifest...');

        const files = await this.findCriticalFiles();
        const entries = {};

        for (const file of files) {
            const relativePath = path.relative(path.join(__dirname, '..'), file);
            entries[relativePath] = {
                hash: await this.hashFile(file),
                size: fs.statSync(file).size,
                modified: fs.statSync(file).mtime.toISOString()
            };
        }

        this.manifest.entries = entries;
        this.manifest.updated = new Date().toISOString();
        this.manifest.signature = await this.signData(JSON.stringify(entries));

        // Save manifest
        const manifestPath = path.join(__dirname, '..', INTEGRITY_CONFIG.manifestLocation);
        fs.writeFileSync(manifestPath, JSON.stringify(this.manifest, null, 2));

        console.log(`✅ Manifest updated with ${Object.keys(entries).length} entries`);
        this.emit('manifest.updated', { entries: Object.keys(entries).length });
    }

    /**
     * Get verification results
     */
    getVerificationResults(limit = 50) {
        return this.verificationResults.slice(-limit);
    }

    /**
     * Get alerts
     */
    getAlerts(limit = 50) {
        return this.alertHistory.slice(-limit);
    }

    /**
     * Resolve alert
     */
    async resolveAlert(alertId, resolution) {
        const alert = this.alertHistory.find(a => a.id === alertId);
        if (!alert) {
            throw new Error(`Alert not found: ${alertId}`);
        }

        alert.resolved = true;
        alert.resolvedAt = new Date().toISOString();
        alert.resolution = resolution;

        await this.updateAlert(alert);

        this.emit('alert.resolved', { alertId, resolution });
        return alert;
    }

    /**
     * Get current configuration status
     */
    getStatus() {
        const lastResult = this.verificationResults[this.verificationResults.length - 1];
        return {
            initialized: this.isInitialized,
            manifestVersion: this.manifest?.version || null,
            manifestCreated: this.manifest?.created || null,
            totalFiles: this.manifest ? Object.keys(this.manifest.entries).length : 0,
            lastVerification: lastResult?.timestamp || null,
            lastVerified: lastResult?.verified || false,
            alertCount: this.alertHistory.length,
            pendingAlerts: this.alertHistory.filter(a => !a.resolved).length
        };
    }

    // ============================================
    // DATABASE OPERATIONS
    // ============================================

    async storeVerificationResult(results) {
        try {
            await db.query(
                `INSERT INTO config_integrity_results 
                 (verified, entries, errors, warnings, result_timestamp)
                 VALUES (?, ?, ?, ?, ?)`,
                [
                    results.verified ? 1 : 0,
                    JSON.stringify(results.entries),
                    JSON.stringify(results.errors),
                    JSON.stringify(results.warnings),
                    results.timestamp
                ]
            );
        } catch (error) {
            console.error('Store verification result error:', error);
        }
    }

    async storeAlert(alert) {
        try {
            await db.query(
                `INSERT INTO config_integrity_alerts 
                 (alert_id, type, severity, results, timestamp, resolved)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [
                    alert.id,
                    alert.type,
                    alert.severity,
                    JSON.stringify(alert.results),
                    alert.timestamp,
                    alert.resolved ? 1 : 0
                ]
            );
        } catch (error) {
            console.error('Store alert error:', error);
        }
    }

    async updateAlert(alert) {
        try {
            await db.query(
                `UPDATE config_integrity_alerts 
                 SET resolved = ?, resolved_at = ?, resolution = ?
                 WHERE alert_id = ?`,
                [
                    alert.resolved ? 1 : 0,
                    alert.resolvedAt,
                    alert.resolution,
                    alert.id
                ]
            );
        } catch (error) {
            console.error('Update alert error:', error);
        }
    }

    // ============================================
    // STATISTICS
    // ============================================

    async getStatistics() {
        const [stats] = await db.query(
            `SELECT 
                COUNT(*) as total_verifications,
                SUM(CASE WHEN verified = 1 THEN 1 ELSE 0 END) as passed,
                SUM(CASE WHEN verified = 0 THEN 1 ELSE 0 END) as failed,
                MAX(result_timestamp) as last_verification
             FROM config_integrity_results
             WHERE result_timestamp > DATE_SUB(NOW(), INTERVAL 30 DAY)`
        );

        return {
            ...stats[0],
            totalFiles: this.manifest ? Object.keys(this.manifest.entries).length : 0,
            pendingAlerts: this.alertHistory.filter(a => !a.resolved).length,
            status: this.getStatus(),
            timestamp: new Date().toISOString()
        };
    }
}

// ============================================
// EXPORT
// ============================================

module.exports = {
    ConfigIntegrityService,
    configIntegrityService: new ConfigIntegrityService()
};