-- ============================================
-- ENHANCED DATABASE SCHEMA FOR E-COMMERCE PLATFORM
-- Includes: Audit Trail, Soft Delete, Indexes, 
-- Inventory Management, Coupons, Shipping Tracking,
-- Payment Logs, Security Features, Data Retention
-- ============================================

-- ============================================
-- USERS TABLE (Enhanced with Audit & Security)
-- ============================================

CREATE TABLE IF NOT EXISTS users (
    id CHAR(36) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    `role` ENUM('customer', 'support', 'admin', 'seller') DEFAULT 'customer',
    refresh_token VARCHAR(255),
    avatar VARCHAR(500),
    phone VARCHAR(20),
    address TEXT,
    city VARCHAR(100),
    state VARCHAR(100),
    zip VARCHAR(20),
    country VARCHAR(100) DEFAULT 'India',
    is_active TINYINT(1) DEFAULT 1,
    is_verified TINYINT(1) DEFAULT 0,
    email_verified_at DATETIME,
    last_login DATETIME,
    login_count INT DEFAULT 0,
    failed_login_attempts INT DEFAULT 0,
    locked_until DATETIME,
    created_by CHAR(36),
    updated_by CHAR(36),
    deleted_by CHAR(36),
    deleted_at DATETIME,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_users_email (email),
    INDEX idx_users_role (`role`),
    INDEX idx_users_is_active (is_active),
    INDEX idx_users_deleted_at (deleted_at),
    INDEX idx_users_last_login (last_login),
    INDEX idx_users_verified (is_verified),
    INDEX idx_users_locked (locked_until)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- CATEGORIES TABLE (New)
-- ============================================

CREATE TABLE IF NOT EXISTS categories (
    id INT AUTO_INCREMENT PRIMARY KEY,
    parent_id INT,
    name VARCHAR(100) NOT NULL,
    slug VARCHAR(100) NOT NULL UNIQUE,
    description TEXT,
    image_url VARCHAR(500),
    icon VARCHAR(100),
    level INT DEFAULT 0,
    path VARCHAR(500),
    is_active TINYINT(1) DEFAULT 1,
    display_order INT DEFAULT 0,
    created_by CHAR(36),
    updated_by CHAR(36),
    deleted_by CHAR(36),
    deleted_at DATETIME,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    FOREIGN KEY (parent_id) REFERENCES categories(id) ON DELETE CASCADE,
    INDEX idx_parent_id (parent_id),
    INDEX idx_path (path(255)),
    INDEX idx_slug (slug),
    INDEX idx_active (is_active),
    INDEX idx_deleted_at (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- PRODUCTS TABLE (Enhanced)
-- ============================================

CREATE TABLE IF NOT EXISTS products (
    id CHAR(36) PRIMARY KEY,
    seller_id CHAR(36),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    short_description VARCHAR(500),
    price DECIMAL(10,2) NOT NULL,
    compare_price DECIMAL(10,2),
    cost_price DECIMAL(10,2),
    stock INT DEFAULT 0,
    low_stock_threshold INT DEFAULT 5,
    image VARCHAR(500),
    images JSON,
    category_id INT,
    brand VARCHAR(100),
    sku VARCHAR(100) UNIQUE,
    barcode VARCHAR(100),
    slug VARCHAR(255) UNIQUE,
    featured TINYINT(1) DEFAULT 0,
    rating DECIMAL(3,2) DEFAULT 0,
    num_reviews INT DEFAULT 0,
    weight DECIMAL(10,2),
    dimensions JSON,
    tags JSON,
    specifications JSON,
    meta_title VARCHAR(255),
    meta_description TEXT,
    meta_keywords TEXT,
    status ENUM('draft', 'active', 'inactive', 'archived') DEFAULT 'draft',
    is_active TINYINT(1) DEFAULT 1,
    views_count INT DEFAULT 0,
    sold_count INT DEFAULT 0,
    created_by CHAR(36),
    updated_by CHAR(36),
    deleted_by CHAR(36),
    deleted_at DATETIME,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    CONSTRAINT chk_price CHECK (price >= 0),
    CONSTRAINT chk_compare_price CHECK (compare_price >= 0 OR compare_price IS NULL),
    CONSTRAINT chk_cost_price CHECK (cost_price >= 0 OR cost_price IS NULL),
    CONSTRAINT chk_stock CHECK (stock >= 0),
    CONSTRAINT chk_rating CHECK (rating >= 0 AND rating <= 5),
    CONSTRAINT chk_num_reviews CHECK (num_reviews >= 0),
    
    FOREIGN KEY (seller_id) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL,
    
    -- Single column indexes
    INDEX idx_products_category (category_id),
    INDEX idx_products_featured (featured),
    INDEX idx_products_status (status),
    INDEX idx_products_slug (slug),
    INDEX idx_products_sku (sku),
    INDEX idx_products_price (price),
    INDEX idx_products_rating (rating),
    INDEX idx_products_deleted_at (deleted_at),
    INDEX idx_products_seller (seller_id),
    INDEX idx_products_barcode (barcode),
    
    -- Composite indexes for performance
    INDEX idx_category_status (category_id, status),
    INDEX idx_price_status (price, status),
    INDEX idx_rating_created (rating, created_at),
    INDEX idx_status_created (status, created_at),
    INDEX idx_seller_status (seller_id, status),
    INDEX idx_featured_status (featured, status),
    
    -- Partial index for active products
    INDEX idx_active_products (status, price, deleted_at),
    
    -- Full-text search indexes
    FULLTEXT INDEX ft_product_search (name, description, short_description, meta_keywords),
    FULLTEXT INDEX ft_product_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- PRODUCT VARIANTS TABLE (New)
-- ============================================

CREATE TABLE IF NOT EXISTS product_variants (
    id INT AUTO_INCREMENT PRIMARY KEY,
    product_id CHAR(36) NOT NULL,
    sku VARCHAR(100) UNIQUE,
    attributes JSON NOT NULL,
    price DECIMAL(10,2),
    compare_price DECIMAL(10,2),
    stock INT DEFAULT 0,
    weight DECIMAL(10,2),
    image VARCHAR(500),
    is_active TINYINT(1) DEFAULT 1,
    created_by CHAR(36),
    updated_by CHAR(36),
    deleted_by CHAR(36),
    deleted_at DATETIME,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    INDEX idx_product_variants (product_id),
    INDEX idx_variant_sku (sku),
    INDEX idx_variant_active (is_active),
    INDEX idx_variant_deleted (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- ORDERS TABLE (Enhanced)
-- ============================================

CREATE TABLE IF NOT EXISTS orders (
    id CHAR(36) PRIMARY KEY,
    user_id CHAR(36),
    order_number VARCHAR(50) UNIQUE,
    customer_name VARCHAR(255) NOT NULL,
    customer_email VARCHAR(255) NOT NULL,
    customer_phone VARCHAR(20),
    city VARCHAR(100),
    state VARCHAR(100),
    zip VARCHAR(20),
    full_address TEXT,
    billing_address JSON,
    shipping_address JSON NOT NULL,
    payment_method VARCHAR(50),
    payment_status ENUM('pending', 'paid', 'failed', 'refunded', 'partially_refunded') DEFAULT 'pending',
    payment_intent_id VARCHAR(255),
    transaction_id VARCHAR(255),
    shipping_method VARCHAR(50),
    shipping_cost DECIMAL(10,2) DEFAULT 0,
    tax DECIMAL(10,2) DEFAULT 0,
    discount DECIMAL(10,2) DEFAULT 0,
    discount_code VARCHAR(50),
    subtotal DECIMAL(10,2) NOT NULL,
    total DECIMAL(10,2) NOT NULL,
    status ENUM('pending', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded', 'on_hold') DEFAULT 'pending',
    notes TEXT,
    admin_notes TEXT,
    tracking_number VARCHAR(100),
    shipping_date DATETIME,
    delivered_at DATETIME,
    cancelled_at DATETIME,
    refunded_at DATETIME,
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_by CHAR(36),
    updated_by CHAR(36),
    deleted_by CHAR(36),
    deleted_at DATETIME,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    CONSTRAINT chk_total CHECK (total >= 0),
    CONSTRAINT chk_shipping_cost CHECK (shipping_cost >= 0),
    CONSTRAINT chk_tax CHECK (tax >= 0),
    CONSTRAINT chk_discount CHECK (discount >= 0),
    
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
    
    -- Single indexes
    INDEX idx_orders_user (user_id),
    INDEX idx_orders_status (status),
    INDEX idx_orders_payment_status (payment_status),
    INDEX idx_orders_order_number (order_number),
    INDEX idx_orders_created_at (created_at),
    INDEX idx_orders_deleted_at (deleted_at),
    INDEX idx_orders_tracking (tracking_number),
    INDEX idx_orders_email (customer_email),
    
    -- Composite indexes
    INDEX idx_status_created (status, created_at),
    INDEX idx_user_status (user_id, status),
    INDEX idx_payment_status_created (payment_status, created_at),
    INDEX idx_status_updated (status, updated_at),
    INDEX idx_shipping_date (status, shipping_date),
    
    -- JSON indexes for shipping address
    INDEX idx_shipping_city ((CAST(shipping_address->>'$.city' AS CHAR(100)))),
    INDEX idx_shipping_state ((CAST(shipping_address->>'$.state' AS CHAR(100)))),
    INDEX idx_shipping_country ((CAST(shipping_address->>'$.country' AS CHAR(100))))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- ORDER ITEMS TABLE (Enhanced)
-- ============================================

CREATE TABLE IF NOT EXISTS order_items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    order_id CHAR(36) NOT NULL,
    product_id CHAR(36),
    variant_id INT,
    name VARCHAR(255) NOT NULL,
    price DECIMAL(10,2) NOT NULL,
    cost_price DECIMAL(10,2),
    qty INT DEFAULT 1,
    color VARCHAR(50),
    size VARCHAR(50),
    variant_data JSON,
    tax_amount DECIMAL(10,2) DEFAULT 0,
    discount_amount DECIMAL(10,2) DEFAULT 0,
    total DECIMAL(10,2) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT chk_order_items_price CHECK (price >= 0),
    CONSTRAINT chk_qty CHECK (qty > 0),
    CONSTRAINT chk_order_items_total CHECK (total >= 0),
    
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL,
    FOREIGN KEY (variant_id) REFERENCES product_variants(id) ON DELETE SET NULL,
    
    INDEX idx_order_items_order (order_id),
    INDEX idx_order_items_product (product_id),
    INDEX idx_order_items_variant (variant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- INVENTORY MANAGEMENT (New)
-- ============================================

CREATE TABLE IF NOT EXISTS inventory_transactions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    product_id CHAR(36) NOT NULL,
    variant_id INT,
    order_id CHAR(36),
    quantity_change INT NOT NULL,
    previous_quantity INT NOT NULL,
    new_quantity INT NOT NULL,
    reason ENUM('purchase', 'sale', 'adjustment', 'return', 'damage', 'restock', 'transfer') NOT NULL,
    notes TEXT,
    reference_type VARCHAR(50),
    reference_id INT,
    created_by CHAR(36),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    FOREIGN KEY (variant_id) REFERENCES product_variants(id) ON DELETE SET NULL,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    
    INDEX idx_inventory_product (product_id),
    INDEX idx_inventory_variant (variant_id),
    INDEX idx_inventory_order (order_id),
    INDEX idx_inventory_created (created_at),
    INDEX idx_inventory_reason (reason),
    INDEX idx_inventory_product_created (product_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS inventory_alerts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    product_id CHAR(36) NOT NULL,
    variant_id INT,
    threshold INT NOT NULL,
    current_stock INT NOT NULL,
    alert_type ENUM('low_stock', 'out_of_stock', 'excess_stock') DEFAULT 'low_stock',
    status ENUM('pending', 'resolved', 'dismissed') DEFAULT 'pending',
    resolved_at DATETIME,
    resolved_by CHAR(36),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    FOREIGN KEY (variant_id) REFERENCES product_variants(id) ON DELETE SET NULL,
    FOREIGN KEY (resolved_by) REFERENCES users(id) ON DELETE SET NULL,
    
    INDEX idx_inventory_alerts_product (product_id),
    INDEX idx_inventory_alerts_status (status),
    INDEX idx_inventory_alerts_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- COUPON SYSTEM (New)
-- ============================================

CREATE TABLE IF NOT EXISTS coupons (
    id INT AUTO_INCREMENT PRIMARY KEY,
    code VARCHAR(50) NOT NULL UNIQUE,
    type ENUM('percentage', 'fixed', 'free_shipping') NOT NULL,
    `value` DECIMAL(10,2) NOT NULL,
    minimum_order_amount DECIMAL(10,2),
    maximum_discount_amount DECIMAL(10,2),
    usage_limit INT,
    per_user_limit INT DEFAULT 1,
    start_date TIMESTAMP NOT NULL,
    end_date TIMESTAMP NOT NULL,
    is_active TINYINT(1) DEFAULT 1,
    applies_to ENUM('all', 'categories', 'products') DEFAULT 'all',
    category_ids JSON,
    product_ids JSON,
    exclude_category_ids JSON,
    exclude_product_ids JSON,
    description TEXT,
    terms_conditions TEXT,
    used_count INT DEFAULT 0,
    created_by CHAR(36),
    updated_by CHAR(36),
    deleted_by CHAR(36),
    deleted_at DATETIME,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    CONSTRAINT chk_value CHECK (`value` >= 0),
    CONSTRAINT chk_min_order CHECK (minimum_order_amount >= 0 OR minimum_order_amount IS NULL),
    CONSTRAINT chk_max_discount CHECK (maximum_discount_amount >= 0 OR maximum_discount_amount IS NULL),
    CONSTRAINT chk_usage_limit CHECK (usage_limit >= 0 OR usage_limit IS NULL),
    CONSTRAINT chk_per_user_limit CHECK (per_user_limit >= 0),
    CONSTRAINT chk_used_count CHECK (used_count >= 0),
    
    INDEX idx_coupons_code (code),
    INDEX idx_coupons_dates (start_date, end_date),
    INDEX idx_coupons_active (is_active),
    INDEX idx_coupons_deleted (deleted_at),
    INDEX idx_coupons_type (type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS coupon_usage (
    id INT AUTO_INCREMENT PRIMARY KEY,
    coupon_id INT NOT NULL,
    user_id CHAR(36) NOT NULL,
    order_id CHAR(36) NOT NULL,
    discount_amount DECIMAL(10,2) NOT NULL,
    used_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ip_address VARCHAR(45),
    
    FOREIGN KEY (coupon_id) REFERENCES coupons(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    
    INDEX idx_coupon_usage_coupon (coupon_id),
    INDEX idx_coupon_usage_user (user_id),
    INDEX idx_coupon_usage_order (order_id),
    INDEX idx_coupon_usage_used_at (used_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- SHIPPING & TRACKING (New)
-- ============================================

CREATE TABLE IF NOT EXISTS shipments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    order_id CHAR(36) NOT NULL,
    tracking_number VARCHAR(100) UNIQUE,
    carrier VARCHAR(100),
    shipping_method VARCHAR(100),
    estimated_delivery_date DATE,
    actual_delivery_date DATE,
    status ENUM('pending', 'picked', 'in_transit', 'out_for_delivery', 'delivered', 'failed', 'returned') DEFAULT 'pending',
    shipping_label_url VARCHAR(500),
    package_details JSON,
    weight DECIMAL(10,2),
    dimensions JSON,
    shipping_cost DECIMAL(10,2),
    created_by CHAR(36),
    updated_by CHAR(36),
    deleted_by CHAR(36),
    deleted_at DATETIME,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    
    INDEX idx_shipments_order (order_id),
    INDEX idx_shipments_tracking (tracking_number),
    INDEX idx_shipments_status (status),
    INDEX idx_shipments_created (created_at),
    INDEX idx_shipments_carrier (carrier),
    INDEX idx_shipments_deleted (deleted_at),
    INDEX idx_shipments_delivery_date (estimated_delivery_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS shipment_tracking (
    id INT AUTO_INCREMENT PRIMARY KEY,
    shipment_id INT NOT NULL,
    status VARCHAR(50) NOT NULL,
    location VARCHAR(255),
    description TEXT,
    latitude DECIMAL(10,8),
    longitude DECIMAL(11,8),
    carrier_status_code VARCHAR(50),
    estimated_delivery DATE,
    is_delivered TINYINT(1) DEFAULT 0,
    `timestamp` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (shipment_id) REFERENCES shipments(id) ON DELETE CASCADE,
    
    INDEX idx_shipment_tracking_shipment (shipment_id),
    INDEX idx_shipment_tracking_timestamp (`timestamp`),
    INDEX idx_shipment_tracking_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS courier_webhooks (
    id INT AUTO_INCREMENT PRIMARY KEY,
    shipment_id INT,
    event_type VARCHAR(100) NOT NULL,
    payload JSON NOT NULL,
    received_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    processed TINYINT(1) DEFAULT 0,
    processed_at DATETIME,
    error_message TEXT,
    
    FOREIGN KEY (shipment_id) REFERENCES shipments(id) ON DELETE SET NULL,
    
    INDEX idx_courier_webhooks_shipment (shipment_id),
    INDEX idx_courier_webhooks_processed (processed),
    INDEX idx_courier_webhooks_received (received_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- PAYMENT LOGS (New)
-- ============================================

CREATE TABLE IF NOT EXISTS payment_transactions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    order_id CHAR(36) NOT NULL,
    transaction_id VARCHAR(100) UNIQUE NOT NULL,
    payment_gateway VARCHAR(50) NOT NULL,
    gateway_transaction_id VARCHAR(100),
    amount DECIMAL(10,2) NOT NULL,
    currency VARCHAR(3) DEFAULT 'INR',
    status ENUM('pending', 'authorized', 'captured', 'failed', 'refunded', 'voided') DEFAULT 'pending',
    payment_method VARCHAR(50),
    card_last4 VARCHAR(4),
    card_brand VARCHAR(20),
    card_expiry VARCHAR(7),
    raw_request JSON,
    raw_response JSON,
    error_code VARCHAR(50),
    error_message TEXT,
    retry_count INT DEFAULT 0,
    created_by CHAR(36),
    updated_by CHAR(36),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    
    INDEX idx_payment_transactions_order (order_id),
    INDEX idx_payment_transactions_transaction (transaction_id),
    INDEX idx_payment_transactions_gateway (payment_gateway),
    INDEX idx_payment_transactions_status (status),
    INDEX idx_payment_transactions_created (created_at),
    INDEX idx_payment_transactions_gateway_txn (gateway_transaction_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS payment_retry_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    transaction_id INT NOT NULL,
    attempt_number INT NOT NULL,
    status ENUM('success', 'failed') NOT NULL,
    error_message TEXT,
    response_data JSON,
    retried_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (transaction_id) REFERENCES payment_transactions(id) ON DELETE CASCADE,
    
    INDEX idx_payment_retry_transaction (transaction_id),
    INDEX idx_payment_retry_attempt (attempt_number)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS refunds (
    id INT AUTO_INCREMENT PRIMARY KEY,
    order_id CHAR(36) NOT NULL,
    payment_transaction_id INT NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    reason VARCHAR(255),
    status ENUM('pending', 'approved', 'completed', 'failed', 'rejected') DEFAULT 'pending',
    gateway_refund_id VARCHAR(100),
    refund_method VARCHAR(50),
    notes TEXT,
    processed_at DATETIME,
    created_by CHAR(36),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    FOREIGN KEY (payment_transaction_id) REFERENCES payment_transactions(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    
    INDEX idx_refunds_order (order_id),
    INDEX idx_refunds_transaction (payment_transaction_id),
    INDEX idx_refunds_status (status),
    INDEX idx_refunds_gateway (gateway_refund_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- SECURITY TABLES (New)
-- ============================================

CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id CHAR(36) NOT NULL,
    token VARCHAR(255) NOT NULL UNIQUE,
    expires_at TIMESTAMP NOT NULL,
    used TINYINT(1) DEFAULT 0,
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    
    INDEX idx_password_reset_token (token),
    INDEX idx_password_reset_user (user_id),
    INDEX idx_password_reset_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS email_verification_tokens (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id CHAR(36) NOT NULL,
    token VARCHAR(255) NOT NULL UNIQUE,
    expires_at TIMESTAMP NOT NULL,
    used TINYINT(1) DEFAULT 0,
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    
    INDEX idx_email_verification_token (token),
    INDEX idx_email_verification_user (user_id),
    INDEX idx_email_verification_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_sessions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id CHAR(36) NOT NULL,
    session_token VARCHAR(255) NOT NULL UNIQUE,
    ip_address VARCHAR(45),
    user_agent TEXT,
    device_type VARCHAR(50),
    is_active TINYINT(1) DEFAULT 1,
    expires_at TIMESTAMP NOT NULL,
    last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    
    INDEX idx_user_sessions_token (session_token),
    INDEX idx_user_sessions_user (user_id),
    INDEX idx_user_sessions_active (is_active),
    INDEX idx_user_sessions_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS login_attempts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(255) NOT NULL,
    ip_address VARCHAR(45) NOT NULL,
    success TINYINT(1) DEFAULT 0,
    user_agent TEXT,
    attempted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_login_attempts_email_ip (email, ip_address),
    INDEX idx_login_attempts_attempted (attempted_at),
    INDEX idx_login_attempts_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS api_tokens (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id CHAR(36) NOT NULL,
    name VARCHAR(100),
    token VARCHAR(255) NOT NULL UNIQUE,
    permissions JSON,
    last_used_at DATETIME,
    expires_at TIMESTAMP,
    is_active TINYINT(1) DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    
    INDEX idx_api_tokens_token (token),
    INDEX idx_api_tokens_user (user_id),
    INDEX idx_api_tokens_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- WISHLIST ITEMS TABLE (Enhanced)
-- ============================================

CREATE TABLE IF NOT EXISTS wishlist_items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id CHAR(36) NOT NULL,
    product_id CHAR(36) NOT NULL,
    variant_id INT,
    notes TEXT,
    created_by CHAR(36),
    updated_by CHAR(36),
    deleted_by CHAR(36),
    deleted_at DATETIME,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    FOREIGN KEY (variant_id) REFERENCES product_variants(id) ON DELETE SET NULL,
    
    UNIQUE KEY user_product_unique (user_id, product_id, variant_id),
    INDEX idx_wishlist_items_user (user_id),
    INDEX idx_wishlist_items_product (product_id),
    INDEX idx_wishlist_items_deleted (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- REVIEWS TABLE (Enhanced)
-- ============================================

CREATE TABLE IF NOT EXISTS reviews (
    id INT AUTO_INCREMENT PRIMARY KEY,
    product_id CHAR(36) NOT NULL,
    user_id CHAR(36) NOT NULL,
    rating TINYINT NOT NULL,
    title VARCHAR(255),
    comment TEXT NOT NULL,
    images JSON,
    is_verified TINYINT(1) DEFAULT 0,
    is_approved TINYINT(1) DEFAULT 1,
    helpful_count INT DEFAULT 0,
    reported_count INT DEFAULT 0,
    moderation_notes TEXT,
    deleted_by CHAR(36),
    deleted_at DATETIME,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    CONSTRAINT chk_reviews_rating CHECK (rating >= 1 AND rating <= 5),
    CONSTRAINT chk_helpful_count CHECK (helpful_count >= 0),
    CONSTRAINT chk_reported_count CHECK (reported_count >= 0),
    
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    
    INDEX idx_reviews_product (product_id),
    INDEX idx_reviews_user (user_id),
    INDEX idx_reviews_rating (rating),
    INDEX idx_reviews_created (created_at),
    INDEX idx_reviews_deleted (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- USER INTERACTIONS TABLE (Enhanced)
-- ============================================

CREATE TABLE IF NOT EXISTS user_interactions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id CHAR(36) NOT NULL,
    product_id CHAR(36) NOT NULL,
    interaction_type ENUM('view', 'cart_add', 'wishlist_add', 'purchase') NOT NULL,
    session_id VARCHAR(255),
    ip_address VARCHAR(45),
    user_agent TEXT,
    metadata JSON,
    quantity INT DEFAULT 1,
    price_at_time DECIMAL(10,2),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    
    INDEX idx_user_interactions_user (user_id),
    INDEX idx_user_interactions_product (product_id),
    INDEX idx_user_interactions_type (interaction_type),
    INDEX idx_user_interactions_created (created_at),
    INDEX idx_user_interactions_user_type (user_id, interaction_type),
    INDEX idx_user_interactions_session (session_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- SERVICEABLE PINCODES TABLE (Enhanced)
-- ============================================

CREATE TABLE IF NOT EXISTS serviceable_pincodes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    pincode VARCHAR(6) NOT NULL UNIQUE,
    city VARCHAR(100),
    state VARCHAR(100),
    country VARCHAR(100) DEFAULT 'India',
    eta_days INT NOT NULL DEFAULT 5,
    delivery_charges DECIMAL(10,2) DEFAULT 0,
    cod_available TINYINT(1) DEFAULT 1,
    is_active TINYINT(1) DEFAULT 1,
    created_by CHAR(36),
    updated_by CHAR(36),
    deleted_by CHAR(36),
    deleted_at DATETIME,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    CONSTRAINT chk_eta_days CHECK (eta_days >= 0),
    CONSTRAINT chk_delivery_charges CHECK (delivery_charges >= 0),
    
    INDEX idx_pincodes_pincode (pincode),
    INDEX idx_pincodes_city (city),
    INDEX idx_pincodes_state (state),
    INDEX idx_pincodes_active (is_active),
    INDEX idx_pincodes_deleted (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- CHAT CONVERSATIONS TABLE (Enhanced)
-- ============================================

CREATE TABLE IF NOT EXISTS chat_conversations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    customer_id CHAR(36) NOT NULL,
    assigned_admin_id CHAR(36),
    status ENUM('open', 'pending', 'closed', 'archived') DEFAULT 'open',
    priority ENUM('low', 'medium', 'high', 'urgent') DEFAULT 'medium',
    subject VARCHAR(255),
    closed_at DATETIME,
    archived_at DATETIME,
    rating TINYINT,
    feedback TEXT,
    created_by CHAR(36),
    updated_by CHAR(36),
    deleted_by CHAR(36),
    deleted_at DATETIME,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (assigned_admin_id) REFERENCES users(id) ON DELETE SET NULL,
    
    INDEX idx_chat_conversations_customer (customer_id),
    INDEX idx_chat_conversations_admin (assigned_admin_id),
    INDEX idx_chat_conversations_status (status),
    INDEX idx_chat_conversations_created (created_at),
    INDEX idx_chat_conversations_priority (priority),
    INDEX idx_chat_conversations_deleted (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- CHAT MESSAGES TABLE (Enhanced)
-- ============================================

CREATE TABLE IF NOT EXISTS chat_messages (
    id INT AUTO_INCREMENT PRIMARY KEY,
    conversation_id INT NOT NULL,
    sender_id CHAR(36) NOT NULL,
    sender_type ENUM('customer', 'admin', 'system') NOT NULL,
    message TEXT NOT NULL,
    attachments JSON,
    is_read TINYINT(1) DEFAULT 0,
    is_edited TINYINT(1) DEFAULT 0,
    is_deleted TINYINT(1) DEFAULT 0,
    deleted_by CHAR(36),
    deleted_at DATETIME,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    FOREIGN KEY (conversation_id) REFERENCES chat_conversations(id) ON DELETE CASCADE,
    FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
    
    INDEX idx_chat_messages_conversation (conversation_id),
    INDEX idx_chat_messages_sender (sender_id),
    INDEX idx_chat_messages_created (created_at),
    INDEX idx_chat_messages_read (is_read)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- MESSAGE READS TABLE (Enhanced)
-- ============================================

CREATE TABLE IF NOT EXISTS message_reads (
    id INT AUTO_INCREMENT PRIMARY KEY,
    message_id INT NOT NULL,
    user_id CHAR(36) NOT NULL,
    read_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (message_id) REFERENCES chat_messages(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    
    UNIQUE KEY message_user_unique (message_id, user_id),
    INDEX idx_message_reads_message (message_id),
    INDEX idx_message_reads_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- ACTIVITY LOG TABLE (Enhanced)
-- ============================================

CREATE TABLE IF NOT EXISTS activity_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id CHAR(36),
    action VARCHAR(100) NOT NULL,
    resource_type VARCHAR(50),
    resource_id INT,
    old_values JSON,
    new_values JSON,
    ip_address VARCHAR(45),
    user_agent TEXT,
    metadata JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
    
    INDEX idx_activity_logs_user (user_id),
    INDEX idx_activity_logs_action (action),
    INDEX idx_activity_logs_created (created_at),
    INDEX idx_activity_logs_resource (resource_type, resource_id),
    INDEX idx_activity_logs_user_action (user_id, action)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- DATA RETENTION PROCEDURES
-- ============================================

DELIMITER //

CREATE PROCEDURE cleanup_old_data(IN days_to_keep INT)
BEGIN
    DECLARE cutoff_date DATETIME;
    SET cutoff_date = DATE_SUB(NOW(), INTERVAL days_to_keep DAY);
    
    -- Delete old login attempts
    DELETE FROM login_attempts WHERE attempted_at < cutoff_date;
    
    -- Delete old activity logs
    DELETE FROM activity_logs WHERE created_at < cutoff_date;
    
    -- Archive old inventory transactions (optional)
    -- INSERT INTO inventory_transactions_archive SELECT * FROM inventory_transactions WHERE created_at < cutoff_date;
    -- DELETE FROM inventory_transactions WHERE created_at < cutoff_date;
    
    -- Delete expired tokens
    DELETE FROM password_reset_tokens WHERE expires_at < NOW() OR used = 1;
    DELETE FROM email_verification_tokens WHERE expires_at < NOW() OR used = 1;
    DELETE FROM user_sessions WHERE expires_at < NOW() OR is_active = 0;
    DELETE FROM api_tokens WHERE expires_at < NOW() OR is_active = 0;
    
    -- Delete old user interactions
    DELETE FROM user_interactions WHERE created_at < cutoff_date;
END //

CREATE PROCEDURE archive_orders(IN days_to_keep INT)
BEGIN
    DECLARE cutoff_date DATETIME;
    SET cutoff_date = DATE_SUB(NOW(), INTERVAL days_to_keep DAY);
    
    -- Archive old orders (soft delete)
    UPDATE orders 
    SET deleted_at = NOW() 
    WHERE created_at < cutoff_date 
    AND status IN ('delivered', 'cancelled', 'refunded')
    AND deleted_at IS NULL;
END //

DELIMITER ;

-- ============================================
-- SCHEDULED EVENTS FOR CLEANUP
-- ============================================

-- Create event for daily cleanup (runs at 2 AM)
CREATE EVENT IF NOT EXISTS daily_cleanup_event
ON SCHEDULE EVERY 1 DAY
STARTS '2026-01-01 02:00:00'
DO CALL cleanup_old_data(30);

-- Create event for weekly order archiving (runs at 3 AM Sunday)
CREATE EVENT IF NOT EXISTS weekly_order_archiving
ON SCHEDULE EVERY 1 WEEK
STARTS '2026-01-07 03:00:00'
DO CALL archive_orders(365);

-- ============================================
-- USEFUL VIEWS
-- ============================================

-- View: Product Inventory Status
CREATE OR REPLACE VIEW vw_product_inventory AS
SELECT 
    p.id,
    p.name,
    p.sku,
    p.stock,
    p.low_stock_threshold,
    CASE 
        WHEN p.stock <= p.low_stock_threshold THEN 'Low Stock'
        WHEN p.stock = 0 THEN 'Out of Stock'
        ELSE 'In Stock'
    END AS stock_status,
    p.status,
    COALESCE(SUM(oi.qty), 0) AS total_sold,
    COUNT(DISTINCT o.id) AS total_orders
FROM products p
LEFT JOIN order_items oi ON p.id = oi.product_id
LEFT JOIN orders o ON oi.order_id = o.id AND o.status = 'delivered'
WHERE p.deleted_at IS NULL
GROUP BY p.id;

-- View: Sales Summary
CREATE OR REPLACE VIEW vw_sales_summary AS
SELECT 
    DATE(created_at) AS order_date,
    COUNT(*) AS total_orders,
    SUM(total) AS total_revenue,
    AVG(total) AS average_order_value,
    SUM(shipping_cost) AS total_shipping,
    SUM(tax) AS total_tax,
    SUM(discount) AS total_discount,
    COUNT(CASE WHEN status = 'delivered' THEN 1 END) AS delivered_orders,
    COUNT(CASE WHEN status = 'cancelled' THEN 1 END) AS cancelled_orders,
    COUNT(CASE WHEN status = 'refunded' THEN 1 END) AS refunded_orders
FROM orders
WHERE deleted_at IS NULL
GROUP BY DATE(created_at);

-- View: Top Products by Sales
CREATE OR REPLACE VIEW vw_top_products AS
SELECT 
    p.id,
    p.name,
    p.sku,
    p.price,
    SUM(oi.qty) AS total_sold,
    SUM(oi.total) AS total_revenue,
    COUNT(DISTINCT o.id) AS order_count,
    AVG(r.rating) AS avg_rating
FROM products p
LEFT JOIN order_items oi ON p.id = oi.product_id
LEFT JOIN orders o ON oi.order_id = o.id AND o.status = 'delivered'
LEFT JOIN reviews r ON p.id = r.product_id
WHERE p.deleted_at IS NULL
GROUP BY p.id
ORDER BY total_revenue DESC;

-- View: Customer Analytics
CREATE OR REPLACE VIEW vw_customer_analytics AS
SELECT 
    u.id,
    u.name,
    u.email,
    COUNT(o.id) AS total_orders,
    SUM(o.total) AS total_spent,
    AVG(o.total) AS average_order_value,
    MAX(o.created_at) AS last_order_date,
    COUNT(DISTINCT DATE(o.created_at)) AS active_days,
    CASE 
        WHEN DATEDIFF(NOW(), MAX(o.created_at)) <= 30 THEN 'Active'
        WHEN DATEDIFF(NOW(), MAX(o.created_at)) <= 90 THEN 'Engaged'
        ELSE 'Inactive'
    END AS customer_segment
FROM users u
LEFT JOIN orders o ON u.id = o.user_id AND o.status = 'delivered' AND o.deleted_at IS NULL
WHERE u.deleted_at IS NULL
GROUP BY u.id;

-- ============================================
-- INITIAL DATA
-- ============================================

INSERT INTO categories (name, slug, description, level, is_active) VALUES
('Electronics', 'electronics', 'Electronic devices and gadgets', 0, 1),
('Clothing', 'clothing', 'Apparel and fashion items', 0, 1),
('Home & Garden', 'home-garden', 'Home improvement and garden supplies', 0, 1),
('Books', 'books', 'Books and publications', 0, 1),
('Sports', 'sports', 'Sports equipment and accessories', 0, 1)
ON DUPLICATE KEY UPDATE name = VALUES(name);

INSERT INTO serviceable_pincodes (pincode, city, state, eta_days, cod_available) VALUES
('110001', 'New Delhi', 'Delhi', 2, 1),
('400001', 'Mumbai', 'Maharashtra', 2, 1),
('560001', 'Bengaluru', 'Karnataka', 3, 1),
('302001', 'Jaipur', 'Rajasthan', 3, 1),
('700001', 'Kolkata', 'West Bengal', 4, 1),
('600001', 'Chennai', 'Tamil Nadu', 4, 1),
('500001', 'Hyderabad', 'Telangana', 3, 1),
('380001', 'Ahmedabad', 'Gujarat', 4, 1),
('411001', 'Pune', 'Maharashtra', 3, 1),
('226001', 'Lucknow', 'Uttar Pradesh', 5, 1)
ON DUPLICATE KEY UPDATE eta_days = VALUES(eta_days);

-- ============================================
-- INVENTORY LOCKS (New)
-- ============================================

CREATE TABLE IF NOT EXISTS inventory_locks (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id CHAR(36) NOT NULL,
    product_id CHAR(36) NOT NULL,
    quantity INT NOT NULL,
    expires_at DATETIME NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    
    INDEX idx_inventory_locks_user (user_id),
    INDEX idx_inventory_locks_product (product_id),
    INDEX idx_inventory_locks_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;