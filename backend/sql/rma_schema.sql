-- RMA schema reference (#1389). Apply via: npm run migrate
-- Canonical change file: migrations/0030_rma_state_machine.sql

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
    INDEX idx_rma_transitions_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- refund_requests gains (via migration 0030):
--   rma_number, reason_code, photo_evidence_url, shipping_tracking,
--   address_fingerprint, payment_fingerprint, fraud_score, fraud_flags
--   status VARCHAR covering: requested|approved|in_transit|received|refunded|rejected|cancelled
