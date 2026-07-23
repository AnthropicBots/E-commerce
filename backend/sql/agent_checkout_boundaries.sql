-- Agent Checkout Sessions
CREATE TABLE IF NOT EXISTS agent_checkout_sessions (
    id INT PRIMARY KEY AUTO_INCREMENT,
    session_id VARCHAR(100) UNIQUE NOT NULL,
    agent_id VARCHAR(100) NOT NULL,
    order_data JSON NOT NULL,
    auth_data JSON,
    authorization JSON,
    status ENUM('pending_review', 'approved', 'rejected', 'completed', 'failed', 'cancelled') DEFAULT 'pending_review',
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    reviewed_by VARCHAR(100),
    reviewed_at DATETIME,
    review_notes TEXT,
    order_result JSON,
    completed_at DATETIME,
    error TEXT,
    attempts INT DEFAULT 0,
    max_attempts INT DEFAULT 3,
    cancelled_at DATETIME,
    cancel_reason TEXT,
    INDEX idx_session (session_id),
    INDEX idx_agent (agent_id),
    INDEX idx_status (status),
    INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Agent Checkout Reviews
CREATE TABLE IF NOT EXISTS agent_checkout_reviews (
    id INT PRIMARY KEY AUTO_INCREMENT,
    session_id VARCHAR(100) NOT NULL,
    reviewer_id VARCHAR(100) NOT NULL,
    decision ENUM('approved', 'rejected') NOT NULL,
    notes TEXT,
    reviewed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_session (session_id),
    INDEX idx_reviewer (reviewer_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Agent Checkout Audit Logs
CREATE TABLE IF NOT EXISTS agent_checkout_audit (
    id INT PRIMARY KEY AUTO_INCREMENT,
    session_id VARCHAR(100) NOT NULL,
    action VARCHAR(50) NOT NULL,
    data JSON,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_session (session_id),
    INDEX idx_action (action),
    INDEX idx_timestamp (timestamp)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Checkout Dashboard View
CREATE VIEW agent_checkout_dashboard AS
SELECT 
    DATE(created_at) as date,
    COUNT(*) as total_checkouts,
    SUM(CASE WHEN status = 'pending_review' THEN 1 ELSE 0 END) as pending_review,
    SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approved,
    SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
    SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected,
    AVG(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) * 100 as completion_rate
FROM agent_checkout_sessions
WHERE created_at > DATE_SUB(NOW(), INTERVAL 30 DAY)
GROUP BY DATE(created_at)
ORDER BY date DESC;