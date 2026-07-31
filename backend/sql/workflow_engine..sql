-- Workflows Table
CREATE TABLE IF NOT EXISTS workflows (
    id INT PRIMARY KEY AUTO_INCREMENT,
    workflow_id VARCHAR(100) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    definition JSON NOT NULL,
    context JSON,
    status ENUM('pending', 'running', 'waiting', 'completed', 'failed', 'cancelled', 'paused') DEFAULT 'pending',
    current_step INT DEFAULT 0,
    steps JSON,
    results JSON,
    errors JSON,
    started_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    completed_at DATETIME,
    metadata JSON,
    INDEX idx_name (name),
    INDEX idx_status (status),
    INDEX idx_started (started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Workflow Step Logs
CREATE TABLE IF NOT EXISTS workflow_step_logs (
    id INT PRIMARY KEY AUTO_INCREMENT,
    workflow_id VARCHAR(100) NOT NULL,
    step_id VARCHAR(100) NOT NULL,
    step_name VARCHAR(100) NOT NULL,
    status VARCHAR(50) NOT NULL,
    result JSON,
    error TEXT,
    duration INT DEFAULT 0,
    started_at DATETIME,
    completed_at DATETIME,
    INDEX idx_workflow (workflow_id),
    INDEX idx_step (step_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;