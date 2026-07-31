-- Config Integrity Results
CREATE TABLE IF NOT EXISTS config_integrity_results (
    id INT PRIMARY KEY AUTO_INCREMENT,
    verified BOOLEAN DEFAULT FALSE,
    entries JSON,
    errors JSON,
    warnings JSON,
    result_timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_verified (verified),
    INDEX idx_timestamp (result_timestamp)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Config Integrity Alerts
CREATE TABLE IF NOT EXISTS config_integrity_alerts (
    id INT PRIMARY KEY AUTO_INCREMENT,
    alert_id VARCHAR(100) UNIQUE NOT NULL,
    type VARCHAR(50) NOT NULL,
    severity VARCHAR(20) DEFAULT 'critical',
    results JSON,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    resolved BOOLEAN DEFAULT FALSE,
    resolved_at DATETIME,
    resolution TEXT,
    INDEX idx_type (type),
    INDEX idx_severity (severity),
    INDEX idx_resolved (resolved)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;