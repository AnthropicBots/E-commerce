// backend/validators/baseValidator.js

/**
 * Base Validator class providing common validation utilities
 */
class BaseValidator {
    constructor() {
        this.errors = [];
        this.warnings = [];
        this.validated = false;
    }

    /**
     * Validate data
     */
    validate(data) {
        this.errors = [];
        this.warnings = [];
        this.data = data;
        this.validated = true;
        return this;
    }

    /**
     * Check if validation passed
     */
    isValid() {
        return this.errors.length === 0;
    }

    /**
     * Get validation errors
     */
    getErrors() {
        return this.errors;
    }

    /**
     * Get validation warnings
     */
    getWarnings() {
        return this.warnings;
    }

    /**
     * Add error
     */
    addError(field, message, code = null) {
        this.errors.push({
            field,
            message,
            code,
            timestamp: new Date().toISOString()
        });
    }

    /**
     * Add warning
     */
    addWarning(field, message, code = null) {
        this.warnings.push({
            field,
            message,
            code,
            timestamp: new Date().toISOString()
        });
    }

    /**
     * Require a field
     */
    required(value, field, message = null) {
        if (value === undefined || value === null || value === '') {
            this.addError(field, message || `${field} is required`);
            return false;
        }
        return true;
    }

    /**
     * Validate string length
     */
    minLength(value, field, min, message = null) {
        if (value && value.length < min) {
            this.addError(field, message || `${field} must be at least ${min} characters`);
            return false;
        }
        return true;
    }

    /**
     * Validate string max length
     */
    maxLength(value, field, max, message = null) {
        if (value && value.length > max) {
            this.addError(field, message || `${field} must be at most ${max} characters`);
            return false;
        }
        return true;
    }

    /**
     * Validate email format
     */
    email(value, field, message = null) {
        if (value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
            this.addError(field, message || `${field} must be a valid email`);
            return false;
        }
        return true;
    }

    /**
     * Validate number range
     */
    range(value, field, min, max, message = null) {
        if (value !== undefined && value !== null) {
            if (value < min || value > max) {
                this.addError(field, message || `${field} must be between ${min} and ${max}`);
                return false;
            }
        }
        return true;
    }

    /**
     * Validate pattern
     */
    pattern(value, field, pattern, message = null) {
        if (value && !pattern.test(value)) {
            this.addError(field, message || `${field} format is invalid`);
            return false;
        }
        return true;
    }

    /**
     * Validate enum
     */
    enum(value, field, allowed, message = null) {
        if (value && !allowed.includes(value)) {
            this.addError(field, message || `${field} must be one of: ${allowed.join(', ')}`);
            return false;
        }
        return true;
    }

    /**
     * Validate array
     */
    array(value, field, message = null) {
        if (value !== undefined && value !== null && !Array.isArray(value)) {
            this.addError(field, message || `${field} must be an array`);
            return false;
        }
        return true;
    }

    /**
     * Validate object
     */
    object(value, field, message = null) {
        if (value !== undefined && value !== null && typeof value !== 'object') {
            this.addError(field, message || `${field} must be an object`);
            return false;
        }
        return true;
    }

    /**
     * Validate boolean
     */
    boolean(value, field, message = null) {
        if (value !== undefined && value !== null && typeof value !== 'boolean') {
            this.addError(field, message || `${field} must be a boolean`);
            return false;
        }
        return true;
    }

    /**
     * Validate date
     */
    date(value, field, message = null) {
        if (value && isNaN(Date.parse(value))) {
            this.addError(field, message || `${field} must be a valid date`);
            return false;
        }
        return true;
    }

    /**
     * Validate future date
     */
    futureDate(value, field, message = null) {
        if (value && new Date(value) <= new Date()) {
            this.addError(field, message || `${field} must be a future date`);
            return false;
        }
        return true;
    }

    /**
     * Validate past date
     */
    pastDate(value, field, message = null) {
        if (value && new Date(value) >= new Date()) {
            this.addError(field, message || `${field} must be a past date`);
            return false;
        }
        return true;
    }

    /**
     * Validate positive number
     */
    positive(value, field, message = null) {
        if (value !== undefined && value !== null && value <= 0) {
            this.addError(field, message || `${field} must be a positive number`);
            return false;
        }
        return true;
    }

    /**
     * Validate non-negative number
     */
    nonNegative(value, field, message = null) {
        if (value !== undefined && value !== null && value < 0) {
            this.addError(field, message || `${field} must be non-negative`);
            return false;
        }
        return true;
    }

    /**
     * Validate integer
     */
    integer(value, field, message = null) {
        if (value !== undefined && value !== null && !Number.isInteger(value)) {
            this.addError(field, message || `${field} must be an integer`);
            return false;
        }
        return true;
    }

    /**
     * Validate URL
     */
    url(value, field, message = null) {
        if (value && !/^https?:\/\/[^\s]+$/.test(value)) {
            this.addError(field, message || `${field} must be a valid URL`);
            return false;
        }
        return true;
    }

    /**
     * Validate UUID
     */
    uuid(value, field, message = null) {
        if (value && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
            this.addError(field, message || `${field} must be a valid UUID`);
            return false;
        }
        return true;
    }

    /**
     * Validate phone number
     */
    phone(value, field, message = null) {
        if (value && !/^\+?[\d\s-]{10,15}$/.test(value)) {
            this.addError(field, message || `${field} must be a valid phone number`);
            return false;
        }
        return true;
    }

    /**
     * Throw validation error if invalid
     */
    throwIfInvalid() {
        if (!this.isValid()) {
            const error = new Error('Validation failed');
            error.errors = this.getErrors();
            throw error;
        }
    }

    /**
     * Get formatted result
     */
    getResult() {
        return {
            valid: this.isValid(),
            errors: this.getErrors(),
            warnings: this.getWarnings(),
            data: this.data
        };
    }

    /**
     * Reset validator
     */
    reset() {
        this.errors = [];
        this.warnings = [];
        this.data = null;
        this.validated = false;
        return this;
    }
}

module.exports = BaseValidator;