// backend/repositories/index.js
const BaseRepository = require('./baseRepository');
const ProductRepository = require('./productRepository');
const OrderRepository = require('./orderRepository');
const UserRepository = require('./userRepository');
const WishlistRepository = require('./wishlistRepository');

module.exports = {
    BaseRepository,
    ProductRepository,
    OrderRepository,
    UserRepository,
    WishlistRepository,
    
    // Convenience exports
    productRepo: ProductRepository,
    orderRepo: OrderRepository,
    userRepo: UserRepository,
    wishlistRepo: WishlistRepository
};