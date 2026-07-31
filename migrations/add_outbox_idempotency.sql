-- Issue #1263: Outbox optimistic lock + idempotency columns
-- Run once on existing DBs. Ignore duplicate-column / duplicate-index errors if already applied.

ALTER TABLE outbox_events
    ADD COLUMN entity_id VARCHAR(100) DEFAULT NULL AFTER event_type;

ALTER TABLE outbox_events
    ADD COLUMN idempotency_key CHAR(36) DEFAULT NULL AFTER entity_id;

ALTER TABLE outbox_events
    ADD COLUMN version INT NOT NULL DEFAULT 0 AFTER status;

ALTER TABLE outbox_events
    ADD COLUMN processing_started_at DATETIME DEFAULT NULL AFTER error;

ALTER TABLE outbox_events
    ADD UNIQUE INDEX idx_idempotency_key (idempotency_key);

ALTER TABLE outbox_events
    ADD INDEX idx_processing_started (status, processing_started_at);

ALTER TABLE outbox_events
    ADD INDEX idx_entity_id (entity_id);

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
