-- ============================================
-- WEBAUTHN / PASSKEY CREDENTIALS (#1385)
-- ============================================

CREATE TABLE IF NOT EXISTS webauthn_credentials (
    id CHAR(36) PRIMARY KEY,
    user_id CHAR(36) NOT NULL,
    credential_id VARCHAR(512) NOT NULL,
    public_key TEXT NOT NULL,
    counter BIGINT UNSIGNED NOT NULL DEFAULT 0,
    device_name VARCHAR(120) NOT NULL DEFAULT 'Passkey',
    transports JSON NULL,
    backed_up TINYINT(1) NOT NULL DEFAULT 0,
    device_type VARCHAR(40) NULL,
    aaguid VARCHAR(64) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_used_at DATETIME NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uq_webauthn_credential_id (credential_id),
    INDEX idx_webauthn_user (user_id),
    INDEX idx_webauthn_user_created (user_id, created_at),

    CONSTRAINT fk_webauthn_user
        FOREIGN KEY (user_id) REFERENCES users(id)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
