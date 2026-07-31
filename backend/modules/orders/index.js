// backend/modules/orders/index.js
const { AggregateRoot, Repository, DomainService } = require('../core');

// ============================================
// ORDERS MODULE - Bounded Context
// ============================================

/**
 * Order Entity
 */
class Order extends AggregateRoot {
    constructor(data) {
        super();
        this.id = data.id;
        this.userId = data.userId;
        this.items = data.items || [];
        this.total = data.total || 0;
        this.subtotal = data.subtotal || 0;
        this.tax = data.tax || 0;
        this.shipping = data.shipping || 0;
        this.discount = data.discount || 0;
        this.status = data.status || 'pending';
        this.shippingAddress = data.shippingAddress || {};
        this.paymentMethod = data.paymentMethod || null;
        this.paymentStatus = data.paymentStatus || 'pending';
        this.createdAt = data.createdAt || new Date().toISOString();
        this.updatedAt = data.updatedAt || new Date().toISOString();
        this.completedAt = data.completedAt || null;
    }

    /**
     * Add item to order
     */
    addItem(productId, name, price, quantity = 1) {
        const item = {
            productId,
            name,
            price,
            quantity,
            subtotal: price * quantity
        };

        this.items.push(item);
        this.calculateTotals();

        this.addDomainEvent('order.item.added', {
            orderId: this.id,
            productId,
            quantity,
            price
        });
    }

    /**
     * Remove item from order
     */
    removeItem(productId) {
        this.items = this.items.filter(item => item.productId !== productId);
        this.calculateTotals();

        this.addDomainEvent('order.item.removed', {
            orderId: this.id,
            productId
        });
    }

    /**
     * Calculate totals
     */
    calculateTotals() {
        this.subtotal = this.items.reduce((sum, item) => sum + item.subtotal, 0);
        this.tax = this.subtotal * 0.18; // 18% tax
        this.shipping = this.subtotal > 500 ? 0 : 50;
        this.total = this.subtotal + this.tax + this.shipping - this.discount;
    }

    /**
     * Apply discount
     */
    applyDiscount(discount) {
        this.discount = discount;
        this.calculateTotals();

        this.addDomainEvent('order.discount.applied', {
            orderId: this.id,
            discount
        });
    }

    /**
     * Update status
     */
    updateStatus(status) {
        const oldStatus = this.status;
        this.status = status;
        this.updatedAt = new Date().toISOString();

        if (status === 'completed') {
            this.completedAt = new Date().toISOString();
        }

        this.addDomainEvent('order.status.changed', {
            orderId: this.id,
            oldStatus,
            newStatus: status
        });
    }

    /**
     * Confirm payment
     */
    confirmPayment(paymentId) {
        this.paymentStatus = 'paid';
        this.updatedAt = new Date().toISOString();

        this.addDomainEvent('order.payment.confirmed', {
            orderId: this.id,
            paymentId
        });
    }
}

/**
 * Order Repository
 */
class OrderRepository extends Repository {
    constructor(db) {
        super(db, 'orders', Order);
    }

    /**
     * Find by user
     */
    async findByUser(userId) {
        const [results] = await this.db.query(
            'SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC',
            [userId]
        );
        return results.map(r => new Order(r));
    }

    /**
     * Find by status
     */
    async findByStatus(status) {
        const [results] = await this.db.query(
            'SELECT * FROM orders WHERE status = ? ORDER BY created_at DESC',
            [status]
        );
        return results.map(r => new Order(r));
    }

    /**
     * Find recent orders
     */
    async findRecent(limit = 10) {
        const [results] = await this.db.query(
            'SELECT * FROM orders ORDER BY created_at DESC LIMIT ?',
            [limit]
        );
        return results.map(r => new Order(r));
    }
}

/**
 * Order Service
 */
class OrderService extends DomainService {
    constructor(orderRepo) {
        super();
        this.orderRepo = orderRepo;
        this.eventBus = new DomainEventBus();
    }

    /**
     * Create order
     */
    async createOrder(data) {
        const order = new Order({
            id: this.generateId(),
            ...data,
            createdAt: new Date().toISOString()
        });

        await this.orderRepo.save(order);

        this.eventBus.publish('orders.order.created', {
            orderId: order.id,
            userId: order.userId,
            total: order.total
        });

        return order;
    }

    /**
     * Update order status
     */
    async updateOrderStatus(orderId, status) {
        const order = await this.orderRepo.findById(orderId);
        if (!order) {
            throw new Error('Order not found');
        }

        order.updateStatus(status);
        await this.orderRepo.save(order);

        this.eventBus.publish('orders.order.status.updated', {
            orderId: order.id,
            status
        });

        return order;
    }

    /**
     * Get order summary
     */
    async getOrderSummary(orderId) {
        const order = await this.orderRepo.findById(orderId);
        if (!order) {
            throw new Error('Order not found');
        }

        return {
            id: order.id,
            total: order.total,
            status: order.status,
            items: order.items.length,
            createdAt: order.createdAt
        };
    }

    generateId() {
        return `ORD_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    }
}

// ============================================
// EXPORT ORDERS MODULE
// ============================================

module.exports = {
    Order,
    OrderRepository,
    OrderService
};