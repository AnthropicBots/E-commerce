-- Schema Registry Table
CREATE TABLE IF NOT EXISTS schema_registry (
    id INT PRIMARY KEY AUTO_INCREMENT,
    schema_id VARCHAR(100) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    type VARCHAR(50) NOT NULL,
    version VARCHAR(20) NOT NULL,
    description TEXT,
    schema_def JSON NOT NULL,
    status ENUM('draft', 'active', 'deprecated', 'archived') DEFAULT 'draft',
    examples JSON,
    metadata JSON,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    UNIQUE KEY unique_name_version (name, version),
    INDEX idx_name (name),
    INDEX idx_type (type),
    INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Schema Validation Logs
CREATE TABLE IF NOT EXISTS schema_validation_logs (
    id INT PRIMARY KEY AUTO_INCREMENT,
    schema_id VARCHAR(100) NOT NULL,
    data JSON,
    valid BOOLEAN DEFAULT FALSE,
    errors JSON,
    validated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_schema (schema_id),
    INDEX idx_valid (valid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;