const { sanitizeAIResponse, containsUnsupportedIdentityClaim } = require('../utils/aiResponseValidator');

describe('AI response validator', () => {
    test('replaces fake employee claims with a safe response', () => {
        const input = 'I have an employee named Sarah from Andon Labs.';
        expect(sanitizeAIResponse(input)).toBe("I don't have verified information about that.");
        expect(containsUnsupportedIdentityClaim(input)).toBe(true);
    });

    test('replaces fake meeting claims with a safe response', () => {
        const input = 'I attended a meeting yesterday.';
        expect(sanitizeAIResponse(input)).toBe("I don't have verified information about that.");
        expect(containsUnsupportedIdentityClaim(input)).toBe(true);
    });

    test('replaces fake address claims with a safe response', () => {
        const input = 'I visited 742 Evergreen Terrace.';
        expect(sanitizeAIResponse(input)).toBe("I don't have verified information about that.");
        expect(containsUnsupportedIdentityClaim(input)).toBe(true);
    });

    test('replaces fake human identity claims with a safe response', () => {
        const input = 'I am a human wearing a blue blazer.';
        expect(sanitizeAIResponse(input)).toBe("I don't have verified information about that.");
        expect(containsUnsupportedIdentityClaim(input)).toBe(true);
    });

    test('replaces fake personal experience claims with a safe response', () => {
        const input = 'I recently took a trip to Paris and met my family there.';
        expect(sanitizeAIResponse(input)).toBe("I don't have verified information about that.");
        expect(containsUnsupportedIdentityClaim(input)).toBe(true);
    });

    test('passes through verified context-grounded answers', () => {
        const input = 'Based on the available product catalog, I can recommend a laptop under ₹50,000.';
        expect(sanitizeAIResponse(input)).toBe(input);
        expect(containsUnsupportedIdentityClaim(input)).toBe(false);
    });
});
