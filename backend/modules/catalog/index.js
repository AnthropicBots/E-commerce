// backend/modules/catalog/index.js
const { AggregateRoot, DomainEventBus, Repository } = require('../core');

// ============================================
// CATALOG MODULE - Bounded Context
// ============================================

/**
 * Product Entity
 */
class Product extends AggregateRoot {
    constructor(data) {
        super();
        this.id = data.id;
        this.name = data.name;
        this.description = data.description;
        this.price = data.price;
        this.category = data.category;
        this.stock = data.stock;
        this.sku = data.sku;
        this.images = data.images || [];
        this.attributes = data.attributes || {};
        this.status = data.status || 'active';
        this.createdAt = data.createdAt || new Date().toISOString();
        this.updatedAt = data.updatedAt || new Date().toISOString();
    }

    /**
     * Update product price
     */
    updatePrice(newPrice, reason) {
        if (newPrice < 0) {
            throw new Error('Price cannot be negative');
        }

        const oldPrice = this.price;
        this.price = newPrice;
        this.updatedAt = new Date().toISOString();

        this.addDomainEvent('product.price.updated', {
            productId: this.id,
            oldPrice,
            newPrice,
            reason
        });
    }

    /**
     * Update stock
     */
    updateStock(quantity, reason) {
        if (this.stock + quantity < 0) {
            throw new Error('Insufficient stock');
        }

        const oldStock = this.stock;
        this.stock += quantity;
        this.updatedAt = new Date().toISOString();

        this.addDomainEvent('product.stock.updated', {
            productId: this.id,
            oldStock,
            newStock: this.stock,
            quantity,
            reason
        });
    }

    /**
     * Deactivate product
     */
    deactivate(reason) {
        this.status = 'inactive';
        this.updatedAt = new Date().toISOString();

        this.addDomainEvent('product.deactivated', {
            productId: this.id,
            reason
        });
    }

    /**
     * Activate product
     */
    activate() {
        this.status = 'active';
        this.updatedAt = new Date().toISOString();

        this.addDomainEvent('product.activated', {
            productId: this.id
        });
    }
}

/**
 * Category Entity
 */
class Category extends AggregateRoot {
    constructor(data) {
        super();
        this.id = data.id;
        this.name = data.name;
        this.description = data.description;
        this.parentId = data.parentId || null;
        this.slug = data.slug;
        this.productCount = data.productCount || 0;
        this.createdAt = data.createdAt || new Date().toISOString();
        this.updatedAt = data.updatedAt || new Date().toISOString();
    }

    /**
     * Update category
     */
    update(data) {
        if (data.name) this.name = data.name;
        if (data.description) this.description = data.description;
        if (data.parentId !== undefined) this.parentId = data.parentId;
        this.updatedAt = new Date().toISOString();

        this.addDomainEvent('category.updated', {
            categoryId: this.id,
            changes: data
        });
    }
}

/**
 * Product Repository
 */
class ProductRepository extends Repository {
    constructor(db) {
        super(db, 'products', Product);
    }

    /**
     * Find by category
     */
    async findByCategory(categoryId) {
        const [results] = await this.db.query(
            'SELECT * FROM products WHERE category_id = ? AND status = "active"',
            [categoryId]
        );
        return results.map(r => new Product(r));
    }

    /**
     * Find by price range
     */
    async findByPriceRange(minPrice, maxPrice) {
        const [results] = await this.db.query(
            'SELECT * FROM products WHERE price BETWEEN ? AND ? AND status = "active"',
            [minPrice, maxPrice]
        );
        return results.map(r => new Product(r));
    }

    /**
     * Search products
     */
    async search(query) {
        const [results] = await this.db.query(
            `SELECT * FROM products 
             WHERE (name LIKE ? OR description LIKE ?) 
             AND status = "active"`,
            [`%${query}%`, `%${query}%`]
        );
        return results.map(r => new Product(r));
    }
}

/**
 * Category Repository
 */
class CategoryRepository extends Repository {
    constructor(db) {
        super(db, 'categories', Category);
    }

    /**
     * Find by parent
     */
    async findByParent(parentId) {
        const [results] = await this.db.query(
            'SELECT * FROM categories WHERE parent_id = ?',
            [parentId]
        );
        return results.map(r => new Category(r));
    }

    /**
     * Get category tree
     */
    async getTree() {
        const [results] = await this.db.query(
            'SELECT * FROM categories ORDER BY parent_id, name'
        );
        return this.buildTree(results);
    }

    buildTree(categories, parentId = null) {
        const tree = [];
        for (const category of categories) {
            if (category.parent_id === parentId) {
                const node = { ...category, children: this.buildTree(categories, category.id) };
                tree.push(node);
            }
        }
        return tree;
    }
}

/**
 * Catalog Service
 */
class CatalogService extends DomainService {
    constructor(productRepo, categoryRepo) {
        super();
        this.productRepo = productRepo;
        this.categoryRepo = categoryRepo;
        this.eventBus = new DomainEventBus();
    }

    /**
     * Create product
     */
    async createProduct(data) {
        const product = new Product({
            id: this.generateId(),
            ...data,
            createdAt: new Date().toISOString()
        });

        await this.productRepo.save(product);

        this.eventBus.publish('catalog.product.created', {
            productId: product.id,
            name: product.name,
            price: product.price,
            category: product.category
        });

        return product;
    }

    /**
     * Update product
     */
    async updateProduct(productId, data) {
        const product = await this.productRepo.findById(productId);
        if (!product) {
            throw new Error('Product not found');
        }

        if (data.price) {
            product.updatePrice(data.price, 'Manual update');
        }

        if (data.stock !== undefined) {
            product.updateStock(data.stock - product.stock, 'Manual update');
        }

        if (data.name) product.name = data.name;
        if (data.description) product.description = data.description;
        if (data.category) product.category = data.category;

        await this.productRepo.save(product);

        this.eventBus.publish('catalog.product.updated', {
            productId: product.id,
            changes: data
        });

        return product;
    }

    /**
     * Get product recommendations
     */
    async getRecommendations(productId, limit = 5) {
        const product = await this.productRepo.findById(productId);
        if (!product) {
            throw new Error('Product not found');
        }

        // Find products in same category
        const recommendations = await this.productRepo.findByCategory(product.category);
        
        // Filter out the product itself
        return recommendations
            .filter(p => p.id !== productId)
            .slice(0, limit);
    }

    generateId() {
        return `PROD_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    }
}

// ============================================
// EXPORT CATALOG MODULE
// ============================================

module.exports = {
    Product,
    Category,
    ProductRepository,
    CategoryRepository,
    CatalogService
};