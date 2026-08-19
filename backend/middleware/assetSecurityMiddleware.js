// backend/middleware/assetSecurityMiddleware.js
const path = require('path');
const express = require('express');

const ALLOWED_FILENAME_REGEX = /^[a-zA-Z0-9_-]+\.svg$/;
const assetsDir = path.resolve(__dirname, '../../frontend/assets');
const staticMiddleware = express.static(assetsDir);

/**
 * Middleware to safely serve SVG assets and protect against path traversal
 * and invalid filename requests.
 */
function assetSecurityMiddleware(req, res, next) {
    const rawUrl = req.originalUrl || req.url || req.path || '';
    let decodedUrl = rawUrl;
    try {
        decodedUrl = decodeURIComponent(rawUrl);
    } catch (err) {
        return res.status(403).json({
            success: false,
            message: 'Forbidden: Invalid URL encoding'
        });
    }

    const isSvgFile = decodedUrl.endsWith('.svg') || decodedUrl.includes('.svg');
    const isAssetPath = decodedUrl.startsWith('/assets') || req.path.startsWith('/assets') || req.baseUrl === '/assets' || decodedUrl.includes('/assets/');

    if (!isSvgFile && !isAssetPath) {
        return next();
    }

    // Reject requests attempting path traversal or trying to access files outside /assets
    if (!decodedUrl.startsWith('/assets') || decodedUrl.includes('..') || decodedUrl.includes('\\') || req.path.includes('..')) {
        return res.status(403).json({
            success: false,
            message: 'Forbidden: Path traversal detected'
        });
    }

    const filename = path.basename(decodedUrl);

    // Whitelist check: only alphanumeric, hyphens, underscores, .svg
    if (!filename || !ALLOWED_FILENAME_REGEX.test(filename)) {
        return res.status(403).json({
            success: false,
            message: 'Forbidden: Invalid asset filename'
        });
    }

    return staticMiddleware(req, res, next);
}

module.exports = assetSecurityMiddleware;
