-- ============================================
-- VARIANT STOCK BECOMES THE AUTHORITATIVE COUNTER
-- ============================================
--
-- `product_variants.stock` has been in the schema since the baseline and has
-- never once been decremented. Its only writer credited it back on an approved
-- return, so it has risen monotonically since the table was created while
-- `products.stock` absorbed every sale. Reservations were keyed per variant all
-- along, but the quantity they compared against was the product total, so a
-- size with two left could go out ten at a time on the strength of its
-- siblings.
--
-- From here the variant holds the quantity for any product that has one, and
-- `products.stock` is a roll-up of that product's sellable variants rather than
-- an authority in its own right. Products with no variants are touched by
-- nothing below: their total stays authoritative and their behaviour does not
-- change.

-- ============================================
-- A VARIANT ALWAYS HAS A QUANTITY
-- ============================================
--
-- The column was nullable, and the code deciding whether a variant was
-- authoritative read NULL as "ask the product instead". That fork is exactly
-- what this change exists to remove, so NULL normalizes to zero and the column
-- becomes NOT NULL.
--
-- Negatives are clamped in the same statement. None should exist -- nothing has
-- ever subtracted from this column -- but the CHECK added below would fail the
-- whole migration on one stray row, and refusing to start is a worse answer
-- than starting from zero on a figure that is about to be rebased anyway.

UPDATE product_variants
SET stock = 0
WHERE stock IS NULL OR stock < 0;

DELIMITER //

CREATE PROCEDURE EnforceVariantStockCounter()
BEGIN
    IF EXISTS (
        SELECT * FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'product_variants'
        AND COLUMN_NAME = 'stock'
        AND IS_NULLABLE = 'YES'
    ) THEN
        ALTER TABLE product_variants
        MODIFY COLUMN stock INT NOT NULL DEFAULT 0;
    END IF;

    -- The counterpart of chk_stock on products. The application already refuses
    -- to decrement past zero; this is the backstop for anything that writes the
    -- column without going through it.
    IF NOT EXISTS (
        SELECT * FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
        WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'product_variants'
        AND CONSTRAINT_NAME = 'chk_variant_stock'
    ) THEN
        ALTER TABLE product_variants
        ADD CONSTRAINT chk_variant_stock CHECK (stock >= 0);
    END IF;

    -- Both the roll-up recompute below and the availability read at runtime
    -- group a product's variants by what a shopper can actually select. The
    -- existing index on product_id alone leaves the is_active and deleted_at
    -- tests to a row visit each.
    IF NOT EXISTS (
        SELECT * FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'product_variants'
        AND INDEX_NAME = 'idx_product_variants_sellable'
    ) THEN
        CREATE INDEX idx_product_variants_sellable
        ON product_variants (product_id, is_active, deleted_at);
    END IF;
END //

DELIMITER ;

CALL EnforceVariantStockCounter();
DROP PROCEDURE EnforceVariantStockCounter;

-- ============================================
-- RECONCILIATION -- AND WHAT IT ASSUMES
-- ============================================
--
-- Stated plainly rather than buried, because the numbers below are a decision
-- and not a derivation.
--
-- The figure currently in `product_variants.stock` is not an opening balance.
-- It is whatever the row was seeded with plus every unit ever credited back by
-- an approved return, with no sale ever taken off it. Adopting it as the new
-- authoritative quantity would hand the counter a number that is wrong in the
-- one direction that matters -- upwards -- and the first thing this fix did
-- would be to license the overselling it exists to stop.
--
-- `products.stock` is the only quantity in the database that has actually been
-- maintained: every sale, cancellation and approved return has moved it. It is
-- therefore taken as the product's true total, and reconciliation reduces to
-- one question: how does that total split across the variants?
--
-- Nothing in the schema records the split. It is ASSUMED to follow the existing
-- variant figures in proportion, on the grounds that their relative sizes still
-- carry some signal about which colours and sizes were stocked deepest even
-- though their absolute values carry none. Where a product's variants sum to
-- zero the total is divided evenly, which is a guess and is meant to look like
-- one.
--
-- The division floors and the product total is then set to the sum of what was
-- actually allocated, so a remainder of a few units is dropped rather than
-- handed to an arbitrary variant. Dropping understates availability by less
-- than one unit per variant. The alternative overstates it, which is the bug.
--
-- Only variants a shopper can select take part. An inactive or soft-deleted
-- variant keeps whatever figure it had and is excluded from the product's
-- total, because nothing can put it in a basket -- which also means its figure
-- is still an inflated one if it is ever reactivated.
--
-- None of this is a stock count. It is a defensible starting position that is
-- internally consistent from the first sale onwards. Only a warehouse count
-- makes these numbers true, and one should follow.
--
-- Re-running changes nothing. After the second statement a product's total
-- equals the sum of its variants, so the proportional split resolves to the
-- figures already there.

UPDATE product_variants v
JOIN products p
  ON p.id = v.product_id
JOIN (
    SELECT
        product_id,
        SUM(stock) AS weight_total,
        COUNT(*)   AS sellable_variants
    FROM product_variants
    WHERE is_active = 1 AND deleted_at IS NULL
    GROUP BY product_id
) agg ON agg.product_id = v.product_id
SET v.stock = CASE
        WHEN agg.weight_total > 0
            THEN FLOOR(GREATEST(COALESCE(p.stock, 0), 0) * v.stock / agg.weight_total)
        ELSE FLOOR(GREATEST(COALESCE(p.stock, 0), 0) / agg.sellable_variants)
    END
WHERE v.is_active = 1
  AND v.deleted_at IS NULL;

-- Bring the product total back to what was actually allocated, so the roll-up
-- the application maintains from here starts in step with the variants it is
-- summarising.

UPDATE products p
JOIN (
    SELECT product_id, SUM(stock) AS sellable_stock
    FROM product_variants
    WHERE is_active = 1 AND deleted_at IS NULL
    GROUP BY product_id
) v ON v.product_id = p.id
SET p.stock = v.sellable_stock;
