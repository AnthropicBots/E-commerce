-- backend/sql/gift_cards.sql
-- Gift cards / store credit (#1231). Codes are never stored in the clear:
-- only the SHA-256 hash of the plaintext code is persisted in code_hash.

-- ============================================
-- GIFT CARDS
-- ============================================
CREATE TABLE IF NOT EXISTS gift_cards (
    id INT PRIMARY KEY AUTO_INCREMENT,
    code_hash CHAR(64) NOT NULL UNIQUE,
    balance DECIMAL(10,2) NOT NULL DEFAULT 0.00 CHECK (balance >= 0),
    currency CHAR(3) NOT NULL DEFAULT 'USD',
    status ENUM('active', 'redeemed', 'expired', 'disabled') NOT NULL DEFAULT 'active',
    expires_at DATETIME DEFAULT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_gift_cards_status (status),
    INDEX idx_gift_cards_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- GIFT CARD TRANSACTIONS (LEDGER)
-- ============================================
-- Append-only ledger. balance_after records the card balance immediately
-- after the row was applied, so a card's balance can always be reconstructed
-- from its transaction history.
CREATE TABLE IF NOT EXISTS gift_card_transactions (
    id INT PRIMARY KEY AUTO_INCREMENT,
    gift_card_id INT NOT NULL,
    order_id CHAR(36) DEFAULT NULL,
    type ENUM('issue', 'redeem', 'refund') NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    balance_after DECIMAL(10,2) NOT NULL CHECK (balance_after >= 0),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_gc_txn_card (gift_card_id),
    INDEX idx_gc_txn_order (order_id),
    INDEX idx_gc_txn_type (type),
    INDEX idx_gc_txn_created (created_at),
    FOREIGN KEY (gift_card_id) REFERENCES gift_cards(id) ON DELETE CASCADE,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
