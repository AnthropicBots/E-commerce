-- Authenticated Sessions Table
--
-- One row per signed-in device. Rotation on renewal inserts a successor in the
-- same family and marks the predecessor superseded, so a superseded row that is
-- presented again is a replay rather than an ordinary expiry.
--
-- Only the SHA-256 digest of the refresh token is stored: a copy of this table
-- does not hand over the ability to impersonate anyone.
CREATE TABLE IF NOT EXISTS auth_sessions (
    id CHAR(36) PRIMARY KEY,
    user_id CHAR(36) NOT NULL,
    family_id CHAR(36) NOT NULL,
    token_hash CHAR(64) NOT NULL UNIQUE,
    device_label VARCHAR(120),
    user_agent TEXT,
    ip_address VARCHAR(45),
    issued_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_used_at DATETIME DEFAULT NULL,
    expires_at DATETIME NOT NULL,
    revoked_at DATETIME DEFAULT NULL,
    revoked_reason VARCHAR(40) DEFAULT NULL,
    replaced_by CHAR(36) DEFAULT NULL,

    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,

    INDEX idx_auth_sessions_token (token_hash),
    INDEX idx_auth_sessions_user (user_id),
    INDEX idx_auth_sessions_family (family_id),
    INDEX idx_auth_sessions_expires (expires_at),
    INDEX idx_auth_sessions_live (user_id, revoked_at, expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
