describe('Product Search Input Sanitization', () => {
    // Test the sanitization logic used in getProductSuggestions
    
    function sanitizeSearchInput(keyword) {
        if (!keyword || keyword.trim() === '') {
            return null;
        }
        const sanitized = keyword.trim().slice(0, 100).replace(/[%_\\]/g, '\\$&');
        return `%${sanitized}%`;
    }

    describe('Input Validation', () => {
        test('should return null for empty input', () => {
            expect(sanitizeSearchInput('')).toBeNull();
        });

        test('should return null for whitespace only', () => {
            expect(sanitizeSearchInput('   ')).toBeNull();
        });

        test('should return null for null input', () => {
            expect(sanitizeSearchInput(null)).toBeNull();
        });
    });

    describe('Basic Sanitization', () => {
        test('should trim whitespace', () => {
            const result = sanitizeSearchInput('  laptop  ');
            expect(result).toBe('%laptop%');
        });

        test('should limit to 100 characters', () => {
            const longInput = 'a'.repeat(150);
            const result = sanitizeSearchInput(longInput);
            expect(result.length).toBeLessThanOrEqual(102); // % + 100 chars + %
        });
    });

    describe('LIKE Special Character Escaping', () => {
        test('should escape percent sign', () => {
            const result = sanitizeSearchInput('100%');
            expect(result).toBe('%100\\%%');
        });

        test('should escape underscore', () => {
            const result = sanitizeSearchInput('laptop_2024');
            expect(result).toBe('%laptop\\_2024%');
        });

        test('should escape backslash', () => {
            const result = sanitizeSearchInput('path\\file');
            expect(result).toBe('%path\\\\file%');
        });

        test('should escape multiple special chars', () => {
            const result = sanitizeSearchInput('%_\\%_');
            expect(result).toBe('%\\%\\_\\\\\\%\\_%');
        });
    });
});
