const { BusinessSLAService } = require('../services/businessSLAService');
const db = require('../config/db');

jest.mock('../config/db', () => ({
    promise: {
        query: jest.fn()
    }
}));

describe('BusinessSLAService SQL Injection Defense', () => {
    let slaService;

    beforeEach(() => {
        slaService = new BusinessSLAService();
        jest.clearAllMocks();
        db.promise.query.mockResolvedValue([[]]);
    });

    test('should map valid period shorthands correctly', async () => {
        await slaService.getMetricsSummary('checkout_completion', '24h');
        expect(db.promise.query).toHaveBeenCalledTimes(1);
        const sqlQuery = db.promise.query.mock.calls[0][0];
        expect(sqlQuery).toContain('INTERVAL 1 DAY');
    });

    test('should map 1h shorthand to HOUR', async () => {
        await slaService.getMetricsSummary('checkout_completion', '1h');
        const sqlQuery = db.promise.query.mock.calls[0][0];
        expect(sqlQuery).toContain('INTERVAL 1 HOUR');
    });

    test('should neutralize SQL injection payloads by falling back to DAY', async () => {
        const injectionPayload = "HOUR) OR 1=1; DROP TABLE sla_measurements;--";
        await slaService.getMetricsSummary('checkout_completion', injectionPayload);
        const sqlQuery = db.promise.query.mock.calls[0][0];
        expect(sqlQuery).toContain('INTERVAL 1 DAY');
        expect(sqlQuery).not.toContain('DROP TABLE');
    });
});
