-- ============================================
-- SHIPPING METHODS (#1430)
-- ============================================
--
-- `orders.shipping_method VARCHAR(50)` and `orders.shipping_cost DECIMAL(10,2)`
-- have been in the schema since the baseline. `shipping_cost` acquired a writer
-- when the pricing engine landed; `shipping_method` never did, because there
-- was nothing to record -- checkout offered no choice of delivery, so every
-- order was shipped by an unnamed method at a flat rate.
--
-- This declares the methods that may be offered. `shipments.shipping_method`
-- is the same vocabulary, one step further downstream: fulfilment reads what
-- checkout sold. It is deliberately not a second list, and it is not an ENUM
-- on either table -- adding a delivery option is a row, not a schema change.
--
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS shipping_methods (
    -- The code is the primary key rather than a surrogate id, because it is
    -- what `orders.shipping_method` has always stored and what fulfilment,
    -- accounting and the courier integrations all speak. VARCHAR(50) matches
    -- that column exactly so the two can be joined and constrained.
    code VARCHAR(50) PRIMARY KEY,

    label VARCHAR(100) NOT NULL,
    description VARCHAR(255),

    -- What this method costs before any waiver. Rates are DECIMAL and are read
    -- by the server only: a delivery charge the client can send is a discount
    -- the client can grant itself.
    base_rate DECIMAL(10,2) NOT NULL DEFAULT 0,

    -- Exactly one method is the default, enforced by the database rather than
    -- by application code alone. MySQL has no partial indexes, so only the
    -- default row stores a marker and every other row stores NULL; NULLs do
    -- not collide in a UNIQUE index. The generated column keeps the marker in
    -- lockstep with the flag with no way for code to get the two out of step.
    is_default TINYINT(1) NOT NULL DEFAULT 0,
    default_marker TINYINT(1)
        GENERATED ALWAYS AS (
            CASE WHEN is_default = 1 THEN 1 ELSE NULL END
        ) STORED,

    -- Retiring a method deactivates it. Deleting it would orphan every order
    -- that recorded it, which is why the foreign key below restricts deletes.
    is_active TINYINT(1) NOT NULL DEFAULT 1,

    -- Display order at checkout. Cheapest-first is not always the order a
    -- shopper should see, so it is a stated value rather than a sort on rate.
    sort_order INT NOT NULL DEFAULT 0,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT chk_shipping_methods_base_rate CHECK (base_rate >= 0),

    UNIQUE KEY uq_shipping_methods_default (default_marker),

    -- The checkout access path: the active options, in the order they show.
    INDEX idx_shipping_methods_active_sort (is_active, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- THE OPTIONS ON OFFER
-- ============================================
--
-- `standard` reproduces exactly what every order has been charged until now:
-- the flat rate the pricing engine has always applied, waived above the
-- free-shipping threshold. That is what makes it a safe default -- a checkout
-- that chooses nothing prices identically to before this migration.
--
-- Guarded on the code so re-running does not overwrite rates an operator has
-- since changed. Rates are business configuration; this seed only establishes
-- that the options exist.

INSERT INTO shipping_methods (
    code, label, description, base_rate, is_default, is_active, sort_order
)
SELECT
    'standard', 'Standard delivery', 'Arrives in three to six days.',
    49.00, 1, 1, 10
FROM DUAL
WHERE NOT EXISTS (
    SELECT 1 FROM shipping_methods WHERE code = 'standard'
);

INSERT INTO shipping_methods (
    code, label, description, base_rate, is_default, is_active, sort_order
)
SELECT
    'express', 'Express delivery', 'Arrives in one to two days.',
    149.00, 0, 1, 20
FROM DUAL
WHERE NOT EXISTS (
    SELECT 1 FROM shipping_methods WHERE code = 'express'
);

-- ============================================
-- TIE ORDERS TO THE VOCABULARY
-- ============================================
--
-- The index exists before the foreign key so InnoDB adopts it rather than
-- building a second one for the constraint.
--
-- Historical orders keep a NULL `shipping_method`, which the constraint
-- permits. Backfilling them to 'standard' would assert something nobody
-- recorded: what those orders were shipped by is not known, and the pricing
-- breakdown work established that figures which were never captured are left
-- absent rather than invented. NULL reads as "not recorded" everywhere it is
-- displayed.
--
-- The column has never had a writer, so every existing value is NULL and the
-- constraint builds. A deployment where the column was populated by hand will
-- fail here rather than quietly dropping the constraint -- an unrecognised
-- method on an order is a real inconsistency and worth stopping for.

DELIMITER //

CREATE PROCEDURE LinkOrdersToShippingMethods()
BEGIN
    IF NOT EXISTS (
        SELECT * FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'orders'
        AND INDEX_NAME = 'idx_orders_shipping_method'
    ) THEN
        CREATE INDEX idx_orders_shipping_method ON orders (shipping_method);
    END IF;

    -- ON DELETE RESTRICT is the point of the constraint: a method that has
    -- been sold cannot be deleted out from under the orders that recorded it,
    -- and renaming one has to carry those orders with it.
    IF NOT EXISTS (
        SELECT * FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
        WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'orders'
        AND CONSTRAINT_NAME = 'fk_orders_shipping_method'
    ) THEN
        ALTER TABLE orders
        ADD CONSTRAINT fk_orders_shipping_method
        FOREIGN KEY (shipping_method) REFERENCES shipping_methods(code)
        ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END //

DELIMITER ;

CALL LinkOrdersToShippingMethods();
DROP PROCEDURE LinkOrdersToShippingMethods;
