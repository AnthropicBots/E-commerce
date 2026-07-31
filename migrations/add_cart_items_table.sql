-- ============================================
-- Migration: Add Cart Items Table
-- ============================================

CREATE TABLE IF NOT EXISTS cart_items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id CHAR(36) NOT NULL,
    product_id CHAR(36) NOT NULL,
    -- variant_id 0 and empty colour/size mean "nothing chosen". Sentinels
    -- rather than NULLs so the unique key below actually rejects a repeat of
    -- the same line. No foreign key on variant_id: a deployment without
    -- product_variants still has to work.
    variant_id INT NOT NULL DEFAULT 0,
    color VARCHAR(50) NOT NULL DEFAULT '',
    size VARCHAR(50) NOT NULL DEFAULT '',
    quantity INT DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    
    -- Ensure a line — a product plus the variant chosen — is only in the cart
    -- once per user. Keying on the product alone collapsed two variants of the
    -- same product into one row.
    UNIQUE KEY idx_cart_items_user_product (user_id, product_id, variant_id, color, size),
    
    INDEX idx_cart_items_user (user_id),
    INDEX idx_cart_items_product (product_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
