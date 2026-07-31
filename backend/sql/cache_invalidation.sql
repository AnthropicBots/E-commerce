-- Cache Dependencies
CREATE TABLE IF NOT EXISTS cache_dependencies (
    id INT PRIMARY KEY AUTO_INCREMENT,
    key VARCHAR(255) UNIQUE NOT NULL,
    dependencies JSON NOT NULL,
    strategy VARCHAR(50) DEFAULT 'dependency_based',
    ttl INT DEFAULT 300,
    last_invalidated DATETIME,
    invalidate_count INT DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_key (key),
    INDEX idx_strategy (strategy)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Invalidation Patterns
CREATE TABLE IF NOT EXISTS invalidation_patterns (
    id INT PRIMARY KEY AUTO_INCREMENT,
    key VARCHAR(255) NOT NULL,
    pattern VARCHAR(255) NOT NULL,
    priority INT DEFAULT 0,
    active BOOLEAN DEFAULT TRUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_key (key),
    INDEX idx_pattern (pattern),
    INDEX idx_active (active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Invalidation Logs
CREATE TABLE IF NOT EXISTS invalidation_logs (
    id INT PRIMARY KEY AUTO_INCREMENT,
    key VARCHAR(255) NOT NULL,
    reason VARCHAR(100),
    strategy VARCHAR(50),
    cascade BOOLEAN DEFAULT FALSE,
    duration INT DEFAULT 0,
    invalidated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_key (key),
    INDEX idx_strategy (strategy),
    INDEX idx_invalidated (invalidated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;