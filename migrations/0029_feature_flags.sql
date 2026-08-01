-- Feature flags with percentage rollouts, allowlists, kill switches (#1390)
-- Folded from backend/sql/feature_flags.sql

CREATE TABLE IF NOT EXISTS feature_flags (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    flag_id VARCHAR(100) NOT NULL,
    name VARCHAR(255) NOT NULL,
    flag_key VARCHAR(100) NOT NULL,
    description TEXT NULL,
    type VARCHAR(50) NOT NULL,
    status ENUM('draft', 'active', 'paused', 'killed', 'archived') DEFAULT 'draft',
    value JSON NULL,
    conditions JSON NULL,
    rollout_strategy VARCHAR(50) NULL,
    rollout_percentage INT DEFAULT 0,
    environments JSON NULL,
    user_groups JSON NULL,
    allowlist JSON NULL,
    kill_switch TINYINT(1) NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,

    UNIQUE KEY uq_feature_flags_flag_id (flag_id),
    UNIQUE KEY uq_feature_flags_key (flag_key),
    INDEX idx_feature_flags_type (type),
    INDEX idx_feature_flags_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS feature_flag_evaluations (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    flag_key VARCHAR(100) NOT NULL,
    user_id VARCHAR(100) NULL,
    context_json JSON NULL,
    result_json JSON NULL,
    evaluated_at DATETIME DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_ff_eval_flag (flag_key),
    INDEX idx_ff_eval_user (user_id),
    INDEX idx_ff_eval_at (evaluated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS feature_flag_audit (
    id CHAR(36) PRIMARY KEY,
    action VARCHAR(32) NOT NULL,
    flag_key VARCHAR(100) NOT NULL,
    actor_id CHAR(36) NULL,
    actor_email VARCHAR(255) NULL,
    meta_json JSON NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_ff_audit_flag (flag_key),
    INDEX idx_ff_audit_action (action),
    INDEX idx_ff_audit_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
