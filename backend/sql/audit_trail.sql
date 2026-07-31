-- Audit Logs Table
CREATE TABLE IF NOT EXISTS audit_logs (
    id INT PRIMARY KEY AUTO_INCREMENT,
    audit_id VARCHAR(100) UNIQUE NOT NULL,
    actor VARCHAR(255) NOT NULL,
    actor_id VARCHAR(100),
    actor_ip VARCHAR(45),
    actor_user_agent TEXT,
    action VARCHAR(100) NOT NULL,
    resource VARCHAR(50) NOT NULL,
    resource_id VARCHAR(100),
    previous_state JSON,
    updated_state JSON,
    changes JSON,
    metadata JSON,
    hash VARCHAR(255) NOT NULL,
    timestamp DATETIME NOT NULL,
    INDEX idx_actor (actor_id),
    INDEX idx_action (action),
    INDEX idx_resource (resource),
    INDEX idx_resource_id (resource_id),
    INDEX idx_timestamp (timestamp)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Audit Dashboard View
CREATE VIEW audit_dashboard AS
SELECT 
    DATE(timestamp) as date,
    COUNT(*) as total_entries,
    COUNT(DISTINCT actor_id) as unique_actors,
    COUNT(DISTINCT action) as unique_actions,
    COUNT(DISTINCT resource) as unique_resources
FROM audit_logs
WHERE timestamp > DATE_SUB(NOW(), INTERVAL 30 DAY)
GROUP BY DATE(timestamp)
ORDER BY date DESC;