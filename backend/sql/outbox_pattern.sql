-- Outbox Events Table (#1263: optimistic lock + idempotency)
CREATE TABLE IF NOT EXISTS outbox_events (
    id INT PRIMARY KEY AUTO_INCREMENT,
    event_id VARCHAR(100) UNIQUE NOT NULL,
    event_type VARCHAR(100) NOT NULL,
    data JSON NOT NULL,
    metadata JSON,
    status ENUM('pending', 'processing', 'completed', 'failed', 'retry') DEFAULT 'pending',
    attempts INT DEFAULT 0,
    max_attempts INT DEFAULT 5,
    -- Optimistic lock version — claim only succeeds when version matches
    version INT NOT NULL DEFAULT 0,
    -- Deterministic UUID v5 (event_type + entity_id + occurred_at)
    idempotency_key VARCHAR(64) NOT NULL,
    processing_started_at DATETIME NULL,
    error TEXT,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    processed_at DATETIME,
    UNIQUE KEY uq_outbox_idempotency (idempotency_key),
    INDEX idx_status (status),
    INDEX idx_type (event_type),
    INDEX idx_created (created_at),
    INDEX idx_updated (updated_at),
    INDEX idx_status_version (status, version),
    INDEX idx_processing_started (processing_started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Consumer-side idempotency ledger (survives outbox retention; prevents double side-effects)
CREATE TABLE IF NOT EXISTS outbox_idempotency_ledger (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    idempotency_key VARCHAR(64) NOT NULL,
    event_id VARCHAR(100) NOT NULL,
    consumer VARCHAR(100) NOT NULL DEFAULT 'default',
    event_type VARCHAR(100),
    status ENUM('processing', 'completed', 'failed') DEFAULT 'processing',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME NULL,
    expires_at DATETIME NULL,
    UNIQUE KEY uq_idempotency_consumer (idempotency_key, consumer),
    INDEX idx_ledger_event (event_id),
    INDEX idx_ledger_expires (expires_at),
    INDEX idx_ledger_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Existing installs (run manually if table already exists):
-- ALTER TABLE outbox_events
--   ADD COLUMN version INT NOT NULL DEFAULT 0,
--   ADD COLUMN idempotency_key VARCHAR(64) NULL,
--   ADD COLUMN processing_started_at DATETIME NULL;
-- CREATE UNIQUE INDEX uq_outbox_idempotency ON outbox_events (idempotency_key);

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
