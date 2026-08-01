-- ============================================
-- EVENT DEAD-LETTER QUEUE (#1387)
-- ============================================

CREATE TABLE IF NOT EXISTS event_dlq (
    id CHAR(36) PRIMARY KEY,
    event_id VARCHAR(100) NOT NULL,
    event_type VARCHAR(100) NOT NULL,
    idempotency_key VARCHAR(64) NULL,
    source VARCHAR(40) NOT NULL DEFAULT 'outbox',
    payload_json JSON NOT NULL,
    metadata_json JSON NULL,
    error_json JSON NOT NULL,
    attempts INT NOT NULL DEFAULT 0,
    status ENUM('open', 'replayed', 'discarded') NOT NULL DEFAULT 'open',
    replay_count INT NOT NULL DEFAULT 0,
    last_replayed_at DATETIME NULL,
    discarded_at DATETIME NULL,
    discarded_by CHAR(36) NULL,
    discard_reason VARCHAR(500) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_event_dlq_status (status),
    INDEX idx_event_dlq_event_id (event_id),
    INDEX idx_event_dlq_type (event_type),
    INDEX idx_event_dlq_created (created_at),
    INDEX idx_event_dlq_status_created (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Optional next_retry_at for exponential backoff on outbox retries
DELIMITER //

CREATE PROCEDURE AddOutboxNextRetryAt()
BEGIN
    IF NOT EXISTS (
        SELECT * FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'outbox_events'
          AND COLUMN_NAME = 'next_retry_at'
    ) THEN
        ALTER TABLE outbox_events
            ADD COLUMN next_retry_at DATETIME NULL AFTER processing_started_at;
    END IF;

    IF NOT EXISTS (
        SELECT * FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'outbox_events'
          AND INDEX_NAME = 'idx_outbox_next_retry'
    ) THEN
        ALTER TABLE outbox_events
            ADD INDEX idx_outbox_next_retry (status, next_retry_at);
    END IF;
END //

DELIMITER ;

CALL AddOutboxNextRetryAt();
DROP PROCEDURE AddOutboxNextRetryAt;
