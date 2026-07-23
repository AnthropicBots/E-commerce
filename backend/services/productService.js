// backend/services/productService.js
const { productRepo } = require('../repositories');

class ProductService {
    /**
     * Get product by ID
     */
    async getProduct(id) {
        return productRepo.findWithReviews(id);
    }

    /**
     * Get products with filtering
     */
    async getProducts(filters = {}, options = {}) {
        const { category, minPrice, maxPrice, search } = filters;
        const { page = 1, limit = 20 } = options;

        let products;
        let total;

        if (search) {
            products = await productRepo.search(search, options);
            total = await productRepo.count({
                ...(category && { category }),
                ...(minPrice && { price: { $gte: minPrice } }),
                ...(maxPrice && { price: { $lte: maxPrice } })
            });
        } else if (category) {
            products = await productRepo.findByCategory(category, options);
            total = await productRepo.count({ category, stock: { $gt: 0 } });
        } else if (minPrice !== undefined || maxPrice !== undefined) {
            products = await productRepo.findByPriceRange(
                minPrice || 0,
                maxPrice || 999999,
                options
            );
            total = await productRepo.count({
                price: {
                    $gte: minPrice || 0,
                    $lte: maxPrice || 999999
                },
                stock: { $gt: 0 }
            });
        } else {
            products = await productRepo.findAll({ stock: { $gt: 0 } }, options);
            total = await productRepo.count({ stock: { $gt: 0 } });
        }

        return {
            products,
            pagination: {
                page,
                limit,
                total,
                pages: Math.ceil(total / limit)
            }
        };
    }

    /**
     * Create product
     */
    async createProduct(data) {
        return productRepo.create(data);
    }

    /**
     * Update product
     */
    async updateProduct(id, data) {
        return productRepo.update(id, data);
    }

    /**
     * Delete product
     */
    async deleteProduct(id) {
        return productRepo.delete(id);
    }

    /**
     * Update stock
     */
    async updateStock(id, quantity) {
        return productRepo.updateStock(id, quantity);
    }

    /**
     * Get related products
     */
    async getRelatedProducts(id, limit = 5) {
        return productRepo.getRelatedProducts(id, limit);
    }

    /**
     * Get low stock products
     */
    async getLowStock(threshold = 10) {
        return productRepo.getLowStockProducts(threshold);
    }
}

module.exports = new ProductService();