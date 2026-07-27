CREATE TABLE IF NOT EXISTS stock_alert_subscriptions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id CHAR(36) NOT NULL,
    product_id CHAR(36) NOT NULL,
    alert_type ENUM('back_in_stock','price_drop') NOT NULL,
    reference_price DECIMAL(10,2) NULL,
    status ENUM('active','notified','cancelled') NOT NULL DEFAULT 'active',
    last_notified_at DATETIME NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    UNIQUE KEY uniq_user_product_type (user_id, product_id, alert_type),
    INDEX idx_stock_alert_product (product_id),
    INDEX idx_stock_alert_type_status (alert_type, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
