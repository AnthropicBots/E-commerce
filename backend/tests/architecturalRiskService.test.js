const { ArchitecturalRiskService } = require('../services/architecturalRiskService');
const fs = require('fs');
const path = require('path');

jest.mock('fs');

describe('ArchitecturalRiskService - calculateCoupling', () => {
    let service;

    beforeEach(() => {
        service = new ArchitecturalRiskService();
        jest.clearAllMocks();
    });

    test('should calculate incoming and outgoing coupling correctly', async () => {
        jest.spyOn(service, 'findModules').mockReturnValue(['/project/backend/controllers', '/project/backend/services']);
        
        jest.spyOn(service, 'findFilesInModule').mockImplementation((modPath) => {
            if (modPath === '/project/backend/controllers') {
                return ['/project/backend/controllers/userController.js'];
            }
            if (modPath === '/project/backend/services') {
                return ['/project/backend/services/userService.js'];
            }
            return [];
        });

        fs.readFileSync.mockImplementation((filePath) => {
            if (filePath === '/project/backend/controllers/userController.js') {
                return "const service = require('../services/userService');";
            }
            if (filePath === '/project/backend/services/userService.js') {
                return "const db = require('../config/db');";
            }
            return "";
        });

        const result = await service.calculateCoupling('/project/backend/services');
        expect(result).toHaveProperty('incoming');
        expect(result).toHaveProperty('outgoing');
        expect(result.incoming).toBe(1); // userController.js imports userService
        expect(result.outgoing).toBe(1); // userService imports ../config/db
        expect(result.total).toBe(2);
    });
});
