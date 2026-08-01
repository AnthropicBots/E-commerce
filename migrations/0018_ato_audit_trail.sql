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

-- `agentic_ato_alerts` is owned by 0017_agentic_ato_detection.sql. The copy that
-- used to live here declared `severity` but not the resolution columns, and
-- widened agent_id to VARCHAR(255); with both saying IF NOT EXISTS, apply order
-- decided which shape the database got.
--
-- The agreed shape is 0017's, which keeps agent_id consistent with every other
-- agent table at VARCHAR(100); `severity` is added here as an explicit ALTER.
ALTER TABLE agentic_ato_alerts
    ADD COLUMN severity VARCHAR(20) DEFAULT 'low',
    ADD INDEX idx_agentic_ato_alerts_severity (severity);