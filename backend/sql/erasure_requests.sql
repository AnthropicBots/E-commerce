-- ============================================
-- DATA RETENTION & GDPR / DPDP ERASURE (#1397)
-- ============================================
--
-- Staged erasure workflow:
--   pending_confirmation → confirmed → soft_deleted → anonymizing → purging → completed
--
-- Legal order rows are retained with PII anonymized (not hard-deleted).
-- Refresh tokens, sessions, and carts are cascade-purged.
--
-- user_id is CHAR(36) to match users.id.
-- This file is the feature schema; also folded into migrations/0026_*.sql
-- so `npm run migrate` applies it on a fresh database.

CREATE TABLE IF NOT EXISTS erasure_requests (
    id CHAR(36) PRIMARY KEY,
    user_id CHAR(36) NOT NULL,
    status ENUM(
        'pending_confirmation',
        'confirmed',
        'soft_deleted',
        'anonymizing',
        'purging',
        'completed',
        'failed',
        'cancelled'
    ) NOT NULL DEFAULT 'pending_confirmation',
    confirmation_token_hash CHAR(64) NOT NULL,
    confirmation_expires_at DATETIME NOT NULL,
    confirmed_at DATETIME NULL,
    receipt_id VARCHAR(64) NULL,
    reason VARCHAR(500) NULL,
    requested_ip VARCHAR(45) NULL,
    user_agent VARCHAR(512) NULL,
    -- One-way hash of the email at request time (audit without retaining PII).
    original_email_hash CHAR(64) NULL,
    stages_json JSON NULL,
    error_message TEXT NULL,
    completed_at DATETIME NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uq_erasure_receipt (receipt_id),
    INDEX idx_erasure_user (user_id),
    INDEX idx_erasure_status (status),
    INDEX idx_erasure_token (confirmation_token_hash),
    INDEX idx_erasure_created (created_at),

    CONSTRAINT fk_erasure_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Append-only receipt ledger so a completed erasure can be verified later
-- without re-exposing PII.
CREATE TABLE IF NOT EXISTS erasure_receipts (
    id CHAR(36) PRIMARY KEY,
    receipt_id VARCHAR(64) NOT NULL,
    erasure_request_id CHAR(36) NOT NULL,
    user_id CHAR(36) NULL,
    summary_json JSON NULL,
    issued_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    UNIQUE KEY uq_receipt_id (receipt_id),
    INDEX idx_receipt_request (erasure_request_id),
    INDEX idx_receipt_issued (issued_at),

    CONSTRAINT fk_receipt_request FOREIGN KEY (erasure_request_id)
        REFERENCES erasure_requests(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
