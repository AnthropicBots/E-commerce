// backend/tests/aiAuditTrailService.test.js
//
// Rewritten in #1341.
//
// The previous version was an integration test wearing a unit test's clothes:
// it required the real `config/db` and `config/redis` and then asserted on the
// results. On any machine without a populated MySQL and a running Redis --
// which is every CI runner and most laptops -- it produced
// `Access denied for user 'test_user'@'localhost'` and
// `MaxRetriesPerRequestError`, and took 41 seconds to do it, because one test
// fired 150 requests at a live rate limiter and another waited out real
// exponential-backoff sleeps.
//
// Both dependencies are now mocked at the module boundary and the backoff is
// stubbed, so the suite runs offline in well under a second and asserts the
// same behaviours the original described.

jest.mock('../config/db', () => {
    const query = jest.fn().mockResolvedValue([[]]);
    return { query, promise: { query } };
});

jest.mock('../config/redis', () => ({
    ping: jest.fn().mockResolvedValue('PONG'),
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    setex: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    keys: jest.fn().mockResolvedValue([]),
    // rate-limiter-flexible drives everything through these.
    defineCommand: jest.fn(),
    eval: jest.fn().mockResolvedValue([1, 60000]),
    evalsha: jest.fn().mockResolvedValue([1, 60000])
}));

jest.mock('../services/webhookService', () => ({
    sendWebhook: jest.fn().mockResolvedValue(undefined),
    sendAlert: jest.fn().mockResolvedValue(undefined),
    sendImmediateAlert: jest.fn().mockResolvedValue(undefined)
}));

const db = require('../config/db').promise;
const redis = require('../config/redis');
const auditService = require('../services/aiAuditTrailService');

/** Let the rate limiter through without touching Redis. */
function allowRateLimit() {
    jest.spyOn(auditService.rateLimiter, 'consume').mockResolvedValue({ remainingPoints: 99 });
}

beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    db.query.mockResolvedValue([[]]);
    redis.ping.mockResolvedValue('PONG');
    redis.get.mockResolvedValue(null);
    auditService.reset();
    auditService.isCircuitOpen = false;
    allowRateLimit();
});

describe('session management', () => {
    it('starts a session and returns a SESS_-prefixed id', async () => {
        const sessionId = await auditService.startSession('agent-123', 'user-456', {
            ipAddress: '127.0.0.1'
        });

        expect(typeof sessionId).toBe('string');
        expect(sessionId).toContain('SESS_');
        expect(auditService.sessionId).toBe(sessionId);
    });

    it('rejects an empty agent id with a validation error', async () => {
        await expect(auditService.startSession('', 'user-456')).rejects.toThrow(
            /Validation error/
        );
    });

    it('rejects a missing user id with a validation error', async () => {
        await expect(auditService.startSession('agent-123', '')).rejects.toThrow(
            /Validation error/
        );
    });

    it('strips injection characters out of the ids it stores', async () => {
        const sessionId = await auditService.startSession(
            "agent'; DROP TABLE users; --",
            'user-456'
        );

        expect(sessionId).toContain('SESS_');

        const logged = auditService.auditLogs.find((l) => l.type === 'session_start');
        expect(logged.data.agentId).not.toContain("'");
        expect(logged.data.agentId).not.toContain(';');
    });

    it('surfaces a rate-limit rejection to the caller', async () => {
        auditService.rateLimiter.consume.mockRejectedValueOnce(new Error('too many'));

        await expect(auditService.startSession('agent-123', 'user-456')).rejects.toThrow(
            /Rate limit exceeded/
        );
    });
});

describe('input sanitization', () => {
    it('removes quotes, backslashes and semicolons from a string', () => {
        const sanitized = auditService.sanitizeInput("test'; DROP TABLE users; --");

        expect(sanitized).not.toContain("'");
        expect(sanitized).not.toContain(';');
        expect(sanitized).not.toContain('"');
    });

    it('leaves non-strings untouched', () => {
        expect(auditService.sanitizeInput(42)).toBe(42);
        expect(auditService.sanitizeInput(null)).toBeNull();
    });

    it('sanitizes nested object values recursively', () => {
        const sanitized = auditService.sanitizeObject({
            name: "test'; DROP TABLE users; --",
            nested: { value: "injection'; --" }
        });

        expect(sanitized.name).not.toContain("'");
        expect(sanitized.nested.value).not.toContain("'");
    });
});

describe('identifier and hash generation', () => {
    it('generates unique certificate ids', () => {
        const id1 = auditService.generateCertificateId();
        const id2 = auditService.generateCertificateId();

        expect(id1).not.toBe(id2);
        expect(id1).toContain('CERT_');
        expect(id2).toContain('CERT_');
    });

    it('generates a stable SHA-256 hash for equal input', () => {
        const hash1 = auditService.generateHash({ test: 'data' });
        const hash2 = auditService.generateHash({ test: 'data' });

        expect(hash1).toBe(hash2);
        expect(hash1).toHaveLength(64);
    });

    it('generates different hashes for different input', () => {
        expect(auditService.generateHash({ a: 1 })).not.toBe(
            auditService.generateHash({ a: 2 })
        );
    });
});

describe('certificates', () => {
    it('creates a certificate bound to the current session and verifies it', async () => {
        const sessionId = await auditService.startSession('agent-123', 'user-456');

        const certificate = await auditService.createCertificate('contract_signature', {
            contractId: 'CT-123',
            amount: 1000
        });

        expect(certificate).toHaveProperty('id');
        expect(certificate).toHaveProperty('signature');
        expect(certificate.status).toBe('active');
        expect(certificate.sessionId).toBe(sessionId);

        // verifyCertificate confirms the row still exists and is not revoked.
        db.query.mockResolvedValueOnce([[{ id: certificate.id, status: 'active' }]]);

        await expect(auditService.verifyCertificate(certificate)).resolves.toMatchObject({
            valid: true
        });
    });

    // The signature used to be computed over a timestamp taken by a separate
    // `new Date()` call from the one stored on the certificate, so a
    // millisecond tick between the two produced a certificate that could never
    // verify.
    it('signs the same timestamp it stores', async () => {
        await auditService.startSession('agent-123', 'user-456');
        const certificate = await auditService.createCertificate('completion', { ok: true });

        const expected = await auditService.generateSignature({
            action: 'completion',
            details: { ok: true },
            timestamp: certificate.timestamp
        });

        expect(certificate.signature).toBe(expected);
    });

    it('rejects a certificate that is not in the database', async () => {
        await auditService.startSession('agent-123', 'user-456');
        const certificate = await auditService.createCertificate('completion', { ok: true });

        db.query.mockResolvedValueOnce([[]]);

        await expect(auditService.verifyCertificate(certificate)).resolves.toMatchObject({
            valid: false,
            reason: 'Certificate not found in database'
        });
    });

    it('rejects a certificate that has been revoked', async () => {
        await auditService.startSession('agent-123', 'user-456');
        const certificate = await auditService.createCertificate('completion', { ok: true });

        db.query.mockResolvedValueOnce([[{ id: certificate.id, status: 'revoked' }]]);

        await expect(auditService.verifyCertificate(certificate)).resolves.toMatchObject({
            valid: false,
            reason: 'Certificate has been revoked'
        });
    });

    it('rejects a certificate whose signature does not match', async () => {
        const verification = await auditService.verifyCertificate({
            id: 'CERT_123',
            action: 'test',
            details: {},
            timestamp: new Date().toISOString(),
            signature: 'invalid_signature'
        });

        expect(verification.valid).toBe(false);
        expect(verification.reason).toBe('Invalid signature');
    });

    it('revokes a certificate with the supplied reason', async () => {
        await auditService.startSession('agent-123', 'user-456');
        const certificate = await auditService.createCertificate('contract_signature', {
            contractId: 'CT-456'
        });

        const revoked = await auditService.revokeCertificate(
            certificate.id,
            'Contract cancelled'
        );

        expect(revoked.status).toBe('revoked');
        expect(revoked.revocationReason).toBe('Contract cancelled');
    });
});

describe('compliance', () => {
    // checkCompliance reads the persisted trail, not the in-memory one, so the
    // rows are supplied through the mocked pool: first the audit logs for the
    // session, then its certificates.
    function persistedTrail(logs, certificates) {
        db.query
            .mockResolvedValueOnce([logs])
            .mockResolvedValueOnce([certificates]);
    }

    const NOW = new Date().toISOString();

    it('scores a session with a step, a decision and a certificate as compliant', async () => {
        const sessionId = 'SESS_test';
        const certificate = await (async () => {
            await auditService.startSession('agent-123', 'user-456');
            return auditService.createCertificate('completion', { status: 'done' });
        })();

        persistedTrail(
            [
                { type: 'session_start', timestamp: NOW, data: { agentId: 'a', userId: 'u' } },
                { type: 'negotiation_step', timestamp: NOW, data: {} },
                { type: 'decision_point', timestamp: NOW, data: {} },
                { type: 'certificate_created', timestamp: NOW, data: {} }
            ],
            [certificate]
        );

        const compliance = await auditService.checkCompliance(sessionId);

        expect(compliance.score).toBeGreaterThan(80);
        expect(compliance.isCompliant).toBe(true);
    });

    it('flags a session missing a decision and a certificate', async () => {
        persistedTrail(
            [{ type: 'session_start', timestamp: NOW, data: { agentId: 'a', userId: 'u' } }],
            []
        );

        const compliance = await auditService.checkCompliance('SESS_incomplete');

        expect(compliance.isCompliant).toBe(false);
        expect(compliance.recommendations.length).toBeGreaterThan(0);
    });
});

describe('retry logic', () => {
    // Real backoff sleeps are 1s, 2s, 4s. Serving them for real is what made
    // this suite take 41 seconds.
    beforeEach(() => {
        jest.spyOn(auditService, 'sleep').mockResolvedValue(undefined);
    });

    it('retries a retryable error and returns the eventual success', async () => {
        let attempts = 0;
        const operation = async () => {
            attempts++;
            if (attempts < 2) throw new Error('ETIMEDOUT');
            return 'success';
        };

        await expect(auditService.executeDatabaseOperation(operation)).resolves.toBe(
            'success'
        );
        expect(attempts).toBe(2);
    });

    it('does not retry an error that is not retryable', async () => {
        let attempts = 0;
        const operation = async () => {
            attempts++;
            throw new Error('Invalid input');
        };

        await expect(auditService.executeDatabaseOperation(operation)).rejects.toThrow(
            'Invalid input'
        );
        expect(attempts).toBe(1);
    });

    it('gives up after the configured number of attempts', async () => {
        let attempts = 0;
        const operation = async () => {
            attempts++;
            throw new Error('ECONNRESET');
        };

        await expect(auditService.executeDatabaseOperation(operation)).rejects.toThrow(
            'ECONNRESET'
        );
        expect(attempts).toBeGreaterThan(1);
    });

    it('classifies errors by code as well as by message', () => {
        const byCode = new Error('boom');
        byCode.code = 'ER_LOCK_DEADLOCK';

        expect(auditService.isRetryableError(byCode)).toBe(true);
        expect(auditService.isRetryableError(new Error('ETIMEDOUT while reading'))).toBe(true);
        expect(auditService.isRetryableError(new Error('Invalid input'))).toBe(false);
    });

    it('backs off exponentially but never past the ceiling', () => {
        const first = auditService.calculateBackoff(1);
        const second = auditService.calculateBackoff(2);

        expect(second).toBeGreaterThan(first);
        expect(auditService.calculateBackoff(20)).toBeLessThanOrEqual(10000);
    });
});

describe('logging', () => {
    it('appends to the in-memory trail', async () => {
        await auditService.startSession('agent-123', 'user-456');
        const before = auditService.auditLogs.length;

        await auditService.log({ type: 'test_log', data: { message: 'test' }, level: 'info' });

        expect(auditService.auditLogs.length).toBe(before + 1);
    });

    // An audit write failing is bad; an audit write taking the request down
    // with it is worse.
    it('does not throw when the database write fails', async () => {
        db.query.mockRejectedValue(new Error('DB error'));

        await expect(
            auditService.log({ type: 'test_log', data: { message: 'test' }, level: 'info' })
        ).resolves.not.toThrow();
    });
});

describe('health check', () => {
    it('reports healthy when both dependencies answer', async () => {
        const health = await auditService.healthCheck();

        expect(health.status).toBe('healthy');
        expect(health.database).toBe('connected');
        expect(health.redis).toBe('connected');
    });

    // The old implementation guessed which dependency had failed from the error
    // code, so a plain Error (no `.code`) was reported as 'unknown'.
    it('names the database when the database is the thing that failed', async () => {
        db.query.mockRejectedValueOnce(new Error('DB error'));

        const health = await auditService.healthCheck();

        expect(health.status).toBe('unhealthy');
        expect(health.database).toBe('error');
        expect(health.redis).toBe('connected');
    });

    it('names Redis when Redis is the thing that failed', async () => {
        redis.ping.mockRejectedValueOnce(new Error('ECONNREFUSED'));

        const health = await auditService.healthCheck();

        expect(health.status).toBe('unhealthy');
        expect(health.redis).toBe('error');
        expect(health.database).toBe('connected');
    });

    // A database failure used to short-circuit the Redis probe entirely.
    it('reports both dependencies when both are down', async () => {
        db.query.mockRejectedValueOnce(new Error('DB error'));
        redis.ping.mockRejectedValueOnce(new Error('ECONNREFUSED'));

        const health = await auditService.healthCheck();

        expect(health.database).toBe('error');
        expect(health.redis).toBe('error');
        expect(health.error).toContain('database');
        expect(health.error).toContain('redis');
    });
});

describe('configuration', () => {
    it('validates the shipped configuration', () => {
        expect(auditService.validateConfig()).toBe(true);
    });

    it('leaves the service usable after applying the fallback config', () => {
        auditService.applyFallbackConfig();
        expect(auditService.retryCount).toBeDefined();
    });
});

describe('reset', () => {
    it('clears session state so suites do not leak into each other', async () => {
        await auditService.startSession('agent-123', 'user-456');
        expect(auditService.auditLogs.length).toBeGreaterThan(0);

        auditService.reset();

        expect(auditService.auditLogs).toEqual([]);
        expect(auditService.certificates).toEqual([]);
        expect(auditService.sessionId).toBeNull();
    });
});
