-- Policies Table
CREATE TABLE IF NOT EXISTS policies (
    id INT PRIMARY KEY AUTO_INCREMENT,
    policy_id VARCHAR(100) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    version VARCHAR(20) DEFAULT '1.0.0',
    type VARCHAR(50) NOT NULL,
    effect VARCHAR(20) NOT NULL,
    resources JSON NOT NULL,
    actions JSON NOT NULL,
    conditions JSON,
    priority INT DEFAULT 0,
    environment JSON,
    enabled BOOLEAN DEFAULT TRUE,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    INDEX idx_name (name),
    INDEX idx_type (type),
    INDEX idx_enabled (enabled)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Policy Evaluations
CREATE TABLE IF NOT EXISTS policy_evaluations (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id VARCHAR(100) NOT NULL,
    resource VARCHAR(255) NOT NULL,
    action VARCHAR(100) NOT NULL,
    context JSON,
    result JSON,
    evaluated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_user (user_id),
    INDEX idx_resource (resource(191)),
    INDEX idx_evaluated (evaluated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Policy Dashboard View
CREATE VIEW policy_dashboard AS
SELECT 
    DATE(evaluated_at) as date,
    COUNT(*) as total_evaluations,
    SUM(CASE WHEN JSON_EXTRACT(result, '$.allowed') = true THEN 1 ELSE 0 END) as allowed,
    SUM(CASE WHEN JSON_EXTRACT(result, '$.allowed') = false THEN 1 ELSE 0 END) as denied,
    COUNT(DISTINCT user_id) as unique_users
FROM policy_evaluations
WHERE evaluated_at > DATE_SUB(NOW(), INTERVAL 30 DAY)
GROUP BY DATE(evaluated_at)
ORDER BY date DESC;