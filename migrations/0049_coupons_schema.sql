-- ============================================
-- WHAT THE COUPON SERVICE NEEDS THAT THE BASELINE DOES NOT HAVE
-- ============================================
--
-- This file used to be a second `CREATE TABLE IF NOT EXISTS coupons (...)`
-- followed by `ALTER TABLE coupons ADD COLUMN IF NOT EXISTS expires_at`.
-- Neither statement could do anything (#1700).
--
-- WHY THE CREATE TABLE WAS A NO-OP
--
-- `coupons` is already declared in 0001_baseline_schema.sql, and the baseline
-- runs first on every database -- fresh or adopted. `CREATE TABLE IF NOT
-- EXISTS` against a table that exists is skipped silently, so this migration
-- would have recorded itself as applied while changing nothing at all.
-- migrations/README.md names this exact hazard:
--
--     A table has exactly one owning migration. Later files amend it with
--     ALTER TABLE. A second CREATE TABLE IF NOT EXISTS for a table that
--     already exists is skipped silently, which is how the schema came to
--     depend on apply order in the first place.
--
-- WHY THE ALTER WAS INVALID
--
-- `ADD COLUMN IF NOT EXISTS` is a MariaDB extension. MySQL 8.0 -- which this
-- project runs: mysql2, utf8mb4_unicode_ci, ENGINE=InnoDB throughout -- answers
--
--     ERROR 1064 (42000): You have an error in your SQL syntax; check the
--     manual ... near 'IF NOT EXISTS expires_at DATETIME NULL'
--
-- and because it sat after the CREATE TABLE, it would have aborted the
-- migration partway through: table present, version unrecorded, and the next
-- run hitting the "never edit an applied migration" checksum rule on the way
-- past.
--
-- WHAT IS ACTUALLY MISSING
--
-- Two things, both read by services/couponService.js against the baseline's
-- `coupons`:
--
--   expires_at  -- validateCoupon reads `coupon.expires_at || coupon.end_date
--                  || coupon.expiry_date`. The baseline has end_date, which is
--                  NOT NULL, so a coupon with no expiry cannot be expressed:
--                  every row must name a date it stops working. expires_at is
--                  the nullable form, and it is checked first.
--
--   type        -- the baseline enum is ('percentage','fixed','free_shipping').
--                  validateCoupon and pricing.service.js both accept 'percent'
--                  as a synonym for 'percentage', and the admin coupon form
--                  submits it, so the column has to be able to hold it. The
--                  existing three members are kept: dropping one would rewrite
--                  every row that uses it to ''.
--
-- Plain ALTERs, not guarded ones. The runner applies each migration exactly
-- once and records it, so a statement here does not need to be idempotent --
-- and this file has never been applied anywhere, because the 0049 version
-- collision meant the runner refused the whole directory before it read
-- schema_migrations.

ALTER TABLE coupons
    ADD COLUMN expires_at DATETIME NULL AFTER end_date;

ALTER TABLE coupons
    MODIFY COLUMN type ENUM('percentage', 'percent', 'fixed', 'free_shipping') NOT NULL;

-- validateCoupon's lookup is `WHERE UPPER(code) = UPPER(?)`, filtered on
-- is_active and the expiry. idx_coupons_code and idx_coupons_active exist in
-- the baseline; this covers the expiry check the new column introduces.
CREATE INDEX idx_coupons_expires_at ON coupons (expires_at);
