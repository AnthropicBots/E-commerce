const { ArchitecturalRiskService } = require('../services/architecturalRiskService');
const fs = require('fs');

jest.mock('fs', () => ({
    ...jest.requireActual('fs'),
    promises: {
        readFile: jest.fn()
    }
}));

describe('ArchitecturalRiskService - calculateCohesion Performance & Accuracy', () => {
    let service;

    beforeEach(() => {
        service = new ArchitecturalRiskService();
        jest.clearAllMocks();
    });

    test('should asynchronously calculate cohesion without blocking main loop', async () => {
        jest.spyOn(service, 'findFilesInModule').mockReturnValue([
            '/project/file1.js',
            '/project/file2.js'
        ]);

        fs.promises.readFile.mockImplementation(async (filePath) => {
            if (filePath === '/project/file1.js') {
                return 'function checkout() { return processPayment(); }';
            }
            if (filePath === '/project/file2.js') {
                return 'function processPayment() { return confirmOrder(); }';
            }
            return '';
        });

        const cohesionScore = await service.calculateCohesion('/project');
        expect(typeof cohesionScore).toBe('number');
        expect(cohesionScore).toBeGreaterThan(0);
        expect(fs.promises.readFile).toHaveBeenCalledTimes(2);
    });
});
