-- Loyalty & Reward Points program (issue #1232, PR 1/3: ledger core).
-- `loyalty_transactions` is the append-only source of truth for a user's
-- points; `loyalty_accounts` caches the running balance so reads stay cheap.

-- Per-user loyalty account: cached running totals plus the derived tier. The
-- balance here is a cache of the ledger and must only ever be mutated in the
-- same transaction that appends the corresponding ledger row.
CREATE TABLE IF NOT EXISTS loyalty_accounts (
    user_id INT PRIMARY KEY,
    points_balance INT NOT NULL DEFAULT 0,
    lifetime_points INT NOT NULL DEFAULT 0,
    tier VARCHAR(20) NOT NULL DEFAULT 'Bronze',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Append-only points ledger: one immutable row per points event. `points` is
-- signed (positive earn, negative redeem/expire) and `balance_after` snapshots
-- the account balance at write time so the history is self-describing.
CREATE TABLE IF NOT EXISTS loyalty_transactions (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    order_id INT DEFAULT NULL,
    type ENUM('earn', 'redeem', 'expire', 'adjust') NOT NULL,
    points INT NOT NULL,
    balance_after INT NOT NULL,
    reason VARCHAR(255) DEFAULT NULL,
    metadata JSON DEFAULT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_user (user_id),
    INDEX idx_type (type),
    INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
