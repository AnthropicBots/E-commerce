-- Module Maturity Analysis Table
CREATE TABLE IF NOT EXISTS module_maturity_analysis (
    id INT PRIMARY KEY AUTO_INCREMENT,
    total_modules INT DEFAULT 0,
    average_score DECIMAL(5,2) DEFAULT 0,
    levels JSON,
    modules JSON,
    recommendations JSON,
    details JSON,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_score (average_score),
    INDEX idx_timestamp (timestamp)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Maturity Dashboard View
CREATE VIEW maturity_dashboard AS
SELECT 
    DATE(timestamp) as date,
    COUNT(*) as total_analyses,
    AVG(average_score) as avg_score,
    MIN(average_score) as min_score,
    MAX(average_score) as max_score,
    SUM(CASE WHEN JSON_EXTRACT(levels, '$.critical') > 0 THEN 1 ELSE 0 END) as has_critical_modules
FROM module_maturity_analysis
WHERE timestamp > DATE_SUB(NOW(), INTERVAL 30 DAY)
GROUP BY DATE(timestamp)
ORDER BY date DESC;