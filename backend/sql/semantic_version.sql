-- Modules Table
CREATE TABLE IF NOT EXISTS modules (
    id INT PRIMARY KEY AUTO_INCREMENT,
    module_name VARCHAR(100) UNIQUE NOT NULL,
    version VARCHAR(20) NOT NULL,
    type VARCHAR(50) NOT NULL,
    path VARCHAR(500),
    description TEXT,
    author VARCHAR(100),
    dependencies JSON,
    dev_dependencies JSON,
    peer_dependencies JSON,
    exports JSON,
    status ENUM('draft', 'published', 'deprecated', 'retired') DEFAULT 'published',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_name (module_name),
    INDEX idx_type (type),
    INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Module Versions Table
CREATE TABLE IF NOT EXISTS module_versions (
    id INT PRIMARY KEY AUTO_INCREMENT,
    module_name VARCHAR(100) NOT NULL,
    version VARCHAR(20) NOT NULL,
    previous_version VARCHAR(20),
    breaking_changes JSON,
    status ENUM('draft', 'published', 'deprecated', 'retired') DEFAULT 'published',
    data JSON,
    version_hash VARCHAR(64) NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_module (module_name),
    INDEX idx_version (version),
    INDEX idx_created (created_at),
    UNIQUE KEY unique_module_version (module_name, version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Version Dashboard View
CREATE VIEW version_dashboard AS
SELECT 
    DATE(created_at) as date,
    COUNT(*) as total_versions,
    COUNT(DISTINCT module_name) as modules_updated,
    SUM(CASE WHEN JSON_LENGTH(breaking_changes) > 0 THEN 1 ELSE 0 END) as breaking_changes
FROM module_versions
WHERE created_at > DATE_SUB(NOW(), INTERVAL 30 DAY)
GROUP BY DATE(created_at)
ORDER BY date DESC;