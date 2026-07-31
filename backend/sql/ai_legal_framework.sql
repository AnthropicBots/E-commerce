-- AI Audit Logs Table
CREATE TABLE IF NOT EXISTS ai_audit_logs (
    id INT PRIMARY KEY AUTO_INCREMENT,
    session_id VARCHAR(100) NOT NULL,
    type VARCHAR(50) NOT NULL,
    data JSON NOT NULL,
    level ENUM('info', 'warning', 'error', 'critical') DEFAULT 'info',
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_session (session_id),
    INDEX idx_type (type),
    INDEX idx_timestamp (timestamp),
    INDEX idx_level (level)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- AI Certificates Table
CREATE TABLE IF NOT EXISTS ai_certificates (
    id VARCHAR(100) PRIMARY KEY,
    session_id VARCHAR(100) NOT NULL,
    action VARCHAR(100) NOT NULL,
    details JSON NOT NULL,
    timestamp DATETIME NOT NULL,
    hash VARCHAR(255) NOT NULL,
    signature VARCHAR(255) NOT NULL,
    status ENUM('active', 'revoked') DEFAULT 'active',
    version VARCHAR(10) DEFAULT '1.0.0',
    revoked_at DATETIME,
    revocation_reason TEXT,
    INDEX idx_session (session_id),
    INDEX idx_status (status),
    INDEX idx_timestamp (timestamp),
    FOREIGN KEY (session_id) REFERENCES ai_audit_logs(session_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- AI Negotiation Logs Table
CREATE TABLE IF NOT EXISTS ai_negotiation_logs (
    id INT PRIMARY KEY AUTO_INCREMENT,
    session_id VARCHAR(100) NOT NULL,
    step VARCHAR(50) NOT NULL,
    data JSON NOT NULL,
    metadata JSON,
    hash VARCHAR(255) NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_session (session_id),
    INDEX idx_step (step),
    INDEX idx_timestamp (timestamp)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Regulatory Compliance Dashboard View
CREATE VIEW regulatory_compliance_dashboard AS
SELECT 
    DATE(timestamp) as date,
    COUNT(*) as total_logs,
    COUNT(DISTINCT session_id) as active_sessions,
    SUM(CASE WHEN level = 'critical' THEN 1 ELSE 0 END) as critical_events,
    SUM(CASE WHEN type = 'certificate_created' THEN 1 ELSE 0 END) as certificates_issued,
    AVG(CASE WHEN type = 'decision_point' THEN 1 ELSE 0 END) as avg_decisions_per_session
FROM ai_audit_logs
GROUP BY DATE(timestamp)
ORDER BY date DESC;

-- Audit Retention Policy (7 years)
CREATE EVENT clean_old_audit_logs
ON SCHEDULE EVERY 1 DAY
DO
    DELETE FROM ai_audit_logs 
    WHERE timestamp < DATE_SUB(NOW(), INTERVAL 2555 DAY); -- 7 years