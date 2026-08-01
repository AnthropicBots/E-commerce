-- ============================================
-- CART LIFECYCLE
-- ============================================
--
-- Before this, the only cart storage was `cart_items`, keyed by user. Lines
-- existed; a cart did not. Nothing in the schema could say when a basket
-- started, whether it turned into an order, or whether it was walked away
-- from -- while reporting code and the cleanup job both spoke as though a
-- `carts` table were already there.

-- ============================================
-- CARTS
-- ============================================

CREATE TABLE IF NOT EXISTS carts (
    -- CHAR(36) to match users.id and orders.id, both of which this table
    -- references. A CHAR(36)/INT mismatch is how a foreign key in this schema
    -- has failed before.
    id CHAR(36) PRIMARY KEY,

    -- Nullable so a pre-sign-in basket can be persisted without inventing a
    -- fake account. Nothing creates one yet: every cart endpoint is behind
    -- authentication.
    user_id CHAR(36),

    status ENUM('active', 'converted', 'abandoned') NOT NULL DEFAULT 'active',

    -- At most one active cart per account, enforced by the database rather
    -- than by application code alone.
    --
    -- MySQL has no partial indexes, so only an *active* cart stores its
    -- user_id in this column; every other row stores NULL, and NULLs do not
    -- collide in a UNIQUE index. The generated column keeps the marker in
    -- lockstep with status with no way for application code to get the two out
    -- of step. Guest carts hold NULL user_id and so never collide with each
    -- other -- there is no account holding the single slot.
    active_marker CHAR(36)
        GENERATED ALWAYS AS (
            CASE WHEN status = 'active' THEN user_id ELSE NULL END
        ) STORED,

    -- The order this cart turned into. ON DELETE SET NULL rather than CASCADE:
    -- losing an order must not delete the record that a cart converted.
    converted_order_id CHAR(36),
    converted_at DATETIME,
    abandoned_at DATETIME,

    -- Written by the cart service on every shopper action, deliberately
    -- without ON UPDATE CURRENT_TIMESTAMP: a status change written by the
    -- abandonment sweep is not shopper activity and must not look like it.
    last_activity_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uq_carts_one_active (active_marker),

    CONSTRAINT fk_carts_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_carts_order
        FOREIGN KEY (converted_order_id) REFERENCES orders(id) ON DELETE SET NULL,

    INDEX idx_carts_user_status (user_id, status),
    -- The sweep's access path: oldest untouched active carts first.
    INDEX idx_carts_status_activity (status, last_activity_at),
    -- The reporting access path: cohorts of carts by the window they started in.
    INDEX idx_carts_status_created (status, created_at),
    INDEX idx_carts_converted_order (converted_order_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- ATTACH THE LINES TO THE CART
-- ============================================
--
-- `cart_id` is nullable, because every existing row is keyed by user alone and
-- an existing database must not break at the moment this runs. The backfill
-- below fills it in; code written after this migration always supplies it.
--
-- The primary key of `cart_items` is deliberately left alone. It is what stops
-- the same line -- product plus variant plus colour plus size -- appearing
-- twice for one shopper, and that guarantee is independent of which cart the
-- line belongs to. Migration 0020 established that key; this migration only
-- adds a reference alongside it.

DELIMITER //

CREATE PROCEDURE AddCartLifecycleColumns()
BEGIN
    IF NOT EXISTS (
        SELECT * FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'cart_items'
        AND COLUMN_NAME = 'cart_id'
    ) THEN
        ALTER TABLE cart_items
        ADD COLUMN cart_id CHAR(36) NULL AFTER user_id;
    END IF;

    IF NOT EXISTS (
        SELECT * FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'cart_items'
        AND INDEX_NAME = 'idx_cart_items_cart'
    ) THEN
        CREATE INDEX idx_cart_items_cart ON cart_items (cart_id);
    END IF;

    -- The foreign key is added after its index exists, so InnoDB adopts that
    -- index rather than creating a second one for the constraint.
    IF NOT EXISTS (
        SELECT * FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
        WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'cart_items'
        AND CONSTRAINT_NAME = 'fk_cart_items_cart'
    ) THEN
        ALTER TABLE cart_items
        ADD CONSTRAINT fk_cart_items_cart
        FOREIGN KEY (cart_id) REFERENCES carts(id) ON DELETE CASCADE;
    END IF;
END //

DELIMITER ;

CALL AddCartLifecycleColumns();
DROP PROCEDURE AddCartLifecycleColumns;

-- ============================================
-- BACKFILL
-- ============================================
--
-- Every shopper who already has lines gets one active cart holding them, dated
-- from the lines themselves so the cart does not look brand new the moment this
-- runs -- which would otherwise hide a year-old basket from the abandonment
-- sweep.
--
-- Guarded on NOT EXISTS so re-running is a no-op rather than a unique-key
-- violation on uq_carts_one_active.

INSERT INTO carts (id, user_id, status, last_activity_at, created_at)
SELECT
    UUID(),
    ci.user_id,
    'active',
    MAX(ci.updated_at),
    MIN(ci.created_at)
FROM cart_items ci
WHERE ci.cart_id IS NULL
  AND NOT EXISTS (
      SELECT 1 FROM carts c
      WHERE c.user_id = ci.user_id AND c.status = 'active'
  )
GROUP BY ci.user_id;

-- Point the orphaned lines at the cart that was just created for their owner.
-- On a large `cart_items` this is the expensive statement in the migration;
-- run it in batches (add `LIMIT` and repeat until zero rows change) if the
-- table is big enough for a single pass to hold locks longer than the
-- deployment window allows.

UPDATE cart_items ci
JOIN carts c
  ON c.user_id = ci.user_id
 AND c.status = 'active'
SET ci.cart_id = c.id
WHERE ci.cart_id IS NULL;
