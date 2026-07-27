-- Loyalty & Reward Points program (#1232)
-- PR 1/3 ledger base: append-only transactions + derived account balance,
-- plus the tier ladder consumed by the PR 3/3 tier engine.

-- Loyalty Accounts (one row per user; balance/lifetime are running totals)
CREATE TABLE IF NOT EXISTS loyalty_accounts (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL UNIQUE,
    points_balance INT NOT NULL DEFAULT 0,
    lifetime_points INT NOT NULL DEFAULT 0,
    tier VARCHAR(20) NOT NULL DEFAULT 'Bronze',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_user (user_id),
    INDEX idx_tier (tier)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Loyalty Transactions (append-only ledger; balance_after is the account
-- balance immediately after this row was applied, for auditability)
CREATE TABLE IF NOT EXISTS loyalty_transactions (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    order_id INT NULL,
    type ENUM('earn', 'redeem', 'expire', 'adjust') NOT NULL,
    points INT NOT NULL,
    balance_after INT NOT NULL,
    reason VARCHAR(255),
    metadata JSON,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_user (user_id),
    INDEX idx_order (order_id),
    INDEX idx_type (type),
    INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Loyalty Tiers (ladder seeded by loyaltyService.initialize(); the service's
-- TIERS constant is authoritative at runtime, this table mirrors it for
-- reporting and admin visibility)
CREATE TABLE IF NOT EXISTS loyalty_tiers (
    name VARCHAR(20) PRIMARY KEY,
    min_lifetime_points INT NOT NULL DEFAULT 0,
    multiplier DECIMAL(4,2) NOT NULL DEFAULT 1.00,
    benefits JSON,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_min_lifetime (min_lifetime_points)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
