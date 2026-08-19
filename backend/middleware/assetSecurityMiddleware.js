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
    let decodedPath = req.path;
    try {
        decodedPath = decodeURIComponent(req.path);
    } catch (err) {
        return res.status(403).json({
            success: false,
            message: 'Forbidden: Invalid path encoding'
        });
    }

    // Guard against path traversal attacks
    if (decodedPath.includes('..') || decodedPath.includes('\\')) {
        return res.status(403).json({
            success: false,
            message: 'Forbidden: Path traversal detected'
        });
    }

    const filename = path.basename(decodedPath);

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
