// backend/services/adrService.js
const fs = require('fs');
const path = require('path');
const db = require('../config/db').promise;
const crypto = require('crypto');
const EventEmitter = require('events');

// ============================================
// ADR CONFIGURATION
// ============================================

const ADR_STATUS = {
    PROPOSED: 'proposed',
    ACCEPTED: 'accepted',
    SUPERSEDED: 'superseded',
    DEPRECATED: 'deprecated',
    REJECTED: 'rejected'
};

const ADR_CATEGORIES = {
    ARCHITECTURE: 'architecture',
    SECURITY: 'security',
    PERFORMANCE: 'performance',
    DATA: 'data',
    INFRASTRUCTURE: 'infrastructure',
    API: 'api',
    UI: 'ui',
    PROCESS: 'process'
};

const ADR_TEMPLATE = `# ADR-{NUMBER}: {TITLE}

## Status
{STATUS}

## Context
{CONTEXT}

## Decision
{DECISION}

## Alternatives Considered
{ALTERNATIVES}

## Consequences
{CONSEQUENCES}

## Related ADRs
{RELATED}

## Date
{DATE}
`;

// ============================================
// ADR SERVICE
// ============================================

class ADRService extends EventEmitter {
    constructor() {
        super();
        this.adrs = new Map();
        this.tags = new Map();
        this.adrHistory = [];
        this.adrPath = path.join(__dirname, '../docs/adr');
        this.lastNumber = 0;
        this.initialized = false;
    }

    /**
     * Initialize ADR service
     */
    async initialize() {
        if (this.initialized) return;

        // Create ADR directory if it doesn't exist
        if (!fs.existsSync(this.adrPath)) {
            fs.mkdirSync(this.adrPath, { recursive: true });
        }

        // Load existing ADRs from filesystem
        await this.loadADRs();

        // Load from database
        await this.loadFromDatabase();

        this.initialized = true;
        console.log('✅ ADR Service initialized');
        return this;
    }

    /**
     * Load ADRs from filesystem
     */
    async loadADRs() {
        try {
            const files = fs.readdirSync(this.adrPath);
            const adrFiles = files.filter(f => f.startsWith('adr-') && f.endsWith('.md'));

            for (const file of adrFiles) {
                const content = fs.readFileSync(path.join(this.adrPath, file), 'utf8');
                const adr = this.parseADR(content, file);
                if (adr) {
                    this.adrs.set(adr.id, adr);
                    this.lastNumber = Math.max(this.lastNumber, adr.number);
                }
            }

            console.log(`📄 Loaded ${this.adrs.size} ADRs from filesystem`);
        } catch (error) {
            console.error('Load ADRs error:', error);
        }
    }

    /**
     * Parse ADR from markdown
     */
    parseADR(content, filename) {
        try {
            // Extract metadata from filename
            const numberMatch = filename.match(/adr-(\d+)/);
            const number = numberMatch ? parseInt(numberMatch[1]) : 0;

            // Extract fields using regex
            const titleMatch = content.match(/^# ADR-\d+: (.+)$/m);
            const statusMatch = content.match(/^## Status\s+([^\n]+)/m);
            const contextMatch = content.match(/^## Context\s+([\s\S]*?)(?=^## )/m);
            const decisionMatch = content.match(/^## Decision\s+([\s\S]*?)(?=^## )/m);
            const alternativesMatch = content.match(/^## Alternatives Considered\s+([\s\S]*?)(?=^## )/m);
            const consequencesMatch = content.match(/^## Consequences\s+([\s\S]*?)(?=^## )/m);
            const relatedMatch = content.match(/^## Related ADRs\s+([\s\S]*?)(?=^## )/m);
            const dateMatch = content.match(/^## Date\s+([^\n]+)/m);

            return {
                id: `adr-${number}`,
                number,
                title: titleMatch ? titleMatch[1].trim() : 'Untitled',
                status: statusMatch ? statusMatch[1].trim() : ADR_STATUS.PROPOSED,
                context: contextMatch ? contextMatch[1].trim() : '',
                decision: decisionMatch ? decisionMatch[1].trim() : '',
                alternatives: alternativesMatch ? alternativesMatch[1].trim() : '',
                consequences: consequencesMatch ? consequencesMatch[1].trim() : '',
                related: relatedMatch ? relatedMatch[1].trim() : '',
                date: dateMatch ? dateMatch[1].trim() : new Date().toISOString().split('T')[0],
                filename,
                content
            };
        } catch (error) {
            console.error('Parse ADR error:', error);
            return null;
        }
    }

    /**
     * Create a new ADR
     */
    async createADR(data) {
        const number = this.getNextNumber();
        const id = `adr-${number}`;

        const adr = {
            id,
            number,
            title: data.title,
            status: data.status || ADR_STATUS.PROPOSED,
            context: data.context || '',
            decision: data.decision || '',
            alternatives: data.alternatives || '',
            consequences: data.consequences || '',
            related: data.related || '',
            date: data.date || new Date().toISOString().split('T')[0],
            category: data.category || ADR_CATEGORIES.ARCHITECTURE,
            tags: data.tags || [],
            author: data.author || 'Unknown',
            filename: `${id}.md`,
            content: this.generateContent(number, data),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        // Validate ADR
        this.validateADR(adr);

        // Save to filesystem
        await this.saveADRFile(adr);

        // Store in memory
        this.adrs.set(adr.id, adr);
        this.lastNumber = number;

        // Store in database
        await this.storeADR(adr);

        // Index tags
        this.indexTags(adr);

        this.emit('adr.created', { id: adr.id, number: adr.number, title: adr.title });

        console.log(`📝 ADR created: ${adr.id} - ${adr.title}`);
        return adr;
    }

    /**
     * Update an existing ADR
     */
    async updateADR(id, updates) {
        const adr = this.adrs.get(id);
        if (!adr) {
            throw new Error(`ADR not found: ${id}`);
        }

        // Update fields
        Object.assign(adr, updates);
        adr.updatedAt = new Date().toISOString();

        // Update content
        adr.content = this.generateContent(adr.number, adr);

        // Save to filesystem
        await this.saveADRFile(adr);

        // Update in database
        await this.storeADR(adr);

        // Re-index tags
        this.indexTags(adr);

        this.emit('adr.updated', { id: adr.id, number: adr.number, title: adr.title });

        console.log(`📝 ADR updated: ${adr.id} - ${adr.title}`);
        return adr;
    }

    /**
     * Update ADR status
     */
    async updateStatus(id, status, reason = null) {
        const adr = this.adrs.get(id);
        if (!adr) {
            throw new Error(`ADR not found: ${id}`);
        }

        if (!Object.values(ADR_STATUS).includes(status)) {
            throw new Error(`Invalid status: ${status}`);
        }

        const oldStatus = adr.status;
        adr.status = status;
        adr.updatedAt = new Date().toISOString();

        // Add status change to content
        adr.content = this.generateContent(adr.number, adr);

        // Save to filesystem
        await this.saveADRFile(adr);

        // Update in database
        await this.storeADR(adr);

        this.emit('adr.status.updated', { 
            id: adr.id, 
            number: adr.number, 
            oldStatus, 
            newStatus: status,
            reason 
        });

        console.log(`📝 ADR status updated: ${adr.id} -> ${status}`);
        return adr;
    }

    /**
     * Get ADR by ID
     */
    getADR(id) {
        return this.adrs.get(id) || null;
    }

    /**
     * Get all ADRs
     */
    getAllADRs(filters = {}) {
        let adrs = Array.from(this.adrs.values());

        if (filters.status) {
            adrs = adrs.filter(a => a.status === filters.status);
        }

        if (filters.category) {
            adrs = adrs.filter(a => a.category === filters.category);
        }

        if (filters.tag) {
            adrs = adrs.filter(a => a.tags && a.tags.includes(filters.tag));
        }

        if (filters.search) {
            const search = filters.search.toLowerCase();
            adrs = adrs.filter(a => 
                a.title.toLowerCase().includes(search) ||
                a.context.toLowerCase().includes(search) ||
                a.decision.toLowerCase().includes(search)
            );
        }

        return adrs.sort((a, b) => b.number - a.number);
    }

    /**
     * Search ADRs
     */
    searchADRs(query) {
        const results = [];
        const lowerQuery = query.toLowerCase();

        for (const adr of this.adrs.values()) {
            const score = this.calculateSearchScore(adr, lowerQuery);
            if (score > 0) {
                results.push({ ...adr, score });
            }
        }

        return results.sort((a, b) => b.score - a.score);
    }

    /**
     * Calculate search score
     */
    calculateSearchScore(adr, query) {
        let score = 0;

        // Title match (highest weight)
        if (adr.title.toLowerCase().includes(query)) {
            score += 10;
        }

        // Context match
        if (adr.context.toLowerCase().includes(query)) {
            score += 5;
        }

        // Decision match
        if (adr.decision.toLowerCase().includes(query)) {
            score += 5;
        }

        // Tags match
        if (adr.tags && adr.tags.some(t => t.toLowerCase().includes(query))) {
            score += 3;
        }

        return score;
    }

    /**
     * Get ADR history
     */
    getHistory(limit = 50) {
        return this.adrHistory.slice(-limit);
    }

    /**
     * Generate ADR content
     */
    generateContent(number, data) {
        return ADR_TEMPLATE
            .replace(/{NUMBER}/g, number)
            .replace(/{TITLE}/g, data.title || 'Untitled')
            .replace(/{STATUS}/g, data.status || ADR_STATUS.PROPOSED)
            .replace(/{CONTEXT}/g, data.context || 'No context provided')
            .replace(/{DECISION}/g, data.decision || 'No decision recorded')
            .replace(/{ALTERNATIVES}/g, data.alternatives || 'None recorded')
            .replace(/{CONSEQUENCES}/g, data.consequences || 'None recorded')
            .replace(/{RELATED}/g, data.related || 'None')
            .replace(/{DATE}/g, data.date || new Date().toISOString().split('T')[0]);
    }

    /**
     * Save ADR to filesystem
     */
    async saveADRFile(adr) {
        const filePath = path.join(this.adrPath, adr.filename);
        fs.writeFileSync(filePath, adr.content, 'utf8');
    }

    /**
     * Index tags for ADR
     */
    indexTags(adr) {
        if (!adr.tags) return;

        for (const tag of adr.tags) {
            if (!this.tags.has(tag)) {
                this.tags.set(tag, []);
            }
            if (!this.tags.get(tag).includes(adr.id)) {
                this.tags.get(tag).push(adr.id);
            }
        }
    }

    /**
     * Get next ADR number
     */
    getNextNumber() {
        return this.lastNumber + 1;
    }

    /**
     * Validate ADR
     */
    validateADR(adr) {
        if (!adr.title) {
            throw new Error('ADR title is required');
        }
        if (!adr.context) {
            throw new Error('ADR context is required');
        }
        if (!adr.decision) {
            throw new Error('ADR decision is required');
        }
        if (!Object.values(ADR_STATUS).includes(adr.status)) {
            throw new Error(`Invalid status: ${adr.status}`);
        }
        if (!Object.values(ADR_CATEGORIES).includes(adr.category)) {
            throw new Error(`Invalid category: ${adr.category}`);
        }
    }

    // ============================================
    // DATABASE OPERATIONS
    // ============================================

    async loadFromDatabase() {
        try {
            const [rows] = await db.query(
                'SELECT * FROM adr_records ORDER BY number DESC'
            );

            for (const row of rows) {
                if (!this.adrs.has(row.adr_id)) {
                    const adr = {
                        id: row.adr_id,
                        number: row.number,
                        title: row.title,
                        status: row.status,
                        context: row.context,
                        decision: row.decision,
                        alternatives: row.alternatives,
                        consequences: row.consequences,
                        related: row.related,
                        date: row.adr_date,
                        category: row.category,
                        tags: JSON.parse(row.tags || '[]'),
                        author: row.author,
                        filename: `${row.adr_id}.md`,
                        content: this.generateContent(row.number, row),
                        createdAt: row.created_at,
                        updatedAt: row.updated_at
                    };

                    this.adrs.set(adr.id, adr);
                    this.lastNumber = Math.max(this.lastNumber, adr.number);
                }
            }

            console.log(`📄 Loaded ${rows.length} ADRs from database`);
        } catch (error) {
            console.error('Load from database error:', error);
        }
    }

    async storeADR(adr) {
        try {
            await db.query(
                `INSERT INTO adr_records 
                 (adr_id, number, title, status, context, decision,
                  alternatives, consequences, related, adr_date, category,
                  tags, author, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE
                 title = VALUES(title), status = VALUES(status),
                 context = VALUES(context), decision = VALUES(decision),
                 alternatives = VALUES(alternatives), 
                 consequences = VALUES(consequences),
                 related = VALUES(related), adr_date = VALUES(adr_date),
                 category = VALUES(category), tags = VALUES(tags),
                 author = VALUES(author), updated_at = VALUES(updated_at)`,
                [
                    adr.id,
                    adr.number,
                    adr.title,
                    adr.status,
                    adr.context,
                    adr.decision,
                    adr.alternatives,
                    adr.consequences,
                    adr.related,
                    adr.date,
                    adr.category,
                    JSON.stringify(adr.tags || []),
                    adr.author,
                    adr.createdAt,
                    adr.updatedAt
                ]
            );
        } catch (error) {
            console.error('Store ADR error:', error);
        }
    }

    // ============================================
    // STATISTICS
    // ============================================

    async getStatistics() {
        const adrs = Array.from(this.adrs.values());

        return {
            totalADRs: adrs.length,
            byStatus: adrs.reduce((acc, a) => {
                acc[a.status] = (acc[a.status] || 0) + 1;
                return acc;
            }, {}),
            byCategory: adrs.reduce((acc, a) => {
                acc[a.category] = (acc[a.category] || 0) + 1;
                return acc;
            }, {}),
            tags: this.tags.size,
            lastNumber: this.lastNumber,
            timestamp: new Date().toISOString()
        };
    }

    getStatus() {
        return {
            adrs: this.adrs.size,
            tags: this.tags.size,
            lastNumber: this.lastNumber,
            categories: Object.values(ADR_CATEGORIES),
            statuses: Object.values(ADR_STATUS)
        };
    }
}

// ============================================
// EXPORT
// ============================================

module.exports = {
    ADRService,
    ADR_STATUS,
    ADR_CATEGORIES,
    adrService: new ADRService()
};