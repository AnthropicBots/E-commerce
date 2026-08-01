-- ============================================
-- DELIVERY ESTIMATE (#1430)
-- ============================================
--
-- Checkout offers delivery options and prices them, but the difference between
-- them is a date, and nothing recorded one. `orders.estimated_delivery` has
-- been in the schema since 0022 and has never had a writer, so the order page
-- has always shown a dash where the delivery promise belongs.
--
-- Two things are added. Each option states the window it promises, and each
-- order records the window it was sold. The promise is stored rather than
-- recomputed on read, because it is a commitment made at a moment in time: an
-- operator retuning an option next month must not silently move the date an
-- order already promised.
--
-- Safe to re-run.

-- ============================================
-- WHAT EACH OPTION PROMISES
-- ============================================
--
-- Nullable, and null means this option states no promise -- the order page then
-- shows no estimate rather than a made-up one. That is also what stops this
-- migration having to guess a window for options an operator added between
-- 0036 and now.
--
-- Days are calendar days from the order being placed. There is no holiday
-- calendar anywhere in this schema, so a working-day promise is not something
-- the application could honestly compute; a slightly conservative calendar
-- window is the better of the two available answers.

DELIMITER //

CREATE PROCEDURE AddDeliveryPromiseColumns()
BEGIN
    IF NOT EXISTS (
        SELECT * FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'shipping_methods'
        AND COLUMN_NAME = 'min_days'
    ) THEN
        ALTER TABLE shipping_methods
        ADD COLUMN min_days INT NULL AFTER base_rate;
    END IF;

    IF NOT EXISTS (
        SELECT * FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'shipping_methods'
        AND COLUMN_NAME = 'max_days'
    ) THEN
        ALTER TABLE shipping_methods
        ADD COLUMN max_days INT NULL AFTER min_days;
    END IF;

    -- A window that ends before it begins would render as a promise running
    -- backwards, and is far easier to reject here than to detect later.
    IF NOT EXISTS (
        SELECT * FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
        WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'shipping_methods'
        AND CONSTRAINT_NAME = 'chk_shipping_methods_days'
    ) THEN
        ALTER TABLE shipping_methods
        ADD CONSTRAINT chk_shipping_methods_days CHECK (
            min_days IS NULL
            OR max_days IS NULL
            OR (min_days >= 0 AND max_days >= min_days)
        );
    END IF;

    IF NOT EXISTS (
        SELECT * FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'orders'
        AND COLUMN_NAME = 'estimated_delivery_from'
    ) THEN
        -- The near end of the window. 0022's `estimated_delivery` is the far
        -- end -- the date the order is promised *by* -- which is the reading it
        -- already had everywhere it is displayed, so it keeps its name and
        -- gains a companion rather than being renamed under its readers.
        ALTER TABLE orders
        ADD COLUMN estimated_delivery_from DATE NULL AFTER estimated_delivery;
    END IF;
END //

DELIMITER ;

CALL AddDeliveryPromiseColumns();
DROP PROCEDURE AddDeliveryPromiseColumns;

-- ============================================
-- THE WINDOWS THE SEEDED OPTIONS ALREADY DESCRIBE
-- ============================================
--
-- 0036 seeded both options with a prose description of their window. These are
-- the same figures in a form the application can date-arithmetic with, so the
-- text a shopper reads at checkout and the date they are given afterwards
-- cannot say different things.
--
-- Guarded on NULL, so an operator who has already set a window keeps it and a
-- re-run changes nothing.

UPDATE shipping_methods
   SET min_days = 3, max_days = 6
 WHERE code = 'standard' AND min_days IS NULL AND max_days IS NULL;

UPDATE shipping_methods
   SET min_days = 1, max_days = 2
 WHERE code = 'express' AND min_days IS NULL AND max_days IS NULL;

-- ============================================
-- NO BACKFILL
-- ============================================
--
-- Orders placed before delivery options existed recorded no method, so there
-- is no window to reconstruct for them, and an order that has already been
-- delivered has an actual date rather than a promised one. Both are left
-- alone. The timeline shows an estimate where one was recorded and says
-- nothing where one was not.
