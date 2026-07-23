-- Agent Baselines
CREATE TABLE IF NOT EXISTS agent_baselines (
    id INT PRIMARY KEY AUTO_INCREMENT,
    agent_id VARCHAR(100) UNIQUE NOT NULL,
    user_id INT NOT NULL,
    established_at DATETIME NOT NULL,
    total_actions INT DEFAULT 0,
    avg_transaction_amount DECIMAL(10,2) DEFAULT 0,
    merchant_count INT DEFAULT 0,
    avg_conversation_length INT DEFAULT 0,
    avg_action_duration INT DEFAULT 0,
    permissions JSON,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_agent (agent_id),
    INDEX idx_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Agent Activity Logs
CREATE TABLE IF NOT EXISTS agent_activity_logs (
    id INT PRIMARY KEY AUTO_INCREMENT,
    agent_id VARCHAR(100) NOT NULL,
    action VARCHAR(50) NOT NULL,
    transaction_amount DECIMAL(10,2),
    merchant_id VARCHAR(100),
    conversation_length INT,
    action_duration INT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_agent (agent_id),
    INDEX idx_action (action),
    INDEX idx_timestamp (timestamp)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Agent Anomaly Logs
CREATE TABLE IF NOT EXISTS agent_anomaly_logs (
    id INT PRIMARY KEY AUTO_INCREMENT,
    agent_id VARCHAR(100) NOT NULL,
    risk_score INT DEFAULT 0,
    flags JSON,
    confidence DECIMAL(5,2) DEFAULT 0,
    details JSON,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    resolved BOOLEAN DEFAULT FALSE,
    resolved_by INT,
    resolution_notes TEXT,
    INDEX idx_agent (agent_id),
    INDEX idx_risk (risk_score),
    INDEX idx_timestamp (timestamp)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Agent Permission Logs
CREATE TABLE IF NOT EXISTS agent_permission_logs (
    id INT PRIMARY KEY AUTO_INCREMENT,
    agent_id VARCHAR(100) NOT NULL,
    permission VARCHAR(50) NOT NULL,
    granted_by INT,
    revoked_by INT,
    granted_at DATETIME,
    revoked_at DATETIME,
    INDEX idx_agent (agent_id),
    INDEX idx_permission (permission)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Agent Merchant Access
CREATE TABLE IF NOT EXISTS agent_merchant_access (
    id INT PRIMARY KEY AUTO_INCREMENT,
    agent_id VARCHAR(100) NOT NULL,
    merchant_id VARCHAR(100) NOT NULL,
    access_level ENUM('view', 'edit', 'admin') DEFAULT 'view',
    granted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY unique_access (agent_id, merchant_id),
    INDEX idx_agent (agent_id),
    INDEX idx_merchant (merchant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Anomaly Dashboard View
CREATE VIEW agent_anomaly_dashboard AS
SELECT 
    DATE(timestamp) as date,
    COUNT(*) as total_anomalies,
    SUM(CASE WHEN risk_score > 75 THEN 1 ELSE 0 END) as critical_anomalies,
    SUM(CASE WHEN risk_score > 50 AND risk_score <= 75 THEN 1 ELSE 0 END) as high_anomalies,
    SUM(CASE WHEN resolved = TRUE THEN 1 ELSE 0 END) as resolved_anomalies,
    AVG(risk_score) as avg_risk_score
FROM agent_anomaly_logs
WHERE timestamp > DATE_SUB(NOW(), INTERVAL 30 DAY)
GROUP BY DATE(timestamp)
ORDER BY date DESC;