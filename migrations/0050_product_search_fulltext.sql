-- ============================================
-- FULLTEXT INDEX ON PRODUCTS NAME FOR AUTOCOMPLETE
-- ============================================
--
-- Real-time product search requires full-text indexing on products.name for
-- fast relevance-based matching.
--
-- Renumbered from 0049 (#1700). Three migrations claimed that version, and the
-- runner refuses to load the directory at all when versions collide -- so
-- nothing at all could be applied, not just the three. 0049 stays with
-- 0049_coupons_schema.sql, which merged first.

ALTER TABLE products ADD FULLTEXT INDEX idx_products_name_ft (name);
