-- Trajectory Fraud Data
CREATE TABLE IF NOT EXISTS trajectory_fraud_data (
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

-- Trajectory Fraud Alerts
CREATE TABLE IF NOT EXISTS trajectory_fraud_alerts (
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
    INDEX idx_escalation (escalation_level),
    INDEX idx_timestamp (timestamp)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Trajectory Dashboard View
CREATE VIEW trajectory_fraud_dashboard AS
SELECT 
    DATE(timestamp) as date,
    COUNT(DISTINCT session_id) as unique_sessions,
    AVG(average_risk) as avg_risk,
    SUM(CASE WHEN risk_level = 'critical' THEN 1 ELSE 0 END) as critical_sessions,
    SUM(CASE WHEN risk_level = 'high' THEN 1 ELSE 0 END) as high_sessions,
    SUM(CASE WHEN trend > 0 THEN 1 ELSE 0 END) as increasing_risk_sessions
FROM trajectory_fraud_data
WHERE timestamp > DATE_SUB(NOW(), INTERVAL 30 DAY)
GROUP BY DATE(timestamp)
ORDER BY date DESC;