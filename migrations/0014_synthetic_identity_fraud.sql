-- Synthetic Identity Detections Table
CREATE TABLE IF NOT EXISTS synthetic_identity_detections (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_email VARCHAR(255),
    user_name VARCHAR(255),
    risk_score INT DEFAULT 0,
    risk_level ENUM('low', 'medium', 'high', 'critical') DEFAULT 'low',
    flags JSON,
    confidence DECIMAL(5,2) DEFAULT 0,
    recommendations JSON,
    ip_address VARCHAR(45),
    device_fingerprint VARCHAR(255),
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_email (user_email),
    INDEX idx_risk (risk_level),
    INDEX idx_timestamp (timestamp),
    INDEX idx_ip (ip_address)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- IP Reputation Table
CREATE TABLE IF NOT EXISTS ip_reputation (
    id INT PRIMARY KEY AUTO_INCREMENT,
    ip_address VARCHAR(45) UNIQUE NOT NULL,
    risk_score INT DEFAULT 0,
    total_attempts INT DEFAULT 0,
    fraud_count INT DEFAULT 0,
    last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_updated DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_ip (ip_address),
    INDEX idx_risk (risk_score),
    INDEX idx_last_seen (last_seen)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Device Fingerprint Tracking
-- `device_fingerprints` is owned by 0013_bot_protection.sql. This file used to
-- redeclare it with client-environment columns and without `is_suspicious`;
-- both declarations said IF NOT EXISTS, so whichever ran first decided the
-- shape and the disagreement never surfaced.
--
-- The agreed shape is the union: 0013 owns the table, the client-environment
-- columns are added here as an explicit ALTER.
ALTER TABLE device_fingerprints
    ADD COLUMN screen_resolution VARCHAR(50) NULL,
    ADD COLUMN timezone VARCHAR(50) NULL,
    ADD COLUMN language VARCHAR(50) NULL,
    ADD INDEX idx_device_fingerprints_last_seen (last_seen);

-- Velocity Monitoring View
CREATE VIEW velocity_monitoring AS
SELECT 
    ip_address,
    COUNT(*) as account_count,
    MAX(created_at) as last_account,
    TIMESTAMPDIFF(HOUR, MIN(created_at), MAX(created_at)) as hours_span,
    CASE 
        WHEN COUNT(*) > 5 THEN 'HIGH'
        WHEN COUNT(*) > 3 THEN 'MEDIUM'
        ELSE 'LOW'
    END as velocity_risk
FROM users
WHERE created_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)
GROUP BY ip_address
HAVING account_count > 2
ORDER BY account_count DESC;

-- Fraud Detection Dashboard View
-- Named for the feature it reports on; see 0010 for why.
CREATE VIEW synthetic_identity_fraud_dashboard AS
SELECT 
    DATE(timestamp) as date,
    COUNT(*) as total_detections,
    SUM(CASE WHEN risk_level = 'critical' THEN 1 ELSE 0 END) as critical_count,
    SUM(CASE WHEN risk_level = 'high' THEN 1 ELSE 0 END) as high_count,
    SUM(CASE WHEN risk_level = 'medium' THEN 1 ELSE 0 END) as medium_count,
    AVG(risk_score) as avg_risk_score,
    AVG(confidence) as avg_confidence
FROM synthetic_identity_detections
WHERE timestamp > DATE_SUB(NOW(), INTERVAL 30 DAY)
GROUP BY DATE(timestamp)
ORDER BY date DESC;