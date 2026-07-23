-- Read Model: Product Summary
CREATE TABLE IF NOT EXISTS read_model_product_summary (
    id INT PRIMARY KEY AUTO_INCREMENT,
    product_id VARCHAR(100) UNIQUE NOT NULL,
    total_orders INT DEFAULT 0,
    total_revenue DECIMAL(10,2) DEFAULT 0,
    average_rating DECIMAL(3,2) DEFAULT 0,
    view_count INT DEFAULT 0,
    last_updated DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_product (product_id),
    INDEX idx_orders (total_orders),
    INDEX idx_revenue (total_revenue)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Read Model: Order Summary
CREATE TABLE IF NOT EXISTS read_model_order_summary (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id VARCHAR(100) UNIQUE NOT NULL,
    total_orders INT DEFAULT 0,
    total_spent DECIMAL(10,2) DEFAULT 0,
    average_order_value DECIMAL(10,2) DEFAULT 0,
    last_order_date DATETIME,
    last_updated DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_user (user_id),
    INDEX idx_orders (total_orders),
    INDEX idx_spent (total_spent)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Read Model: User Summary
CREATE TABLE IF NOT EXISTS read_model_user_summary (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id VARCHAR(100) UNIQUE NOT NULL,
    total_orders INT DEFAULT 0,
    total_spent DECIMAL(10,2) DEFAULT 0,
    last_active DATETIME,
    account_age INT DEFAULT 0,
    last_updated DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_user (user_id),
    INDEX idx_orders (total_orders),
    INDEX idx_active (last_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Read Model: Category Summary
CREATE TABLE IF NOT EXISTS read_model_category_summary (
    id INT PRIMARY KEY AUTO_INCREMENT,
    category VARCHAR(100) UNIQUE NOT NULL,
    product_count INT DEFAULT 0,
    total_orders INT DEFAULT 0,
    total_revenue DECIMAL(10,2) DEFAULT 0,
    last_updated DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_category (category),
    INDEX idx_orders (total_orders),
    INDEX idx_revenue (total_revenue)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Command History
CREATE TABLE IF NOT EXISTS cqrs_command_history (
    id INT PRIMARY KEY AUTO_INCREMENT,
    command_id VARCHAR(100) UNIQUE NOT NULL,
    command_type VARCHAR(100) NOT NULL,
    user_id VARCHAR(100) NOT NULL,
    payload JSON,
    result JSON,
    duration INT DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_type (command_type),
    INDEX idx_user (user_id),
    INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Query History
CREATE TABLE IF NOT EXISTS cqrs_query_history (
    id INT PRIMARY KEY AUTO_INCREMENT,
    query_type VARCHAR(100) NOT NULL,
    user_id VARCHAR(100) NOT NULL,
    params JSON,
    cache_hit BOOLEAN DEFAULT FALSE,
    duration INT DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_type (query_type),
    INDEX idx_user (user_id),
    INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- CQRS Dashboard View
CREATE VIEW cqrs_dashboard AS
SELECT 
    DATE(created_at) as date,
    COUNT(DISTINCT command_id) as total_commands,
    COUNT(DISTINCT query_type) as query_types,
    AVG(duration) as avg_duration
FROM cqrs_command_history
WHERE created_at > DATE_SUB(NOW(), INTERVAL 30 DAY)
GROUP BY DATE(created_at)
ORDER BY date DESC;