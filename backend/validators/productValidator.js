// backend/validators/productValidator.js
const BaseValidator = require('./baseValidator');

class ProductValidator extends BaseValidator {
    /**
     * Validate product creation
     */
    validateCreate(data) {
        this.validate(data);

        this.required(data.name, 'name');
        this.minLength(data.name, 'name', 3);
        this.maxLength(data.name, 'name', 255);

        this.required(data.price, 'price');
        this.positive(data.price, 'price');

        if (data.description) {
            this.maxLength(data.description, 'description', 5000);
        }

        if (data.category) {
            this.maxLength(data.category, 'category', 100);
        }

        if (data.stock !== undefined) {
            this.nonNegative(data.stock, 'stock');
            this.integer(data.stock, 'stock');
        }

        if (data.sku) {
            this.maxLength(data.sku, 'sku', 50);
            this.pattern(data.sku, 'sku', /^[A-Z0-9-]+$/);
        }

        if (data.images) {
            this.array(data.images, 'images');
            if (Array.isArray(data.images)) {
                for (let i = 0; i < data.images.length; i++) {
                    this.url(data.images[i], `images[${i}]`);
                }
            }
        }

        return this;
    }

    /**
     * Validate product update
     */
    validateUpdate(data) {
        this.validate(data);

        const hasFields = Object.keys(data).some(key => 
            key !== 'id' && data[key] !== undefined
        );

        if (!hasFields) {
            this.addError('update', 'At least one field must be provided for update');
        }

        if (data.name !== undefined) {
            this.minLength(data.name, 'name', 3);
            this.maxLength(data.name, 'name', 255);
        }

        if (data.price !== undefined) {
            this.positive(data.price, 'price');
        }

        if (data.stock !== undefined) {
            this.nonNegative(data.stock, 'stock');
            this.integer(data.stock, 'stock');
        }

        return this;
    }

    /**
     * Validate stock update
     */
    validateStockUpdate(data) {
        this.validate(data);

        this.required(data.quantity, 'quantity');
        this.integer(data.quantity, 'quantity');
        this.required(data.reason, 'reason');

        return this;
    }

    /**
     * Validate price update
     */
    validatePriceUpdate(data) {
        this.validate(data);

        this.required(data.newPrice, 'newPrice');
        this.positive(data.newPrice, 'newPrice');
        this.required(data.reason, 'reason');

        if (data.oldPrice !== undefined) {
            this.positive(data.oldPrice, 'oldPrice');
        }

        return this;
    }
}

module.exports = new ProductValidator();