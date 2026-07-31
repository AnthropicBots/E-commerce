-- Agent Identities
CREATE TABLE IF NOT EXISTS agent_identities (
    id INT PRIMARY KEY AUTO_INCREMENT,
    agent_id VARCHAR(100) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    type VARCHAR(50) NOT NULL,
    public_key TEXT,
    capabilities JSON,
    permissions JSON,
    created_at DATETIME NOT NULL,
    expires_at DATETIME NOT NULL,
    status ENUM('active', 'inactive', 'expired') DEFAULT 'active',
    signature VARCHAR(255) NOT NULL,
    INDEX idx_agent (agent_id),
    INDEX idx_status (status),
    INDEX idx_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Agent Sessions
CREATE TABLE IF NOT EXISTS agent_sessions (
    id INT PRIMARY KEY AUTO_INCREMENT,
    session_id VARCHAR(100) UNIQUE NOT NULL,
    agent_a VARCHAR(100) NOT NULL,
    agent_b VARCHAR(100) NOT NULL,
    status ENUM('active', 'closed', 'expired') DEFAULT 'active',
    created_at DATETIME NOT NULL,
    expires_at DATETIME NOT NULL,
    context JSON,
    state VARCHAR(50) DEFAULT 'negotiating',
    closed_at DATETIME,
    close_reason TEXT,
    INDEX idx_session (session_id),
    INDEX idx_agents (agent_a, agent_b),
    INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Agent Messages
CREATE TABLE IF NOT EXISTS agent_messages (
    id INT PRIMARY KEY AUTO_INCREMENT,
    message_id VARCHAR(100) UNIQUE NOT NULL,
    session_id VARCHAR(100) NOT NULL,
    from_agent VARCHAR(100) NOT NULL,
    to_agent VARCHAR(100) NOT NULL,
    type VARCHAR(50) NOT NULL,
    payload JSON NOT NULL,
    signature VARCHAR(255) NOT NULL,
    status ENUM('sent', 'delivered', 'failed') DEFAULT 'sent',
    created_at DATETIME NOT NULL,
    delivered_at DATETIME,
    INDEX idx_session (session_id),
    INDEX idx_from (from_agent),
    INDEX idx_to (to_agent),
    INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Agent Agreements
CREATE TABLE IF NOT EXISTS agent_agreements (
    id INT PRIMARY KEY AUTO_INCREMENT,
    agreement_id VARCHAR(100) UNIQUE NOT NULL,
    session_id VARCHAR(100) NOT NULL,
    agent_a VARCHAR(100) NOT NULL,
    agent_b VARCHAR(100) NOT NULL,
    terms JSON NOT NULL,
    status ENUM('pending', 'confirmed', 'rejected', 'expired') DEFAULT 'pending',
    created_at DATETIME NOT NULL,
    expires_at DATETIME NOT NULL,
    confirmed_by JSON,
    INDEX idx_session (session_id),
    INDEX idx_agents (agent_a, agent_b),
    INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Protocol Dashboard View
CREATE VIEW protocol_dashboard AS
SELECT 
    DATE(created_at) as date,
    COUNT(DISTINCT session_id) as active_sessions,
    COUNT(*) as total_messages,
    COUNT(DISTINCT from_agent) as active_agents,
    SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END) as delivered_messages
FROM agent_messages
WHERE created_at > DATE_SUB(NOW(), INTERVAL 7 DAY)
GROUP BY DATE(created_at)
ORDER BY date DESC;