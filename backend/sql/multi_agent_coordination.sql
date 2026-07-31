-- Agent Registry
CREATE TABLE IF NOT EXISTS agent_registry (
    id INT PRIMARY KEY AUTO_INCREMENT,
    agent_id VARCHAR(100) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL,
    capabilities JSON,
    parent VARCHAR(100),
    subordinates JSON,
    permissions JSON,
    status ENUM('active', 'inactive', 'suspended') DEFAULT 'active',
    decision_count INT DEFAULT 0,
    approval_count INT DEFAULT 0,
    denial_count INT DEFAULT 0,
    delegated_count INT DEFAULT 0,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    INDEX idx_agent (agent_id),
    INDEX idx_role (role),
    INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Multi-Agent Decisions
CREATE TABLE IF NOT EXISTS multi_agent_decisions (
    id INT PRIMARY KEY AUTO_INCREMENT,
    agent_id VARCHAR(100) NOT NULL,
    decision JSON NOT NULL,
    approved BOOLEAN DEFAULT FALSE,
    score INT DEFAULT 0,
    flags JSON,
    context JSON,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_agent (agent_id),
    INDEX idx_approved (approved),
    INDEX idx_timestamp (timestamp)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Multi-Agent Alerts
CREATE TABLE IF NOT EXISTS multi_agent_alerts (
    id INT PRIMARY KEY AUTO_INCREMENT,
    alert_id VARCHAR(100) UNIQUE NOT NULL,
    agent_id VARCHAR(100) NOT NULL,
    severity VARCHAR(20) DEFAULT 'critical',
    evaluation JSON,
    resolved BOOLEAN DEFAULT FALSE,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_agent (agent_id),
    INDEX idx_severity (severity)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;