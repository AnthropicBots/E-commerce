-- ============================================
-- SETTLE THE KEY STRATEGY: UUIDs FOR USERS, PRODUCTS AND ORDERS
-- ============================================
--
-- The project uses CHAR(36) UUIDs for `users`, `products` and `orders`, and
-- AUTO_INCREMENT integers for everything else. See migrations/README.md for the
-- reasoning. This migration brings the columns that still reference those three
-- tables by integer id into line, so every reference in the schema has the same
-- type as the key it points at.
--
-- Columns without a foreign key were the ones this drifted in: nothing stopped
-- them being declared INT, and the mismatch only showed up as a failed insert at
-- runtime, when a UUID was written into an integer column.

-- ============================================
-- LOYALTY
-- ============================================
--
-- The service always passes the caller's UUID, so any row already in these
-- tables was written through an integer column that could not hold it: those
-- rows do not identify an account and are removed before the references are
-- constrained. Nothing that resolves to a real user is discarded.

ALTER TABLE loyalty_accounts
    MODIFY COLUMN user_id CHAR(36) NOT NULL;

ALTER TABLE loyalty_transactions
    MODIFY COLUMN user_id CHAR(36) NOT NULL,
    MODIFY COLUMN order_id CHAR(36) NULL;

DELETE FROM loyalty_transactions
WHERE user_id NOT IN (SELECT id FROM users);

DELETE FROM loyalty_accounts
WHERE user_id NOT IN (SELECT id FROM users);

UPDATE loyalty_transactions
SET order_id = NULL
WHERE order_id IS NOT NULL
  AND order_id NOT IN (SELECT id FROM orders);

ALTER TABLE loyalty_accounts
    ADD CONSTRAINT fk_loyalty_accounts_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE loyalty_transactions
    ADD CONSTRAINT fk_loyalty_transactions_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    ADD CONSTRAINT fk_loyalty_transactions_order
        FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL;

-- ============================================
-- PROMOTIONS
-- ============================================
--
-- Audit columns only: no foreign key, because a promotion's history should
-- survive the deletion of the admin who created it.

ALTER TABLE promo_codes
    MODIFY COLUMN created_by CHAR(36) DEFAULT NULL,
    MODIFY COLUMN updated_by CHAR(36) DEFAULT NULL;

ALTER TABLE promo_batches
    MODIFY COLUMN created_by CHAR(36) DEFAULT NULL,
    MODIFY COLUMN updated_by CHAR(36) DEFAULT NULL;

ALTER TABLE promo_generation_history
    MODIFY COLUMN generated_by CHAR(36) DEFAULT NULL;
