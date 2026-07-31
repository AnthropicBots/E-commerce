-- Content Security Logs
CREATE TABLE IF NOT EXISTS content_security_logs (
    id INT PRIMARY KEY AUTO_INCREMENT,
    content_type VARCHAR(50) NOT NULL,
    flags JSON,
    trust_score INT DEFAULT 0,
    is_safe BOOLEAN DEFAULT TRUE,
    provenance JSON,
    context JSON,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_content_type (content_type),
    INDEX idx_trust (trust_score),
    INDEX idx_safe (is_safe),
    INDEX idx_timestamp (timestamp)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Content Provenance
CREATE TABLE IF NOT EXISTS content_provenance (
    id INT PRIMARY KEY AUTO_INCREMENT,
    content_id VARCHAR(100) NOT NULL,
    source VARCHAR(50) NOT NULL,
    trust_score INT DEFAULT 100,
    flags JSON,
    last_updated DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY unique_provenance (content_id, source),
    INDEX idx_content (content_id),
    INDEX idx_source (source),
    INDEX idx_trust (trust_score)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Content Security Dashboard View
CREATE VIEW content_security_dashboard AS
SELECT 
    DATE(timestamp) as date,
    COUNT(*) as total_checks,
    SUM(CASE WHEN is_safe = 1 THEN 1 ELSE 0 END) as safe_content,
    SUM(CASE WHEN is_safe = 0 THEN 1 ELSE 0 END) as unsafe_content,
    AVG(trust_score) as avg_trust_score,
    COUNT(DISTINCT content_type) as content_types,
    (SUM(CASE WHEN is_safe = 0 THEN 1 ELSE 0 END) / COUNT(*)) * 100 as unsafe_rate
FROM content_security_logs
WHERE timestamp > DATE_SUB(NOW(), INTERVAL 30 DAY)
GROUP BY DATE(timestamp)
ORDER BY date DESC;