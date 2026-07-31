-- Notifications Table
CREATE TABLE IF NOT EXISTS notifications (
    id INT PRIMARY KEY AUTO_INCREMENT,
    notification_id VARCHAR(100) UNIQUE NOT NULL,
    type VARCHAR(100) NOT NULL,
    data JSON NOT NULL,
    priority ENUM('high', 'medium', 'low') DEFAULT 'medium',
    channels JSON,
    status ENUM('pending', 'sent', 'delivered', 'read', 'failed') DEFAULT 'pending',
    user_id VARCHAR(100),
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    delivered_at DATETIME,
    read_at DATETIME,
    metadata JSON,
    retry_count INT DEFAULT 0,
    max_retries INT DEFAULT 3,
    INDEX idx_type (type),
    INDEX idx_user (user_id),
    INDEX idx_status (status),
    INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Notification Subscribers
CREATE TABLE IF NOT EXISTS notification_subscribers (
    id INT PRIMARY KEY AUTO_INCREMENT,
    subscription_id VARCHAR(100) UNIQUE NOT NULL,
    notification_type VARCHAR(100) NOT NULL,
    handler TEXT NOT NULL,
    options JSON,
    active BOOLEAN DEFAULT TRUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_type (notification_type),
    INDEX idx_active (active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;