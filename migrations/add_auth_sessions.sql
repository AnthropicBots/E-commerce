-- =====================
-- MOVE SESSIONS OFF THE USER ROW
-- =====================
-- Replaces the single credential stored on users.refresh_token with one durable
-- record per signed-in device. See backend/sql/auth_sessions.sql for the table
-- definition kept in step with backend/schema.sql.

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

-- =====================
-- DROP THE SINGLE-CREDENTIAL COLUMN
-- =====================
-- Nothing reads or writes it any more. Existing values are not migrated: the
-- column held the raw token, and the replacement stores only a digest, so every
-- shopper signs in once more after this runs.
ALTER TABLE users DROP COLUMN IF EXISTS refresh_token;

-- =====================
-- VERIFY CHANGES
-- =====================
SELECT
    COLUMN_NAME,
    DATA_TYPE,
    IS_NULLABLE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'auth_sessions'
ORDER BY ORDINAL_POSITION;
