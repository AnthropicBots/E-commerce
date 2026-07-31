// backend/middleware/apiVersioningMiddleware.js
const { apiVersioningService, VERSION_STATUS } = require('../services/apiVersioningService');

/**
 * Middleware to handle API versioning
 */
function apiVersioning(version = null) {
    return async (req, res, next) => {
        // Determine version from URL or header
        let requestedVersion = version || req.params.version || req.headers['api-version'];

        if (!requestedVersion) {
            // Try to get from URL path
            const pathMatch = req.path.match(/\/api\/(v\d+)\//);
            if (pathMatch) {
                requestedVersion = pathMatch[1];
            }
        }

        // If no version specified, use default
        if (!requestedVersion) {
            requestedVersion = apiVersioningService.getCurrentVersion();
        }

        // Check if version is valid
        if (!apiVersioningService.isValidVersion(requestedVersion)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid API version',
                supportedVersions: apiVersioningService.getSupportedVersions(),
                deprecatedVersions: VERSION_CONFIG.deprecatedVersions,
                currentVersion: apiVersioningService.getCurrentVersion()
            });
        }

        // Attach version to request
        req.apiVersion = requestedVersion;

        // Add version headers to response
        const headers = apiVersioningService.getSunsetHeaders(requestedVersion);
        for (const [key, value] of Object.entries(headers)) {
            res.setHeader(key, value);
        }

        // Add deprecation warning if applicable
        const warning = apiVersioningService.getDeprecationWarning(requestedVersion);
        if (warning) {
            res.setHeader('Warning', `299 - ${warning.warning}`);
        }

        // Track usage
        apiVersioningService.trackUsage(
            requestedVersion,
            req.path,
            req.method,
            req.user?.id
        );

        // Store version in request for route handlers
        req.apiVersionInfo = apiVersioningService.getVersion(requestedVersion);

        next();
    };
}

/**
 * Middleware to deprecate API endpoints
 */
function deprecateEndpoint(version, deprecationDate = null) {
    return async (req, res, next) => {
        const warning = apiVersioningService.getDeprecationWarning(version);
        if (warning) {
            res.setHeader('Warning', `299 - ${warning.warning}`);
            res.setHeader('Deprecation', 'true');
        }

        next();
    };
}

/**
 * Middleware to enforce version compatibility
 */
function enforceVersionCompatibility(version, minVersion = null) {
    return async (req, res, next) => {
        const currentVersion = req.apiVersion || version;

        if (minVersion && currentVersion < minVersion) {
            return res.status(400).json({
                success: false,
                error: `Minimum API version required: ${minVersion}`,
                currentVersion,
                minimumRequired: minVersion
            });
        }

        if (!apiVersioningService.isSupportedVersion(currentVersion)) {
            const supported = apiVersioningService.getSupportedVersions();
            return res.status(400).json({
                success: false,
                error: `API version ${currentVersion} is no longer supported`,
                supportedVersions: supported
            });
        }

        next();
    };
}

module.exports = {
    apiVersioning,
    deprecateEndpoint,
    enforceVersionCompatibility
};