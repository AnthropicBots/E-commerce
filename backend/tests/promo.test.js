const { expect } = require('chai');
const sinon = require('sinon');
const { promisify } = require('util');
const db = require('../config/db');
const redis = require('../config/redis');

// Mock modules
const promoService = require('../services/promo.service');
const promoController = require('../controllers/promo.controller');

describe('Promo Service Tests', () => {
    let sandbox;
    let clock;

    beforeEach(() => {
        sandbox = sinon.createSandbox();
        clock = sinon.useFakeTimers();
        
        // Mock Redis
        sandbox.stub(redis, 'get').resolves(null);
        sandbox.stub(redis, 'set').resolves('OK');
        sandbox.stub(redis, 'del').resolves(1);
        sandbox.stub(redis, 'incr').resolves(1);
        sandbox.stub(redis, 'decr').resolves(0);
        sandbox.stub(redis, 'expire').resolves(1);
        sandbox.stub(redis, 'eval').resolves(1);
    });

    afterEach(() => {
        sandbox.restore();
        clock.restore();
    });

    describe('Promo Validation', () => {
        it('should validate a valid promo code', async () => {
            const mockPromo = {
                code: 'TEST100',
                is_active: true,
                start_date: new Date(Date.now() - 100000),
                expiry_date: new Date(Date.now() + 100000),
                minimum_order_amount: 100,
                discount_type: 'percentage',
                discount_value: 10,
                maximum_discount: 50,
                usage_limit: 100,
                is_stackable: true
            };

            sandbox.stub(promoService, 'getPromoByCode').resolves(mockPromo);

            const result = await promoService.validatePromo('TEST100', 500);
            expect(result.valid).to.be.true;
            expect(result.promo).to.deep.equal(mockPromo);
        });

        it('should reject inactive promo', async () => {
            const mockPromo = {
                code: 'INACTIVE',
                is_active: false
            };

            sandbox.stub(promoService, 'getPromoByCode').resolves(mockPromo);

            const result = await promoService.validatePromo('INACTIVE', 500);
            expect(result.valid).to.be.false;
            expect(result.message).to.equal('Promo code is inactive');
        });

        it('should reject expired promo', async () => {
            const mockPromo = {
                code: 'EXPIRED',
                is_active: true,
                start_date: new Date(Date.now() - 100000),
                expiry_date: new Date(Date.now() - 1000)
            };

            sandbox.stub(promoService, 'getPromoByCode').resolves(mockPromo);

            const result = await promoService.validatePromo('EXPIRED', 500);
            expect(result.valid).to.be.false;
            expect(result.message).to.equal('Promo code has expired');
        });
    });

    describe('Discount Calculation', () => {
        it('should calculate percentage discount correctly', () => {
            const promo = {
                discount_type: 'percentage',
                discount_value: 20,
                maximum_discount: null
            };

            const discount = promoService.calculateDiscount(promo, 1000);
            expect(discount).to.equal(200);
        });

        it('should respect maximum discount limit', () => {
            const promo = {
                discount_type: 'percentage',
                discount_value: 20,
                maximum_discount: 100
            };

            const discount = promoService.calculateDiscount(promo, 1000);
            expect(discount).to.equal(100);
        });

        it('should calculate fixed discount correctly', () => {
            const promo = {
                discount_type: 'fixed',
                discount_value: 50
            };

            const discount = promoService.calculateDiscount(promo, 1000);
            expect(discount).to.equal(50);
        });

        it('should not make discount negative', () => {
            const promo = {
                discount_type: 'fixed',
                discount_value: 100
            };

            const discount = promoService.calculateDiscount(promo, 50);
            expect(discount).to.equal(50);
        });
    });

    describe('Concurrent Race Condition Prevention', () => {
        it('should prevent double discount application with locks', async () => {
            const mockPromo = {
                code: 'TEST100',
                is_active: true,
                start_date: new Date(Date.now() - 100000),
                expiry_date: new Date(Date.now() + 100000),
                minimum_order_amount: 0,
                discount_type: 'percentage',
                discount_value: 10,
                is_stackable: true
            };

            sandbox.stub(promoService, 'getPromoByCode').resolves(mockPromo);
            sandbox.stub(promoService, 'applyPromoTransaction').resolves(true);

            // Simulate concurrent requests
            const requests = [];
            for (let i = 0; i < 5; i++) {
                requests.push(
                    promoController.applyMultiplePromos({
                        body: { 
                            promoCodes: ['TEST100'], 
                            cartTotal: 1000,
                            sessionId: `session-${i}`
                        },
                        user: { id: 'user123' }
                    }, {
                        status: function(code) { return { json: (data) => data }; }
                    })
                );
            }

            // Only one should succeed, others should get lock error
            const results = await Promise.all(requests);
            const successCount = results.filter(r => r.success === true).length;
            expect(successCount).to.be.at.most(1);
        });

        it('should handle multiple promo stacking correctly', async () => {
            const mockPromos = {
                'PROMO1': {
                    code: 'PROMO1',
                    is_active: true,
                    start_date: new Date(Date.now() - 100000),
                    expiry_date: new Date(Date.now() + 100000),
                    minimum_order_amount: 0,
                    discount_type: 'percentage',
                    discount_value: 10,
                    is_stackable: true,
                    exclusive_category: null,
                    campaign_id: null,
                    usage_limit: 100
                },
                'PROMO2': {
                    code: 'PROMO2',
                    is_active: true,
                    start_date: new Date(Date.now() - 100000),
                    expiry_date: new Date(Date.now() + 100000),
                    minimum_order_amount: 0,
                    discount_type: 'percentage',
                    discount_value: 20,
                    is_stackable: true,
                    exclusive_category: null,
                    campaign_id: null,
                    usage_limit: 100
                }
            };

            sandbox.stub(promoService, 'getPromoByCode').callsFake((code) => {
                return Promise.resolve(mockPromos[code] || null);
            });

            sandbox.stub(promoService, 'applyPromoTransaction').resolves(true);

            const result = await promoController.applyMultiplePromos({
                body: { 
                    promoCodes: ['PROMO1', 'PROMO2'], 
                    cartTotal: 1000,
                    sessionId: 'test-session'
                },
                user: { id: 'user123' }
            }, {
                status: function(code) { return { json: (data) => data }; }
            });

            expect(result.success).to.be.true;
            expect(result.data.totalDiscount).to.be.greaterThan(0);
        });
    });

    describe('Promo Stacking Rules', () => {
        it('should reject non-stackable promos', async () => {
            const mockPromos = {
                'PROMO1': {
                    code: 'PROMO1',
                    is_stackable: false
                }
            };

            sandbox.stub(promoService, 'getPromoByCode').callsFake((code) => {
                return Promise.resolve(mockPromos[code] || null);
            });

            const result = await promoController.applyMultiplePromos({
                body: { 
                    promoCodes: ['PROMO1'], 
                    cartTotal: 1000,
                    sessionId: 'test-session'
                },
                user: { id: 'user123' }
            }, {
                status: function(code) { 
                    expect(code).to.equal(400);
                    return { json: (data) => data };
                }
            });

            expect(result.success).to.be.false;
            expect(result.message).to.include('cannot be stacked');
        });

        it('should reject promos from same exclusive category', async () => {
            const mockPromos = {
                'PROMO1': {
                    code: 'PROMO1',
                    is_stackable: true,
                    exclusive_category: 'WELCOME'
                },
                'PROMO2': {
                    code: 'PROMO2',
                    is_stackable: true,
                    exclusive_category: 'WELCOME'
                }
            };

            sandbox.stub(promoService, 'getPromoByCode').callsFake((code) => {
                return Promise.resolve(mockPromos[code] || null);
            });

            const result = await promoController.applyMultiplePromos({
                body: { 
                    promoCodes: ['PROMO1', 'PROMO2'], 
                    cartTotal: 1000,
                    sessionId: 'test-session'
                },
                user: { id: 'user123' }
            }, {
                status: function(code) { 
                    expect(code).to.equal(500);
                    return { json: (data) => data };
                }
            });

            expect(result.success).to.be.false;
            expect(result.message).to.include('exclusive category');
        });
    });

    describe('Distributed Locking', () => {
        it('should acquire and release locks correctly', async () => {
            const lockKey = 'test:lock';
            let lockAcquired = false;

            // Simulate lock acquire
            const mockAcquireLock = sandbox.stub(promoController, 'acquireLock')
                .callsFake(async () => {
                    lockAcquired = true;
                    return 'lock-value';
                });

            const mockReleaseLock = sandbox.stub(promoController, 'releaseLock')
                .callsFake(async () => {
                    lockAcquired = false;
                    return true;
                });

            // Execute with lock
            await promoController.withLock(lockKey, async () => {
                expect(lockAcquired).to.be.true;
                return 'result';
            });

            expect(lockAcquired).to.be.false;
            expect(mockAcquireLock.calledOnce).to.be.true;
            expect(mockReleaseLock.calledOnce).to.be.true;
        });

        it('should retry on lock acquisition failure', async () => {
            const lockKey = 'test:lock';
            let attempts = 0;

            sandbox.stub(promoController, 'acquireLock')
                .callsFake(async () => {
                    attempts++;
                    if (attempts < 3) return null;
                    return 'lock-value';
                });

            sandbox.stub(promoController, 'releaseLock').resolves(true);

            const result = await promoController.withLock(lockKey, async () => {
                return 'success';
            }, 5);

            expect(result).to.equal('success');
            expect(attempts).to.equal(3);
        });
    });

    describe('Usage Limit Validation', () => {
        it('should respect usage limits', async () => {
            const mockPromo = {
                code: 'LIMITED',
                is_active: true,
                start_date: new Date(Date.now() - 100000),
                expiry_date: new Date(Date.now() + 100000),
                minimum_order_amount: 0,
                discount_type: 'percentage',
                discount_value: 10,
                usage_limit: 1
            };

            sandbox.stub(promoService, 'getPromoByCode').resolves(mockPromo);
            sandbox.stub(redis, 'get').resolves('1'); // Already used once

            const result = await promoService.validatePromo('LIMITED', 500);
            expect(result.valid).to.be.false;
            expect(result.message).to.equal('Promo code usage limit has been reached');
        });

        it('should increment usage atomically', async () => {
            const mockPromo = {
                code: 'TEST',
                is_active: true,
                start_date: new Date(Date.now() - 100000),
                expiry_date: new Date(Date.now() + 100000),
                usage_limit: 10
            };

            sandbox.stub(promoService, 'getPromoByCode').resolves(mockPromo);
            
            let incrCalls = 0;
            sandbox.stub(redis, 'incr').callsFake(async () => {
                incrCalls++;
                return incrCalls;
            });

            // Simulate transaction
            const connection = {
                beginTransaction: sandbox.stub().resolves(),
                commit: sandbox.stub().resolves(),
                rollback: sandbox.stub().resolves(),
                release: sandbox.stub().resolves(),
                query: sandbox.stub().resolves([[mockPromo], { affectedRows: 1 }])
            };

            sandbox.stub(db, 'getConnection').resolves(connection);

            await promoService.applyPromoTransaction('TEST', 'user123', 50);
            expect(incrCalls).to.equal(1);
        });
    });

    describe('Error Handling', () => {
        it('should handle database errors gracefully', async () => {
            sandbox.stub(promoService, 'getPromoByCode').throws(new Error('DB connection failed'));

            try {
                await promoService.validatePromo('TEST', 500);
                expect.fail('Should have thrown error');
            } catch (error) {
                expect(error.message).to.equal('DB connection failed');
            }
        });

        it('should handle Redis errors gracefully', async () => {
            const mockPromo = {
                code: 'TEST',
                is_active: true,
                start_date: new Date(Date.now() - 100000),
                expiry_date: new Date(Date.now() + 100000),
                minimum_order_amount: 0
            };

            sandbox.stub(promoService, 'getPromoByCode').resolves(mockPromo);
            sandbox.stub(redis, 'get').throws(new Error('Redis connection failed'));

            const result = await promoService.validatePromo('TEST', 500);
            // Should fallback to database value
            expect(result.valid).to.be.true;
        });
    });
});