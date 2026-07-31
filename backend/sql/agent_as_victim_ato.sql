-- Agent Behavioral Baselines
CREATE TABLE IF NOT EXISTS agent_behavioral_baselines (
    id INT PRIMARY KEY AUTO_INCREMENT,
    agent_id VARCHAR(100) UNIQUE NOT NULL,
    initialized_at DATETIME NOT NULL,
    last_updated DATETIME NOT NULL,
    merchant_profile JSON,
    basket_profile JSON,
    conversation_fingerprint JSON,
    mandate_profile JSON,
    behavioral_patterns JSON,
    INDEX idx_agent (agent_id),
    INDEX idx_updated (last_updated)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Agent Behavioral Anomalies
CREATE TABLE IF NOT EXISTS agent_behavioral_anomalies (
    id INT PRIMARY KEY AUTO_INCREMENT,
    agent_id VARCHAR(100) NOT NULL,
    confidence INT DEFAULT 0,
    flags JSON,
    details JSON,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_agent (agent_id),
    INDEX idx_confidence (confidence),
    INDEX idx_timestamp (timestamp)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Agent Compromise Alerts
CREATE TABLE IF NOT EXISTS agent_compromise_alerts (
    id INT PRIMARY KEY AUTO_INCREMENT,
    agent_id VARCHAR(100) NOT NULL,
    confidence INT DEFAULT 0,
    flags JSON,
    details JSON,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    resolved BOOLEAN DEFAULT FALSE,
    resolved_at DATETIME,
    resolution_notes TEXT,
    INDEX idx_agent (agent_id),
    INDEX idx_resolved (resolved),
    INDEX idx_timestamp (timestamp)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Agent-as-Victim ATO Dashboard View
CREATE VIEW agent_ato_dashboard AS
SELECT 
    DATE(timestamp) as date,
    COUNT(DISTINCT agent_id) as unique_agents,
    AVG(confidence) as avg_confidence,
    SUM(CASE WHEN confidence > 60 THEN 1 ELSE 0 END) as high_confidence_alerts,
    SUM(CASE WHEN resolved = FALSE THEN 1 ELSE 0 END) as pending_alerts
FROM agent_compromise_alerts
WHERE timestamp > DATE_SUB(NOW(), INTERVAL 30 DAY)
GROUP BY DATE(timestamp)
ORDER BY date DESC;