-- Fitness Rules Table
CREATE TABLE IF NOT EXISTS fitness_rules (
    id INT PRIMARY KEY AUTO_INCREMENT,
    rule_name VARCHAR(100) UNIQUE NOT NULL,
    description TEXT,
    severity ENUM('error', 'warning', 'info') DEFAULT 'warning',
    check_function TEXT NOT NULL,
    enabled BOOLEAN DEFAULT TRUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_name (rule_name),
    INDEX idx_enabled (enabled)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Fitness Reports Table
CREATE TABLE IF NOT EXISTS fitness_reports (
    id INT PRIMARY KEY AUTO_INCREMENT,
    score INT DEFAULT 0,
    violations INT DEFAULT 0,
    errors INT DEFAULT 0,
    warnings INT DEFAULT 0,
    report JSON,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_score (score),
    INDEX idx_timestamp (timestamp)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Fitness Dashboard View
CREATE VIEW fitness_dashboard AS
SELECT 
    DATE(timestamp) as date,
    COUNT(*) as total_runs,
    AVG(score) as avg_score,
    MIN(score) as min_score,
    MAX(score) as max_score,
    AVG(violations) as avg_violations
FROM fitness_reports
WHERE timestamp > DATE_SUB(NOW(), INTERVAL 30 DAY)
GROUP BY DATE(timestamp)
ORDER BY date DESC;