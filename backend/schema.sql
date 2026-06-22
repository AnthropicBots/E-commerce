-- backend/schema.sql

-- users table
CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255)
        NOT NULL,

    email VARCHAR(255)
        NOT NULL UNIQUE,

    password VARCHAR(255)
        NOT NULL,

    role ENUM(
        'customer',
        'support',
        'admin'
    )
    DEFAULT 'customer',

    refresh_token VARCHAR(255),

    is_active TINYINT(1)
        DEFAULT 1,
    
    created_at TIMESTAMP
        DEFAULT CURRENT_TIMESTAMP,
    
    updated_at TIMESTAMP
        DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP
);

-- products table
CREATE TABLE IF NOT EXISTS products (
    id INT AUTO_INCREMENT PRIMARY KEY,

    name VARCHAR(255)
        NOT NULL,

    description TEXT,

    price DECIMAL(10,2)
        NOT NULL,

    stock INT
        DEFAULT 0,

    image VARCHAR(500),

    category VARCHAR(100),

    featured TINYINT(1)
        DEFAULT 0,

    rating DECIMAL(3,2)
        DEFAULT 0,

    num_reviews INT
        DEFAULT 0,

    created_at TIMESTAMP
        DEFAULT CURRENT_TIMESTAMP,

    updated_at TIMESTAMP
        DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,

    CHECK (price >= 0),

    CHECK (stock >= 0),

    CHECK (rating >= 0),

    CHECK (num_reviews >= 0)
);

-- orders table
CREATE TABLE IF NOT EXISTS orders (
    id INT AUTO_INCREMENT PRIMARY KEY,

    user_id INT,

    customer_name VARCHAR(255)
        NOT NULL,

    customer_email VARCHAR(255)
        NOT NULL,

    customer_phone VARCHAR(20),

    city VARCHAR(100),

    state VARCHAR(100),

    zip VARCHAR(20),

    full_address TEXT,

    payment_method VARCHAR(50),

    total DECIMAL(10,2)
        NOT NULL,

    status ENUM(
        'pending',
        'processing',
        'shipped',
        'delivered',
        'cancelled'
    )
    DEFAULT 'pending',

    created_at TIMESTAMP
        DEFAULT CURRENT_TIMESTAMP,

    updated_at TIMESTAMP
        DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,

    FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DeleteE SET NULL,

    CHECK (total >= 0)
);

-- order items table
CREATE TABLE IF NOT EXISTS order_items (
    id INT AUTO_INCREMENT PRIMARY KEY,

    order_id INT
        NOT NULL,

    product_id INT,

    name VARCHAR(255),

    price DECIMAL(10,2),

    qty INT
        DEFAULT 1,

    color VARCHAR(50),

    size VARCHAR(50),

    created_at TIMESTAMP
        DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (order_id)
        REFERENCES orders(id)
        ON DeleteE CASCADE,

    FOREIGN KEY (product_id)
        REFERENCES products(id)
        ON DeleteE SET NULL,

    CHECK (price >= 0),

    CHECK (qty > 0)
);

-- indexes
CREATE INDEX idx_products_category
ON products(category);

CREATE INDEX idx_products_featured
ON products(featured);

CREATE INDEX idx_orders_user
ON orders(user_id);

CREATE INDEX idx_orders_status
ON orders(status);

CREATE INDEX idx_order_items_order
ON order_items(order_id);

CREATE INDEX idx_order_items_product
ON order_items(product_id);

-- wishlist items table
CREATE TABLE IF NOT EXISTS wishlist_items (
    id INT AUTO_INCREMENT PRIMARY KEY,

    user_id INT
        NOT NULL,

    product_id INT
        NOT NULL,

    created_at TIMESTAMP
        DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DeleteE CASCADE,

    FOREIGN KEY (product_id)
        REFERENCES products(id)
        ON DeleteE CASCADE,

    UNIQUE KEY user_product_unique (user_id, product_id)
);

-- indexes
CREATE INDEX idx_wishlist_items_user
ON wishlist_items(user_id);

CREATE INDEX idx_wishlist_items_product
ON wishlist_items(product_id);

-- user interactions table
CREATE TABLE IF NOT EXISTS user_interactions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    product_id INT NOT NULL,
    interaction_type ENUM('view', 'cart_add', 'wishlist_add', 'purchase') NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

-- indexes
CREATE INDEX idx_user_interactions_user
ON user_interactions(user_id);

CREATE INDEX idx_user_interactions_product
ON user_interactions(product_id);

CREATE INDEX idx_user_interactions_type
ON user_interactions(interaction_type);

-- Serviceable pincodes for delivery availability check
CREATE TABLE IF NOT EXISTS serviceable_pincodes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    pincode VARCHAR(6) NOT NULL UNIQUE,
    city VARCHAR(100),
    state VARCHAR(100),
    eta_days INT NOT NULL DEFAULT 5,
    is_active BOOLEAN DEFAULT TRUE
);

INSERT INTO serviceable_pincodes (pincode, city, state, eta_days) VALUES
('110001', 'New Delhi', 'Delhi', 2),
('400001', 'Mumbai', 'Maharashtra', 2),
('560001', 'Bengaluru', 'Karnataka', 3),
('302001', 'Jaipur', 'Rajasthan', 3),
('700001', 'Kolkata', 'West Bengal', 4),
('600001', 'Chennai', 'Tamil Nadu', 4),
('500001', 'Hyderabad', 'Telangana', 3),
('380001', 'Ahmedabad', 'Gujarat', 4),
('411001', 'Pune', 'Maharashtra', 3),
('226001', 'Lucknow', 'Uttar Pradesh', 5);
