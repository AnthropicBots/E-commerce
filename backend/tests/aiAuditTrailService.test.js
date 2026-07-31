// backend/tests/aiAuditTrailService.test.js
const { expect } = require('chai');
const sinon = require('sinon');
const auditService = require('../services/aiAuditTrailService');
const db = require('../config/db').promise;
const redis = require('../config/redis');

describe('AIAuditTrail Service Tests', () => {
    let sandbox;

    beforeEach(() => {
        sandbox = sinon.createSandbox();
        auditService.reset();
    });

    afterEach(() => {
        sandbox.restore();
    });

    describe('Session Management', () => {
        it('should start a new session with valid inputs', async () => {
            const sessionId = await auditService.startSession(
                'agent-123',
                'user-456',
                { ipAddress: '127.0.0.1' }
            );
            expect(sessionId).to.be.a('string');
            expect(sessionId).to.include('SESS_');
        });

        it('should throw error with invalid inputs', async () => {
            try {
                await auditService.startSession('', 'user-456');
                expect.fail('Should have thrown error');
            } catch (error) {
                expect(error.message).to.include('Validation error');
            }
        });

        it('should sanitize inputs to prevent injection', async () => {
            const sessionId = await auditService.startSession(
                "agent'; DROP TABLE users; --",
                'user-456'
            );
            expect(sessionId).to.be.a('string');
            expect(sessionId).to.include('SESS_');
        });
    });

    describe('Rate Limiting', () => {
        it('should block excessive requests', async () => {
            // Make multiple requests to trigger rate limit
            const promises = [];
            for (let i = 0; i < 150; i++) {
                promises.push(
                    auditService.startSession(`agent-${i}`, 'user-456')
                );
            }

            try {
                await Promise.all(promises);
                expect.fail('Should have thrown rate limit error');
            } catch (error) {
                expect(error.message).to.include('Rate limit exceeded');
            }
        });
    });

    describe('Certificate Management', () => {
        it('should create and verify certificate', async () => {
            // Start session first
            const sessionId = await auditService.startSession('agent-123', 'user-456');

            const certificate = await auditService.createCertificate(
                'contract_signature',
                { contractId: 'CT-123', amount: 1000 }
            );

            expect(certificate).to.have.property('id');
            expect(certificate).to.have.property('signature');
            expect(certificate.status).to.equal('active');
            expect(certificate.sessionId).to.equal(sessionId);

            // Verify certificate
            const verification = await auditService.verifyCertificate(certificate);
            expect(verification.valid).to.be.true;
        });

        it('should revoke certificate', async () => {
            await auditService.startSession('agent-123', 'user-456');
            
            const certificate = await auditService.createCertificate(
                'contract_signature',
                { contractId: 'CT-456' }
            );

            const revoked = await auditService.revokeCertificate(
                certificate.id,
                'Contract cancelled'
            );

            expect(revoked.status).to.equal('revoked');
            expect(revoked.revocationReason).to.equal('Contract cancelled');
        });

        it('should detect invalid certificate signature', async () => {
            const certificate = {
                id: 'CERT_123',
                action: 'test',
                details: {},
                timestamp: new Date().toISOString(),
                signature: 'invalid_signature'
            };

            const verification = await auditService.verifyCertificate(certificate);
            expect(verification.valid).to.be.false;
            expect(verification.reason).to.equal('Invalid signature');
        });
    });

    describe('Compliance Checking', () => {
        it('should check compliance for a session', async () => {
            const sessionId = await auditService.startSession(
                'agent-123',
                'user-456'
            );

            await auditService.logNegotiationStep('step1', { data: 'test' });
            await auditService.logDecision('accept', 'Good offer', ['accept', 'reject']);
            await auditService.createCertificate('completion', { status: 'done' });

            const compliance = await auditService.checkCompliance(sessionId);
            expect(compliance.score).to.be.greaterThan(80);
            expect(compliance.isCompliant).to.be.true;
        });

        it('should identify non-compliant sessions', async () => {
            const sessionId = await auditService.startSession(
                'agent-123',
                'user-456'
            );

            // Only log one step, missing decision and certificate
            await auditService.logNegotiationStep('step1', { data: 'test' });

            const compliance = await auditService.checkCompliance(sessionId);
            expect(compliance.isCompliant).to.be.false;
            expect(compliance.recommendations.length).to.be.greaterThan(0);
        });
    });

    describe('Circuit Breaker', () => {
        it('should handle database failures gracefully', async () => {
            // Mock database failure
            sandbox.stub(db, 'query').throws(new Error('DB connection failed'));

            try {
                await auditService.startSession('agent-123', 'user-456');
                expect.fail('Should have thrown error');
            } catch (error) {
                expect(error.message).to.include('DB connection failed');
            }

            // Check circuit breaker status - should not be open for single failure
            expect(auditService.isCircuitOpen).to.be.false;
        });

        it('should open circuit after multiple failures', async () => {
            sandbox.stub(db, 'query').throws(new Error('DB connection failed'));

            for (let i = 0; i < 10; i++) {
                try {
                    await auditService.startSession(`agent-${i}`, 'user-456');
                } catch (error) {
                    // Expected to fail
                }
            }

            // Circuit should be open after multiple failures
            expect(auditService.isCircuitOpen).to.be.true;
        });
    });

    describe('Caching', () => {
        it('should cache audit trail results', async () => {
            await auditService.startSession('agent-123', 'user-456');

            // First call - should cache
            const result1 = await auditService.getAuditTrail();
            
            // Second call - should use cache
            const result2 = await auditService.getAuditTrail();

            expect(result1).to.deep.equal(result2);
        });

        it('should invalidate cache on changes', async () => {
            await auditService.startSession('agent-123', 'user-456');

            await auditService.getAuditTrail();
            
            // Make change
            await auditService.logNegotiationStep('test', { data: 'test' });
            
            // Cache should be invalidated
            const result = await auditService.getAuditTrail();
            expect(result.logs.length).to.be.greaterThan(0);
        });
    });

    describe('Health Check', () => {
        it('should return healthy status', async () => {
            const health = await auditService.healthCheck();
            expect(health.status).to.equal('healthy');
            expect(health.database).to.equal('connected');
            expect(health.redis).to.equal('connected');
        });

        it('should handle unhealthy database', async () => {
            sandbox.stub(db, 'query').throws(new Error('DB error'));
            
            const health = await auditService.healthCheck();
            expect(health.status).to.equal('unhealthy');
            expect(health.database).to.equal('error');
        });
    });

    describe('Configuration Validation', () => {
        it('should validate configuration on startup', () => {
            const result = auditService.validateConfig();
            expect(result).to.be.true;
        });

        it('should apply fallback config on invalid config', () => {
            // Test with invalid config
            const invalidConfig = {
                retry: {
                    maxAttempts: 0 // Invalid
                }
            };
            // This should fallback to defaults
            auditService.applyFallbackConfig();
            expect(auditService.retryCount).to.exist;
        });
    });

    describe('Logging', () => {
        it('should log to database', async () => {
            await auditService.startSession('agent-123', 'user-456');
            
            const logEntry = {
                type: 'test_log',
                data: { message: 'test' },
                level: 'info'
            };

            await auditService.log(logEntry);
            // Should not throw
        });

        it('should handle logging errors gracefully', async () => {
            // Mock database error
            sandbox.stub(db, 'query').throws(new Error('DB error'));

            const logEntry = {
                type: 'test_log',
                data: { message: 'test' },
                level: 'info'
            };

            // Should not throw even though DB is failing
            await auditService.log(logEntry);
        });
    });

    describe('Export', () => {
        it('should export audit report', async () => {
            const startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
            const endDate = new Date();

            const report = await auditService.exportReport(startDate, endDate);
            expect(report).to.have.property('period');
            expect(report).to.have.property('logs');
            expect(report).to.have.property('certificates');
            expect(report).to.have.property('summary');
        });
    });

    describe('Sanitization', () => {
        it('should sanitize string inputs', () => {
            const input = "test'; DROP TABLE users; --";
            const sanitized = auditService.sanitizeInput(input);
            expect(sanitized).to.not.include("'");
            expect(sanitized).to.not.include(";");
            expect(sanitized).to.not.include("--");
        });

        it('should sanitize objects recursively', () => {
            const obj = {
                name: "test'; DROP TABLE users; --",
                nested: {
                    value: "injection'; --"
                }
            };
            const sanitized = auditService.sanitizeObject(obj);
            expect(sanitized.name).to.not.include("'");
            expect(sanitized.nested.value).to.not.include("'");
        });
    });

    describe('Certificate Generation', () => {
        it('should generate unique certificate IDs', () => {
            const id1 = auditService.generateCertificateId();
            const id2 = auditService.generateCertificateId();
            expect(id1).to.not.equal(id2);
            expect(id1).to.include('CERT_');
            expect(id2).to.include('CERT_');
        });

        it('should generate valid hashes', () => {
            const data = { test: 'data' };
            const hash1 = auditService.generateHash(data);
            const hash2 = auditService.generateHash(data);
            expect(hash1).to.equal(hash2);
            expect(hash1).to.have.lengthOf(64); // SHA256 hex length
        });
    });

    describe('Statistics', () => {
        it('should return statistics', async () => {
            const stats = await auditService.getStatistics();
            expect(stats).to.have.property('total_logs');
            expect(stats).to.have.property('total_sessions');
            expect(stats).to.have.property('errors');
            expect(stats).to.have.property('warnings');
        });
    });

    describe('Retry Logic', () => {
        it('should retry on retryable errors', async () => {
            let attempts = 0;
            const mockOperation = async () => {
                attempts++;
                if (attempts < 2) {
                    throw new Error('ETIMEDOUT');
                }
                return 'success';
            };

            const result = await auditService.executeDatabaseOperation(mockOperation);
            expect(result).to.equal('success');
            expect(attempts).to.equal(2);
        });

        it('should not retry on non-retryable errors', async () => {
            const mockOperation = async () => {
                throw new Error('Invalid input');
            };

            try {
                await auditService.executeDatabaseOperation(mockOperation);
                expect.fail('Should have thrown error');
            } catch (error) {
                expect(error.message).to.equal('Invalid input');
            }
        });
    });
});