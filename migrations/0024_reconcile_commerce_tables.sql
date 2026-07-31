-- ============================================
-- RECONCILE THE SCHEMA WITH THE QUERIES THE APPLICATION ISSUES
-- ============================================
--
-- Each table below is queried by application code but was never created by any
-- SQL in the repository, so the feature failed at runtime with "table doesn't
-- exist" on a database built exactly as documented. Shapes are taken from the
-- queries themselves: column names, types and keys are what the code reads,
-- writes and upserts on.

-- ============================================
-- BILLING PLANS
-- ============================================
-- `interval` is a reserved word, so it is quoted here and must be quoted in any
-- statement that names it explicitly. Subscription renewal reads it to decide
-- how far to advance the period.

CREATE TABLE IF NOT EXISTS billing_plans (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    price DECIMAL(10,2) NOT NULL,
    currency CHAR(3) NOT NULL DEFAULT 'INR',
    `interval` ENUM('daily', 'weekly', 'monthly', 'yearly') NOT NULL DEFAULT 'monthly',
    interval_count INT NOT NULL DEFAULT 1,
    trial_days INT NOT NULL DEFAULT 0,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT chk_billing_plans_price CHECK (price >= 0),
    CONSTRAINT chk_billing_plans_interval_count CHECK (interval_count > 0),

    INDEX idx_billing_plans_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- SUBSCRIPTIONS
-- ============================================
-- The status vocabulary is exactly the set the controller and the renewal job
-- filter on, including the American spelling of `canceled` that the code writes.
-- `cancel_at_period_end` is read as a flag, and `dunning_retry_count` is
-- incremented on each failed renewal until the subscription is cancelled.

CREATE TABLE IF NOT EXISTS subscriptions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id CHAR(36) NOT NULL,
    plan_id INT NOT NULL,
    status ENUM('active', 'past_due', 'paused', 'canceled') NOT NULL DEFAULT 'active',
    current_period_start DATETIME NOT NULL,
    current_period_end DATETIME NOT NULL,
    cancel_at_period_end TINYINT(1) NOT NULL DEFAULT 0,
    canceled_at DATETIME NULL,
    dunning_retry_count INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (plan_id) REFERENCES billing_plans(id) ON DELETE RESTRICT,

    INDEX idx_subscriptions_user_status (user_id, status),
    INDEX idx_subscriptions_plan (plan_id),
    -- The renewal job sweeps by period end within a status, so both columns are
    -- in the index and in this order.
    INDEX idx_subscriptions_due (status, current_period_end)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- PRODUCT VIEWS
-- ============================================
-- An append-only view log, distinct from `recently_viewed`, which keeps one row
-- per user and product. Recommendations count rows here and read the most recent
-- `viewed_at` per user, so repeat views must each be retained.
--
-- No foreign key on user_id: views are recorded for signed-out visitors as NULL
-- and are worth keeping after an account is deleted.

CREATE TABLE IF NOT EXISTS product_views (
    id INT AUTO_INCREMENT PRIMARY KEY,
    product_id CHAR(36) NOT NULL,
    user_id CHAR(36) NULL,
    viewed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,

    INDEX idx_product_views_product (product_id),
    INDEX idx_product_views_user_viewed (user_id, viewed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- WISHLIST SHARE LINKS
-- ============================================
-- user_id is unique because generating a link upserts on the user: asking for a
-- share link twice replaces the previous token rather than accumulating tokens.

CREATE TABLE IF NOT EXISTS wishlist_shares (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id CHAR(36) NOT NULL UNIQUE,
    share_token VARCHAR(128) NOT NULL UNIQUE,
    expires_at DATETIME NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,

    INDEX idx_wishlist_shares_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- LOGIN HISTORY AND DEVICE FINGERPRINTS PER USER
-- ============================================
-- Risk evaluation compares the current request against the last recorded address
-- and fingerprint for the account, so both tables are read newest-first per user
-- and the indexes are ordered to serve that directly.
--
-- The column names `ip` and `timestamp` are the ones the risk code uses. They
-- differ from `login_attempts`, which records failed sign-in attempts by email
-- address rather than a per-account history, and is a separate concern.

CREATE TABLE IF NOT EXISTS login_history (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id CHAR(36) NOT NULL,
    ip VARCHAR(45) NOT NULL,
    `timestamp` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,

    INDEX idx_login_history_user_timestamp (user_id, `timestamp`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_fingerprints (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id CHAR(36) NOT NULL,
    fingerprint VARCHAR(255) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,

    INDEX idx_user_fingerprints_user_created (user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- PROMO USAGE LOG
-- ============================================
-- Records a promotion being applied, keyed by the code itself, and is what the
-- per-user limit check counts. Distinct from `promo_usage`, which links a
-- promotion to the order it was applied to once that order exists.
--
-- No foreign key on promo_code: an expired promotion may be archived out of
-- `promo_codes` while its usage history is still needed for reporting.

CREATE TABLE IF NOT EXISTS promo_usage_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    promo_code VARCHAR(50) NOT NULL,
    user_id CHAR(36) NOT NULL,
    discount_amount DECIMAL(10,2) NOT NULL,
    applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_promo_usage_logs_discount CHECK (discount_amount >= 0),

    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,

    INDEX idx_promo_usage_logs_code_user (promo_code, user_id),
    INDEX idx_promo_usage_logs_applied (applied_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- SECURITY LOG: COLUMN NAME
-- ============================================
-- The admin security-log endpoint orders by `timestamp`. Every other column in
-- this table matches what the code expects; only the name of the time column
-- disagreed, so it is renamed rather than duplicated.

ALTER TABLE security_logs
    RENAME COLUMN created_at TO `timestamp`;

ALTER TABLE security_logs
    DROP INDEX idx_security_logs_created,
    ADD INDEX idx_security_logs_timestamp (`timestamp`);
