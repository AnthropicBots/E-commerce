-- Query Profiles Table
CREATE TABLE IF NOT EXISTS query_profiles (
    id INT PRIMARY KEY AUTO_INCREMENT,
    query_hash VARCHAR(32) NOT NULL,
    query_text TEXT NOT NULL,
    params TEXT,
    duration INT NOT NULL,
    memory_used INT DEFAULT 0,
    rows_affected INT DEFAULT 0,
    explain_result JSON,
    context JSON,
    timestamp DATETIME NOT NULL,
    INDEX idx_hash (query_hash),
    INDEX idx_duration (duration),
    INDEX idx_timestamp (timestamp)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Query Alerts Table
CREATE TABLE IF NOT EXISTS query_alerts (
    id INT PRIMARY KEY AUTO_INCREMENT,
    alert_id VARCHAR(100) UNIQUE NOT NULL,
    query_hash VARCHAR(32) NOT NULL,
    query_text TEXT NOT NULL,
    duration INT NOT NULL,
    count INT DEFAULT 1,
    recommendation JSON,
    acknowledged BOOLEAN DEFAULT FALSE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_hash (query_hash),
    INDEX idx_acknowledged (acknowledged)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Query Profiling Dashboard View
CREATE VIEW query_profiling_dashboard AS
SELECT 
    DATE(timestamp) as date,
    COUNT(*) as total_queries,
    AVG(duration) as avg_duration,
    MAX(duration) as max_duration,
    MIN(duration) as min_duration,
    COUNT(DISTINCT query_hash) as unique_queries
FROM query_profiles
WHERE timestamp > DATE_SUB(NOW(), INTERVAL 7 DAY)
GROUP BY DATE(timestamp)
ORDER BY date DESC;