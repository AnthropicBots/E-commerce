-- AI Agent Actions Table
CREATE TABLE IF NOT EXISTS ai_agent_actions (
    id VARCHAR(50) PRIMARY KEY,
    agent_id VARCHAR(50) NOT NULL,
    action VARCHAR(50) NOT NULL,
    data JSON,
    status ENUM('pending', 'pending_approval', 'conflict_detected', 'completed', 'failed', 'blocked', 'rejected') DEFAULT 'pending',
    priority INT DEFAULT 40,
    conflicts JSON,
    error TEXT,
    result JSON,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_agent (agent_id),
    INDEX idx_status (status),
    INDEX idx_timestamp (timestamp),
    INDEX idx_priority (priority)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- AI Action Approvals Table
CREATE TABLE IF NOT EXISTS ai_action_approvals (
    id VARCHAR(50) PRIMARY KEY,
    action_id VARCHAR(50) NOT NULL,
    status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',
    requested_by VARCHAR(50) NOT NULL,
    approved_by VARCHAR(50),
    rejected_by VARCHAR(50),
    approvers JSON,
    notes TEXT,
    requested_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    approved_at DATETIME,
    rejected_at DATETIME,
    FOREIGN KEY (action_id) REFERENCES ai_agent_actions(id) ON DELETE CASCADE,
    INDEX idx_action (action_id),
    INDEX idx_status (status),
    INDEX idx_requested (requested_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Agent Session Tracking
CREATE TABLE IF NOT EXISTS ai_agent_sessions (
    agent_id VARCHAR(50) PRIMARY KEY,
    priority INT DEFAULT 40,
    action_count INT DEFAULT 0,
    last_action DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_last_action (last_action)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Monitoring Views
CREATE VIEW agent_coordination_dashboard AS
SELECT 
    DATE(timestamp) as date,
    COUNT(*) as total_actions,
    SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
    SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
    SUM(CASE WHEN status = 'blocked' THEN 1 ELSE 0 END) as blocked,
    SUM(CASE WHEN status = 'pending_approval' THEN 1 ELSE 0 END) as pending_approvals,
    SUM(CASE WHEN status = 'conflict_detected' THEN 1 ELSE 0 END) as conflicts,
    AVG(priority) as avg_priority
FROM ai_agent_actions
GROUP BY DATE(timestamp)
ORDER BY date DESC;

-- Active Agents View
CREATE VIEW active_agents AS
SELECT 
    agent_id,
    priority,
    action_count,
    last_action,
    TIMESTAMPDIFF(MINUTE, last_action, NOW()) as minutes_inactive
FROM ai_agent_sessions
WHERE action_count > 0
ORDER BY priority DESC;