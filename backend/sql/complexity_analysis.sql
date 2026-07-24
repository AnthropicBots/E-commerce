-- Complexity Analysis Table
CREATE TABLE IF NOT EXISTS complexity_analysis (
    id INT PRIMARY KEY AUTO_INCREMENT,
    coupling_score INT DEFAULT 0,
    cohesion_score INT DEFAULT 0,
    cyclomatic_score INT DEFAULT 0,
    dependency_depth_score INT DEFAULT 0,
    instability_score INT DEFAULT 0,
    maintainability_score INT DEFAULT 0,
    overall_score INT DEFAULT 0,
    details JSON,
    status VARCHAR(20) DEFAULT 'good',
    analyzed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_overall (overall_score),
    INDEX idx_analyzed (analyzed_at),
    INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Complexity Dashboard View
CREATE VIEW complexity_dashboard AS
SELECT 
    DATE(analyzed_at) as date,
    COUNT(*) as total_analyses,
    AVG(overall_score) as avg_score,
    MIN(overall_score) as min_score,
    MAX(overall_score) as max_score,
    AVG(coupling_score) as avg_coupling,
    AVG(cohesion_score) as avg_cohesion,
    AVG(maintainability_score) as avg_maintainability
FROM complexity_analysis
WHERE analyzed_at > DATE_SUB(NOW(), INTERVAL 30 DAY)
GROUP BY DATE(analyzed_at)
ORDER BY date DESC;