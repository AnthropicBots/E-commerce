-- FACT Trust Records
CREATE TABLE IF NOT EXISTS fact_trust_records (
    id INT PRIMARY KEY AUTO_INCREMENT,
    agent_id VARCHAR(100) UNIQUE NOT NULL,
    trust_level INT DEFAULT 0,
    trust_score INT DEFAULT 0,
    created_at DATETIME NOT NULL,
    last_verified DATETIME NOT NULL,
    attestations JSON,
    policies JSON,
    constraints JSON,
    auditor_id VARCHAR(100),
    status ENUM('active', 'suspended', 'revoked') DEFAULT 'active',
    INDEX idx_agent (agent_id),
    INDEX idx_trust (trust_score),
    INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- FACT Attestations
CREATE TABLE IF NOT EXISTS fact_attestations (
    id VARCHAR(100) PRIMARY KEY,
    agent_id VARCHAR(100) NOT NULL,
    type VARCHAR(50) NOT NULL,
    data JSON,
    timestamp DATETIME NOT NULL,
    hash VARCHAR(255) NOT NULL,
    signature VARCHAR(255) NOT NULL,
    status ENUM('active', 'revoked') DEFAULT 'active',
    INDEX idx_agent (agent_id),
    INDEX idx_type (type),
    INDEX idx_timestamp (timestamp)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- FACT Verifications
CREATE TABLE IF NOT EXISTS fact_verifications (
    id INT PRIMARY KEY AUTO_INCREMENT,
    agent_id VARCHAR(100) NOT NULL,
    action VARCHAR(50) NOT NULL,
    context JSON,
    verified BOOLEAN DEFAULT FALSE,
    trust_score INT DEFAULT 0,
    attestation_id VARCHAR(100),
    violations JSON,
    auditor_observations JSON,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_agent (agent_id),
    INDEX idx_verified (verified),
    INDEX idx_timestamp (timestamp)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- FACT Auditor Agents
CREATE TABLE IF NOT EXISTS fact_auditor_agents (
    id INT PRIMARY KEY AUTO_INCREMENT,
    auditor_id VARCHAR(100) UNIQUE NOT NULL,
    assigned_agent VARCHAR(100) NOT NULL,
    status ENUM('active', 'inactive') DEFAULT 'active',
    initialized_at DATETIME,
    last_verification DATETIME,
    verification_count INT DEFAULT 0,
    INDEX idx_auditor (auditor_id),
    INDEX idx_agent (assigned_agent)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- FACT Trust Alerts
CREATE TABLE IF NOT EXISTS fact_trust_alerts (
    id VARCHAR(100) PRIMARY KEY,
    agent_id VARCHAR(100) NOT NULL,
    type VARCHAR(50) NOT NULL,
    severity ENUM('low', 'medium', 'high', 'critical') DEFAULT 'medium',
    verification JSON,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    resolved BOOLEAN DEFAULT FALSE,
    resolved_at DATETIME,
    resolution_notes TEXT,
    INDEX idx_agent (agent_id),
    INDEX idx_severity (severity),
    INDEX idx_resolved (resolved)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;