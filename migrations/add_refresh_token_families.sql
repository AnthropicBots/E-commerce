-- Issue #1261: Refresh token families + reuse detection
-- Run once on existing databases.

CREATE TABLE IF NOT EXISTS refresh_tokens (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id CHAR(36) NOT NULL,
    family_id CHAR(36) NOT NULL,
    token_hash CHAR(64) NOT NULL,
    parent_token_hash CHAR(64) DEFAULT NULL,
    device_fingerprint CHAR(64) NOT NULL,
    ip_address VARCHAR(45),
    user_agent VARCHAR(512),
    status ENUM('active', 'rotated', 'revoked') NOT NULL DEFAULT 'active',
    expires_at DATETIME NOT NULL,
    rotated_at DATETIME DEFAULT NULL,
    revoked_at DATETIME DEFAULT NULL,
    revoke_reason VARCHAR(255) DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_used_at TIMESTAMP NULL DEFAULT NULL,

    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,

    UNIQUE KEY uq_refresh_token_hash (token_hash),
    INDEX idx_refresh_tokens_user (user_id),
    INDEX idx_refresh_tokens_family (family_id),
    INDEX idx_refresh_tokens_status (status),
    INDEX idx_refresh_tokens_family_status (family_id, status),
    INDEX idx_refresh_tokens_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS refresh_token_security_events (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id CHAR(36) NOT NULL,
    family_id CHAR(36) DEFAULT NULL,
    event_type VARCHAR(64) NOT NULL,
    token_hash CHAR(64) DEFAULT NULL,
    ip_address VARCHAR(45),
    user_agent VARCHAR(512),
    details JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_rt_sec_user (user_id),
    INDEX idx_rt_sec_family (family_id),
    INDEX idx_rt_sec_type (event_type),
    INDEX idx_rt_sec_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
