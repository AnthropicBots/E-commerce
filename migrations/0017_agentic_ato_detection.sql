-- Agentic ATO Baselines
CREATE TABLE IF NOT EXISTS agentic_ato_baselines (
    id INT PRIMARY KEY AUTO_INCREMENT,
    agent_id VARCHAR(100) UNIQUE NOT NULL,
    initialized_at DATETIME NOT NULL,
    last_updated DATETIME NOT NULL,
    merchant_profile JSON,
    basket_profile JSON,
    conversation_fingerprint JSON,
    mandate_profile JSON,
    behavioral_patterns JSON,
    credential_vault_pattern JSON,
    INDEX idx_agent (agent_id),
    INDEX idx_updated (last_updated)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Agentic ATO Anomalies
CREATE TABLE IF NOT EXISTS agentic_ato_anomalies (
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

-- Agentic ATO Alerts
CREATE TABLE IF NOT EXISTS agentic_ato_alerts (
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