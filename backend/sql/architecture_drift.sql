-- Architecture Drift Reports
CREATE TABLE IF NOT EXISTS architecture_drift_reports (
    id INT PRIMARY KEY AUTO_INCREMENT,
    total_drifts INT DEFAULT 0,
    critical_count INT DEFAULT 0,
    high_count INT DEFAULT 0,
    medium_count INT DEFAULT 0,
    low_count INT DEFAULT 0,
    report JSON,
    reported_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_total (total_drifts),
    INDEX idx_reported (reported_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Architecture Drift Dashboard View
CREATE VIEW architecture_drift_dashboard AS
SELECT 
    DATE(reported_at) as date,
    COUNT(*) as total_reports,
    AVG(total_drifts) as avg_drifts,
    SUM(CASE WHEN total_drifts > 0 THEN 1 ELSE 0 END) as reports_with_drift,
    MIN(total_drifts) as min_drifts,
    MAX(total_drifts) as max_drifts
FROM architecture_drift_reports
WHERE reported_at > DATE_SUB(NOW(), INTERVAL 30 DAY)
GROUP BY DATE(reported_at)
ORDER BY date DESC;