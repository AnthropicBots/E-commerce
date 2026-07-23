const Joi = require("joi");

// ============ ERROR CODES ============
const VALIDATION_ERROR_CODES = {
    INVALID_STATUS: 'INVALID_STATUS_VALUE',
    INVALID_USER_IDS: 'INVALID_USER_IDS_FORMAT',
    EMPTY_USER_IDS: 'EMPTY_USER_IDS_ARRAY',
    TOO_MANY_USERS: 'TOO_MANY_USERS_REQUESTED',
    INVALID_EMAIL: 'INVALID_EMAIL_FORMAT',
    INVALID_ROLE: 'INVALID_ROLE_VALUE'
};

// ============ VALIDATION SCHEMAS ============

// 1. Single user status update
const updateUserStatusSchema = Joi.object({
    status: Joi.string()
        .valid("active", "blocked", "inactive")
        .required()
        .messages({
            'any.required': 'Status is required',
            'any.only': 'Status must be one of: active, blocked, inactive',
            'string.base': 'Status must be a string'
        }),
    // Optional: Add user ID validation if needed
    userId: Joi.string()
        .optional()
        .pattern(/^[0-9a-fA-F]{24}$/) // For MongoDB ObjectId
        .messages({
            'string.pattern.base': 'Invalid user ID format'
        })
});

// 2. Bulk user status update
const bulkUpdateUserStatusSchema = Joi.object({
    userIds: Joi.array()
        .items(
            Joi.string()
                .required()
                .pattern(/^[0-9a-fA-F]{24}$/) // For MongoDB ObjectId
                .messages({
                    'string.pattern.base': 'Each user ID must be a valid format'
                })
        )
        .min(1)
        .max(50)
        .required()
        .messages({
            'any.required': 'User IDs array is required',
            'array.min': 'At least 1 user ID is required',
            'array.max': 'Cannot update more than 50 users at once',
            'array.base': 'User IDs must be an array'
        }),
    status: Joi.string()
        .valid("active", "blocked", "inactive")
        .required()
        .messages({
            'any.required': 'Status is required',
            'any.only': 'Status must be one of: active, blocked, inactive',
            'string.base': 'Status must be a string'
        })
});

// 3. New: Update user role validation
const updateUserRoleSchema = Joi.object({
    role: Joi.string()
        .valid("user", "admin", "superadmin", "moderator")
        .required()
        .messages({
            'any.required': 'Role is required',
            'any.only': 'Role must be one of: user, admin, superadmin, moderator',
            'string.base': 'Role must be a string'
        }),
    userId: Joi.string()
        .required()
        .pattern(/^[0-9a-fA-F]{24}$/)
        .messages({
            'any.required': 'User ID is required',
            'string.pattern.base': 'Invalid user ID format'
        })
});

// 4. New: Bulk user role update
const bulkUpdateUserRoleSchema = Joi.object({
    userIds: Joi.array()
        .items(
            Joi.string()
                .required()
                .pattern(/^[0-9a-fA-F]{24}$/)
        )
        .min(1)
        .max(30)
        .required()
        .messages({
            'any.required': 'User IDs array is required',
            'array.min': 'At least 1 user ID is required',
            'array.max': 'Cannot update more than 30 users at once'
        }),
    role: Joi.string()
        .valid("user", "admin", "moderator")
        .required()
        .messages({
            'any.required': 'Role is required',
            'any.only': 'Role must be one of: user, admin, moderator'
        })
});

// 5. New: Email verification validation
const emailVerificationSchema = Joi.object({
    email: Joi.string()
        .email()
        .required()
        .messages({
            'any.required': 'Email is required',
            'string.email': 'Please provide a valid email address',
            'string.base': 'Email must be a string'
        }),
    userId: Joi.string()
        .optional()
        .pattern(/^[0-9a-fA-F]{24}$/)
        .messages({
            'string.pattern.base': 'Invalid user ID format'
        })
});

// 6. New: Account status filter validation
const accountStatusFilterSchema = Joi.object({
    status: Joi.string()
        .valid("active", "blocked", "inactive", "pending", "all")
        .default("all")
        .messages({
            'any.only': 'Status must be one of: active, blocked, inactive, pending, all'
        }),
    page: Joi.number()
        .integer()
        .min(1)
        .default(1)
        .messages({
            'number.base': 'Page must be a number',
            'number.min': 'Page must be at least 1',
            'number.integer': 'Page must be an integer'
        }),
    limit: Joi.number()
        .integer()
        .min(1)
        .max(100)
        .default(10)
        .messages({
            'number.base': 'Limit must be a number',
            'number.min': 'Limit must be at least 1',
            'number.max': 'Limit cannot exceed 100',
            'number.integer': 'Limit must be an integer'
        }),
    search: Joi.string()
        .optional()
        .allow('')
        .max(100)
        .messages({
            'string.max': 'Search query cannot exceed 100 characters'
        })
});

// 7. New: User deletion validation
const deleteUserSchema = Joi.object({
    userId: Joi.string()
        .required()
        .pattern(/^[0-9a-fA-F]{24}$/)
        .messages({
            'any.required': 'User ID is required',
            'string.pattern.base': 'Invalid user ID format'
        }),
    reason: Joi.string()
        .optional()
        .max(500)
        .messages({
            'string.max': 'Reason cannot exceed 500 characters'
        }),
    permanent: Joi.boolean()
        .default(false)
        .messages({
            'boolean.base': 'Permanent must be a boolean value'
        })
});

// 8. New: Admin permissions validation
const adminPermissionsSchema = Joi.object({
    userId: Joi.string()
        .required()
        .pattern(/^[0-9a-fA-F]{24}$/)
        .messages({
            'any.required': 'User ID is required',
            'string.pattern.base': 'Invalid user ID format'
        }),
    permissions: Joi.array()
        .items(
            Joi.string().valid(
                'manage_users',
                'manage_products',
                'manage_orders',
                'manage_payments',
                'view_reports',
                'manage_admins',
                'manage_settings'
            )
        )
        .min(1)
        .required()
        .messages({
            'any.required': 'Permissions array is required',
            'array.min': 'At least 1 permission is required',
            'array.base': 'Permissions must be an array'
        })
});

// ============ EXPORT ============
module.exports = {
    // Existing
    updateUserStatusSchema,
    bulkUpdateUserStatusSchema,
    
    // New schemas
    updateUserRoleSchema,
    bulkUpdateUserRoleSchema,
    emailVerificationSchema,
    accountStatusFilterSchema,
    deleteUserSchema,
    adminPermissionsSchema,
    
    // Export error codes
    VALIDATION_ERROR_CODES
};