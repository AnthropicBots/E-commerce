// backend/repositories/index.js
const BaseRepository = require('./baseRepository');
const ProductRepository = require('./productRepository');
const OrderRepository = require('./orderRepository');
const UserRepository = require('./userRepository');
const WishlistRepository = require('./wishlistRepository');
const ReviewRepository = require('./reviewRepository');

module.exports = {
    BaseRepository,
    ProductRepository,
    OrderRepository,
    UserRepository,
    WishlistRepository,
    ReviewRepository,
    
    // Convenience exports
    productRepo: ProductRepository,
    orderRepo: OrderRepository,
    userRepo: UserRepository,
    wishlistRepo: WishlistRepository,
    reviewRepo: ReviewRepository
};