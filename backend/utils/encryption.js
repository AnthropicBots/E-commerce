const crypto = require("crypto");

const algorithm = "aes-256-gcm";
const ivLength = 16;

// Derive a 32-byte key from JWT_SECRET if ENCRYPTION_KEY is missing
function getKey() {
    const rawKey = process.env.ENCRYPTION_KEY || process.env.JWT_SECRET || 'default_fallback_secret_must_change';
    return crypto.createHash('sha256').update(String(rawKey)).digest('base64').substring(0, 32);
}

/**
 * Encrypts a string
 * @param {string} text - The text to encrypt
 * @returns {string} The encrypted text (IV:AuthTag:EncryptedData)
 */
function encrypt(text) {
    if (!text) return text;
    
    const iv = crypto.randomBytes(ivLength);
    const key = getKey();
    
    const cipher = crypto.createCipheriv(algorithm, key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag().toString('hex');
    
    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/**
 * Decrypts a previously encrypted string
 * @param {string} text - The encrypted text (IV:AuthTag:EncryptedData)
 * @returns {string} The decrypted text
 */
function decrypt(text) {
    if (!text) return text;
    
    try {
        const parts = text.split(':');
        if (parts.length !== 3) return text; // Not encrypted or malformed
        
        const iv = Buffer.from(parts[0], 'hex');
        const authTag = Buffer.from(parts[1], 'hex');
        const encryptedText = parts[2];
        const key = getKey();
        
        const decipher = crypto.createDecipheriv(algorithm, key, iv);
        decipher.setAuthTag(authTag);
        
        let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        
        return decrypted;
    } catch (error) {
        console.error("Decryption failed:", error.message);
        return null;
    }
}

module.exports = {
    encrypt,
    decrypt
};
