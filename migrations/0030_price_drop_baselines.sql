-- Wishlist price-drop baselines & preference center (#1394)
-- Folded from backend/sql/price_drop_baselines.sql

CREATE TABLE IF NOT EXISTS price_drop_baselines (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id CHAR(36) NOT NULL,
    product_id CHAR(36) NOT NULL,
    baseline_price DECIMAL(10,2) NOT NULL,
    last_seen_price DECIMAL(10,2) NOT NULL,
    last_notified_at DATETIME NULL,
    last_notified_price DECIMAL(10,2) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uq_price_drop_user_product (user_id, product_id),
    INDEX idx_pdb_product (product_id),
    INDEX idx_pdb_notified (last_notified_at),

    CONSTRAINT fk_pdb_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_pdb_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS notification_preferences (
    user_id CHAR(36) PRIMARY KEY,
    price_drop_email TINYINT(1) NOT NULL DEFAULT 1,
    price_drop_in_app TINYINT(1) NOT NULL DEFAULT 1,
    unsubscribed_all TINYINT(1) NOT NULL DEFAULT 0,
    unsubscribe_token_hash CHAR(64) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_notif_pref_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS price_drop_notification_log (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id CHAR(36) NOT NULL,
    product_id CHAR(36) NOT NULL,
    old_price DECIMAL(10,2) NOT NULL,
    new_price DECIMAL(10,2) NOT NULL,
    channels_json JSON NULL,
    dedupe_key VARCHAR(128) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    UNIQUE KEY uq_price_drop_dedupe (dedupe_key),
    INDEX idx_pdnl_user (user_id),
    INDEX idx_pdnl_created (created_at),

    CONSTRAINT fk_pdnl_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_pdnl_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
