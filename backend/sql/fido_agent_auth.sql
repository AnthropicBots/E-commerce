-- FIDO Challenges
CREATE TABLE IF NOT EXISTS fido_challenges (
    id INT PRIMARY KEY AUTO_INCREMENT,
    challenge_id VARCHAR(100) UNIQUE NOT NULL,
    agent_id VARCHAR(100) NOT NULL,
    user_id VARCHAR(100) NOT NULL,
    challenge VARCHAR(255) NOT NULL,
    expires_at DATETIME NOT NULL,
    status ENUM('pending', 'verified', 'expired') DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_agent (agent_id),
    INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- FIDO Agent Credentials
CREATE TABLE IF NOT EXISTS fido_agent_credentials (
    id INT PRIMARY KEY AUTO_INCREMENT,
    credential_id VARCHAR(100) UNIQUE NOT NULL,
    agent_id VARCHAR(100) UNIQUE NOT NULL,
    user_id VARCHAR(100) NOT NULL,
    public_key TEXT NOT NULL,
    user_instruction JSON,
    verified_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    status ENUM('active', 'suspended', 'revoked') DEFAULT 'active',
    INDEX idx_agent (agent_id),
    INDEX idx_user (user_id),
    INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- FIDO Delegations
CREATE TABLE IF NOT EXISTS fido_delegations (
    id INT PRIMARY KEY AUTO_INCREMENT,
    delegation_id VARCHAR(100) UNIQUE NOT NULL,
    agent_id VARCHAR(100) NOT NULL,
    user_id VARCHAR(100) NOT NULL,
    scope VARCHAR(50) NOT NULL,
    parameters JSON,
    expires_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    status ENUM('active', 'revoked', 'expired') DEFAULT 'active',
    revoke_reason TEXT,
    revoked_at DATETIME,
    verifiable_instruction JSON,
    INDEX idx_agent (agent_id),
    INDEX idx_user (user_id),
    INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- FIDO Agent Actions
CREATE TABLE IF NOT EXISTS fido_agent_actions (
    id INT PRIMARY KEY AUTO_INCREMENT,
    agent_id VARCHAR(100) NOT NULL,
    action VARCHAR(50) NOT NULL,
    data JSON,
    delegation_id VARCHAR(100),
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_agent (agent_id),
    INDEX idx_action (action),
    INDEX idx_timestamp (timestamp)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;