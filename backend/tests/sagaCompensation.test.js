const { SagaOrchestrator, SAGA_STATUS } = require('../services/sagaOrchestratorService');

describe('SagaOrchestrator - Compensation Error Handling', () => {
    let orchestrator;

    beforeEach(() => {
        orchestrator = new SagaOrchestrator();
        jest.spyOn(orchestrator, 'storeSaga').mockResolvedValue();
    });

    test('should set status to COMPENSATED when all compensation steps succeed', async () => {
        const handlerMock = jest.fn().mockResolvedValue();
        const saga = {
            id: 'saga-1',
            status: SAGA_STATUS.FAILED,
            context: {},
            compensations: [
                { step: 'releaseInventory', handler: handlerMock, data: {} }
            ],
            errors: []
        };

        await orchestrator.compensateSaga(saga, 0);
        expect(saga.status).toBe(SAGA_STATUS.COMPENSATED);
        expect(handlerMock).toHaveBeenCalledTimes(1);
        expect(saga.errors.length).toBe(0);
    });

    test('should set status to PARTIAL and record errors when compensation step throws', async () => {
        const failingHandler = jest.fn().mockRejectedValue(new Error('Gateway timeout on refund'));
        const saga = {
            id: 'saga-2',
            status: SAGA_STATUS.FAILED,
            context: {},
            compensations: [
                { step: 'refundPayment', handler: failingHandler, data: {} }
            ],
            errors: []
        };

        await orchestrator.compensateSaga(saga, 0);
        expect(saga.status).toBe(SAGA_STATUS.PARTIAL);
        expect(saga.errors.length).toBe(1);
        expect(saga.errors[0]).toEqual(expect.objectContaining({
            step: 'refundPayment',
            phase: 'compensation',
            error: 'Gateway timeout on refund'
        }));
    });
});
