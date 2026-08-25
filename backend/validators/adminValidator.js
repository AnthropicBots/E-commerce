const Joi = require('joi');

const validateBody = (schema) => (req, res, next) => {
    const { error, value } = schema.validate(req.body, { 
        stripUnknown: true, 
        abortEarly: false 
    });
    
    if (error) {
        return res.status(400).json({ 
            success: false, 
            message: "Validation error", 
            errors: error.details.map(err => err.message) 
        });
    }
    
    // Assign validated and stripped value back to req.body. 
    // This removes any prototype pollution vectors.
    req.body = value;
    next();
};

const updateUserStatusSchema = Joi.object({
    status: Joi.string().valid('active', 'blocked', 'deactivated').required()
});

const bulkUpdateUserStatusSchema = Joi.object({
    userIds: Joi.array().items(Joi.string().uuid()).min(1).required(),
    status: Joi.string().valid('active', 'blocked', 'deactivated').required()
});

const updateUserRoleSchema = Joi.object({
    role: Joi.string().valid('user', 'admin', 'moderator').required()
});

const bulkUpdateUserRoleSchema = Joi.object({
    userIds: Joi.array().items(Joi.string().uuid()).min(1).required(),
    role: Joi.string().valid('user', 'admin', 'moderator').required()
});

const deleteUserSchema = Joi.object({
    permanent: Joi.boolean().optional(),
    reason: Joi.string().allow('').optional()
});

const verifyUserEmailSchema = Joi.object({
    email: Joi.string().email().optional(),
    userId: Joi.string().uuid().optional()
}).or('email', 'userId');

module.exports = {
    validateUpdateUserStatus: validateBody(updateUserStatusSchema),
    validateBulkUpdateUserStatus: validateBody(bulkUpdateUserStatusSchema),
    validateUpdateUserRole: validateBody(updateUserRoleSchema),
    validateBulkUpdateUserRole: validateBody(bulkUpdateUserRoleSchema),
    validateDeleteUser: validateBody(deleteUserSchema),
    validateVerifyUserEmail: validateBody(verifyUserEmailSchema)
};
