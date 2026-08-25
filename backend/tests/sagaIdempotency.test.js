const { SagaOrchestrator, SAGA_STATUS } = require('../services/sagaOrchestratorService');
const redis = require('../config/redis');

jest.mock('../config/redis', () => ({
    set: jest.fn(),
    get: jest.fn(),
    del: jest.fn()
}));

describe('SagaOrchestrator - Idempotency JSON Parsing Resilience', () => {
    let orchestrator;

    beforeEach(() => {
        orchestrator = new SagaOrchestrator();
        jest.clearAllMocks();
        jest.spyOn(orchestrator, 'storeSaga').mockResolvedValue();
    });

    test('should return parsed cached saga data when JSON in Redis is valid', async () => {
        redis.set.mockResolvedValue(null); // setnx returned false (duplicate key)
        redis.get.mockResolvedValue(JSON.stringify({
            id: 'cached-saga-1',
            status: SAGA_STATUS.COMPLETED,
            workflow: 'checkout'
        }));

        const workflow = { name: 'checkout', steps: [] };
        const result = await orchestrator.createSaga(workflow, { idempotencyKey: 'key-123' });

        expect(result).toBeDefined();
        expect(result.id).toBe('cached-saga-1');
        expect(result.status).toBe(SAGA_STATUS.COMPLETED);
    });

    test('should catch SyntaxError on corrupted JSON in Redis and delete corrupted key', async () => {
        redis.set.mockResolvedValue(null);
        redis.get.mockResolvedValue('invalid-non-json-string{corrupted');

        const workflow = { name: 'checkout', steps: [] };
        const result = await orchestrator.createSaga(workflow, { idempotencyKey: 'key-corrupt' });

        expect(result).toBeDefined();
        expect(result.isDuplicate).toBe(true);
        expect(redis.del).toHaveBeenCalledWith('saga:idempotency:key-corrupt');
    });
});
