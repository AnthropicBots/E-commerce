-- Loyalty Accounts Table
-- One row per user holding the current balance and derived tier.
CREATE TABLE IF NOT EXISTS loyalty_accounts (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id VARCHAR(100) UNIQUE NOT NULL,
    points_balance INT NOT NULL DEFAULT 0,
    lifetime_points INT NOT NULL DEFAULT 0,
    tier VARCHAR(20) NOT NULL DEFAULT 'Bronze',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_user (user_id),
    INDEX idx_tier (tier)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Loyalty Transactions Table
-- Append-only ledger. Every earn/redeem/expire/adjust is a new row; the
-- signed `points` column plus `balance_after` make the running balance
-- auditable without mutating history.
CREATE TABLE IF NOT EXISTS loyalty_transactions (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id VARCHAR(100) NOT NULL,
    order_id VARCHAR(100),
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
