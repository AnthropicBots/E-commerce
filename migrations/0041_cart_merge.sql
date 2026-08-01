-- ============================================
-- MERGING A GUEST BASKET INTO AN ACCOUNT
-- ============================================
--
-- A shopper who builds a basket and then signs in has to end up with one cart
-- holding both. That leaves the guest cart needing somewhere to go, and none
-- of the three states it could already be in is the truth:
--
--   `active` would leave two live carts for the same shopper, one of them
--   unreachable, and the abandonment sweep would eventually write the guest
--   one off as a basket that was walked away from -- which is the opposite of
--   what happened;
--
--   `abandoned` says the same thing outright, and would put a floor under the
--   abandonment rate made entirely of shoppers who did sign in;
--
--   `converted` claims an order that does not exist, and `converted_order_id`
--   would be NULL on a row the conversion figures count.
--
-- So there is a fourth exit. Like the other two it is terminal, and like them
-- it is recorded with what it went to and when.
--
-- The one-active-cart guarantee survives untouched, and by the same mechanism
-- as before: `active_marker` is generated from `status`, so a merged cart's
-- marker is NULL and it holds no slot. The expression is unchanged -- only the
-- set of values the column can take is wider -- so the generated column and
-- the unique index behind it carry on meaning exactly what migration 0027 said
-- they mean.

DELIMITER //

CREATE PROCEDURE AddMergedCartStatus()
BEGIN
    IF NOT EXISTS (
        SELECT * FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'carts'
        AND COLUMN_NAME = 'status'
        AND COLUMN_TYPE LIKE '%''merged''%'
    ) THEN
        ALTER TABLE carts
        MODIFY COLUMN status
            ENUM('active', 'converted', 'abandoned', 'merged')
            NOT NULL DEFAULT 'active';
    END IF;

    IF NOT EXISTS (
        SELECT * FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'carts'
        AND COLUMN_NAME = 'merged_into_cart_id'
    ) THEN
        ALTER TABLE carts
        ADD COLUMN merged_into_cart_id CHAR(36) NULL AFTER abandoned_at,
        ADD COLUMN merged_at DATETIME NULL AFTER merged_into_cart_id;
    END IF;

    IF NOT EXISTS (
        SELECT * FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'carts'
        AND INDEX_NAME = 'idx_carts_merged_into'
    ) THEN
        CREATE INDEX idx_carts_merged_into ON carts (merged_into_cart_id);
    END IF;

    -- ON DELETE SET NULL rather than CASCADE, for the same reason
    -- `converted_order_id` uses it: losing the surviving cart must not delete
    -- the record that a basket was folded into it.
    IF NOT EXISTS (
        SELECT * FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
        WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'carts'
        AND CONSTRAINT_NAME = 'fk_carts_merged_into'
    ) THEN
        ALTER TABLE carts
        ADD CONSTRAINT fk_carts_merged_into
        FOREIGN KEY (merged_into_cart_id) REFERENCES carts(id) ON DELETE SET NULL;
    END IF;
END //

DELIMITER ;

CALL AddMergedCartStatus();
DROP PROCEDURE AddMergedCartStatus;
