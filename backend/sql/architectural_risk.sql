-- Architectural Risk Analysis Table
CREATE TABLE IF NOT EXISTS architectural_risk_analysis (
    id INT PRIMARY KEY AUTO_INCREMENT,
    overall_score INT DEFAULT 0,
    overall_level VARCHAR(20) DEFAULT 'low',
    modules JSON,
    summary JSON,
    recommendations JSON,
    details JSON,
    analyzed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_score (overall_score),
    INDEX idx_analyzed (analyzed_at),
    INDEX idx_level (overall_level)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Risk Dashboard View
CREATE VIEW risk_dashboard AS
SELECT 
    DATE(analyzed_at) as date,
    COUNT(*) as total_analyses,
    AVG(overall_score) as avg_score,
    MIN(overall_score) as min_score,
    MAX(overall_score) as max_score,
    SUM(CASE WHEN overall_level = 'Low Risk' THEN 1 ELSE 0 END) as low_risk_count,
    SUM(CASE WHEN overall_level = 'Critical Risk' THEN 1 ELSE 0 END) as critical_risk_count
FROM architectural_risk_analysis
WHERE analyzed_at > DATE_SUB(NOW(), INTERVAL 30 DAY)
GROUP BY DATE(analyzed_at)
ORDER BY date DESC;