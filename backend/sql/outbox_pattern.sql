-- Outbox Events Table
CREATE TABLE IF NOT EXISTS outbox_events (
    id INT PRIMARY KEY AUTO_INCREMENT,
    event_id VARCHAR(100) UNIQUE NOT NULL,
    event_type VARCHAR(100) NOT NULL,
    data JSON NOT NULL,
    metadata JSON,
    status ENUM('pending', 'processing', 'completed', 'failed', 'retry') DEFAULT 'pending',
    attempts INT DEFAULT 0,
    max_attempts INT DEFAULT 5,
    error TEXT,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    processed_at DATETIME,
    INDEX idx_status (status),
    INDEX idx_type (event_type),
    INDEX idx_created (created_at),
    INDEX idx_updated (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Outbox Dashboard View
CREATE VIEW outbox_dashboard AS
SELECT 
    DATE(created_at) as date,
    COUNT(*) as total_events,
    SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
    SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
    SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
    AVG(attempts) as avg_attempts
FROM outbox_events
WHERE created_at > DATE_SUB(NOW(), INTERVAL 30 DAY)
GROUP BY DATE(created_at)
ORDER BY date DESC;