-- Provenance Records Table
CREATE TABLE IF NOT EXISTS provenance_records (
    id INT PRIMARY KEY AUTO_INCREMENT,
    provenance_id VARCHAR(100) UNIQUE NOT NULL,
    entity_id VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    source_module VARCHAR(100) NOT NULL,
    destination_module VARCHAR(100) NOT NULL,
    operation VARCHAR(50) NOT NULL,
    previous_version TEXT,
    current_version TEXT,
    responsible_service VARCHAR(100) NOT NULL,
    correlation_id VARCHAR(100),
    metadata JSON,
    status VARCHAR(20) DEFAULT 'completed',
    hash VARCHAR(64) NOT NULL,
    timestamp DATETIME NOT NULL,
    INDEX idx_entity (entity_id, entity_type),
    INDEX idx_source (source_module),
    INDEX idx_destination (destination_module),
    INDEX idx_operation (operation),
    INDEX idx_timestamp (timestamp),
    INDEX idx_correlation (correlation_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Provenance Dashboard View
CREATE VIEW provenance_dashboard AS
SELECT 
    DATE(timestamp) as date,
    COUNT(*) as total_records,
    COUNT(DISTINCT entity_id) as unique_entities,
    COUNT(DISTINCT source_module) as source_modules,
    COUNT(DISTINCT destination_module) as destination_modules,
    COUNT(DISTINCT operation) as operations
FROM provenance_records
WHERE timestamp > DATE_SUB(NOW(), INTERVAL 30 DAY)
GROUP BY DATE(timestamp)
ORDER BY date DESC;