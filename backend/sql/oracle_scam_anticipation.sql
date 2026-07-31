-- ORACLE Trajectory Data
CREATE TABLE IF NOT EXISTS oracle_trajectory_data (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id VARCHAR(100) NOT NULL,
    app_history JSON,
    interactions JSON,
    detected_patterns JSON,
    scam_probability DECIMAL(5,2) DEFAULT 0,
    confidence DECIMAL(5,2) DEFAULT 0,
    risk_level ENUM('low', 'medium', 'high', 'critical') DEFAULT 'low',
    warning_data JSON,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    trajectory_days INT DEFAULT 0,
    INDEX idx_user (user_id),
    INDEX idx_risk (risk_level),
    INDEX idx_timestamp (timestamp)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ORACLE Warnings
CREATE TABLE IF NOT EXISTS oracle_warnings (
    id INT PRIMARY KEY AUTO_INCREMENT,
    warning_id VARCHAR(100) UNIQUE NOT NULL,
    user_id VARCHAR(100) NOT NULL,
    risk_level ENUM('low', 'medium', 'high', 'critical') DEFAULT 'low',
    scam_probability DECIMAL(5,2) DEFAULT 0,
    confidence DECIMAL(5,2) DEFAULT 0,
    detected_scams JSON,
    early_signals JSON,
    recommendations JSON,
    resolved BOOLEAN DEFAULT FALSE,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_user (user_id),
    INDEX idx_risk (risk_level),
    INDEX idx_warning (warning_id),
    INDEX idx_timestamp (timestamp)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ORACLE Context Data
CREATE TABLE IF NOT EXISTS oracle_context_data (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id VARCHAR(100) UNIQUE NOT NULL,
    patterns JSON,
    confidence DECIMAL(5,2) DEFAULT 0,
    last_updated DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_user (user_id),
    INDEX idx_confidence (confidence)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ORACLE Dashboard View
CREATE VIEW oracle_dashboard AS
SELECT 
    DATE(timestamp) as date,
    COUNT(DISTINCT user_id) as unique_users,
    AVG(scam_probability) as avg_scam_probability,
    SUM(CASE WHEN risk_level = 'critical' THEN 1 ELSE 0 END) as critical_trajectories,
    SUM(CASE WHEN risk_level = 'high' THEN 1 ELSE 0 END) as high_trajectories,
    AVG(confidence) as avg_confidence,
    AVG(trajectory_days) as avg_trajectory_days
FROM oracle_trajectory_data
WHERE timestamp > DATE_SUB(NOW(), INTERVAL 30 DAY)
GROUP BY DATE(timestamp)
ORDER BY date DESC;