-- ============================================
-- RECOVERY ATTRIBUTION
-- ============================================
--
-- The recovery programme can now send a message and rebuild a basket from it,
-- and cannot say what either of those is worth. Anything reconstructed later --
-- "an order from someone we mailed, placed soon enough afterwards" -- is a
-- guess dressed as a figure: it counts shoppers who would have come back
-- anyway, it changes whenever somebody adjusts the window, and it cannot
-- survive the send log being pruned.
--
-- So attribution is recorded at the moment it is known, on the order, as a
-- fact. An order either arrived through a link or it did not, and the row says
-- which.

DELIMITER //

CREATE PROCEDURE AddOrderRecoveryAttribution()
BEGIN
    -- Which message minted the link. A link is issued per send, so this is what
    -- makes "the second reminder earns nothing" an exact statement rather than
    -- a guess from timestamps -- and the stage delays are configuration nobody
    -- can tune without it.
    IF NOT EXISTS (
        SELECT * FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'cart_restore_tokens'
        AND COLUMN_NAME = 'recovery_log_id'
    ) THEN
        ALTER TABLE cart_restore_tokens
        ADD COLUMN recovery_log_id CHAR(36) NULL AFTER user_id;
    END IF;

    IF NOT EXISTS (
        SELECT * FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'cart_restore_tokens'
        AND INDEX_NAME = 'idx_cart_restore_recovery_log'
    ) THEN
        CREATE INDEX idx_cart_restore_recovery_log
            ON cart_restore_tokens (recovery_log_id);
    END IF;

    IF NOT EXISTS (
        SELECT * FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
        WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'cart_restore_tokens'
        AND CONSTRAINT_NAME = 'fk_cart_restore_recovery_log'
    ) THEN
        ALTER TABLE cart_restore_tokens
        ADD CONSTRAINT fk_cart_restore_recovery_log
        FOREIGN KEY (recovery_log_id)
            REFERENCES cart_recovery_log(id) ON DELETE SET NULL;
    END IF;

    -- The link that was actually spent. Precise enough to answer which message
    -- in the sequence earned the order, since the token is minted per send.
    IF NOT EXISTS (
        SELECT * FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'orders'
        AND COLUMN_NAME = 'recovery_token_id'
    ) THEN
        ALTER TABLE orders
        ADD COLUMN recovery_token_id CHAR(36) NULL AFTER promo_code;
    END IF;

    -- The basket that was recovered. Derivable from the token today, and stored
    -- anyway: restore tokens are short-lived rows that a housekeeping job will
    -- eventually clear out, and losing them must not silently turn recovered
    -- revenue back into ordinary revenue.
    IF NOT EXISTS (
        SELECT * FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'orders'
        AND COLUMN_NAME = 'recovered_cart_id'
    ) THEN
        ALTER TABLE orders
        ADD COLUMN recovered_cart_id CHAR(36) NULL AFTER recovery_token_id;
    END IF;

    -- The reporting access path: recovered orders in a trading window. Leading
    -- with the cart id keeps the index selective -- almost every order has NULL
    -- there, and NULLs are not stored in a way that makes this index grow with
    -- ordinary trade.
    IF NOT EXISTS (
        SELECT * FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'orders'
        AND INDEX_NAME = 'idx_orders_recovered_cart'
    ) THEN
        CREATE INDEX idx_orders_recovered_cart
            ON orders (recovered_cart_id, created_at);
    END IF;

    -- ON DELETE SET NULL, not CASCADE, on both. Deleting a spent link or an old
    -- cart must never delete the order that came out of it; the worst it may do
    -- is cost the attribution, and the denormalised pair above means it takes
    -- both deletions to do even that.
    IF NOT EXISTS (
        SELECT * FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
        WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'orders'
        AND CONSTRAINT_NAME = 'fk_orders_recovery_token'
    ) THEN
        ALTER TABLE orders
        ADD CONSTRAINT fk_orders_recovery_token
        FOREIGN KEY (recovery_token_id)
            REFERENCES cart_restore_tokens(id) ON DELETE SET NULL;
    END IF;

    IF NOT EXISTS (
        SELECT * FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
        WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'orders'
        AND CONSTRAINT_NAME = 'fk_orders_recovered_cart'
    ) THEN
        ALTER TABLE orders
        ADD CONSTRAINT fk_orders_recovered_cart
        FOREIGN KEY (recovered_cart_id)
            REFERENCES carts(id) ON DELETE SET NULL;
    END IF;
END //

DELIMITER ;

CALL AddOrderRecoveryAttribution();
DROP PROCEDURE AddOrderRecoveryAttribution;
