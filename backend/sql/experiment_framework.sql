-- Experiments Table
CREATE TABLE IF NOT EXISTS experiments (
    id INT PRIMARY KEY AUTO_INCREMENT,
    experiment_id VARCHAR(100) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    type VARCHAR(50) NOT NULL,
    status ENUM('draft', 'active', 'paused', 'completed', 'archived') DEFAULT 'draft',
    variants JSON NOT NULL,
    traffic_allocation INT DEFAULT 100,
    start_date DATETIME,
    end_date DATETIME,
    metrics JSON,
    target_audience JSON,
    results JSON,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    INDEX idx_status (status),
    INDEX idx_type (type),
    INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Experiment Assignments
CREATE TABLE IF NOT EXISTS experiment_assignments (
    id INT PRIMARY KEY AUTO_INCREMENT,
    experiment_id VARCHAR(100) NOT NULL,
    user_id VARCHAR(100) NOT NULL,
    variant_id VARCHAR(100) NOT NULL,
    assigned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_experiment (experiment_id),
    INDEX idx_user (user_id),
    INDEX idx_variant (variant_id),
    UNIQUE KEY unique_assignment (experiment_id, user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Experiment Metrics
CREATE TABLE IF NOT EXISTS experiment_metrics (
    id INT PRIMARY KEY AUTO_INCREMENT,
    metric_id VARCHAR(100) UNIQUE NOT NULL,
    experiment_id VARCHAR(100) NOT NULL,
    user_id VARCHAR(100) NOT NULL,
    variant_id VARCHAR(100) NOT NULL,
    metric_type VARCHAR(50) NOT NULL,
    value DECIMAL(10,2) DEFAULT 0,
    timestamp DATETIME NOT NULL,
    INDEX idx_experiment (experiment_id),
    INDEX idx_user (user_id),
    INDEX idx_variant (variant_id),
    INDEX idx_metric (metric_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;