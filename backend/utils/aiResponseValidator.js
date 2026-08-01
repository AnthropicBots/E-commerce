const UNSAFE_IDENTITY_PATTERNS = [
    /\bI am\b[^\n]{0,40}\b(human|person|man|woman|boy|girl)\b/i,
    /\bI am\b[^\n]{0,40}\bwearing\b[^\n]{0,40}\b(blazer|shirt|dress|coat|jacket|clothes|outfit)\b/i,
    /\bI have\b[^\n]{0,40}\b(employee|coworker|colleague|team member|worker)\b/i,
    /\bI visited\b[^\n]{0,40}\b(\d+\s+[A-Za-z0-9 .'-]+|[A-Za-z0-9 .'-]+)\b/i,
    /\bI attended\b[^\n]{0,40}\b(meeting|call|conference|trip|appointment)\b/i,
    /\bI wore\b[^\n]{0,40}\b(blazer|shirt|dress|coat|jacket|clothes|outfit)\b/i,
    /\bI went\b[^\n]{0,40}\b(to|on)\b[^\n]{0,40}\b(trip|vacation|meeting|appointment|travel)\b/i,
    /\bI met\b[^\n]{0,40}\b(family|friend|coworker|colleague|employee|team member)\b/i,
    /\bI recently\b[^\n]{0,40}\b(traveled|visited|went|met|attended)\b/i,
    /\bI have\b[^\n]{0,40}\b(address|office|company|organization|contract)\b/i,
    /\bI am\b[^\n]{0,40}\bfrom\b[^\n]{0,40}\b[A-Za-z0-9 .'-]+\b/i
];

const SAFE_FALLBACK_RESPONSE = "I don't have verified information about that.";

function containsUnsupportedIdentityClaim(text) {
    if (!text || typeof text !== 'string') {
        return false;
    }

    const trimmed = text.trim();
    if (!trimmed) {
        return false;
    }

    return UNSAFE_IDENTITY_PATTERNS.some((pattern) => pattern.test(trimmed));
}

function sanitizeAIResponse(text) {
    if (!text || typeof text !== 'string') {
        return text;
    }

    if (containsUnsupportedIdentityClaim(text)) {
        return SAFE_FALLBACK_RESPONSE;
    }

    return text;
}

module.exports = {
    SAFE_FALLBACK_RESPONSE,
    containsUnsupportedIdentityClaim,
    sanitizeAIResponse
};
