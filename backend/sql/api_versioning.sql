-- API Versions Table
CREATE TABLE IF NOT EXISTS api_versions (
    id INT PRIMARY KEY AUTO_INCREMENT,
    version VARCHAR(20) UNIQUE NOT NULL,
    status ENUM('current', 'supported', 'deprecated', 'sunset', 'retired') DEFAULT 'supported',
    description TEXT,
    release_date DATETIME NOT NULL,
    deprecation_date DATETIME,
    sunset_date DATETIME,
    retired_date DATETIME,
    routes JSON,
    changes JSON,
    dependencies JSON,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_version (version),
    INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- API Usage Logs
CREATE TABLE IF NOT EXISTS api_usage_logs (
    id INT PRIMARY KEY AUTO_INCREMENT,
    version VARCHAR(20) NOT NULL,
    path VARCHAR(255) NOT NULL,
    method VARCHAR(10) NOT NULL,
    user_id VARCHAR(100),
    status_code INT,
    duration INT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_version (version),
    INDEX idx_path (path(191)),
    INDEX idx_timestamp (timestamp)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- API Changelog
CREATE TABLE IF NOT EXISTS api_changelog (
    id INT PRIMARY KEY AUTO_INCREMENT,
    version VARCHAR(20) NOT NULL,
    change_type ENUM('added', 'changed', 'deprecated', 'removed', 'fixed') NOT NULL,
    description TEXT NOT NULL,
    breaking BOOLEAN DEFAULT FALSE,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_version (version),
    INDEX idx_type (change_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;