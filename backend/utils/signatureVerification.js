const crypto = require('crypto');

const config = {
    secret: process.env.CLAUDE_WEBHOOK_SECRET,
    signatureHeader: process.env.SIGNATURE_HEADER || 'x-claude-signature',
    maxBodySize: parseInt(process.env.MAX_SIGNATURE_BODY_SIZE) || 10 * 1024 * 1024,
    signatureExpiry: parseInt(process.env.SIGNATURE_EXPIRY_SECONDS) || 300,
    algorithm: process.env.SIGNATURE_ALGORITHM || 'sha256',
    supportOldSecrets: process.env.SUPPORT_OLD_SECRETS === 'true' || false,
    oldSecret: process.env.OLD_CLAUDE_WEBHOOK_SECRET,
    logVerifications: process.env.LOG_SIGNATURE_VERIFICATIONS !== 'false'
};

function validateSecret(secret) {
    if (!secret || typeof secret !== 'string' || secret.length === 0) {
        throw new Error('Secret must be a non-empty string');
    }
    if (secret.length < 16) {
        throw new Error('Secret should be at least 16 characters long');
    }
    return true;
}

function validateBody(body) {
    if (body === null || body === undefined) {
        throw new Error('Body cannot be null or undefined');
    }
    const bodySize = JSON.stringify(body).length;
    if (bodySize > config.maxBodySize) {
        throw new Error(`Body size ${bodySize} exceeds maximum ${config.maxBodySize} bytes`);
    }
    return true;
}

function validateSignature(signature) {
    if (!signature || typeof signature !== 'string' || signature.length === 0) {
        return false;
    }
    if (!/^[0-9a-fA-F]+$/.test(signature)) {
        return false;
    }
    if (signature.length !== 64) {
        return false;
    }
    return true;
}

function generateSignature(body, secret, options = {}) {
    validateSecret(secret);
    const algorithm = options.algorithm || config.algorithm;
    const hasTimestamp = options.timestamp !== undefined || (body && typeof body === 'object' && body.timestamp !== undefined);
    const hasNonce = options.nonce !== undefined || (body && typeof body === 'object' && body.nonce !== undefined);

    let payload;
    let timestamp = options.timestamp || (body && typeof body === 'object' && body.timestamp);
    let nonce = options.nonce || (body && typeof body === 'object' && body.nonce);

    if (hasTimestamp || hasNonce) {
        timestamp = timestamp || Math.floor(Date.now() / 1000);
        nonce = nonce || crypto.randomBytes(16).toString('hex');
        payload = {
            body: body,
            timestamp: timestamp,
            nonce: nonce
        };
    } else {
        payload = body;
    }

    const signature = crypto
        .createHmac(algorithm, secret)
        .update(JSON.stringify(payload))
        .digest('hex');

    return {
        signature,
        timestamp,
        nonce
    };
}

function verifyClaudeSignature(signature, body, secret, options = {}) {
    // 1. Parameter type validation (must throw)
    if (secret !== undefined && secret !== null && typeof secret !== 'string') {
        throw new Error('Secret must be a string');
    }
    if (body !== undefined && body !== null && typeof body !== 'object') {
        throw new Error('Body must be an object or array');
    }
    if (signature !== undefined && signature !== null && typeof signature !== 'string') {
        throw new Error('Signature must be a string');
    }

    // 2. Return false validation checks (missing or empty values)
    if (!secret || secret.length === 0) return false;
    if (!body) return false;
    if (!signature || signature.length === 0) return false;

    // 3. Size validation (throws if body exceeds max size)
    validateBody(body);

    // 4. Format validation
    if (!validateSignature(signature)) {
        console.warn('Invalid signature format', {
            signature: signature.substring(0, 10)
        });
        return false;
    }

    try {
        const hasTimestamp = options.timestamp !== undefined || (body && typeof body === 'object' && body.timestamp !== undefined);
        const hasNonce = options.nonce !== undefined || (body && typeof body === 'object' && body.nonce !== undefined);

        let payload;
        if (hasTimestamp || hasNonce) {
            const timestamp = options.timestamp || (body && typeof body === 'object' && body.timestamp);
            const nonce = options.nonce || (body && typeof body === 'object' && body.nonce) || 'legacy';

            if (timestamp) {
                const currentTime = Math.floor(Date.now() / 1000);
                const age = currentTime - timestamp;

                if (age > config.signatureExpiry) {
                    console.warn('Signature expired', { age, expiry: config.signatureExpiry });
                    return false;
                }

                if (age < 0) {
                    console.warn('Signature from future', { age });
                    return false;
                }
            }

            payload = {
                body: body,
                timestamp: timestamp,
                nonce: nonce
            };
        } else {
            payload = body;
        }

        const expectedSignature = crypto
            .createHmac(config.algorithm, secret)
            .update(JSON.stringify(payload))
            .digest('hex');

        try {
            return crypto.timingSafeEqual(
                Buffer.from(signature, 'hex'),
                Buffer.from(expectedSignature, 'hex')
            );
        } catch (bufferError) {
            console.warn('Buffer comparison failed', { error: bufferError.message });
            return false;
        }

    } catch (error) {
        console.error('Signature verification error', {
            error: error.message,
            type: error.name
        });
        return false;
    }
}

function generateClaudeSignature(body, secret) {
    return generateSignature(body, secret).signature;
}

function verifyWithSecrets(signature, body, secrets) {
    if (!Array.isArray(secrets) || secrets.length === 0) {
        return false;
    }

    for (const secret of secrets) {
        try {
            if (verifyClaudeSignature(signature, body, secret)) {
                return true;
            }
        } catch (error) {
            continue;
        }
    }

    return false;
}

function isTrustedAgent(req) {
    const startTime = Date.now();
    const requestId = req.id || crypto.randomBytes(16).toString('hex');

    try {
        if (!req || !req.headers) {
            console.warn('Invalid request object', { requestId });
            return { isTrusted: false, reason: 'invalid_request' };
        }

        const signature = req.headers[config.signatureHeader] ||
            req.headers['x-claude-signature'];

        if (!signature) {
            console.warn('Missing signature header', {
                requestId,
                ip: req.ip,
                path: req.path
            });
            return { isTrusted: false, reason: 'missing_signature' };
        }

        const body = req.body;
        if (!body) {
            console.warn('Missing request body', { requestId });
            return { isTrusted: false, reason: 'missing_body' };
        }

        const bodySize = JSON.stringify(body).length;
        if (bodySize > config.maxBodySize) {
            console.warn('Request body too large', {
                requestId,
                size: bodySize,
                maxSize: config.maxBodySize
            });
            return { isTrusted: false, reason: 'body_too_large' };
        }

        const secrets = [config.secret];
        if (config.supportOldSecrets && config.oldSecret) {
            secrets.push(config.oldSecret);
        }

        const isValid = verifyWithSecrets(signature, body, secrets);

        const duration = Date.now() - startTime;

        if (config.logVerifications) {
            console.log('Signature verification result', {
                requestId,
                isValid,
                method: isValid ? 'signature' : 'none',
                duration,
                ip: req.ip,
                path: req.path
            });
        }

        if (!isValid) {
            console.warn('Invalid signature', {
                requestId,
                ip: req.ip,
                path: req.path,
                signature: signature.substring(0, 10)
            });
            return { isTrusted: false, reason: 'invalid_signature' };
        }

        return {
            isTrusted: true,
            verificationMethod: 'signature',
            requestId,
            duration
        };

    } catch (error) {
        console.error('Trusted agent check failed', {
            requestId,
            error: error.message,
            stack: error.stack
        });
        return { isTrusted: false, reason: 'verification_error' };
    }
}

function verifySignatureMiddleware(req, res, next) {
    const result = isTrustedAgent(req);

    if (!result.isTrusted) {
        const status = result.reason === 'body_too_large' ? 413 : 401;
        return res.status(status).json({
            success: false,
            error: 'Unauthorized',
            reason: result.reason,
            requestId: result.requestId
        });
    }

    req.verification = result;
    next();
}

function verifyWithMultipleAlgorithms(signature, body, secret) {
    const algorithms = ['sha256', 'sha384', 'sha512'];

    for (const algo of algorithms) {
        try {
            const expected = crypto
                .createHmac(algo, secret)
                .update(JSON.stringify(body))
                .digest('hex');

            if (crypto.timingSafeEqual(
                Buffer.from(signature, 'hex'),
                Buffer.from(expected, 'hex')
            )) {
                return true;
            }
        } catch (error) {
            continue;
        }
    }

    return false;
}

module.exports = {
    verifyClaudeSignature,
    generateClaudeSignature,
    generateSignature,
    isTrustedAgent,
    verifySignatureMiddleware,
    verifyWithSecrets,
    validateSecret,
    validateBody,
    validateSignature,
    verifyWithMultipleAlgorithms
};