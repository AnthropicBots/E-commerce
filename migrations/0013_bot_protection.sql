-- Bot Detection Logs
CREATE TABLE IF NOT EXISTS bot_detection_logs (
    id INT PRIMARY KEY AUTO_INCREMENT,
    ip_address VARCHAR(45) NOT NULL,
    user_agent VARCHAR(255),
    path VARCHAR(255),
    method VARCHAR(10),
    is_bot BOOLEAN DEFAULT FALSE,
    confidence INT DEFAULT 0,
    factors JSON,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_ip (ip_address),
    INDEX idx_bot (is_bot),
    INDEX idx_timestamp (timestamp),
    INDEX idx_path (path)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Device Fingerprints
CREATE TABLE IF NOT EXISTS device_fingerprints (
    id INT PRIMARY KEY AUTO_INCREMENT,
    fingerprint VARCHAR(255) UNIQUE NOT NULL,
    user_agent TEXT,
    first_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_seen DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    account_count INT DEFAULT 1,
    is_suspicious BOOLEAN DEFAULT FALSE,
    INDEX idx_fingerprint (fingerprint),
    INDEX idx_suspicious (is_suspicious)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Bot Protection Dashboard View
CREATE VIEW bot_protection_dashboard AS
SELECT 
    DATE(timestamp) as date,
    COUNT(*) as total_requests,
    SUM(CASE WHEN is_bot = 1 THEN 1 ELSE 0 END) as bot_requests,
    AVG(confidence) as avg_confidence,
    (SUM(CASE WHEN is_bot = 1 THEN 1 ELSE 0 END) / COUNT(*)) * 100 as bot_rate,
    COUNT(DISTINCT ip_address) as unique_ips
FROM bot_detection_logs
WHERE timestamp > DATE_SUB(NOW(), INTERVAL 30 DAY)
GROUP BY DATE(timestamp)
ORDER BY date DESC;