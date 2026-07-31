-- Agent Negotiation Performance
CREATE TABLE IF NOT EXISTS agent_negotiation_performance (
    id INT PRIMARY KEY AUTO_INCREMENT,
    agent_id VARCHAR(100) NOT NULL,
    transaction_id VARCHAR(100),
    item_id VARCHAR(100),
    target_price DECIMAL(10,2),
    achieved_price DECIMAL(10,2),
    model_type VARCHAR(50),
    duration INT DEFAULT 0,
    success BOOLEAN DEFAULT TRUE,
    metrics JSON,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_agent (agent_id),
    INDEX idx_model (model_type),
    INDEX idx_timestamp (timestamp),
    INDEX idx_success (success)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Agent Performance Alerts
CREATE TABLE IF NOT EXISTS agent_performance_alerts (
    id INT PRIMARY KEY AUTO_INCREMENT,
    agent_id VARCHAR(100) NOT NULL,
    type VARCHAR(50) NOT NULL,
    severity ENUM('info', 'warning', 'critical') DEFAULT 'warning',
    message TEXT,
    current DECIMAL(10,2),
    average DECIMAL(10,2),
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    resolved BOOLEAN DEFAULT FALSE,
    resolved_by INT,
    resolved_at DATETIME,
    INDEX idx_agent (agent_id),
    INDEX idx_severity (severity),
    INDEX idx_resolved (resolved)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Agent Feedback
CREATE TABLE IF NOT EXISTS agent_feedback (
    id INT PRIMARY KEY AUTO_INCREMENT,
    agent_id VARCHAR(100) NOT NULL,
    user_id INT NOT NULL,
    satisfaction INT DEFAULT 0,
    fairness INT DEFAULT 0,
    effectiveness INT DEFAULT 0,
    speed INT DEFAULT 0,
    comment TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_agent (agent_id),
    INDEX idx_user (user_id),
    INDEX idx_timestamp (timestamp)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Performance Dashboard View
CREATE VIEW agent_performance_dashboard AS
SELECT 
    DATE(timestamp) as date,
    COUNT(*) as total_negotiations,
    SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successful,
    AVG(achieved_price - target_price) as avg_optimization,
    AVG(duration) as avg_duration,
    COUNT(DISTINCT agent_id) as active_agents,
    COUNT(DISTINCT model_type) as active_models
FROM agent_negotiation_performance
WHERE timestamp > DATE_SUB(NOW(), INTERVAL 30 DAY)
GROUP BY DATE(timestamp)
ORDER BY date DESC;

-- Model Comparison View
CREATE VIEW model_comparison AS
SELECT 
    model_type,
    COUNT(*) as total_transactions,
    AVG(achieved_price - target_price) as avg_optimization,
    AVG(duration) as avg_duration,
    AVG(CASE WHEN success = 1 THEN 1 ELSE 0 END) * 100 as success_rate,
    COUNT(DISTINCT agent_id) as agent_count
FROM agent_negotiation_performance
WHERE timestamp > DATE_SUB(NOW(), INTERVAL 30 DAY)
GROUP BY model_type
ORDER BY avg_optimization DESC;