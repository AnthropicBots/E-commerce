-- ============================================
-- SAVED ADDRESS BOOK
-- ============================================
--
-- Addresses #1347.
--
-- Before this, `users` carried a single flattened address inline
-- (`address`, `city`, `state`, `zip`, `country`) that nothing read, and
-- checkout rebuilt the delivery address from form fields on every single
-- order. There was no addresses table, model or endpoint anywhere in the
-- codebase.
--
-- Run against an existing database. `backend/schema.sql` carries the same
-- definition for fresh installs.

-- ============================================
-- USER ADDRESSES
-- ============================================

CREATE TABLE IF NOT EXISTS user_addresses (
    -- CHAR(36) to match users.id and orders.id. The rest of the schema moved
    -- to UUIDs in #1025 specifically so externally-exposed identifiers are not
    -- enumerable, and an address id is about as sensitive as a handle gets:
    -- it points at where somebody lives.
    id CHAR(36) PRIMARY KEY,
    user_id CHAR(36) NOT NULL,

    -- Free-text label the shopper chooses ("Home", "Mum's place"), with the
    -- common three offered in the UI. Not an ENUM: a fixed vocabulary is the
    -- kind of thing that needs a migration the first time someone wants
    -- "Warehouse".
    label VARCHAR(50) NOT NULL DEFAULT 'Home',

    -- Per-address recipient. Deliberately not inherited from the account:
    -- ordering to a family member, a colleague or an office front desk is
    -- ordinary, and the courier needs the person who will actually take the
    -- parcel, not the person who owns the login.
    recipient_name VARCHAR(255) NOT NULL,
    recipient_phone VARCHAR(20) NOT NULL,

    address_line1 VARCHAR(255) NOT NULL,
    address_line2 VARCHAR(255),
    landmark VARCHAR(255),
    city VARCHAR(100) NOT NULL,
    state VARCHAR(100) NOT NULL,
    postal_code VARCHAR(20) NOT NULL,
    country VARCHAR(100) NOT NULL DEFAULT 'India',

    is_default TINYINT(1) NOT NULL DEFAULT 0,

    -- Set when an order ships to this address, so deleting the default can
    -- promote the address the shopper actually uses rather than an arbitrary
    -- survivor.
    last_used_at DATETIME,

    -- Soft delete. `orders.address_id` references this table, and a hard
    -- delete would orphan the reference on historical orders.
    deleted_at DATETIME,
    deleted_by CHAR(36),

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_user_addresses_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,

    -- At most one default per account, enforced by the database rather than
    -- by application code alone.
    --
    -- MySQL has no partial indexes, so the trick is that only the *default*
    -- row stores its user_id in this column; every non-default row stores
    -- NULL, and NULLs do not collide in a UNIQUE index. The generated column
    -- keeps it in lockstep with is_default with no way for application code
    -- to get the two out of step.
    --
    -- deleted_at is folded in so a soft-deleted default does not block the
    -- promotion of its replacement.
    default_marker CHAR(36)
        GENERATED ALWAYS AS (
            CASE WHEN is_default = 1 AND deleted_at IS NULL THEN user_id ELSE NULL END
        ) STORED,
    UNIQUE KEY uq_user_addresses_one_default (default_marker),

    INDEX idx_user_addresses_user (user_id, deleted_at),
    INDEX idx_user_addresses_default (user_id, is_default),
    INDEX idx_user_addresses_last_used (user_id, last_used_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- LINK ORDERS TO THE BOOK
-- ============================================
--
-- The flattened snapshot already on `orders` (customer_name, city, state,
-- zip, full_address) stays authoritative for what was actually shipped: it
-- must not change when a shopper later edits or deletes the saved address.
-- This column answers the different question of *which* saved address an
-- order came from, which is what "reorder to the same place" needs.
--
-- ON DELETE SET NULL rather than CASCADE: losing an address must never lose
-- an order.

ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS address_id CHAR(36) NULL AFTER shipping_address;

ALTER TABLE orders
    ADD CONSTRAINT fk_orders_address
    FOREIGN KEY (address_id) REFERENCES user_addresses(id) ON DELETE SET NULL;

CREATE INDEX idx_orders_address ON orders (address_id);

-- ============================================
-- BACKFILL
-- ============================================
--
-- Every account that filled in the legacy inline columns gets that address
-- seeded as its default, so nobody has to retype what they already gave us.
--
-- Guarded on `address IS NOT NULL AND address <> ''` because the columns are
-- nullable and mostly empty, and on NOT EXISTS so re-running this migration
-- is a no-op rather than a duplicate.

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
