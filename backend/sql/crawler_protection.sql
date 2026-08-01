-- Blocked IPs Table
CREATE TABLE IF NOT EXISTS blocked_ips (
    id INT PRIMARY KEY AUTO_INCREMENT,
    ip_address VARCHAR(45) UNIQUE NOT NULL,
    reason TEXT,
    blocked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME,
    unblocked_at DATETIME,
    INDEX idx_ip (ip_address),
    INDEX idx_blocked (blocked_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Crawler Traffic Logs
CREATE TABLE IF NOT EXISTS crawler_traffic_logs (
    id INT PRIMARY KEY AUTO_INCREMENT,
    ip_address VARCHAR(45) NOT NULL,
    user_agent TEXT,
    path VARCHAR(255),
    method VARCHAR(10),
    is_bot BOOLEAN DEFAULT FALSE,
    rate_limited BOOLEAN DEFAULT FALSE,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_ip (ip_address),
    INDEX idx_timestamp (timestamp)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Crawler Dashboard View
CREATE VIEW crawler_dashboard AS
SELECT 
    DATE(timestamp) as date,
    COUNT(*) as total_requests,
    SUM(CASE WHEN is_bot = 1 THEN 1 ELSE 0 END) as bot_requests,
    SUM(CASE WHEN rate_limited = 1 THEN 1 ELSE 0 END) as rate_limited,
    COUNT(DISTINCT ip_address) as unique_ips
FROM crawler_traffic_logs
WHERE timestamp > DATE_SUB(NOW(), INTERVAL 30 DAY)
GROUP BY DATE(timestamp)
ORDER BY date DESC;