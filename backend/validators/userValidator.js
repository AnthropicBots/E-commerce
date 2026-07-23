// backend/validators/userValidator.js
const BaseValidator = require('./baseValidator');

class UserValidator extends BaseValidator {
    /**
     * Validate user registration
     */
    validateRegister(data) {
        this.validate(data);

        this.required(data.name, 'name');
        this.minLength(data.name, 'name', 2);
        this.maxLength(data.name, 'name', 100);

        this.required(data.email, 'email');
        this.email(data.email, 'email');

        this.required(data.password, 'password');
        this.minLength(data.password, 'password', 6);
        this.maxLength(data.password, 'password', 100);

        // Optional fields
        if (data.phone) {
            this.phone(data.phone, 'phone');
        }

        if (data.role) {
            this.enum(data.role, 'role', ['user', 'admin', 'moderator']);
        }

        return this;
    }

    /**
     * Validate user login
     */
    validateLogin(data) {
        this.validate(data);

        this.required(data.email, 'email');
        this.email(data.email, 'email');

        this.required(data.password, 'password');

        return this;
    }

    /**
     * Validate user update
     */
    validateUpdate(data) {
        this.validate(data);

        if (data.name !== undefined) {
            this.minLength(data.name, 'name', 2);
            this.maxLength(data.name, 'name', 100);
        }

        if (data.email !== undefined) {
            this.email(data.email, 'email');
        }

        if (data.phone !== undefined) {
            this.phone(data.phone, 'phone');
        }

        if (data.role !== undefined) {
            this.enum(data.role, 'role', ['user', 'admin', 'moderator']);
        }

        if (data.status !== undefined) {
            this.enum(data.status, 'status', ['active', 'inactive', 'suspended']);
        }

        return this;
    }

    /**
     * Validate password change
     */
    validatePasswordChange(data) {
        this.validate(data);

        this.required(data.currentPassword, 'currentPassword');
        this.required(data.newPassword, 'newPassword');
        this.minLength(data.newPassword, 'newPassword', 6);
        this.maxLength(data.newPassword, 'newPassword', 100);

        if (data.newPassword === data.currentPassword) {
            this.addError('newPassword', 'New password must be different from current password');
        }

        return this;
    }

    /**
     * Validate password reset
     */
    validatePasswordReset(data) {
        this.validate(data);

        this.required(data.email, 'email');
        this.email(data.email, 'email');

        return this;
    }

    /**
     * Validate email verification
     */
    validateEmailVerification(data) {
        this.validate(data);

        this.required(data.token, 'token');
        this.uuid(data.token, 'token');

        return this;
    }
}

module.exports = new UserValidator();