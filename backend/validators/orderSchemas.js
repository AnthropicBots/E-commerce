// backend/validators/orderSchemas.js
const Joi = require("joi");

const orderItemSchema = Joi.object({
    productId: Joi.alternatives().try(Joi.string(), Joi.number()).required().messages({
        "any.required": "Product ID is required for each order item"
    }),
    quantity: Joi.number().integer().min(1).required().messages({
        "number.min": "Quantity must be at least 1",
        "any.required": "Quantity is required for each order item"
    }),
    price: Joi.number().positive().optional()
});

const createOrder = Joi.object({
    items: Joi.array().items(orderItemSchema).min(1).required().messages({
        "array.min": "Order must contain at least one item",
        "any.required": "Order items are required"
    }),
    shippingAddress: Joi.object({
        street: Joi.string().optional(),
        city: Joi.string().optional(),
        state: Joi.string().optional(),
        zipCode: Joi.string().optional(),
        country: Joi.string().optional()
    }).optional(),
    paymentMethod: Joi.string().optional()
});

const updateOrder = Joi.object({
    status: Joi.string().valid("pending", "processing", "shipped", "delivered", "cancelled").optional(),
    trackingNumber: Joi.string().optional()
});

module.exports = {
    createOrder,
    updateOrder,
    orderItemSchema
};
