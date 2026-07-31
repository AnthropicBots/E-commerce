// backend/services/railsClearingService.js
const crypto = require('crypto');
const db = require('../config/db').promise;

// ============================================
// CONFIGURATION
// ============================================

const RAILS_CONFIG = {
    // Admissibility grades
    admissibilityGrades: {
        NONE: 0,
        DRAFT: 1,
        PROVISIONAL: 2,
        CONFIRMED: 3,
        CERTIFIED: 4
    },
    
    // Obligation types
    obligationTypes: {
        PAYMENT: 'payment',
        DELIVERY: 'delivery',
        SERVICE: 'service',
        REFUND: 'refund'
    },
    
    // Verification mesh
    verificationTypes: ['cryptographic', 'witness', 'attestation', 'consensus'],
    
    // Finality rules
    finalityTypes: ['immediate', 'conditional', 'deferred'],
    
    // Clearing decision
    clearingActions: ['settle', 'reject', 'defer', 'escalate']
};

// ============================================
// RAILS CLEARING CLASS
// ============================================

class RAILSClearingService {
    constructor() {
        this.obligations = new Map();
        this.evidence = new Map();
        this.verifications = new Map();
        this.clearingDecisions = new Map();
        this.settlements = new Map();
        this.clearingPassports = new Map();
        this.finalityRecords = new Map();
    }

    /**
     * Create Obligation Object
     */
    async createObligation(data) {
        const obligation = {
            id: this.generateObligationId(),
            type: data.type || RAILS_CONFIG.obligationTypes.PAYMENT,
            agentId: data.agentId,
            userId: data.userId,
            amount: data.amount || 0,
            currency: data.currency || 'INR',
            description: data.description || '',
            terms: data.terms || {},
            createdAt: new Date().toISOString(),
            expiresAt: data.expiresAt || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
            status: 'active',
            admissibilityGrade: RAILS_CONFIG.admissibilityGrades.NONE,
            evidenceHash: null,
            verificationMesh: null,
            clearingDecision: null,
            settlementInstruction: null,
            clearingPassport: null,
            finalityRule: null
        };

        this.obligations.set(obligation.id, obligation);
        await this.storeObligation(obligation);

        console.log(`✅ Obligation created: ${obligation.id}`);
        return obligation;
    }

    /**
     * Submit Evidence Envelope
     */
    async submitEvidence(obligationId, evidenceData) {
        const obligation = this.obligations.get(obligationId);
        if (!obligation) {
            throw new Error(`Obligation not found: ${obligationId}`);
        }

        const evidence = {
            id: this.generateEvidenceId(),
            obligationId,
            type: evidenceData.type || 'cryptographic',
            data: evidenceData.data || {},
            timestamp: new Date().toISOString(),
            hash: this.generateHash(evidenceData),
            signature: await this.generateSignature(evidenceData),
            status: 'submitted',
            admissibilityGrade: RAILS_CONFIG.admissibilityGrades.DRAFT
        };

        this.evidence.set(evidence.id, evidence);
        obligation.evidenceHash = evidence.hash;
        obligation.admissibilityGrade = evidence.admissibilityGrade;

        await this.storeEvidence(evidence);
        await this.updateObligation(obligation);

        console.log(`✅ Evidence submitted for obligation: ${obligationId}`);
        return evidence;
    }

    /**
     * Create Verification Mesh
     */
    async createVerificationMesh(obligationId, verificationData) {
        const obligation = this.obligations.get(obligationId);
        if (!obligation) {
            throw new Error(`Obligation not found: ${obligationId}`);
        }

        const mesh = {
            id: this.generateMeshId(),
            obligationId,
            type: verificationData.type || 'cryptographic',
            verification: verificationData.verification || {},
            witnesses: verificationData.witnesses || [],
            attestations: verificationData.attestations || [],
            consensus: verificationData.consensus || 0,
            timestamp: new Date().toISOString(),
            admissibilityGrade: this.calculateAdmissibilityGrade(verificationData),
            status: 'active'
        };

        this.verifications.set(mesh.id, mesh);
        obligation.verificationMesh = mesh.id;

        await this.storeVerificationMesh(mesh);
        await this.updateObligation(obligation);

        console.log(`✅ Verification mesh created for obligation: ${obligationId}`);
        return mesh;
    }

    /**
     * Make Clearing Decision
     */
    async makeClearingDecision(obligationId, decisionData) {
        const obligation = this.obligations.get(obligationId);
        if (!obligation) {
            throw new Error(`Obligation not found: ${obligationId}`);
        }

        // Verify evidence and verification are present
        if (!obligation.evidenceHash) {
            throw new Error('No evidence submitted for obligation');
        }

        if (!obligation.verificationMesh) {
            throw new Error('No verification mesh created for obligation');
        }

        // Check admissibility grade
        const grade = obligation.admissibilityGrade;
        if (grade < RAILS_CONFIG.admissibilityGrades.CONFIRMED) {
            return {
                decision: 'reject',
                reason: 'Insufficient admissibility grade',
                grade,
                required: RAILS_CONFIG.admissibilityGrades.CONFIRMED
            };
        }

        // Make decision
        const decision = {
            id: this.generateDecisionId(),
            obligationId,
            action: decisionData.action || 'settle',
            reason: decisionData.reason || 'Clearing conditions met',
            timestamp: new Date().toISOString(),
            admissibilityGrade: grade,
            evidenceHash: obligation.evidenceHash,
            verificationMesh: obligation.verificationMesh
        };

        this.clearingDecisions.set(decision.id, decision);
        obligation.clearingDecision = decision.id;

        await this.storeClearingDecision(decision);
        await this.updateObligation(obligation);

        console.log(`✅ Clearing decision made for obligation: ${obligationId}`);
        return decision;
    }

    /**
     * Create Settlement Instruction
     */
    async createSettlementInstruction(obligationId, settlementData) {
        const obligation = this.obligations.get(obligationId);
        if (!obligation) {
            throw new Error(`Obligation not found: ${obligationId}`);
        }

        if (!obligation.clearingDecision) {
            throw new Error('No clearing decision made for obligation');
        }

        const instruction = {
            id: this.generateInstructionId(),
            obligationId,
            decisionId: obligation.clearingDecision,
            amount: settlementData.amount || obligation.amount,
            currency: settlementData.currency || obligation.currency,
            from: settlementData.from || '',
            to: settlementData.to || '',
            method: settlementData.method || 'bank_transfer',
            timestamp: new Date().toISOString(),
            status: 'pending'
        };

        this.settlements.set(instruction.id, instruction);
        obligation.settlementInstruction = instruction.id;

        await this.storeSettlementInstruction(instruction);
        await this.updateObligation(obligation);

        console.log(`✅ Settlement instruction created for obligation: ${obligationId}`);
        return instruction;
    }

    /**
     * Create Clearing Passport
     */
    async createClearingPassport(obligationId) {
        const obligation = this.obligations.get(obligationId);
        if (!obligation) {
            throw new Error(`Obligation not found: ${obligationId}`);
        }

        // Verify all steps are complete
        if (!obligation.evidenceHash || !obligation.verificationMesh || 
            !obligation.clearingDecision || !obligation.settlementInstruction) {
            throw new Error('Incomplete clearing process');
        }

        const passport = {
            id: this.generatePassportId(),
            obligationId,
            evidenceHash: obligation.evidenceHash,
            verificationMesh: obligation.verificationMesh,
            clearingDecision: obligation.clearingDecision,
            settlementInstruction: obligation.settlementInstruction,
            admissibilityGrade: obligation.admissibilityGrade,
            finalityRule: obligation.finalityRule || 'immediate',
            timestamp: new Date().toISOString(),
            hash: this.generateHash({
                obligationId,
                evidenceHash: obligation.evidenceHash,
                verificationMesh: obligation.verificationMesh,
                clearingDecision: obligation.clearingDecision,
                settlementInstruction: obligation.settlementInstruction
            }),
            signature: await this.generateSignature({
                obligationId,
                evidenceHash: obligation.evidenceHash,
                verificationMesh: obligation.verificationMesh
            })
        };

        this.clearingPassports.set(passport.id, passport);
        obligation.clearingPassport = passport.id;

        await this.storeClearingPassport(passport);
        await this.updateObligation(obligation);

        console.log(`✅ Clearing passport created for obligation: ${obligationId}`);
        return passport;
    }

    /**
     * Apply Finality Rules
     */
    async applyFinality(obligationId, finalityData) {
        const obligation = this.obligations.get(obligationId);
        if (!obligation) {
            throw new Error(`Obligation not found: ${obligationId}`);
        }

        if (!obligation.clearingPassport) {
            throw new Error('No clearing passport for obligation');
        }

        const finality = {
            id: this.generateFinalityId(),
            obligationId,
            type: finalityData.type || 'immediate',
            conditions: finalityData.conditions || {},
            timestamp: new Date().toISOString(),
            status: 'active'
        };

        this.finalityRecords.set(finality.id, finality);
        obligation.finalityRule = finality.id;

        await this.storeFinalityRecord(finality);
        await this.updateObligation(obligation);

        console.log(`✅ Finality applied to obligation: ${obligationId}`);
        return finality;
    }

    /**
     * Complete clearing process
     */
    async completeClearing(obligationId) {
        const obligation = this.obligations.get(obligationId);
        if (!obligation) {
            throw new Error(`Obligation not found: ${obligationId}`);
        }

        // Verify all RAILS primitives are present
        const required = [
            'evidenceHash',
            'verificationMesh',
            'clearingDecision',
            'settlementInstruction',
            'clearingPassport',
            'finalityRule'
        ];

        const missing = required.filter(r => !obligation[r]);
        if (missing.length > 0) {
            throw new Error(`Missing primitives: ${missing.join(', ')}`);
        }

        obligation.status = 'cleared';
        obligation.clearedAt = new Date().toISOString();

        await this.updateObligation(obligation);

        return {
            success: true,
            obligationId,
            clearedAt: obligation.clearedAt,
            passportId: obligation.clearingPassport
        };
    }

    /**
     * Verify Clearing Passport
     */
    async verifyClearingPassport(passportId) {
        const passport = this.clearingPassports.get(passportId);
        if (!passport) {
            throw new Error(`Passport not found: ${passportId}`);
        }

        // Verify hash
        const computedHash = this.generateHash({
            obligationId: passport.obligationId,
            evidenceHash: passport.evidenceHash,
            verificationMesh: passport.verificationMesh,
            clearingDecision: passport.clearingDecision,
            settlementInstruction: passport.settlementInstruction
        });

        if (computedHash !== passport.hash) {
            return { valid: false, reason: 'Invalid passport hash' };
        }

        // Verify signature
        const signatureValid = await this.verifySignature(passport);
        if (!signatureValid) {
            return { valid: false, reason: 'Invalid passport signature' };
        }

        // Verify all referenced primitives exist
        const primitives = [
            passport.evidenceHash,
            passport.verificationMesh,
            passport.clearingDecision,
            passport.settlementInstruction
        ];

        for (const primitive of primitives) {
            if (!this.exists(primitive)) {
                return { valid: false, reason: `Missing primitive: ${primitive}` };
            }
        }

        return { valid: true };
    }

    // ============================================
    // HELPER FUNCTIONS
    // ============================================

    generateObligationId() {
        return `OBL_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
    }

    generateEvidenceId() {
        return `EVD_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
    }

    generateMeshId() {
        return `MESH_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
    }

    generateDecisionId() {
        return `DEC_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
    }

    generateInstructionId() {
        return `INS_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
    }

    generatePassportId() {
        return `PASS_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
    }

    generateFinalityId() {
        return `FIN_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
    }

    generateHash(data) {
        return crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
    }

    async generateSignature(data) {
        const secret = process.env.RAILS_SECRET || 'default_rails_secret';
        return crypto.createHmac('sha256', secret).update(JSON.stringify(data)).digest('hex');
    }

    async verifySignature(passport) {
        const secret = process.env.RAILS_SECRET || 'default_rails_secret';
        const expected = crypto.createHmac('sha256', secret)
            .update(JSON.stringify({
                obligationId: passport.obligationId,
                evidenceHash: passport.evidenceHash,
                verificationMesh: passport.verificationMesh
            }))
            .digest('hex');
        return passport.signature === expected;
    }

    calculateAdmissibilityGrade(data) {
        let grade = RAILS_CONFIG.admissibilityGrades.DRAFT;
        
        if (data.witnesses && data.witnesses.length >= 3) {
            grade = RAILS_CONFIG.admissibilityGrades.CONFIRMED;
        }
        
        if (data.attestations && data.attestations.length >= 2) {
            grade = RAILS_CONFIG.admissibilityGrades.CERTIFIED;
        }
        
        if (data.consensus && data.consensus >= 0.8) {
            grade = Math.max(grade, RAILS_CONFIG.admissibilityGrades.CERTIFIED);
        }
        
        return grade;
    }

    exists(id) {
        return this.obligations.has(id) || 
               this.evidence.has(id) || 
               this.verifications.has(id) || 
               this.clearingDecisions.has(id) || 
               this.settlements.has(id) ||
               this.clearingPassports.has(id) ||
               this.finalityRecords.has(id);
    }

    // ============================================
    // DATABASE OPERATIONS
    // ============================================

    async storeObligation(obligation) {
        await db.query(
            `INSERT INTO rails_obligations 
             (id, type, agent_id, user_id, amount, currency, description,
              terms, created_at, expires_at, status, admissibility_grade,
              evidence_hash, verification_mesh, clearing_decision,
              settlement_instruction, clearing_passport, finality_rule)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                obligation.id, obligation.type, obligation.agentId,
                obligation.userId, obligation.amount, obligation.currency,
                obligation.description, JSON.stringify(obligation.terms),
                obligation.createdAt, obligation.expiresAt, obligation.status,
                obligation.admissibilityGrade, obligation.evidenceHash,
                obligation.verificationMesh, obligation.clearingDecision,
                obligation.settlementInstruction, obligation.clearingPassport,
                obligation.finalityRule
            ]
        );
    }

    async updateObligation(obligation) {
        await db.query(
            `UPDATE rails_obligations 
             SET status = ?, admissibility_grade = ?, evidence_hash = ?,
                 verification_mesh = ?, clearing_decision = ?,
                 settlement_instruction = ?, clearing_passport = ?,
                 finality_rule = ?
             WHERE id = ?`,
            [
                obligation.status, obligation.admissibilityGrade,
                obligation.evidenceHash, obligation.verificationMesh,
                obligation.clearingDecision, obligation.settlementInstruction,
                obligation.clearingPassport, obligation.finalityRule,
                obligation.id
            ]
        );
    }

    async storeEvidence(evidence) {
        await db.query(
            `INSERT INTO rails_evidence 
             (id, obligation_id, type, data, timestamp, hash, signature, status, admissibility_grade)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                evidence.id, evidence.obligationId, evidence.type,
                JSON.stringify(evidence.data), evidence.timestamp,
                evidence.hash, evidence.signature, evidence.status,
                evidence.admissibilityGrade
            ]
        );
    }

    async storeVerificationMesh(mesh) {
        await db.query(
            `INSERT INTO rails_verification_mesh 
             (id, obligation_id, type, verification, witnesses, attestations,
              consensus, timestamp, admissibility_grade, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                mesh.id, mesh.obligationId, mesh.type,
                JSON.stringify(mesh.verification), JSON.stringify(mesh.witnesses),
                JSON.stringify(mesh.attestations), mesh.consensus,
                mesh.timestamp, mesh.admissibilityGrade, mesh.status
            ]
        );
    }

    async storeClearingDecision(decision) {
        await db.query(
            `INSERT INTO rails_clearing_decisions 
             (id, obligation_id, action, reason, timestamp, admissibility_grade,
              evidence_hash, verification_mesh)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                decision.id, decision.obligationId, decision.action,
                decision.reason, decision.timestamp, decision.admissibilityGrade,
                decision.evidenceHash, decision.verificationMesh
            ]
        );
    }

    async storeSettlementInstruction(instruction) {
        await db.query(
            `INSERT INTO rails_settlement_instructions 
             (id, obligation_id, decision_id, amount, currency, from_account,
              to_account, method, timestamp, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                instruction.id, instruction.obligationId, instruction.decisionId,
                instruction.amount, instruction.currency, instruction.from,
                instruction.to, instruction.method, instruction.timestamp,
                instruction.status
            ]
        );
    }

    async storeClearingPassport(passport) {
        await db.query(
            `INSERT INTO rails_clearing_passports 
             (id, obligation_id, evidence_hash, verification_mesh,
              clearing_decision, settlement_instruction, admissibility_grade,
              finality_rule, timestamp, hash, signature)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                passport.id, passport.obligationId, passport.evidenceHash,
                passport.verificationMesh, passport.clearingDecision,
                passport.settlementInstruction, passport.admissibilityGrade,
                passport.finalityRule, passport.timestamp, passport.hash,
                passport.signature
            ]
        );
    }

    async storeFinalityRecord(finality) {
        await db.query(
            `INSERT INTO rails_finality_records 
             (id, obligation_id, type, conditions, timestamp, status)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
                finality.id, finality.obligationId, finality.type,
                JSON.stringify(finality.conditions), finality.timestamp,
                finality.status
            ]
        );
    }

    // ============================================
    // STATISTICS
    // ============================================

    async getStatistics() {
        try {
            const [obligationStats] = await db.query(
                `SELECT 
                    COUNT(*) as total_obligations,
                    SUM(CASE WHEN status = 'cleared' THEN 1 ELSE 0 END) as cleared,
                    SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active,
                    AVG(admissibility_grade) as avg_grade
                 FROM rails_obligations`
            );

            const [passportStats] = await db.query(
                `SELECT 
                    COUNT(*) as total_passports,
                    COUNT(DISTINCT obligation_id) as unique_obligations
                 FROM rails_clearing_passports`
            );

            return {
                obligations: obligationStats[0],
                passports: passportStats[0],
                config: RAILS_CONFIG,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            console.error('Statistics error:', error);
            throw error;
        }
    }

    getStatus() {
        return {
            obligations: this.obligations.size,
            evidence: this.evidence.size,
            verifications: this.verifications.size,
            clearingDecisions: this.clearingDecisions.size,
            settlements: this.settlements.size,
            clearingPassports: this.clearingPassports.size,
            finalityRecords: this.finalityRecords.size,
            config: RAILS_CONFIG
        };
    }
}

// ============================================
// EXPORT
// ============================================

module.exports = new RAILSClearingService();