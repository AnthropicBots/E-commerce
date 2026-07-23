-- backend/sql/ato_audit_trail.sql

CREATE TABLE IF NOT EXISTS ato_audit_trail (
    id VARCHAR(36) PRIMARY KEY,
    action VARCHAR(100) NOT NULL,
    actor VARCHAR(255) NOT NULL,
    target VARCHAR(255),
    details JSON,
    status VARCHAR(50),
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    ip VARCHAR(45),
    user_agent TEXT,
    INDEX idx_action (action),
    INDEX idx_actor (actor),
    INDEX idx_status (status),
    INDEX idx_timestamp (timestamp)
);

CREATE TABLE IF NOT EXISTS agentic_ato_alerts (
    id INT PRIMARY KEY AUTO_INCREMENT,
    agent_id VARCHAR(255) NOT NULL,
    confidence INT DEFAULT 0,
    flags JSON,
    details JSON,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    resolved BOOLEAN DEFAULT FALSE,
    severity VARCHAR(20) DEFAULT 'low',
    INDEX idx_agent_id (agent_id),
    INDEX idx_severity (severity),
    INDEX idx_resolved (resolved),
    INDEX idx_timestamp (timestamp)
);