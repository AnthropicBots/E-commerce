-- Business Capabilities Table
CREATE TABLE IF NOT EXISTS business_capabilities (
    id INT PRIMARY KEY AUTO_INCREMENT,
    capability_id VARCHAR(100) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    type VARCHAR(50) NOT NULL,
    status VARCHAR(50) DEFAULT 'active',
    owner_module VARCHAR(100),
    dependencies JSON,
    apis JSON,
    data_ownership JSON,
    consumers JSON,
    metrics JSON,
    metadata JSON,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_name (name),
    INDEX idx_type (type),
    INDEX idx_status (status),
    INDEX idx_owner (owner_module)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Business Modules Table
CREATE TABLE IF NOT EXISTS business_modules (
    id INT PRIMARY KEY AUTO_INCREMENT,
    module_id VARCHAR(100) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    type VARCHAR(50) DEFAULT 'service',
    owner VARCHAR(100),
    capabilities JSON,
    dependencies JSON,
    apis JSON,
    metadata JSON,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_name (name),
    INDEX idx_type (type),
    INDEX idx_owner (owner)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Capability Mapping Dashboard View
CREATE VIEW capability_mapping_dashboard AS
SELECT 
    DATE(created_at) as date,
    COUNT(*) as total_capabilities,
    SUM(CASE WHEN type = 'core' THEN 1 ELSE 0 END) as core_capabilities,
    SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_capabilities,
    COUNT(DISTINCT owner_module) as modules,
    AVG(JSON_LENGTH(dependencies)) as avg_dependencies
FROM business_capabilities
WHERE created_at > DATE_SUB(NOW(), INTERVAL 30 DAY)
GROUP BY DATE(created_at)
ORDER BY date DESC;