-- Impact Analysis Reports
CREATE TABLE IF NOT EXISTS impact_analysis_reports (
    id INT PRIMARY KEY AUTO_INCREMENT,
    affected_files JSON,
    affected_services JSON,
    affected_apis JSON,
    affected_events JSON,
    severity VARCHAR(20) NOT NULL,
    recommendations JSON,
    summary JSON,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_severity (severity),
    INDEX idx_timestamp (timestamp)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Impact Dashboard View
CREATE VIEW impact_dashboard AS
SELECT 
    DATE(timestamp) as date,
    COUNT(*) as total_reports,
    SUM(CASE WHEN severity = 'critical' THEN 1 ELSE 0 END) as critical_reports,
    SUM(CASE WHEN severity = 'high' THEN 1 ELSE 0 END) as high_reports,
    AVG(JSON_LENGTH(affected_files)) as avg_files_affected,
    AVG(JSON_LENGTH(affected_services)) as avg_services_affected
FROM impact_analysis_reports
WHERE timestamp > DATE_SUB(NOW(), INTERVAL 30 DAY)
GROUP BY DATE(timestamp)
ORDER BY date DESC;