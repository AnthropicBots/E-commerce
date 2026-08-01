-- ============================================
-- GUEST CARTS
-- ============================================
--
-- Migration 0027 made `carts.user_id` nullable so a basket could exist before
-- we know who the shopper is, and said plainly that nothing created one yet.
-- This is the other half.
--
-- Two things were missing. A cart with no account has nothing to identify it
-- by, so the client needs to hold something; and the lines themselves are
-- still keyed by account -- `cart_items.user_id` is NOT NULL and part of the
-- primary key -- so a line cannot exist without one however nullable the cart
-- row is. Both are addressed here.

-- ============================================
-- WHAT THE CLIENT HOLDS
-- ============================================
--
-- The token is a bearer credential: whoever presents it gets the cart. Only
-- its SHA-256 is stored, for the same reason a password is not stored in
-- plaintext -- a read of this table must not hand over live baskets. The
-- column is CHAR(64) because that is the width of a hex-encoded SHA-256, and
-- UNIQUE so one token can never resolve to two carts. Account carts store
-- NULL, and NULLs do not collide in a UNIQUE index.
--
-- The expiry is separate from `last_activity_at`, which the abandonment sweep
-- owns. A cart may be swept as abandoned while the token that reaches it is
-- still valid, and a token has to stop working eventually whatever the cart
-- did: an unexpiring bearer credential in someone's browser storage is a
-- standing invitation.

DELIMITER //

CREATE PROCEDURE AddGuestCartToken()
BEGIN
    IF NOT EXISTS (
        SELECT * FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'carts'
        AND COLUMN_NAME = 'guest_token_hash'
    ) THEN
        ALTER TABLE carts
        ADD COLUMN guest_token_hash CHAR(64) NULL AFTER user_id,
        ADD COLUMN guest_token_expires_at DATETIME NULL AFTER guest_token_hash;
    END IF;

    IF NOT EXISTS (
        SELECT * FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'carts'
        AND INDEX_NAME = 'uq_carts_guest_token'
    ) THEN
        CREATE UNIQUE INDEX uq_carts_guest_token ON carts (guest_token_hash);
    END IF;
END //

DELIMITER ;

CALL AddGuestCartToken();
DROP PROCEDURE AddGuestCartToken;

-- ============================================
-- THE LINE BELONGS TO THE CART, NOT THE ACCOUNT
-- ============================================
--
-- Migration 0027 added `cart_items.cart_id` alongside the existing key and
-- backfilled it, deliberately leaving the primary key alone because the
-- guarantee it carries -- one row per product plus variant plus colour plus
-- size -- was independent of which cart the line belonged to. That is still
-- true. What has changed is who the guarantee is scoped to: the cart, which
-- every line now has, rather than the account, which a guest line does not.
--
-- So the same guarantee is re-expressed over `cart_id`, and `user_id` becomes
-- optional. It is not dropped: it still carries the owner for the cascade on
-- account deletion and for the queries that read a shopper's lines directly,
-- and for an account cart it is still written on every line.
--
-- The backfill from 0027 is repeated first. It is a no-op on a database that
-- has already run it, and it is what makes `cart_id NOT NULL` safe on one that
-- acquired rows between the two migrations.

DELIMITER //

CREATE PROCEDURE KeyCartLinesByCart()
BEGIN
    DECLARE owner_fk VARCHAR(64) DEFAULT NULL;

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

    UPDATE cart_items ci
    JOIN carts c
      ON c.user_id = ci.user_id
     AND c.status = 'active'
    SET ci.cart_id = c.id
    WHERE ci.cart_id IS NULL;

    IF EXISTS (
        SELECT * FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'cart_items'
        AND COLUMN_NAME = 'cart_id'
        AND IS_NULLABLE = 'YES'
    ) THEN
        ALTER TABLE cart_items
        MODIFY COLUMN cart_id CHAR(36) NOT NULL;
    END IF;

    -- The foreign key on user_id needs an index with user_id leftmost. It is
    -- about to lose the primary key it has been using for that, so the
    -- standalone index is ensured before rather than after.
    IF NOT EXISTS (
        SELECT * FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'cart_items'
        AND INDEX_NAME = 'idx_cart_items_user'
    ) THEN
        CREATE INDEX idx_cart_items_user ON cart_items (user_id);
    END IF;

    -- Two deployment shapes, as migration 0020 found: one keys the table on
    -- the line itself, the other on a surrogate id with the line as a unique
    -- key. The first has a primary key to move; the second only needs the
    -- cart-scoped key adding beside what it has.
    IF EXISTS (
        SELECT * FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'cart_items'
        AND INDEX_NAME = 'PRIMARY'
        AND COLUMN_NAME = 'user_id'
    ) THEN
        ALTER TABLE cart_items
        DROP PRIMARY KEY,
        ADD PRIMARY KEY (cart_id, product_id, variant_id, color, size);
    ELSEIF NOT EXISTS (
        SELECT * FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'cart_items'
        AND INDEX_NAME = 'uq_cart_items_line'
    ) THEN
        ALTER TABLE cart_items
        ADD UNIQUE KEY uq_cart_items_line (cart_id, product_id, variant_id, color, size);
    END IF;

    -- The constraint is unnamed in the baseline schema, so it is looked up
    -- rather than guessed at, and re-added under a name the next migration can
    -- refer to.
    SET owner_fk = (
        SELECT CONSTRAINT_NAME
        FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
        WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'cart_items'
        AND COLUMN_NAME = 'user_id'
        AND REFERENCED_TABLE_NAME = 'users'
        LIMIT 1
    );

    IF EXISTS (
        SELECT * FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'cart_items'
        AND COLUMN_NAME = 'user_id'
        AND IS_NULLABLE = 'NO'
    ) THEN
        IF owner_fk IS NOT NULL THEN
            SET @drop_owner_fk = CONCAT(
                'ALTER TABLE cart_items DROP FOREIGN KEY `', owner_fk, '`'
            );
            PREPARE drop_owner_fk_stmt FROM @drop_owner_fk;
            EXECUTE drop_owner_fk_stmt;
            DEALLOCATE PREPARE drop_owner_fk_stmt;
            SET owner_fk = NULL;
        END IF;

        ALTER TABLE cart_items
        MODIFY COLUMN user_id CHAR(36) NULL;
    END IF;

    IF owner_fk IS NULL THEN
        ALTER TABLE cart_items
        ADD CONSTRAINT fk_cart_items_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
    END IF;
END //

DELIMITER ;

CALL KeyCartLinesByCart();
DROP PROCEDURE KeyCartLinesByCart;
