-- Temporal Records Table
CREATE TABLE IF NOT EXISTS temporal_records (
    id INT PRIMARY KEY AUTO_INCREMENT,
    record_id VARCHAR(100) UNIQUE NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    entity_id VARCHAR(100) NOT NULL,
    version_number INT NOT NULL,
    data JSON NOT NULL,
    metadata JSON,
    valid_from DATETIME NOT NULL,
    valid_until DATETIME,
    hash VARCHAR(64) NOT NULL,
    archived BOOLEAN DEFAULT FALSE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_entity (entity_type, entity_id),
    INDEX idx_version (version_number),
    INDEX idx_valid_from (valid_from),
    INDEX idx_valid_until (valid_until),
    INDEX idx_archived (archived),
    UNIQUE KEY unique_entity_version (entity_type, entity_id, version_number)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Temporal Dashboard View
CREATE VIEW temporal_dashboard AS
SELECT 
    DATE(created_at) as date,
    COUNT(*) as total_versions,
    COUNT(DISTINCT entity_type) as entity_types,
    COUNT(DISTINCT entity_id) as entities,
    AVG(version_number) as avg_versions_per_entity,
    SUM(CASE WHEN archived = 1 THEN 1 ELSE 0 END) as archived_count
FROM temporal_records
WHERE created_at > DATE_SUB(NOW(), INTERVAL 30 DAY)
GROUP BY DATE(created_at)
ORDER BY date DESC;