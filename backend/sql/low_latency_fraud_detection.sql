-- Low Latency Detections
CREATE TABLE IF NOT EXISTS low_latency_detections (
    id INT PRIMARY KEY AUTO_INCREMENT,
    session_id VARCHAR(100) NOT NULL,
    risk_history JSON,
    current_risk INT DEFAULT 0,
    average_risk INT DEFAULT 0,
    max_risk INT DEFAULT 0,
    trend INT DEFAULT 0,
    risk_level ENUM('low', 'medium', 'high', 'critical') DEFAULT 'low',
    alert_data JSON,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_session (session_id),
    INDEX idx_risk (risk_level),
    INDEX idx_timestamp (timestamp)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Low Latency Alerts
CREATE TABLE IF NOT EXISTS low_latency_alerts (
    id INT PRIMARY KEY AUTO_INCREMENT,
    session_id VARCHAR(100) NOT NULL,
    risk_level ENUM('low', 'medium', 'high', 'critical') DEFAULT 'low',
    escalation_level ENUM('low', 'medium', 'high', 'critical') DEFAULT 'low',
    pattern JSON,
    details JSON,
    resolved BOOLEAN DEFAULT FALSE,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_session (session_id),
    INDEX idx_risk (risk_level),
    INDEX idx_escalation (escalation_level)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;