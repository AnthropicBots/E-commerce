-- ============================================
-- ORDER PRICING BREAKDOWN (#1256)
-- ============================================
--
-- Orders now record the full breakdown the pricing engine produced: subtotal,
-- discount, tax, shipping and the charged total. Deployments reach this point
-- from three different histories -- schema.sql alone, schema.sql plus
-- promo_schema.sql, or an older database where `final_amount` was written by
-- code and by a promo procedure without ever being declared -- so every column
-- is added only if it is genuinely absent.
--
-- Safe to re-run.

DELIMITER //

CREATE PROCEDURE AddPricingBreakdownColumnsToOrders()
BEGIN
    IF NOT EXISTS (
        SELECT * FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'orders'
        AND COLUMN_NAME = 'tax'
    ) THEN
        ALTER TABLE orders
        ADD COLUMN tax DECIMAL(10,2) NOT NULL DEFAULT 0.00 CHECK (tax >= 0);
    END IF;

    IF NOT EXISTS (
        SELECT * FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'orders'
        AND COLUMN_NAME = 'shipping_cost'
    ) THEN
        ALTER TABLE orders
        ADD COLUMN shipping_cost DECIMAL(10,2) NOT NULL DEFAULT 0.00 CHECK (shipping_cost >= 0);
    END IF;

    IF NOT EXISTS (
        SELECT * FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'orders'
        AND COLUMN_NAME = 'promo_code'
    ) THEN
        ALTER TABLE orders
        ADD COLUMN promo_code VARCHAR(50) DEFAULT NULL;
    END IF;

    IF NOT EXISTS (
        SELECT * FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'orders'
        AND COLUMN_NAME = 'discount_amount'
    ) THEN
        ALTER TABLE orders
        ADD COLUMN discount_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00 CHECK (discount_amount >= 0);
    END IF;

    IF NOT EXISTS (
        SELECT * FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'orders'
        AND COLUMN_NAME = 'final_amount'
    ) THEN
        ALTER TABLE orders
        ADD COLUMN final_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00 CHECK (final_amount >= 0);
    END IF;

    IF NOT EXISTS (
        SELECT * FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'orders'
        AND INDEX_NAME = 'idx_orders_promo_code'
    ) THEN
        CREATE INDEX idx_orders_promo_code ON orders(promo_code);
    END IF;
END //

DELIMITER ;

-- Run migration
CALL AddPricingBreakdownColumnsToOrders();
DROP PROCEDURE AddPricingBreakdownColumnsToOrders;

-- ============================================
-- BACKFILL
-- ============================================
--
-- Orders written before the engine existed carry no tax or shipping and stored
-- the post-discount subtotal in `total`. Leave those figures alone -- they are
-- what was actually charged -- and only fill in the columns that were never
-- populated at all, so historical invoices still reconcile.

UPDATE orders
SET final_amount = total
WHERE final_amount = 0
  AND total > 0;

UPDATE orders
SET subtotal = total + COALESCE(discount_amount, 0)
WHERE (subtotal IS NULL OR subtotal = 0)
  AND total > 0;
