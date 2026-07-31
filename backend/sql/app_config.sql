-- Application Configuration Table
CREATE TABLE IF NOT EXISTS app_config (
    id INT PRIMARY KEY AUTO_INCREMENT,
    config_key VARCHAR(100) UNIQUE NOT NULL,
    config_value JSON NOT NULL,
    version INT DEFAULT 1,
    active BOOLEAN DEFAULT TRUE,
    priority INT DEFAULT 0,
    updated_by VARCHAR(100),
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_key (config_key),
    INDEX idx_active (active),
    INDEX idx_priority (priority)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Configuration History Table
CREATE TABLE IF NOT EXISTS config_history (
    id INT PRIMARY KEY AUTO_INCREMENT,
    config_key VARCHAR(100) NOT NULL,
    old_value JSON,
    new_value JSON,
    updated_by VARCHAR(100),
    reason TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_key (config_key),
    INDEX idx_timestamp (timestamp)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;