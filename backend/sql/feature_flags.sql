-- Feature Flags Table
CREATE TABLE IF NOT EXISTS feature_flags (
    id INT PRIMARY KEY AUTO_INCREMENT,
    flag_id VARCHAR(100) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    key VARCHAR(100) UNIQUE NOT NULL,
    description TEXT,
    type VARCHAR(50) NOT NULL,
    status ENUM('draft', 'active', 'paused', 'archived') DEFAULT 'draft',
    value JSON,
    conditions JSON,
    rollout_strategy VARCHAR(50),
    rollout_percentage INT DEFAULT 0,
    environments JSON,
    user_groups JSON,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    INDEX idx_key (key),
    INDEX idx_type (type),
    INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Feature Flag Evaluations
CREATE TABLE IF NOT EXISTS feature_flag_evaluations (
    id INT PRIMARY KEY AUTO_INCREMENT,
    flag_key VARCHAR(100) NOT NULL,
    user_id VARCHAR(100),
    context JSON,
    result JSON,
    evaluated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_flag (flag_key),
    INDEX idx_user (user_id),
    INDEX idx_evaluated (evaluated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;