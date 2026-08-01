-- ============================================
-- ADMIN IMPERSONATION GRANTS & AUDIT (#1393)
-- ============================================
-- Time-boxed "view as user" grants with mandatory reason + ticket id.
-- Audit rows are append-only (no UPDATE/DELETE from the application).
--
-- Also folded into migrations/0028_admin_impersonation_audit.sql.

CREATE TABLE IF NOT EXISTS admin_impersonation_grants (
    id CHAR(36) PRIMARY KEY,
    actor_admin_id CHAR(36) NOT NULL,
    subject_user_id CHAR(36) NOT NULL,
    reason VARCHAR(500) NOT NULL,
    ticket_id VARCHAR(100) NOT NULL,
    jti CHAR(36) NOT NULL,
    expires_at DATETIME NOT NULL,
    revoked_at DATETIME NULL,
    revoked_by CHAR(36) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    UNIQUE KEY uq_impersonation_jti (jti),
    INDEX idx_imp_grant_actor (actor_admin_id),
    INDEX idx_imp_grant_subject (subject_user_id),
    INDEX idx_imp_grant_expires (expires_at),

    CONSTRAINT fk_imp_grant_actor FOREIGN KEY (actor_admin_id)
        REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_imp_grant_subject FOREIGN KEY (subject_user_id)
        REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS admin_impersonation_audit (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    grant_id CHAR(36) NOT NULL,
    actor_admin_id CHAR(36) NOT NULL,
    subject_user_id CHAR(36) NOT NULL,
    action VARCHAR(32) NOT NULL,
    method VARCHAR(16) NULL,
    path VARCHAR(512) NULL,
    status_code INT NULL,
    ip VARCHAR(45) NULL,
    user_agent VARCHAR(512) NULL,
    meta_json JSON NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_imp_audit_grant (grant_id),
    INDEX idx_imp_audit_actor (actor_admin_id),
    INDEX idx_imp_audit_subject (subject_user_id),
    INDEX idx_imp_audit_created (created_at),
    INDEX idx_imp_audit_action (action)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
