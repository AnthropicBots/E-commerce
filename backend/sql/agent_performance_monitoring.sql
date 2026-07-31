-- Agent Performance History
CREATE TABLE IF NOT EXISTS agent_performance_history (
    id INT PRIMARY KEY AUTO_INCREMENT,
    agent_id VARCHAR(100) NOT NULL,
    transaction_id VARCHAR(100) NOT NULL,
    model_type VARCHAR(50),
    success BOOLEAN DEFAULT FALSE,
    duration INT DEFAULT 0,
    score INT DEFAULT 0,
    metrics JSON,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_agent (agent_id),
    INDEX idx_model (model_type),
    INDEX idx_timestamp (timestamp)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Agent Feedback
CREATE TABLE IF NOT EXISTS agent_feedback (
    id INT PRIMARY KEY AUTO_INCREMENT,
    agent_id VARCHAR(100) NOT NULL,
    user_id VARCHAR(100) NOT NULL,
    rating INT DEFAULT 0,
    comment TEXT,
    category VARCHAR(50),
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_agent (agent_id),
    INDEX idx_user (user_id),
    INDEX idx_timestamp (timestamp)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Performance Alerts
CREATE TABLE IF NOT EXISTS performance_alerts (
    id INT PRIMARY KEY AUTO_INCREMENT,
    alert_id VARCHAR(100) UNIQUE NOT NULL,
    agent_id VARCHAR(100) NOT NULL,
    severity VARCHAR(20) DEFAULT 'warning',
    message TEXT,
    performance_data JSON,
    resolved BOOLEAN DEFAULT FALSE,
    resolution TEXT,
    resolved_at DATETIME,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_agent (agent_id),
    INDEX idx_severity (severity),
    INDEX idx_resolved (resolved)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Performance Dashboard View
CREATE VIEW performance_dashboard AS
SELECT 
    DATE(timestamp) as date,
    COUNT(*) as total_transactions,
    AVG(score) as avg_score,
    AVG(success) as success_rate,
    COUNT(DISTINCT agent_id) as active_agents,
    COUNT(DISTINCT model_type) as active_models
FROM agent_performance_history
WHERE timestamp > DATE_SUB(NOW(), INTERVAL 30 DAY)
GROUP BY DATE(timestamp)
ORDER BY date DESC;