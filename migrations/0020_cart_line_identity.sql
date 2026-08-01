-- ============================================
-- CART LINE IDENTITY
-- ============================================

-- A cart line is a product plus the variant the shopper chose. The cart tables
-- predate that: they held one row per (user, product), so two variants of the
-- same product overwrote each other and a reservation was held against the
-- product rather than the chosen variant.
--
-- Rows that predate this migration normalize to the "nothing chosen" sentinels
-- (variant_id 0, empty colour/size) rather than NULL, because NULL never
-- compares equal to NULL and would let the same line slip past the key twice.

DELIMITER //

CREATE PROCEDURE AddCartLineIdentityColumns()
BEGIN
    IF NOT EXISTS (
        SELECT * FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'cart_items'
        AND COLUMN_NAME = 'variant_id'
    ) THEN
        ALTER TABLE cart_items
        ADD COLUMN variant_id INT NOT NULL DEFAULT 0,
        ADD COLUMN color VARCHAR(50) NOT NULL DEFAULT '',
        ADD COLUMN size VARCHAR(50) NOT NULL DEFAULT '';
    END IF;

    -- Widen the primary key to the full line identity. Deployments built from
    -- schema.sql key the table on (user_id, product_id).
    IF EXISTS (
        SELECT * FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'cart_items'
        AND INDEX_NAME = 'PRIMARY'
        AND COLUMN_NAME = 'product_id'
    ) AND NOT EXISTS (
        SELECT * FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'cart_items'
        AND INDEX_NAME = 'PRIMARY'
        AND COLUMN_NAME = 'size'
    ) THEN
        ALTER TABLE cart_items
        DROP PRIMARY KEY,
        ADD PRIMARY KEY (user_id, product_id, variant_id, color, size);
    END IF;

    -- Deployments built from the standalone cart migration instead carry a
    -- surrogate primary key plus a unique key over (user_id, product_id).
    IF EXISTS (
        SELECT * FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'cart_items'
        AND INDEX_NAME = 'idx_cart_items_user_product'
        AND COLUMN_NAME = 'product_id'
    ) AND NOT EXISTS (
        SELECT * FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'cart_items'
        AND INDEX_NAME = 'idx_cart_items_user_product'
        AND COLUMN_NAME = 'size'
    ) THEN
        ALTER TABLE cart_items
        DROP INDEX idx_cart_items_user_product,
        ADD UNIQUE KEY idx_cart_items_user_product (user_id, product_id, variant_id, color, size);
    END IF;

    IF NOT EXISTS (
        SELECT * FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'inventory_locks'
        AND COLUMN_NAME = 'variant_id'
    ) THEN
        ALTER TABLE inventory_locks
        ADD COLUMN variant_id INT NOT NULL DEFAULT 0,
        ADD COLUMN color VARCHAR(50) NOT NULL DEFAULT '',
        ADD COLUMN size VARCHAR(50) NOT NULL DEFAULT '';
    END IF;

    -- Locks stay one row per reservation, so this index is not unique: a
    -- shopper may hold several reservations for one line and consuming a
    -- purchase walks them oldest-expiring first.
    IF NOT EXISTS (
        SELECT * FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'inventory_locks'
        AND INDEX_NAME = 'idx_inventory_locks_line'
    ) THEN
        CREATE INDEX idx_inventory_locks_line
        ON inventory_locks (product_id, variant_id, color, size);
    END IF;
END //

DELIMITER ;

-- Run migration
CALL AddCartLineIdentityColumns();
DROP PROCEDURE AddCartLineIdentityColumns;
