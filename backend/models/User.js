/**
 * User Model with Comprehensive Security Features
 * @module models/User
 */

const bcrypt = require("bcryptjs");
const logger = require("../utils/logger");

const VALID_ROLES = ['user', 'admin', 'superadmin', 'moderator'];
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION = 15 * 60 * 1000; // 15 minutes
const PASSWORD_HISTORY_LIMIT = 3;

class User {
    constructor(user) {
        // Sanitize inputs
        const sanitizedEmail = this.sanitizeEmail(user.email);
        const sanitizedName = this.sanitizeName(user.name);

        // Validate required fields
        if (!sanitizedName || sanitizedName.length < 2) {
            throw new Error('Name must be at least 2 characters long');
        }

        if (!this.isValidEmail(sanitizedEmail)) {
            throw new Error('Invalid email format');
        }

        // Validate password with enhanced security
        if (user.password && !this.isValidPassword(user.password)) {
            throw new Error(
                'Password must be at least 8 characters and contain ' +
                'uppercase, lowercase, number, and special character (@$!%*?&)'
            );
        }

        // Validate role
        const role = user.role || 'user';
        if (!this.isValidRole(role)) {
            throw new Error(`Invalid role. Allowed roles: ${VALID_ROLES.join(', ')}`);
        }

        // Assign properties
        this.id = user.id;
        this.name = sanitizedName;
        this.email = sanitizedEmail;
        this.password = user.password; // Will be hashed before storage
        this.role = role;
        this.isActive = user.isActive !== undefined ? user.isActive : true;
        this.isVerified = user.isVerified !== undefined ? user.isVerified : false;
        this.isEmailVerified = user.isEmailVerified !== undefined ? user.isEmailVerified : false;
        
        // Security fields
        this.failedLoginAttempts = user.failedLoginAttempts || 0;
        this.lockoutUntil = user.lockoutUntil || null;
        this.lastLogin = user.lastLogin || null;
        this.deletedAt = user.deletedAt || null;
        this.deleteReason = user.deleteReason || null;
        
        // 2FA fields
        this.totpSecret = user.totpSecret || null;
        this.is2faEnabled = user.is2faEnabled !== undefined ? user.is2faEnabled : false;
        
        this.createdAt = user.createdAt || new Date();
        this.updatedAt = user.updatedAt || new Date();
    }

    // ==================== VALIDATION METHODS ====================

    /**
     * Validate email format
     * @param {string} email - Email to validate
     * @returns {boolean} True if valid
     */
    isValidEmail(email) {
        const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
        return emailRegex.test(email);
    }

    /**
     * Validate password strength - Enhanced security
     * Requires: min 8 chars, uppercase, lowercase, number, special char
     * @param {string} password - Password to validate
     * @returns {boolean} True if valid
     */
    isValidPassword(password) {
        if (!password || password.length < 8) return false;
        
        // At least one uppercase, one lowercase, one number, one special character
        const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
        return passwordRegex.test(password);
    }

    /**
     * Validate user role
     * @param {string} role - Role to validate
     * @returns {boolean} True if valid
     */
    isValidRole(role) {
        return VALID_ROLES.includes(role);
    }

    /**
     * Check if account is locked
     * @returns {boolean} True if account is locked
     */
    isAccountLocked() {
        if (!this.lockoutUntil) return false;
        return new Date(this.lockoutUntil) > new Date();
    }

    /**
     * Get remaining lockout time in minutes
     * @returns {number} Minutes remaining (0 if not locked)
     */
    getLockoutRemainingMinutes() {
        if (!this.lockoutUntil) return 0;
        const remaining = new Date(this.lockoutUntil) - new Date();
        return Math.max(0, Math.ceil(remaining / 60000));
    }

    // ==================== SANITIZATION METHODS ====================

    /**
     * Sanitize email - trim and lowercase
     * @param {string} email - Email to sanitize
     * @returns {string} Sanitized email
     */
    sanitizeEmail(email) {
        if (!email) return '';
        return email.trim().toLowerCase();
    }

    /**
     * Sanitize name - trim and remove extra spaces
     * @param {string} name - Name to sanitize
     * @returns {string} Sanitized name
     */
    sanitizeName(name) {
        if (!name) return '';
        return name.trim().replace(/\s+/g, ' ');
    }

    // ==================== PASSWORD METHODS ====================

    /**
     * Hash password using bcrypt
     * @param {string} password - Plain text password
     * @returns {Promise<string>} Hashed password
     */
    static async hashPassword(password) {
        const salt = await bcrypt.genSalt(10);
        return await bcrypt.hash(password, salt);
    }

    /**
     * Compare plain password with hashed password
     * @param {string} plainPassword - Plain text password
     * @param {string} hashedPassword - Hashed password
     * @returns {Promise<boolean>} True if match
     */
    static async comparePassword(plainPassword, hashedPassword) {
        return await bcrypt.compare(plainPassword, hashedPassword);
    }

    // ==================== SECURITY METHODS ====================

    /**
     * Increment failed login attempts
     * @returns {User} Updated user instance
     */
    incrementFailedAttempts() {
        this.failedLoginAttempts += 1;
        
        // Lock account if max attempts exceeded
        if (this.failedLoginAttempts >= MAX_FAILED_ATTEMPTS) {
            this.lockoutUntil = new Date(Date.now() + LOCKOUT_DURATION);
            logger.warn("Account locked due to multiple failed attempts", {
                userId: this.id,
                email: this.email,
                attempts: this.failedLoginAttempts,
                lockoutUntil: this.lockoutUntil
            });
        }
        
        this.updatedAt = new Date();
        return this;
    }

    /**
     * Reset failed login attempts (on successful login)
     * @returns {User} Updated user instance
     */
    resetFailedAttempts() {
        this.failedLoginAttempts = 0;
        this.lockoutUntil = null;
        this.updatedAt = new Date();
        return this;
    }

    /**
     * Update last login timestamp
     * @param {string} ip - IP address
     * @param {string} userAgent - User agent
     * @returns {User} Updated user instance
     */
    updateLastLogin(ip, userAgent) {
        this.lastLogin = new Date();
        this.updatedAt = new Date();
        
        logger.info("User logged in", {
            userId: this.id,
            email: this.email,
            ip,
            userAgent
        });
        
        return this;
    }

    // ==================== TOKEN METHODS ====================

    /**
     * Generate refresh token for user
     * @param {string} refreshToken - Refresh token
     * @param {string} ip - IP address
     * @param {string} userAgent - User agent
     * @returns {Object} Token data
     */
    generateRefreshToken(refreshToken, ip, userAgent) {
        return {
            userId: this.id,
            token: refreshToken,
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
            ipAddress: ip,
            userAgent: userAgent,
            isRevoked: false
        };
    }

    // ==================== PASSWORD HISTORY ====================

    /**
     * Check if password was used before (prevent reuse)
     * @param {string} newPassword - New password to check
     * @param {Array} passwordHistory - Array of previous password hashes
     * @returns {Promise<boolean>} True if password was used before
     */
    static async isPasswordReused(newPassword, passwordHistory) {
        for (const history of passwordHistory) {
            const isMatch = await bcrypt.compare(newPassword, history.password_hash);
            if (isMatch) return true;
        }
        return false;
    }

    // ==================== CONVERSION METHODS ====================

    /**
     * Convert to JSON - Exclude sensitive data
     * @returns {Object} User object without sensitive data
     */
    toJSON() {
        return {
            id: this.id,
            name: this.name,
            email: this.email,
            role: this.role,
            isActive: this.isActive,
            isVerified: this.isVerified,
            isEmailVerified: this.isEmailVerified,
            is2faEnabled: this.is2faEnabled,
            lastLogin: this.lastLogin,
            createdAt: this.createdAt,
            updatedAt: this.updatedAt
        };
    }

    /**
     * Convert to JSON with security info
     * @returns {Object} User object with security info
     */
    toSecurityJSON() {
        return {
            ...this.toJSON(),
            failedLoginAttempts: this.failedLoginAttempts,
            isLocked: this.isAccountLocked(),
            lockoutRemainingMinutes: this.getLockoutRemainingMinutes()
        };
    }

    // ==================== UPDATE METHODS ====================

    /**
     * Safe update user data
     * @param {Object} updates - Fields to update
     * @returns {User} Updated user instance
     */
    update(updates) {
        const allowedFields = ['name', 'email', 'password', 'role', 'isActive', 'isVerified', 'isEmailVerified'];

        Object.keys(updates).forEach(key => {
            if (!allowedFields.includes(key)) {
                throw new Error(`Field '${key}' cannot be updated`);
            }
        });

        // Sanitize and validate before update
        if (updates.name) {
            updates.name = this.sanitizeName(updates.name);
            if (updates.name.length < 2) {
                throw new Error('Name must be at least 2 characters long');
            }
        }

        if (updates.email) {
            updates.email = this.sanitizeEmail(updates.email);
            if (!this.isValidEmail(updates.email)) {
                throw new Error('Invalid email format');
            }
        }

        if (updates.password) {
            if (!this.isValidPassword(updates.password)) {
                throw new Error(
                    'Password must be at least 8 characters and contain ' +
                    'uppercase, lowercase, number, and special character (@$!%*?&)'
                );
            }
        }

        if (updates.role) {
            if (!this.isValidRole(updates.role)) {
                throw new Error(`Invalid role. Allowed roles: ${VALID_ROLES.join(', ')}`);
            }
        }

        // Apply updates
        if (updates.name) this.name = updates.name;
        if (updates.email) this.email = updates.email;
        if (updates.password) this.password = updates.password;
        if (updates.role) this.role = updates.role;
        if (updates.isActive !== undefined) this.isActive = updates.isActive;
        if (updates.isVerified !== undefined) this.isVerified = updates.isVerified;
        if (updates.isEmailVerified !== undefined) this.isEmailVerified = updates.isEmailVerified;

        this.updatedAt = new Date();
        return this;
    }

    /**
     * Soft delete user
     * @param {string} reason - Reason for deletion
     * @returns {User} Updated user instance
     */
    softDelete(reason) {
        this.isActive = false;
        this.deletedAt = new Date();
        this.deleteReason = reason || 'No reason provided';
        this.updatedAt = new Date();
        
        logger.info("User soft deleted", {
            userId: this.id,
            email: this.email,
            reason: this.deleteReason
        });
        
        return this;
    }

    /**
     * Restore soft deleted user
     * @returns {User} Updated user instance
     */
    restore() {
        this.isActive = true;
        this.deletedAt = null;
        this.deleteReason = null;
        this.updatedAt = new Date();
        
        logger.info("User restored", {
            userId: this.id,
            email: this.email
        });
        
        return this;
    }

    // ==================== STATUS METHODS ====================

    /**
     * Check if user is active (active + verified)
     * @returns {boolean} True if active and verified
     */
    isActiveUser() {
        return this.isActive === true && this.isVerified === true;
    }

    /**
     * Check if user is admin
     * @returns {boolean} True if admin
     */
    isAdmin() {
        return this.role === 'admin' || this.role === 'superadmin';
    }

    /**
     * Check if user has admin or moderator role
     * @returns {boolean} True if admin or moderator
     */
    isStaff() {
        return ['admin', 'superadmin', 'moderator'].includes(this.role);
    }

    /**
     * Check if user is superadmin
     * @returns {boolean} True if superadmin
     */
    isSuperAdmin() {
        return this.role === 'superadmin';
    }

    /**
     * Check if user is moderator
     * @returns {boolean} True if moderator
     */
    isModerator() {
        return this.role === 'moderator';
    }

    /**
     * Check if user is deleted
     * @returns {boolean} True if deleted
     */
    isDeleted() {
        return this.deletedAt !== null;
    }

    // ==================== STATIC METHODS ====================

    /**
     * Get all valid roles
     * @returns {Array} List of valid roles
     */
    static getValidRoles() {
        return [...VALID_ROLES];
    }

    /**
     * Check if a role is valid
     * @param {string} role - Role to check
     * @returns {boolean} True if valid
     */
    static isValidRoleStatic(role) {
        return VALID_ROLES.includes(role);
    }

    /**
     * Get password complexity requirements
     * @returns {Object} Password requirements
     */
    static getPasswordRequirements() {
        return {
            minLength: 8,
            requiresUppercase: true,
            requiresLowercase: true,
            requiresNumber: true,
            requiresSpecialChar: true,
            specialChars: '@$!%*?&',
            maxFailedAttempts: MAX_FAILED_ATTEMPTS,
            lockoutDurationMinutes: LOCKOUT_DURATION / 60000,
            passwordHistoryLimit: PASSWORD_HISTORY_LIMIT
        };
    }

    /**
     * Validate password against requirements (static version)
     * @param {string} password - Password to validate
     * @returns {Object} { valid: boolean, errors: string[] }
     */
    static validatePasswordStrength(password) {
        const errors = [];
        
        if (!password || password.length < 8) {
            errors.push('Password must be at least 8 characters long');
        }
        if (!/[A-Z]/.test(password)) {
            errors.push('Password must contain at least one uppercase letter');
        }
        if (!/[a-z]/.test(password)) {
            errors.push('Password must contain at least one lowercase letter');
        }
        if (!/\d/.test(password)) {
            errors.push('Password must contain at least one number');
        }
        if (!/[@$!%*?&]/.test(password)) {
            errors.push('Password must contain at least one special character (@$!%*?&)');
        }
        
        return {
            valid: errors.length === 0,
            errors
        };
    }
}

module.exports = User;