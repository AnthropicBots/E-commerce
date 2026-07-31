-- Services Table
CREATE TABLE IF NOT EXISTS services (
    id INT PRIMARY KEY AUTO_INCREMENT,
    service_id VARCHAR(100) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    version VARCHAR(20) NOT NULL,
    description TEXT,
    category VARCHAR(50) NOT NULL,
    capabilities JSON,
    dependencies JSON,
    permissions JSON,
    endpoints JSON,
    metadata JSON,
    status ENUM('active', 'deprecated', 'beta', 'experimental', 'disabled') DEFAULT 'active',
    registered_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    INDEX idx_name (name),
    INDEX idx_category (category),
    INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Capabilities Table
CREATE TABLE IF NOT EXISTS capabilities (
    id INT PRIMARY KEY AUTO_INCREMENT,
    capability_id VARCHAR(100) UNIQUE NOT NULL,
    service_id VARCHAR(100) NOT NULL,
    service_name VARCHAR(100) NOT NULL,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    version VARCHAR(20) NOT NULL,
    category VARCHAR(50) NOT NULL,
    operations JSON,
    parameters JSON,
    returns JSON,
    dependencies JSON,
    permissions JSON,
    status ENUM('active', 'deprecated', 'beta', 'experimental', 'disabled') DEFAULT 'active',
    metadata JSON,
    registered_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    INDEX idx_service (service_id),
    INDEX idx_name (name),
    INDEX idx_category (category),
    INDEX idx_status (status),
    UNIQUE KEY unique_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Capability Discovery Dashboard View
CREATE VIEW capability_discovery_dashboard AS
SELECT 
    DATE(registered_at) as date,
    COUNT(*) as total_capabilities,
    COUNT(DISTINCT service_id) as services,
    COUNT(DISTINCT category) as categories,
    SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_capabilities
FROM capabilities
WHERE registered_at > DATE_SUB(NOW(), INTERVAL 30 DAY)
GROUP BY DATE(registered_at)
ORDER BY date DESC;