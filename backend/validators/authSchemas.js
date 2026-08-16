// backend/validators/authSchemas.js
const Joi = require("joi");

const login = Joi.object({
    email: Joi.string().email().required().messages({
        "string.email": "Invalid email format",
        "any.required": "Email is required"
    }),
    password: Joi.string().required().messages({
        "any.required": "Password is required"
    })
});

const signup = Joi.object({
    name: Joi.string().min(2).max(100).required().messages({
        "string.min": "Name must be at least 2 characters long",
        "any.required": "Name is required"
    }),
    email: Joi.string().email().required().messages({
        "string.email": "Invalid email format",
        "any.required": "Email is required"
    }),
    password: Joi.string().min(6).max(100).required().messages({
        "string.min": "Password must be at least 6 characters long",
        "any.required": "Password is required"
    }),
    age: Joi.number().integer().min(18).max(100).optional().messages({
        "number.min": "Age must be between 18 and 100",
        "number.max": "Age must be between 18 and 100"
    })
});

const forgotPassword = Joi.object({
    email: Joi.string().email().required().messages({
        "string.email": "Invalid email format",
        "any.required": "Email is required"
    })
});

const resetPassword = Joi.object({
    userId: Joi.alternatives().try(Joi.number(), Joi.string()).required().messages({
        "any.required": "User ID is required"
    }),
    otp: Joi.string().length(6).required().messages({
        "string.length": "OTP must be 6 digits",
        "any.required": "OTP is required"
    }),
    newPassword: Joi.string().min(6).max(100).required().messages({
        "string.min": "New password must be at least 6 characters long",
        "any.required": "New password is required"
    })
});

const refreshToken = Joi.object({
    refreshToken: Joi.string().required().messages({
        "any.required": "Refresh token is required"
    })
});

module.exports = {
    login,
    signup,
    forgotPassword,
    resetPassword,
    refreshToken
};
