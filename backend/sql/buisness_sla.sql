-- SLA Configuration Table
CREATE TABLE IF NOT EXISTS sla_config (
    id INT PRIMARY KEY AUTO_INCREMENT,
    metric_name VARCHAR(100) UNIQUE NOT NULL,
    threshold INT NOT NULL,
    warning_threshold INT NOT NULL,
    critical_threshold INT NOT NULL,
    unit VARCHAR(20) DEFAULT 'ms',
    active BOOLEAN DEFAULT TRUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- SLA Measurements Table
CREATE TABLE IF NOT EXISTS sla_measurements (
    id INT PRIMARY KEY AUTO_INCREMENT,
    measurement_id VARCHAR(100) UNIQUE NOT NULL,
    metric VARCHAR(100) NOT NULL,
    duration INT NOT NULL,
    severity VARCHAR(20) NOT NULL,
    metadata JSON,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_metric (metric),
    INDEX idx_severity (severity),
    INDEX idx_timestamp (timestamp)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- SLA Alerts Table
CREATE TABLE IF NOT EXISTS sla_alerts (
    id INT PRIMARY KEY AUTO_INCREMENT,
    alert_id VARCHAR(100) UNIQUE NOT NULL,
    metric VARCHAR(100) NOT NULL,
    duration INT NOT NULL,
    severity VARCHAR(20) NOT NULL,
    metadata JSON,
    threshold JSON,
    resolved BOOLEAN DEFAULT FALSE,
    resolution TEXT,
    resolved_at DATETIME,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_metric (metric),
    INDEX idx_severity (severity),
    INDEX idx_resolved (resolved),
    INDEX idx_timestamp (timestamp)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- SLA Dashboard View
CREATE VIEW sla_dashboard AS
SELECT 
    DATE(timestamp) as date,
    COUNT(*) as total_measurements,
    AVG(duration) as avg_duration,
    SUM(CASE WHEN severity = 'pass' THEN 1 ELSE 0 END) as passed,
    SUM(CASE WHEN severity = 'failure' THEN 1 ELSE 0 END) as failures,
    SUM(CASE WHEN severity = 'critical' THEN 1 ELSE 0 END) as criticals
FROM sla_measurements
WHERE timestamp > DATE_SUB(NOW(), INTERVAL 30 DAY)
GROUP BY DATE(timestamp)
ORDER BY date DESC;