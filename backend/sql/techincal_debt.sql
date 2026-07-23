-- Technical Debt Analysis Table
CREATE TABLE IF NOT EXISTS technical_debt_analysis (
    id INT PRIMARY KEY AUTO_INCREMENT,
    overall_score INT DEFAULT 0,
    categories JSON,
    metrics JSON,
    recommendations JSON,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_score (overall_score),
    INDEX idx_timestamp (timestamp)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Technical Debt Dashboard View
CREATE VIEW technical_debt_dashboard AS
SELECT 
    DATE(timestamp) as date,
    COUNT(*) as total_analyses,
    AVG(overall_score) as avg_score,
    MIN(overall_score) as min_score,
    MAX(overall_score) as max_score,
    SUM(CASE WHEN overall_score < 30 THEN 1 ELSE 0 END) as low_debt_count,
    SUM(CASE WHEN overall_score > 60 THEN 1 ELSE 0 END) as high_debt_count
FROM technical_debt_analysis
WHERE timestamp > DATE_SUB(NOW(), INTERVAL 30 DAY)
GROUP BY DATE(timestamp)
ORDER BY date DESC;