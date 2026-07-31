// backend/middleware/schemaMiddleware.js
const { schemaRegistryService } = require('../services/schemaRegistryService');

/**
 * Middleware to validate request body against schema
 */
function validateRequest(schemaName, version = 'latest') {
    return async (req, res, next) => {
        try {
            const schema = schemaRegistryService.getSchemaByName(schemaName, version);

            if (!schema) {
                return res.status(500).json({
                    success: false,
                    error: `Schema not found: ${schemaName}`
                });
            }

            const result = schemaRegistryService.validate(req.body, schema.id);

            if (!result.valid) {
                return res.status(400).json({
                    success: false,
                    error: 'Validation failed',
                    errors: result.errors
                });
            }

            // Attach schema info to request
            req.schema = schema;
            next();
        } catch (error) {
            console.error('Schema validation error:', error);
            res.status(500).json({
                success: false,
                error: 'Schema validation failed'
            });
        }
    };
}

/**
 * Middleware to validate response against schema
 */
function validateResponse(schemaName, version = 'latest') {
    return (req, res, next) => {
        const originalJson = res.json;

        res.json = function(data) {
            try {
                const schema = schemaRegistryService.getSchemaByName(schemaName, version);

                if (schema && res.statusCode >= 200 && res.statusCode < 300) {
                    const result = schemaRegistryService.validate(data, schema.id);

                    if (!result.valid) {
                        console.warn('Response validation failed:', {
                            schema: schemaName,
                            errors: result.errors
                        });
                    }
                }
            } catch (error) {
                console.error('Response validation error:', error);
            }

            return originalJson.call(this, data);
        };

        next();
    };
}

/**
 * Middleware to validate event payload
 */
function validateEvent(schemaName, version = 'latest') {
    return async (req, res, next) => {
        try {
            const { event, data } = req.body;

            if (!event) {
                return next();
            }

            const schema = schemaRegistryService.getSchemaByName(schemaName, version);

            if (schema) {
                const result = schemaRegistryService.validate(data, schema.id);

                if (!result.valid) {
                    return res.status(400).json({
                        success: false,
                        error: 'Event validation failed',
                        errors: result.errors
                    });
                }
            }

            next();
        } catch (error) {
            console.error('Event validation error:', error);
            next();
        }
    };
}

module.exports = {
    validateRequest,
    validateResponse,
    validateEvent
};