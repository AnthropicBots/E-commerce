-- Agentic Fraud Evaluations
CREATE TABLE IF NOT EXISTS agentic_fraud_evaluations (
    id INT PRIMARY KEY AUTO_INCREMENT,
    agent_id VARCHAR(100) NOT NULL,
    trust_score INT DEFAULT 0,
    risk_level ENUM('low', 'medium', 'high', 'critical') DEFAULT 'low',
    is_fraudulent BOOLEAN DEFAULT FALSE,
    flags JSON,
    recommendations JSON,
    context JSON,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_agent (agent_id),
    INDEX idx_risk (risk_level),
    INDEX idx_fraud (is_fraudulent),
    INDEX idx_timestamp (timestamp)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Provider Reputation
CREATE TABLE IF NOT EXISTS provider_reputation (
    id INT PRIMARY KEY AUTO_INCREMENT,
    provider VARCHAR(50) UNIQUE NOT NULL,
    score INT DEFAULT 50,
    total_agents INT DEFAULT 0,
    fraud_count INT DEFAULT 0,
    last_updated DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_provider (provider),
    INDEX idx_score (score)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Agentic Fraud Dashboard View
CREATE VIEW agentic_fraud_dashboard AS
SELECT 
    DATE(timestamp) as date,
    COUNT(*) as total_evaluations,
    SUM(CASE WHEN risk_level = 'critical' THEN 1 ELSE 0 END) as critical_alerts,
    SUM(CASE WHEN risk_level = 'high' THEN 1 ELSE 0 END) as high_alerts,
    SUM(CASE WHEN is_fraudulent = 1 THEN 1 ELSE 0 END) as fraud_detected,
    AVG(trust_score) as avg_trust_score,
    COUNT(DISTINCT agent_id) as unique_agents
FROM agentic_fraud_evaluations
WHERE timestamp > DATE_SUB(NOW(), INTERVAL 30 DAY)
GROUP BY DATE(timestamp)
ORDER BY date DESC;