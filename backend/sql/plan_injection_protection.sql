-- Secure Agent Memory
CREATE TABLE IF NOT EXISTS secure_agent_memory (
    id INT PRIMARY KEY AUTO_INCREMENT,
    memory_id VARCHAR(100) UNIQUE NOT NULL,
    agent_id VARCHAR(100) NOT NULL,
    encrypted_data TEXT NOT NULL,
    integrity_hash VARCHAR(255) NOT NULL,
    created_at DATETIME NOT NULL,
    last_accessed DATETIME NOT NULL,
    version INT DEFAULT 1,
    status ENUM('active', 'compromised', 'revoked') DEFAULT 'active',
    INDEX idx_agent (agent_id),
    INDEX idx_status (status),
    INDEX idx_version (version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Plan Injection Logs
CREATE TABLE IF NOT EXISTS plan_injection_logs (
    id INT PRIMARY KEY AUTO_INCREMENT,
    agent_id VARCHAR(100) NOT NULL,
    context JSON,
    validation JSON,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    resolved BOOLEAN DEFAULT FALSE,
    INDEX idx_agent (agent_id),
    INDEX idx_timestamp (timestamp)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Plan Injection Detections
CREATE TABLE IF NOT EXISTS plan_injection_detections (
    id INT PRIMARY KEY AUTO_INCREMENT,
    agent_id VARCHAR(100) NOT NULL,
    detection_type VARCHAR(50) NOT NULL,
    details JSON,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    mitigated BOOLEAN DEFAULT FALSE,
    INDEX idx_agent (agent_id),
    INDEX idx_type (detection_type),
    INDEX idx_timestamp (timestamp)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Injection Dashboard View
CREATE VIEW plan_injection_dashboard AS
SELECT 
    DATE(timestamp) as date,
    COUNT(*) as total_injections,
    COUNT(DISTINCT agent_id) as affected_agents,
    SUM(CASE WHEN mitigated = TRUE THEN 1 ELSE 0 END) as mitigated_injections,
    COUNT(DISTINCT detection_type) as attack_types
FROM plan_injection_detections
WHERE timestamp > DATE_SUB(NOW(), INTERVAL 30 DAY)
GROUP BY DATE(timestamp)
ORDER BY date DESC;