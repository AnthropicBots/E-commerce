-- ============================================
-- RMA STATE MACHINE (#1389)
-- ============================================
-- Expands refund_requests for formal FSM statuses, reason codes, optional
-- photo evidence, fingerprints for velocity fraud checks, and a transition log.

DELIMITER //

CREATE PROCEDURE UpgradeRefundRequestsForRma()
BEGIN
    -- Widen status beyond the original ENUM so FSM states fit.
    ALTER TABLE refund_requests
        MODIFY COLUMN status VARCHAR(32) NOT NULL DEFAULT 'requested';

    IF NOT EXISTS (
        SELECT * FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'refund_requests'
          AND COLUMN_NAME = 'rma_number'
    ) THEN
        ALTER TABLE refund_requests
            ADD COLUMN rma_number VARCHAR(40) NULL AFTER id;
    END IF;

    IF NOT EXISTS (
        SELECT * FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'refund_requests'
          AND COLUMN_NAME = 'reason_code'
    ) THEN
        ALTER TABLE refund_requests
            ADD COLUMN reason_code VARCHAR(40) NULL AFTER reason;
    END IF;

    IF NOT EXISTS (
        SELECT * FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'refund_requests'
          AND COLUMN_NAME = 'photo_evidence_url'
    ) THEN
        ALTER TABLE refund_requests
            ADD COLUMN photo_evidence_url VARCHAR(512) NULL AFTER reason_code;
    END IF;

    IF NOT EXISTS (
        SELECT * FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'refund_requests'
          AND COLUMN_NAME = 'shipping_tracking'
    ) THEN
        ALTER TABLE refund_requests
            ADD COLUMN shipping_tracking VARCHAR(120) NULL AFTER photo_evidence_url;
    END IF;

    IF NOT EXISTS (
        SELECT * FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'refund_requests'
          AND COLUMN_NAME = 'address_fingerprint'
    ) THEN
        ALTER TABLE refund_requests
            ADD COLUMN address_fingerprint VARCHAR(64) NULL AFTER shipping_tracking;
    END IF;

    IF NOT EXISTS (
        SELECT * FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'refund_requests'
          AND COLUMN_NAME = 'payment_fingerprint'
    ) THEN
        ALTER TABLE refund_requests
            ADD COLUMN payment_fingerprint VARCHAR(64) NULL AFTER address_fingerprint;
    END IF;

    IF NOT EXISTS (
        SELECT * FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'refund_requests'
          AND COLUMN_NAME = 'fraud_score'
    ) THEN
        ALTER TABLE refund_requests
            ADD COLUMN fraud_score INT NULL AFTER payment_fingerprint;
    END IF;

    IF NOT EXISTS (
        SELECT * FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'refund_requests'
          AND COLUMN_NAME = 'fraud_flags'
    ) THEN
        ALTER TABLE refund_requests
            ADD COLUMN fraud_flags JSON NULL AFTER fraud_score;
    END IF;

    IF NOT EXISTS (
        SELECT * FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'refund_requests'
          AND INDEX_NAME = 'uq_refund_requests_rma_number'
    ) THEN
        ALTER TABLE refund_requests
            ADD UNIQUE INDEX uq_refund_requests_rma_number (rma_number);
    END IF;

    IF NOT EXISTS (
        SELECT * FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'refund_requests'
          AND INDEX_NAME = 'idx_refund_requests_address_fp'
    ) THEN
        ALTER TABLE refund_requests
            ADD INDEX idx_refund_requests_address_fp (address_fingerprint);
    END IF;

    IF NOT EXISTS (
        SELECT * FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'refund_requests'
          AND INDEX_NAME = 'idx_refund_requests_payment_fp'
    ) THEN
        ALTER TABLE refund_requests
            ADD INDEX idx_refund_requests_payment_fp (payment_fingerprint);
    END IF;
END //

DELIMITER ;

CALL UpgradeRefundRequestsForRma();
DROP PROCEDURE UpgradeRefundRequestsForRma;

-- Normalize legacy pending → requested
UPDATE refund_requests SET status = 'requested' WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS rma_transitions (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    rma_id INT NOT NULL,
    from_status VARCHAR(32) NULL,
    to_status VARCHAR(32) NOT NULL,
    actor_id CHAR(36) NULL,
    note TEXT NULL,
    meta_json JSON NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_rma_transitions_rma (rma_id),
    INDEX idx_rma_transitions_created (created_at),

    CONSTRAINT fk_rma_transitions_request
        FOREIGN KEY (rma_id) REFERENCES refund_requests(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
