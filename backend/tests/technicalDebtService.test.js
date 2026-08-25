const { TechnicalDebtService } = require('../services/technicalDebtService');
const fs = require('fs');

jest.mock('fs');

describe('TechnicalDebtService - Memory Accumulation Prevention', () => {
    let service;

    beforeEach(() => {
        service = new TechnicalDebtService();
        jest.clearAllMocks();
    });

    test('should reset todoItems on each analyzeCodeQuality cycle and prevent duplicates', async () => {
        jest.spyOn(service, 'findCodeFiles').mockReturnValue(['/project/file1.js']);
        fs.readFileSync.mockReturnValue('// TODO: refactor logic\n// TODO: add unit test');

        // First analysis run
        const result1 = await service.analyzeCodeQuality();
        expect(service.todoItems.length).toBe(1);
        expect(service.todoItems[0].count).toBe(2);

        // Second analysis run
        const result2 = await service.analyzeCodeQuality();
        expect(service.todoItems.length).toBe(1);
        expect(result2.todoCount).toBe(1);
    });

    test('should reset todoItems at the start of analyzeDebt', async () => {
        service.todoItems = [{ file: 'old.js', count: 1 }];
        jest.spyOn(service, 'analyzeArchitectureDebt').mockResolvedValue({});
        jest.spyOn(service, 'analyzeCodeQuality').mockResolvedValue({});
        jest.spyOn(service, 'analyzeTestingDebt').mockResolvedValue({});
        jest.spyOn(service, 'analyzeDocumentationDebt').mockResolvedValue({});
        jest.spyOn(service, 'analyzeDependencies').mockResolvedValue({});
        jest.spyOn(service, 'analyzeSecurity').mockResolvedValue({});
        jest.spyOn(service, 'analyzePerformance').mockResolvedValue({});
        jest.spyOn(service, 'calculateMetrics').mockReturnValue({});
        jest.spyOn(service, 'generateRecommendations').mockReturnValue([]);
        jest.spyOn(service, 'calculateOverallScore').mockReturnValue(10);
        jest.spyOn(service, 'storeAnalysis').mockResolvedValue();

        await service.analyzeDebt();
        expect(service.todoItems).toEqual([]);
    });
});
