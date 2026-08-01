-- ============================================
-- USER SECURITY FIELDS AND SECURITY TABLES
-- ============================================
--
-- Folded in from the hand-written change file `add_security_fields.sql`, which
-- could not be applied as written:
--
--   * it used `ADD COLUMN IF NOT EXISTS`, which is MariaDB syntax and a syntax
--     error on MySQL, so the whole file failed on the first statement;
--   * it declared `user_id INT` against a `users.id` that is CHAR(36), so its
--     foreign keys could not be built either;
--   * it re-added `failed_login_attempts`, `last_login` and `deleted_at`, which
--     the baseline already declares;
--   * it introduced `lockout_until` alongside the baseline's `locked_until` for
--     the same purpose. `locked_until` is the one the lockout code reads, so
--     that name wins and `lockout_until` is not created;
--   * it declared `refresh_tokens` with a plaintext `token` column, and the
--     baseline now owns a table of that name — the rotating, hash-only one from
--     the refresh token families work, which is the one the token service
--     reads. A second `CREATE TABLE IF NOT EXISTS` would be skipped silently
--     and leave the shape depending on apply order, so it is not repeated here.
--
-- What is left is the part the baseline genuinely lacks.

ALTER TABLE users
    ADD COLUMN delete_reason VARCHAR(500) NULL;

-- ============================================
-- PASSWORD HISTORY
-- ============================================
-- Retains previous hashes so a password cannot be reused.

CREATE TABLE IF NOT EXISTS password_history (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id CHAR(36) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,

    INDEX idx_password_history_user (user_id),
    INDEX idx_password_history_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- SECURITY EVENT LOG
-- ============================================
-- No foreign key on user_id: security events are retained for audit after the
-- account they describe has been deleted.

CREATE TABLE IF NOT EXISTS security_logs (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id CHAR(36) NULL,
    event_type VARCHAR(50) NOT NULL,
    ip_address VARCHAR(45),
    user_agent VARCHAR(255),
    metadata JSON,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_security_logs_user (user_id),
    INDEX idx_security_logs_event_type (event_type),
    INDEX idx_security_logs_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
