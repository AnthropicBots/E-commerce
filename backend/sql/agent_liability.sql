-- Agent Liability Registrations
CREATE TABLE IF NOT EXISTS agent_liability_registrations (
    id INT PRIMARY KEY AUTO_INCREMENT,
    agent_id VARCHAR(100) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    owner_id VARCHAR(100) NOT NULL,
    owner_type ENUM('merchant', 'customer', 'third-party') DEFAULT 'merchant',
    liability_tier ENUM('FULL', 'PARTIAL', 'LIMITED', 'NONE') DEFAULT 'PARTIAL',
    insurance_active BOOLEAN DEFAULT FALSE,
    max_transaction_limit DECIMAL(10,2) DEFAULT 50000,
    permissions JSON,
    status ENUM('active', 'inactive', 'suspended') DEFAULT 'active',
    public_key TEXT,
    registered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_agent (agent_id),
    INDEX idx_owner (owner_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Agent Authorizations
CREATE TABLE IF NOT EXISTS agent_authorizations (
    id VARCHAR(100) PRIMARY KEY,
    agent_id VARCHAR(100) NOT NULL,
    action VARCHAR(50) NOT NULL,
    data JSON,
    signature VARCHAR(255) NOT NULL,
    liability JSON,
    status ENUM('authorized', 'executed', 'failed') DEFAULT 'authorized',
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_agent (agent_id),
    INDEX idx_timestamp (timestamp)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Liability Assignments
CREATE TABLE IF NOT EXISTS liability_assignments (
    id INT PRIMARY KEY AUTO_INCREMENT,
    agent_id VARCHAR(100) NOT NULL,
    authorization_id VARCHAR(100) NOT NULL,
    action VARCHAR(50) NOT NULL,
    amount DECIMAL(10,2) DEFAULT 0,
    liability_amount DECIMAL(10,2) DEFAULT 0,
    tier VARCHAR(20) NOT NULL,
    coverage INT DEFAULT 0,
    assigned_to VARCHAR(100) NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_agent (agent_id),
    INDEX idx_auth (authorization_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Agent Insurance Policies
CREATE TABLE IF NOT EXISTS agent_insurance_policies (
    id VARCHAR(100) PRIMARY KEY,
    agent_id VARCHAR(100) UNIQUE NOT NULL,
    created_at DATETIME NOT NULL,
    active BOOLEAN DEFAULT TRUE,
    balance DECIMAL(10,2) DEFAULT 100000,
    remaining_balance DECIMAL(10,2) DEFAULT 100000,
    premium DECIMAL(5,4) DEFAULT 0.025,
    claims INT DEFAULT 0,
    total_paid DECIMAL(10,2) DEFAULT 0,
    FOREIGN KEY (agent_id) REFERENCES agent_liability_registrations(agent_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Liability Claims
CREATE TABLE IF NOT EXISTS liability_claims (
    id VARCHAR(100) PRIMARY KEY,
    agent_id VARCHAR(100) NOT NULL,
    authorization_id VARCHAR(100) NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    reason TEXT,
    evidence JSON,
    status ENUM('pending', 'resolved', 'rejected') DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    resolved_at DATETIME,
    resolution TEXT,
    insurance_used DECIMAL(10,2) DEFAULT 0,
    liability_amount DECIMAL(10,2) DEFAULT 0,
    liable_party VARCHAR(100),
    INDEX idx_agent (agent_id),
    INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;