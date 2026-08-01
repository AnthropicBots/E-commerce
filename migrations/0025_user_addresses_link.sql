-- ============================================
-- SAVED ADDRESS BOOK: ORDER LINK AND BACKFILL
-- ============================================
--
-- Folded in from the un-numbered change file `add_user_addresses.sql`, which the
-- runner ignored because nothing could order it, so a fresh install never got
-- the `orders.address_id` link at all.
--
-- The `user_addresses` table itself is not re-declared here: the baseline
-- already owns it, in the same shape. What the baseline lacks is the link from
-- an order back to the saved address it came from, and the backfill of the
-- legacy inline address columns on `users`.
--
-- The change file used `ADD COLUMN IF NOT EXISTS`, which is MariaDB syntax that
-- MySQL rejects outright; the add is guarded by an INFORMATION_SCHEMA check
-- instead. The constraint and the index are guarded the same way, because that
-- file shipped as something runnable and a database may already carry them.

DELIMITER //

CREATE PROCEDURE AddOrderAddressLink()
BEGIN
    -- The flattened snapshot already on `orders` (customer_name, city, state,
    -- zip, full_address) stays authoritative for what was actually shipped: it
    -- must not change when a shopper later edits or deletes the saved address.
    -- This column answers the different question of *which* saved address an
    -- order came from, which is what "reorder to the same place" needs.
    IF NOT EXISTS (
        SELECT * FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'orders'
        AND COLUMN_NAME = 'address_id'
    ) THEN
        ALTER TABLE orders
        ADD COLUMN address_id CHAR(36) NULL AFTER shipping_address;
    END IF;

    -- ON DELETE SET NULL rather than CASCADE: losing an address must never lose
    -- an order.
    IF NOT EXISTS (
        SELECT * FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
        WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'orders'
        AND CONSTRAINT_NAME = 'fk_orders_address'
    ) THEN
        ALTER TABLE orders
        ADD CONSTRAINT fk_orders_address
        FOREIGN KEY (address_id) REFERENCES user_addresses(id) ON DELETE SET NULL;
    END IF;

    IF NOT EXISTS (
        SELECT * FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'orders'
        AND INDEX_NAME = 'idx_orders_address'
    ) THEN
        CREATE INDEX idx_orders_address ON orders (address_id);
    END IF;
END //

DELIMITER ;

CALL AddOrderAddressLink();
DROP PROCEDURE AddOrderAddressLink;

-- ============================================
-- BACKFILL
-- ============================================
--
-- Every account that filled in the legacy inline columns gets that address
-- seeded as its default, so nobody has to retype what they already gave us.
--
-- Guarded on `address IS NOT NULL AND address <> ''` because the columns are
-- nullable and mostly empty, and on NOT EXISTS so re-running this migration is
-- a no-op rather than a duplicate.

INSERT INTO user_addresses (
    id, user_id, label, recipient_name, recipient_phone,
    address_line1, city, state, postal_code, country, is_default
)
SELECT
    UUID(),
    u.id,
    'Home',
    COALESCE(NULLIF(TRIM(u.name), ''), 'Recipient'),
    COALESCE(NULLIF(TRIM(u.phone), ''), ''),
    TRIM(u.address),
    COALESCE(NULLIF(TRIM(u.city), ''), 'Unknown'),
    COALESCE(NULLIF(TRIM(u.state), ''), 'Unknown'),
    COALESCE(NULLIF(TRIM(u.zip), ''), '000000'),
    COALESCE(NULLIF(TRIM(u.country), ''), 'India'),
    1
FROM users u
WHERE u.address IS NOT NULL
  AND TRIM(u.address) <> ''
  AND u.deleted_at IS NULL
  AND NOT EXISTS (
      SELECT 1 FROM user_addresses a
      WHERE a.user_id = u.id AND a.deleted_at IS NULL
  );

-- The legacy `users` address columns are intentionally left in place rather
-- than dropped in the same migration that starts writing their replacement.
-- Drop them in a follow-up once nothing reads them.
