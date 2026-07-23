-- Sagas Table
CREATE TABLE IF NOT EXISTS sagas (
    id INT PRIMARY KEY AUTO_INCREMENT,
    saga_id VARCHAR(100) UNIQUE NOT NULL,
    workflow VARCHAR(100) NOT NULL,
    steps JSON,
    context JSON,
    status ENUM('initiated', 'running', 'completed', 'failed', 'compensating', 'compensated', 'partial') DEFAULT 'initiated',
    current_step INT DEFAULT 0,
    results JSON,
    errors JSON,
    compensations JSON,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    completed_at DATETIME,
    INDEX idx_status (status),
    INDEX idx_workflow (workflow),
    INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Saga Steps Log
CREATE TABLE IF NOT EXISTS saga_step_logs (
    id INT PRIMARY KEY AUTO_INCREMENT,
    saga_id VARCHAR(100) NOT NULL,
    step_name VARCHAR(100) NOT NULL,
    status VARCHAR(50) NOT NULL,
    result JSON,
    error TEXT,
    duration INT DEFAULT 0,
    executed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_saga (saga_id),
    INDEX idx_step (step_name),
    INDEX idx_executed (executed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;