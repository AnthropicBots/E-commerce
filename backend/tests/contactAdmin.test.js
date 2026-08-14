const contactService = require('../services/contactService');
const db = require('../config/db');

jest.mock('../config/db', () => ({
    query: jest.fn()
}));

describe('ContactService - Admin Status Updates', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('should accept numeric integer adminId for status updates', async () => {
        db.query
            .mockResolvedValueOnce([[{ id: 5 }]]) // existing message check
            .mockResolvedValueOnce([{}])          // update query
            .mockResolvedValueOnce([[{ id: 5, status: 'resolved', name: 'John', email: 'j@example.com', subject: 'Help', message: 'Hello' }]]) // getMessage detail
            .mockResolvedValueOnce([[]]);         // getMessage history

        const result = await contactService.updateStatus(5, 'resolved', 1);
        expect(result).toBeDefined();
        expect(result.status).toBe('resolved');
        expect(db.query).toHaveBeenCalledTimes(4);
    });

    test('should reject invalid status string with 400 error', async () => {
        await expect(contactService.updateStatus(5, 'invalid_status_value', 1))
            .rejects
            .toMatchObject({
                status: 400,
                code: 'INVALID_STATUS'
            });
    });

    test('should reject missing admin authentication', async () => {
        await expect(contactService.updateStatus(5, 'resolved', null))
            .rejects
            .toMatchObject({
                status: 401,
                code: 'UNAUTHENTICATED'
            });
    });
});
