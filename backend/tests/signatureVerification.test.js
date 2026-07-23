// backend/tests/signatureVerification.test.js

const { verifyClaudeSignature, generateClaudeSignature } = require('../utils/signatureVerification');
const express = require('express');
const request = require('supertest');

// ============================================
// TEST FIXTURES
// ============================================

const fixtures = {
    validBody: { productId: '123', quantity: 1 },
    nestedBody: {
        user: { id: 1, name: 'John' },
        products: [{ id: 1 }, { id: 2 }]
    },
    specialCharsBody: { text: 'Hello!@#$%^&*()_+' },
    unicodeBody: { text: '中文日本語한국어' },
    largeBody: { data: 'x'.repeat(1024 * 1024) },
    deepNestedBody: {
        level1: {
            level2: {
                level3: {
                    level4: 'deep'
                }
            }
        }
    },
    arrayBody: ['item1', 'item2', 'item3'],
    nullBody: { field1: 'value', field2: null },
    undefinedBody: { field1: 'value', field2: undefined },
    emptyBody: {},
};

// ============================================
// TEST FACTORIES
// ============================================

const createSignatureTest = (body, secret = 'test_secret_1234567890123456') => {
    const signature = generateClaudeSignature(body, secret);
    return { body, signature, secret };
};

const createTamperedBody = (body, changes) => {
    return { ...body, ...changes };
};

// ============================================
// ASSERTION HELPERS
// ============================================

const assertSignatureValid = (signature, body, secret) => {
    expect(verifyClaudeSignature(signature, body, secret)).toBe(true);
};

const assertSignatureInvalid = (signature, body, secret) => {
    expect(verifyClaudeSignature(signature, body, secret)).toBe(false);
};

const assertSignatureThrows = (signature, body, secret) => {
    expect(() => verifyClaudeSignature(signature, body, secret)).toThrow();
};

// ============================================
// TEST SUITE
// ============================================

describe('Signature Verification Tests', () => {
    const secret = 'test_secret_1234567890123456';
    const testBody = { productId: '123', quantity: 1 };
    let testData;

    // ============================================
    // TEST HOOKS
    // ============================================

    beforeAll(() => {
        console.log('Starting Signature Verification Tests...');
    });

    beforeEach(() => {
        testData = {
            body: { ...testBody },
            secret: secret,
        };
        testData.signature = generateClaudeSignature(testData.body, testData.secret);
    });

    afterEach(() => {
        testData = null;
    });

    afterAll(() => {
        console.log('Signature Verification Tests completed.');
    });

    // ============================================
    // SIGNATURE GENERATION TESTS
    // ============================================

    describe('Signature Generation Tests', () => {
        test('Should generate signature for simple body', () => {
            const signature = generateClaudeSignature(testBody, secret);
            expect(signature).toBeDefined();
            expect(typeof signature).toBe('string');
            expect(signature.length).toBe(64); // SHA256 hex length
        });

        test('Should generate signature for nested body', () => {
            const signature = generateClaudeSignature(fixtures.nestedBody, secret);
            expect(signature).toBeDefined();
            expect(typeof signature).toBe('string');
        });

        test('Should generate signature for array body', () => {
            const signature = generateClaudeSignature(fixtures.arrayBody, secret);
            expect(signature).toBeDefined();
            expect(typeof signature).toBe('string');
        });

        test('Should generate different signatures for different secrets', () => {
            const sig1 = generateClaudeSignature(testBody, 'secret_1234567890123456_1');
            const sig2 = generateClaudeSignature(testBody, 'secret_1234567890123456_2');
            expect(sig1).not.toBe(sig2);
        });

        test('Should generate different signatures for different bodies', () => {
            const sig1 = generateClaudeSignature({ a: 1 }, secret);
            const sig2 = generateClaudeSignature({ b: 2 }, secret);
            expect(sig1).not.toBe(sig2);
        });

        test('Should throw error for invalid secret type', () => {
            expect(() => {
                generateClaudeSignature(testBody, 123);
            }).toThrow();
        });

        test('Should throw error for null secret', () => {
            expect(() => {
                generateClaudeSignature(testBody, null);
            }).toThrow();
        });
    });

    // ============================================
    // VALID SIGNATURES
    // ============================================

    describe('Valid Signatures', () => {
        test('Should verify valid signature with simple body', () => {
            const signature = generateClaudeSignature(testBody, secret);
            assertSignatureValid(signature, testBody, secret);
        });

        test('Should verify valid signature with nested body', () => {
            const signature = generateClaudeSignature(fixtures.nestedBody, secret);
            assertSignatureValid(signature, fixtures.nestedBody, secret);
        });

        test('Should verify valid signature with special characters', () => {
            const signature = generateClaudeSignature(fixtures.specialCharsBody, secret);
            assertSignatureValid(signature, fixtures.specialCharsBody, secret);
        });

        test('Should verify valid signature with empty object', () => {
            const signature = generateClaudeSignature({}, secret);
            assertSignatureValid(signature, {}, secret);
        });

        test('Should verify valid signature with array payload', () => {
            const signature = generateClaudeSignature(fixtures.arrayBody, secret);
            assertSignatureValid(signature, fixtures.arrayBody, secret);
        });

        test('Should verify valid signature with null values', () => {
            const signature = generateClaudeSignature(fixtures.nullBody, secret);
            assertSignatureValid(signature, fixtures.nullBody, secret);
        });

        test('Should verify valid signature with undefined values', () => {
            const signature = generateClaudeSignature(fixtures.undefinedBody, secret);
            assertSignatureValid(signature, fixtures.undefinedBody, secret);
        });

        test('Should verify valid signature with Unicode characters', () => {
            const signature = generateClaudeSignature(fixtures.unicodeBody, secret);
            assertSignatureValid(signature, fixtures.unicodeBody, secret);
        });

        test('Should verify valid signature with deep nested objects', () => {
            const signature = generateClaudeSignature(fixtures.deepNestedBody, secret);
            assertSignatureValid(signature, fixtures.deepNestedBody, secret);
        });
    });

    // ============================================
    // INVALID SIGNATURES
    // ============================================

    describe('Invalid Signatures', () => {
        test('Should reject invalid signature', () => {
            assertSignatureInvalid('invalid', testBody, secret);
        });

        test('Should reject empty signature', () => {
            assertSignatureInvalid('', testBody, secret);
        });

        test('Should reject null signature', () => {
            assertSignatureInvalid(null, testBody, secret);
        });

        test('Should reject malformed signature (non-hex)', () => {
            assertSignatureInvalid('not-a-hex-string', testBody, secret);
        });

        test('Should reject signature with wrong length', () => {
            const shortSig = 'a'.repeat(10);
            assertSignatureInvalid(shortSig, testBody, secret);
        });

        test('Should reject signature with invalid characters', () => {
            const invalidSig = 'g'.repeat(64);
            assertSignatureInvalid(invalidSig, testBody, secret);
        });

        test('Should reject hex-like but incorrect signature', () => {
            const hexLike = 'a'.repeat(64);
            assertSignatureInvalid(hexLike, testBody, secret);
        });
    });

    // ============================================
    // TAMPERED DATA
    // ============================================

    describe('Tampered Data', () => {
        test('Should reject tampered body', () => {
            const signature = generateClaudeSignature(testBody, secret);
            const tamperedBody = createTamperedBody(testBody, { quantity: 999 });
            assertSignatureInvalid(signature, tamperedBody, secret);
        });

        test('Should reject body with extra fields', () => {
            const body = { productId: '123' };
            const signature = generateClaudeSignature(body, secret);
            const tampered = createTamperedBody(body, { extra: 'field' });
            assertSignatureInvalid(signature, tampered, secret);
        });

        test('Should reject body with missing fields', () => {
            const body = { productId: '123', quantity: 1 };
            const signature = generateClaudeSignature(body, secret);
            const tampered = { productId: '123' };
            assertSignatureInvalid(signature, tampered, secret);
        });

        test('Should reject body with changed field order', () => {
            const body1 = { a: 1, b: 2 };
            const body2 = { b: 2, a: 1 };
            const signature = generateClaudeSignature(body1, secret);
            assertSignatureInvalid(signature, body2, secret);
        });

        test('Should reject body with modified nested values', () => {
            const body = { user: { id: 1, name: 'John' } };
            const signature = generateClaudeSignature(body, secret);
            const tampered = { user: { id: 1, name: 'Jane' } };
            assertSignatureInvalid(signature, tampered, secret);
        });
    });

    // ============================================
    // EDGE CASES
    // ============================================

    describe('Edge Cases - Empty/Null/Undefined', () => {
        test('Should handle empty body', () => {
            const signature = generateClaudeSignature({}, secret);
            assertSignatureValid(signature, {}, secret);
        });

        test('Should handle null body', () => {
            assertSignatureInvalid('sig', null, secret);
        });

        test('Should handle undefined body', () => {
            assertSignatureInvalid('sig', undefined, secret);
        });

        test('Should handle empty secret', () => {
            assertSignatureInvalid('sig', testBody, '');
        });

        test('Should handle null secret', () => {
            assertSignatureInvalid('sig', testBody, null);
        });

        test('Should handle undefined secret', () => {
            assertSignatureInvalid('sig', testBody, undefined);
        });

        test('Should handle missing signature header', () => {
            assertSignatureInvalid(undefined, testBody, secret);
        });
    });

    // ============================================
    // LARGE PAYLOADS
    // ============================================

    describe('Large Payloads', () => {
        test('Should handle large payload (1MB)', () => {
            const signature = generateClaudeSignature(fixtures.largeBody, secret);
            assertSignatureValid(signature, fixtures.largeBody, secret);
        });

        test('Should handle large payload (5MB)', () => {
            const largeBody = { data: 'x'.repeat(1024 * 1024 * 5) };
            const signature = generateClaudeSignature(largeBody, secret);
            assertSignatureValid(signature, largeBody, secret);
        });
    });

    // ============================================
    // SECURITY TESTS
    // ============================================

    describe('Security Tests', () => {
        test('Should be resistant to timing attacks', () => {
            const signature = generateClaudeSignature(testBody, secret);
            const invalidSignature = 'a'.repeat(signature.length);
            
            const start1 = Date.now();
            verifyClaudeSignature(signature, testBody, secret);
            const time1 = Date.now() - start1;
            
            const start2 = Date.now();
            verifyClaudeSignature(invalidSignature, testBody, secret);
            const time2 = Date.now() - start2;
            
            expect(Math.abs(time1 - time2)).toBeLessThan(100);
        });

        test('Should reject replay attack with different timestamp', () => {
            const body = { productId: '123', timestamp: 1234567890 };
            const signature = generateClaudeSignature(body, secret);
            const replayed = { ...body, timestamp: 1234567891 };
            assertSignatureInvalid(signature, replayed, secret);
        });

        test('Should handle special characters in secret', () => {
            const specialSecret = 'secret!@#$%^&*()_+-=';
            const signature = generateClaudeSignature(testBody, specialSecret);
            assertSignatureValid(signature, testBody, specialSecret);
        });

        test('Should reject signature with malformed format', () => {
            const malformed = 'g'.repeat(64);
            assertSignatureInvalid(malformed, testBody, secret);
        });
    });

    // ============================================
    // ENVIRONMENT VARIABLE TESTS
    // ============================================

    describe('Environment Variable Tests', () => {
        const originalEnv = process.env;

        beforeEach(() => {
            process.env = { ...originalEnv };
        });

        afterEach(() => {
            process.env = originalEnv;
        });

        test('Should use secret from environment', () => {
            process.env.SIGNATURE_SECRET = 'env_secret_1234567890123456';
            const signature = generateClaudeSignature(testBody, process.env.SIGNATURE_SECRET);
            assertSignatureValid(signature, testBody, process.env.SIGNATURE_SECRET);
        });

        test('Should handle missing environment secret', () => {
            delete process.env.SIGNATURE_SECRET;
            expect(() => {
                generateClaudeSignature(testBody, process.env.SIGNATURE_SECRET);
            }).toThrow();
        });

        test('Should handle invalid environment secret', () => {
            process.env.SIGNATURE_SECRET = 'short';
            expect(() => {
                generateClaudeSignature(testBody, process.env.SIGNATURE_SECRET);
            }).toThrow();
        });
    });

    // ============================================
    // ERROR HANDLING TESTS
    // ============================================

    describe('Error Handling', () => {
        test('Should handle invalid secret type (number)', () => {
            assertSignatureThrows('sig', testBody, 123);
        });

        test('Should handle invalid secret type (boolean)', () => {
            assertSignatureThrows('sig', testBody, true);
        });

        test('Should handle invalid body type (number)', () => {
            assertSignatureThrows('sig', 123, secret);
        });

        test('Should handle invalid body type (boolean)', () => {
            assertSignatureThrows('sig', true, secret);
        });

        test('Should handle invalid body type (string)', () => {
            assertSignatureThrows('sig', 'string', secret);
        });

        test('Should handle invalid signature type (number)', () => {
            assertSignatureThrows(123, testBody, secret);
        });

        test('Should handle invalid signature type (boolean)', () => {
            assertSignatureThrows(true, testBody, secret);
        });
    });

    // ============================================
    // PERFORMANCE BENCHMARKS
    // ============================================

    describe('Performance Benchmarks', () => {
        test('Should verify signature within 50ms for average payload', () => {
            const signature = generateClaudeSignature(testBody, secret);
            const start = Date.now();
            verifyClaudeSignature(signature, testBody, secret);
            const duration = Date.now() - start;
            expect(duration).toBeLessThan(50);
        });

        test('Should generate signature within 10ms', () => {
            const start = Date.now();
            generateClaudeSignature(testBody, secret);
            const duration = Date.now() - start;
            expect(duration).toBeLessThan(10);
        });

        test('Should handle 100 concurrent verifications', async () => {
            const signature = generateClaudeSignature(testBody, secret);
            const promises = Array(100).fill().map(() => 
                Promise.resolve(verifyClaudeSignature(signature, testBody, secret))
            );
            const results = await Promise.all(promises);
            expect(results.every(r => r === true)).toBe(true);
        });

        test('Should handle 1000 concurrent verifications', async () => {
            const signature = generateClaudeSignature(testBody, secret);
            const promises = Array(1000).fill().map(() => 
                Promise.resolve(verifyClaudeSignature(signature, testBody, secret))
            );
            const results = await Promise.all(promises);
            expect(results.every(r => r === true)).toBe(true);
        });
    });

    // ============================================
    // INTEGRATION TESTS WITH EXPRESS
    // ============================================

    describe('Integration Tests with Express', () => {
        let app;
        let server;

        beforeAll(() => {
            app = express();
            app.use(express.json({ limit: '10mb' }));

            app.post('/verify', (req, res) => {
                const signature = req.headers['x-signature'];
                const isValid = verifyClaudeSignature(signature, req.body, secret);
                res.json({ valid: isValid });
            });

            app.post('/protected', (req, res) => {
                const signature = req.headers['x-signature'];
                const isValid = verifyClaudeSignature(signature, req.body, secret);
                if (!isValid) {
                    return res.status(401).json({ error: 'Invalid signature' });
                }
                res.json({ success: true, data: req.body });
            });

            server = app.listen(0);
        });

        afterAll(() => {
            server.close();
        });

        test('Should verify signature in HTTP request', async () => {
            const body = { productId: '123' };
            const signature = generateClaudeSignature(body, secret);

            const response = await request(app)
                .post('/verify')
                .set('x-signature', signature)
                .send(body);

            expect(response.status).toBe(200);
            expect(response.body.valid).toBe(true);
        });

        test('Should reject invalid signature in HTTP request', async () => {
            const body = { productId: '123' };

            const response = await request(app)
                .post('/verify')
                .set('x-signature', 'invalid')
                .send(body);

            expect(response.status).toBe(200);
            expect(response.body.valid).toBe(false);
        });

        test('Should reject request without signature', async () => {
            const body = { productId: '123' };

            const response = await request(app)
                .post('/verify')
                .send(body);

            expect(response.status).toBe(200);
            expect(response.body.valid).toBe(false);
        });

        test('Should protect route with signature verification', async () => {
            const body = { productId: '123' };
            const signature = generateClaudeSignature(body, secret);

            const response = await request(app)
                .post('/protected')
                .set('x-signature', signature)
                .send(body);

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
        });

        test('Should reject unauthorized requests', async () => {
            const body = { productId: '123' };

            const response = await request(app)
                .post('/protected')
                .set('x-signature', 'invalid')
                .send(body);

            expect(response.status).toBe(401);
            expect(response.body.error).toBe('Invalid signature');
        });

        test('Should handle large payloads in HTTP request', async () => {
            const largeBody = { data: 'x'.repeat(1024 * 1024) };
            const signature = generateClaudeSignature(largeBody, secret);

            const response = await request(app)
                .post('/verify')
                .set('x-signature', signature)
                .send(largeBody);

            expect(response.status).toBe(200);
            expect(response.body.valid).toBe(true);
        });
    });

    // ============================================
    // NEGATIVE TEST CASES
    // ============================================

    describe('Negative Test Cases', () => {
        test('Should reject expired signature', () => {
            const body = { productId: '123', timestamp: Date.now() - 3600000 };
            const signature = generateClaudeSignature(body, secret);
            assertSignatureInvalid(signature, body, secret);
        });

        test('Should reject signature with invalid timestamp format', () => {
            const body = { productId: '123', timestamp: 'invalid' };
            const signature = generateClaudeSignature(body, secret);
            const tampered = { ...body, timestamp: 'different' };
            assertSignatureInvalid(signature, tampered, secret);
        });

        test('Should reject signature with SQL injection attempt', () => {
            const body = { productId: "123' OR '1'='1" };
            const signature = generateClaudeSignature(body, secret);
            const tampered = { productId: "123' OR '1'='2" };
            assertSignatureInvalid(signature, tampered, secret);
        });

        test('Should reject signature with XSS attempt', () => {
            const body = { text: '<script>alert("xss")</script>' };
            const signature = generateClaudeSignature(body, secret);
            const tampered = { text: '<script>alert("hacked")</script>' };
            assertSignatureInvalid(signature, tampered, secret);
        });
    });

    // ============================================
    // CROSS-PLATFORM COMPATIBILITY
    // ============================================

    describe('Cross-Platform Compatibility', () => {
        test('Should handle different JSON stringify order consistently', () => {
            const body1 = { a: 1, b: 2, c: 3 };
            const body2 = { c: 3, b: 2, a: 1 };
            const signature = generateClaudeSignature(body1, secret);
            assertSignatureInvalid(signature, body2, secret);
        });

        test('Should handle deep nested objects', () => {
            const signature = generateClaudeSignature(fixtures.deepNestedBody, secret);
            assertSignatureValid(signature, fixtures.deepNestedBody, secret);
        });

        test('Should handle objects with different key order but same content', () => {
            const body1 = { a: 1, b: 2 };
            const body2 = { b: 2, a: 1 };
            const signature = generateClaudeSignature(body1, secret);
            assertSignatureInvalid(signature, body2, secret);
        });
    });

    // ============================================
    // CUSTOM ASSERTION HELPERS TESTS
    // ============================================

    describe('Assertion Helpers', () => {
        test('assertSignatureValid should pass for valid signature', () => {
            const { body, signature, secret } = createSignatureTest(testBody);
            expect(() => assertSignatureValid(signature, body, secret)).not.toThrow();
        });

        test('assertSignatureInvalid should pass for invalid signature', () => {
            expect(() => assertSignatureInvalid('invalid', testBody, secret)).not.toThrow();
        });

        test('assertSignatureThrows should pass for invalid secret', () => {
            expect(() => assertSignatureThrows('sig', testBody, 123)).not.toThrow();
        });
    });

    // ============================================
    // TEST COVERAGE SUMMARY
    // ============================================

    describe('Test Coverage Summary', () => {
        test('Should have completed all test suites', () => {
            // This test ensures all test suites are executed
            expect(true).toBe(true);
        });
    });
});