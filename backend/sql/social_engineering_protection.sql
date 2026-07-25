-- Hard Limits Table
CREATE TABLE IF NOT EXISTS hard_limits (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(100) UNIQUE NOT NULL,
    value JSON NOT NULL,
    active BOOLEAN DEFAULT TRUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_name (name),
    INDEX idx_active (active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Suspicious Patterns Table
CREATE TABLE IF NOT EXISTS suspicious_patterns (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(100) UNIQUE NOT NULL,
    pattern TEXT NOT NULL,
    severity VARCHAR(20) DEFAULT 'medium',
    action VARCHAR(50) DEFAULT 'block',
    active BOOLEAN DEFAULT TRUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_name (name),
    INDEX idx_active (active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Authority Verification Logs
CREATE TABLE IF NOT EXISTS authority_verification_logs (
    id INT PRIMARY KEY AUTO_INCREMENT,
    agent_id VARCHAR(100) NOT NULL,
    authority VARCHAR(100),
    action VARCHAR(50),
    confidence DECIMAL(5,2) DEFAULT 0,
    verified BOOLEAN DEFAULT FALSE,
    flags JSON,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_agent (agent_id),
    INDEX idx_verified (verified),
    INDEX idx_timestamp (timestamp)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Social Engineering Alerts
CREATE TABLE IF NOT EXISTS social_engineering_alerts (
    id INT PRIMARY KEY AUTO_INCREMENT,
    alert_id VARCHAR(100) UNIQUE NOT NULL,
    agent_id VARCHAR(100) NOT NULL,
    severity VARCHAR(20) DEFAULT 'high',
    details JSON,
    flags JSON,
    resolved BOOLEAN DEFAULT FALSE,
    resolution TEXT,
    resolved_at DATETIME,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_agent (agent_id),
    INDEX idx_severity (severity),
    INDEX idx_resolved (resolved)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;