// backend/validators/orderValidator.js
const BaseValidator = require('./baseValidator');

class OrderValidator extends BaseValidator {
    /**
     * Validate order creation
     */
    validateCreate(data) {
        this.validate(data);

        // Check required fields
        this.required(data.userId, 'userId');
        this.required(data.items, 'items');
        this.array(data.items, 'items');
        this.required(data.shippingAddress, 'shippingAddress');

        // Validate each item
        if (data.items && Array.isArray(data.items)) {
            for (let i = 0; i < data.items.length; i++) {
                const item = data.items[i];
                this.required(item.productId, `items[${i}].productId`);
                this.required(item.quantity, `items[${i}].quantity`);
                this.positive(item.quantity, `items[${i}].quantity`);
                this.integer(item.quantity, `items[${i}].quantity`);
                this.required(item.price, `items[${i}].price`);
                this.positive(item.price, `items[${i}].price`);
            }
        }

        // Validate shipping address
        if (data.shippingAddress) {
            const address = data.shippingAddress;
            this.required(address.street, 'shippingAddress.street');
            this.required(address.city, 'shippingAddress.city');
            this.required(address.state, 'shippingAddress.state');
            this.required(address.zipCode, 'shippingAddress.zipCode');
            this.required(address.country, 'shippingAddress.country');
            this.pattern(address.zipCode, 'shippingAddress.zipCode', /^[0-9]{5,6}$/);
        }

        // Validate payment method
        if (data.paymentMethod) {
            this.enum(data.paymentMethod, 'paymentMethod', ['card', 'upi', 'netbanking', 'cod']);
        }

        // Validate total
        if (data.total !== undefined) {
            this.positive(data.total, 'total');
        }

        return this;
    }

    /**
     * Validate order update
     */
    validateUpdate(data) {
        this.validate(data);

        // Check at least one field to update
        const hasFields = Object.keys(data).some(key => 
            key !== 'id' && key !== 'userId' && data[key] !== undefined
        );

        if (!hasFields) {
            this.addError('update', 'At least one field must be provided for update');
        }

        // Validate status if provided
        if (data.status !== undefined) {
            this.enum(data.status, 'status', ['pending', 'processing', 'shipped', 'delivered', 'cancelled']);
        }

        // Validate items if provided
        if (data.items !== undefined) {
            this.array(data.items, 'items');
            if (Array.isArray(data.items)) {
                for (let i = 0; i < data.items.length; i++) {
                    const item = data.items[i];
                    if (item.productId) {
                        this.required(item.productId, `items[${i}].productId`);
                    }
                    if (item.quantity !== undefined) {
                        this.positive(item.quantity, `items[${i}].quantity`);
                        this.integer(item.quantity, `items[${i}].quantity`);
                    }
                }
            }
        }

        return this;
    }

    /**
     * Validate order cancellation
     */
    validateCancel(data) {
        this.validate(data);

        this.required(data.reason, 'reason');
        this.minLength(data.reason, 'reason', 3);
        this.maxLength(data.reason, 'reason', 500);

        return this;
    }

    /**
     * Validate order status transition
     */
    validateStatusTransition(currentStatus, newStatus) {
        const validTransitions = {
            pending: ['processing', 'cancelled'],
            processing: ['shipped', 'cancelled'],
            shipped: ['delivered', 'cancelled'],
            delivered: [],
            cancelled: []
        };

        const allowed = validTransitions[currentStatus] || [];
        if (!allowed.includes(newStatus)) {
            this.addError(
                'status',
                `Cannot transition from ${currentStatus} to ${newStatus}`,
                'INVALID_STATUS_TRANSITION'
            );
        }

        return this;
    }

    /**
     * Validate payment confirmation
     */
    validatePayment(data) {
        this.validate(data);

        this.required(data.paymentId, 'paymentId');
        this.required(data.paymentMethod, 'paymentMethod');
        this.required(data.amount, 'amount');
        this.positive(data.amount, 'amount');

        this.enum(data.paymentMethod, 'paymentMethod', ['card', 'upi', 'netbanking', 'cod']);

        return this;
    }
}

module.exports = new OrderValidator();