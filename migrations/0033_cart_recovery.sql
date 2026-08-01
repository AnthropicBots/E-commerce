-- ============================================
-- ABANDONED-CART RECOVERY
-- ============================================
--
-- Migration 0027 gave a cart somewhere to go when it is walked away from, and
-- nothing has acted on that since: the sweep stamps `abandoned_at` and the
-- basket is never mentioned again. This adds the two things needed before a
-- recovery message can be sent safely -- a record of what was already sent, and
-- somewhere for the shopper to say they would rather not hear about it.
--
-- The preference centre from #1394 is extended rather than replaced. A second
-- table of opt-outs would mean a shopper who unsubscribed from one kind of mail
-- still hearing from us through the other, which is the complaint the
-- preference centre exists to prevent.

-- ============================================
-- SEND LOG
-- ============================================
--
-- The suppression rules are enforced here rather than in application code alone.
-- A recovery run can be retried, can overlap with another instance, and can be
-- restarted mid-batch; in all three cases the thing that must not happen is a
-- second message about a basket the shopper has already been reminded of.
-- `dedupe_key` is written before the message goes out, so the database refuses
-- the duplicate instead of the sender having to notice it.

CREATE TABLE IF NOT EXISTS cart_recovery_log (
    -- CHAR(36) to match carts.id and users.id, both referenced below. A
    -- CHAR(36)/INT mismatch is how a foreign key in this schema has failed
    -- before.
    id CHAR(36) PRIMARY KEY,

    cart_id CHAR(36) NOT NULL,
    user_id CHAR(36) NOT NULL,

    -- Which message in the sequence this was, counted from zero. Stored rather
    -- than derived: the delays behind the sequence are configuration and move
    -- with campaigns, so "the second message" has to stay identifiable after
    -- the schedule that produced it has changed.
    stage TINYINT UNSIGNED NOT NULL,

    channels_json JSON NULL,

    -- `cartId:stage`. One row per basket per step of the sequence, which is
    -- what makes "nobody is contacted twice for the same basket" a constraint
    -- rather than a convention.
    dedupe_key VARCHAR(128) NOT NULL,

    sent_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    UNIQUE KEY uq_cart_recovery_dedupe (dedupe_key),

    INDEX idx_cart_recovery_cart (cart_id),
    -- The frequency cap's access path: how much this person has heard from us
    -- lately, across every basket they have left behind.
    INDEX idx_cart_recovery_user_sent (user_id, sent_at),

    CONSTRAINT fk_cart_recovery_cart
        FOREIGN KEY (cart_id) REFERENCES carts(id) ON DELETE CASCADE,
    CONSTRAINT fk_cart_recovery_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- PREFERENCES AND ACCESS PATHS
-- ============================================
--
-- Recovery mail gets its own two flags rather than riding on the price-drop
-- ones: a shopper who does not want to be told about discounts may still want
-- to be told they left a basket behind, and conflating the two makes the only
-- available answer "all or nothing". `unsubscribed_all` still overrides both.
--
-- Defaulting to 1 matches the price-drop columns and keeps existing accounts
-- in the same position they are in today for every other notification. The
-- suppression rules in the recovery service, not this default, are what stop
-- the programme becoming a nuisance.

DELIMITER //

CREATE PROCEDURE AddCartRecoveryPreferences()
BEGIN
    IF NOT EXISTS (
        SELECT * FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'notification_preferences'
        AND COLUMN_NAME = 'cart_recovery_email'
    ) THEN
        ALTER TABLE notification_preferences
        ADD COLUMN cart_recovery_email TINYINT(1) NOT NULL DEFAULT 1
        AFTER price_drop_in_app;
    END IF;

    IF NOT EXISTS (
        SELECT * FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'notification_preferences'
        AND COLUMN_NAME = 'cart_recovery_in_app'
    ) THEN
        ALTER TABLE notification_preferences
        ADD COLUMN cart_recovery_in_app TINYINT(1) NOT NULL DEFAULT 1
        AFTER cart_recovery_email;
    END IF;

    -- The recovery scan reads oldest-abandoned-first, which none of the
    -- indexes from 0027 serve: they are keyed on last_activity_at and
    -- created_at, neither of which moves when the sweep abandons a cart.
    IF NOT EXISTS (
        SELECT * FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'carts'
        AND INDEX_NAME = 'idx_carts_status_abandoned'
    ) THEN
        CREATE INDEX idx_carts_status_abandoned ON carts (status, abandoned_at);
    END IF;

    -- "Has this person bought since they walked away" is asked once per
    -- candidate basket, and answering it by user alone means scanning every
    -- order that account has ever placed.
    IF NOT EXISTS (
        SELECT * FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'orders'
        AND INDEX_NAME = 'idx_orders_user_created'
    ) THEN
        CREATE INDEX idx_orders_user_created ON orders (user_id, created_at);
    END IF;
END //

DELIMITER ;

CALL AddCartRecoveryPreferences();
DROP PROCEDURE AddCartRecoveryPreferences;
