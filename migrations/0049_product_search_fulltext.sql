-- ============================================
-- FULLTEXT INDEX ON PRODUCTS NAME FOR AUTOCOMPLETE
-- ============================================
--
-- Real-time product search requires full-text indexing on products.name for
-- fast relevance-based matching.

ALTER TABLE products ADD FULLTEXT INDEX idx_products_name_ft (name);
