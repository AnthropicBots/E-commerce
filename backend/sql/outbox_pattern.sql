-- Outbox Events Table (Issue #1263: optimistic locks + idempotency)
CREATE TABLE IF NOT EXISTS outbox_events (
    id INT PRIMARY KEY AUTO_INCREMENT,
    event_id VARCHAR(100) UNIQUE NOT NULL,
    event_type VARCHAR(100) NOT NULL,
    entity_id VARCHAR(100) DEFAULT NULL,
    idempotency_key CHAR(36) DEFAULT NULL,
    data JSON NOT NULL,
    metadata JSON,
    status ENUM('pending', 'processing', 'completed', 'failed', 'retry') DEFAULT 'pending',
    version INT NOT NULL DEFAULT 0,
    attempts INT DEFAULT 0,
    max_attempts INT DEFAULT 5,
    error TEXT,
    processing_started_at DATETIME DEFAULT NULL,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    processed_at DATETIME,
    INDEX idx_status (status),
    INDEX idx_type (event_type),
    INDEX idx_created (created_at),
    INDEX idx_updated (updated_at),
    INDEX idx_status_attempts (status, attempts),
    INDEX idx_processing_started (status, processing_started_at),
    UNIQUE INDEX idx_idempotency_key (idempotency_key),
    INDEX idx_entity_id (entity_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Consumer-side idempotency ledger (prevents double side-effects on replay)
CREATE TABLE IF NOT EXISTS outbox_idempotency_keys (
    idempotency_key CHAR(36) NOT NULL,
    event_id VARCHAR(100) NOT NULL,
    event_type VARCHAR(100) NOT NULL,
    consumer_name VARCHAR(100) NOT NULL DEFAULT 'default',
    status ENUM('processing', 'completed', 'expired') NOT NULL DEFAULT 'processing',
    result_hash VARCHAR(64) DEFAULT NULL,
    expires_at DATETIME NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME DEFAULT NULL,
    PRIMARY KEY (idempotency_key, consumer_name),
    INDEX idx_idempotency_event (event_id),
    INDEX idx_idempotency_status_expires (status, expires_at),
    INDEX idx_idempotency_consumer (consumer_name, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Outbox Dashboard View
CREATE OR REPLACE VIEW outbox_dashboard AS
SELECT 
    DATE(created_at) as date,
    COUNT(*) as total_events,
    SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
    SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
    SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
    SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) as processing,
    AVG(attempts) as avg_attempts
FROM outbox_events
WHERE created_at > DATE_SUB(NOW(), INTERVAL 30 DAY)
GROUP BY DATE(created_at)
ORDER BY date DESC;
