-- ============================================
-- PUBLISH THE PRODUCTS THAT WERE ONLY VISIBLE BECAUSE NOTHING CHECKED
-- ============================================
--
-- Data-only migration, no schema change. It exists because #1456 switches the
-- public product queries on to `status`, and without this that switch empties
-- the catalogue on deploy.
--
-- The column has been there since the baseline:
--
--     status ENUM('draft','active','inactive','archived') DEFAULT 'draft'
--
-- and nothing ever wrote it. `createProduct`'s INSERT did not list it, so every
-- product created through the API took the DEFAULT and became a `draft`. And
-- nothing ever read it either -- every public query filtered on `deleted_at`
-- alone -- so those drafts were on the shop page regardless. The two mistakes
-- cancelled out exactly, which is why the catalogue has always looked correct.
--
-- Turning the read filter on breaks that symmetry. Every existing row says
-- `draft`, so the shop page would go empty the moment the new code ships. The
-- rows have to be told what they have actually been all along.
--
-- WHAT COUNTS AS "HAS ACTUALLY BEEN ON SALE"
--
-- Only `status = 'draft' AND deleted_at IS NULL`.
--
-- `draft` because that is the value the DEFAULT produced and therefore the only
-- one that can be assumed to be unintentional. If a row says `inactive` or
-- `archived`, somebody set it by hand -- against a UI or a console, since no
-- endpoint could -- and they meant it. Publishing those would override a
-- deliberate decision to withdraw a product, which is the opposite of the point.
--
-- `deleted_at IS NULL` because a soft-deleted product is not on sale whatever
-- its status says, and giving it `active` would leave a contradictory row
-- behind for whoever reads it next.
--
-- This is a one-off. From #1456 onward `createProduct` writes the column
-- explicitly and `updateProduct` can change it, so no future row arrives in
-- this state and re-running the file is a no-op.

UPDATE products
   SET status = 'active'
 WHERE status = 'draft'
   AND deleted_at IS NULL;

-- The index for the filter this migration makes real. Declared in the baseline
-- at `INDEX idx_active_products (status, price, deleted_at)` and unused ever
-- since, because no query mentioned `status`. Nothing to add -- noted here so
-- the next person to look at the plan for the product list knows it is meant to
-- be used and is not left wondering whether one is missing.
