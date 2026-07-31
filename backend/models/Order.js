// Field names mirror the columns the order service writes, so a row read back
// out of `orders` and an object built here describe the same order.
class Order {
    constructor(order) {
        this.id = order.id;
        this.customerName = order.customerName;
        this.customerEmail = order.customerEmail;
        this.customerPhone = order.customerPhone;
        this.city = order.city;
        this.state = order.state;
        this.zip = order.zip;
        this.fullAddress = order.fullAddress;
        this.paymentMethod = order.paymentMethod;
        this.subtotal = order.subtotal || 0;
        this.discount = order.discount || 0;
        this.discountCode = order.discountCode || null;
        this.tax = order.tax || 0;
        this.shippingCost = order.shippingCost || 0;
        this.total = order.total || 0;
        this.status = order.status || "pending";
        this.items = order.items || [];
        this.isPaid = order.isPaid || false;
        this.paidAt = order.paidAt || null;
        this.isDelivered = order.isDelivered || false;
        this.deliveredAt = order.deliveredAt || null;
        this.createdAt = order.createdAt || new Date();
        this.updatedAt = order.updatedAt || new Date();
    }
}

module.exports =
    Order;
