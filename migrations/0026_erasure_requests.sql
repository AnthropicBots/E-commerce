-- ============================================
-- DATA RETENTION & GDPR / DPDP ERASURE (#1397)
-- ============================================
-- Folded from backend/sql/erasure_requests.sql so migrate applies it.

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
