const { advancePeriod } = require('../services/subscriptionService');

describe('SubscriptionService - advancePeriod End-of-Month Clamping', () => {
    test('should clamp January 31 + 1 month to February 28 in non-leap year', () => {
        const from = new Date(2025, 0, 31); // 2025-01-31
        const next = advancePeriod(from, 'monthly', 1);
        expect(next.getFullYear()).toBe(2025);
        expect(next.getMonth()).toBe(1); // February
        expect(next.getDate()).toBe(28);
    });

    test('should clamp January 31 + 1 month to February 29 in leap year', () => {
        const from = new Date(2024, 0, 31); // 2024-01-31
        const next = advancePeriod(from, 'monthly', 1);
        expect(next.getFullYear()).toBe(2024);
        expect(next.getMonth()).toBe(1); // February
        expect(next.getDate()).toBe(29);
    });

    test('should clamp August 31 + 1 month to September 30', () => {
        const from = new Date(2025, 7, 31); // 2025-08-31
        const next = advancePeriod(from, 'monthly', 1);
        expect(next.getFullYear()).toBe(2025);
        expect(next.getMonth()).toBe(8); // September
        expect(next.getDate()).toBe(30);
    });

    test('should clamp Feb 29 leap year + 1 year to Feb 28', () => {
        const from = new Date(2024, 1, 29); // 2024-02-29
        const next = advancePeriod(from, 'yearly', 1);
        expect(next.getFullYear()).toBe(2025);
        expect(next.getMonth()).toBe(1); // February
        expect(next.getDate()).toBe(28);
    });
});
