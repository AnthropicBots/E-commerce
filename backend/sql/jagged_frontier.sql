-- Jagged Frontier Decisions
CREATE TABLE IF NOT EXISTS jagged_frontier_decisions (
    id INT PRIMARY KEY AUTO_INCREMENT,
    agent_id VARCHAR(100) NOT NULL,
    action_type VARCHAR(50) NOT NULL,
    confidence DECIMAL(5,2) DEFAULT 0,
    ambiguity_score DECIMAL(5,2) DEFAULT 0,
    status VARCHAR(20) DEFAULT 'approved',
    flags JSON,
    context JSON,
    requires_review BOOLEAN DEFAULT FALSE,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_agent (agent_id),
    INDEX idx_status (status),
    INDEX idx_timestamp (timestamp)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Jagged Frontier Guardrails
CREATE TABLE IF NOT EXISTS jagged_frontier_guardrails (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(100) UNIQUE NOT NULL,
    type VARCHAR(50) NOT NULL,
    threshold DECIMAL(5,2) NOT NULL,
    action VARCHAR(50) NOT NULL,
    severity VARCHAR(20) DEFAULT 'high',
    active BOOLEAN DEFAULT TRUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_name (name),
    INDEX idx_active (active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Jagged Frontier Patterns
CREATE TABLE IF NOT EXISTS jagged_frontier_patterns (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(100) UNIQUE NOT NULL,
    type VARCHAR(50) NOT NULL,
    pattern JSON NOT NULL,
    severity VARCHAR(20) DEFAULT 'medium',
    confidence DECIMAL(5,2) DEFAULT 0.7,
    active BOOLEAN DEFAULT TRUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_name (name),
    INDEX idx_active (active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Jagged Frontier Reviews
CREATE TABLE IF NOT EXISTS jagged_frontier_reviews (
    id INT PRIMARY KEY AUTO_INCREMENT,
    decision_id VARCHAR(100) NOT NULL,
    reviewer_id VARCHAR(100) NOT NULL,
    decision VARCHAR(20) NOT NULL,
    notes TEXT,
    reviewed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_decision (decision_id),
    INDEX idx_reviewer (reviewer_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;