-- Business Rules Table
CREATE TABLE IF NOT EXISTS business_rules (
    id INT PRIMARY KEY AUTO_INCREMENT,
    rule_id VARCHAR(100) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    type VARCHAR(50) NOT NULL,
    category VARCHAR(100),
    priority INT DEFAULT 0,
    conditions JSON,
    actions JSON,
    enabled BOOLEAN DEFAULT TRUE,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    expires_at DATETIME,
    metadata JSON,
    INDEX idx_type (type),
    INDEX idx_category (category),
    INDEX idx_enabled (enabled),
    INDEX idx_priority (priority),
    INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Rule Execution Logs
CREATE TABLE IF NOT EXISTS rule_execution_logs (
    id INT PRIMARY KEY AUTO_INCREMENT,
    rule_id VARCHAR(100) NOT NULL,
    context JSON,
    results JSON,
    executed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_rule (rule_id),
    INDEX idx_executed (executed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Rule Statistics View
CREATE VIEW rule_statistics AS
SELECT 
    DATE(created_at) as date,
    COUNT(*) as total_rules,
    COUNT(DISTINCT type) as rule_types,
    SUM(CASE WHEN enabled = 1 THEN 1 ELSE 0 END) as enabled_rules,
    COUNT(DISTINCT category) as categories
FROM business_rules
WHERE created_at > DATE_SUB(NOW(), INTERVAL 30 DAY)
GROUP BY DATE(created_at)
ORDER BY date DESC;