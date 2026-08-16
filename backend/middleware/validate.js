// backend/middleware/validate.js
/**
 * Generic Express middleware to validate request payload against a Joi schema.
 *
 * @param {object} schema - Joi validation schema.
 * @param {string} [property='body'] - Property of `req` to validate ('body', 'query', 'params').
 * @returns {Function} Express middleware function.
 */
function validate(schema, property = 'body') {
    return (req, res, next) => {
        if (!schema || typeof schema.validate !== 'function') {
            return next();
        }

        const payload = req[property] || {};
        const { error, value } = schema.validate(payload, {
            abortEarly: false,
            allowUnknown: true
        });

        if (error) {
            return res.status(400).json({
                success: false,
                message: error.details.map(detail => detail.message).join(', '),
                errors: error.details.map(detail => detail.message)
            });
        }

        req[property] = value;
        next();
    };
}

module.exports = validate;
