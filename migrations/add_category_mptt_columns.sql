-- Issue #1264: MPTT columns + indexes for hierarchical category tree fetching
-- Run once against existing databases. Ignore duplicate-column / duplicate-index errors if already applied.

ALTER TABLE categories
    ADD COLUMN lft INT DEFAULT NULL AFTER path;

ALTER TABLE categories
    ADD COLUMN rgt INT DEFAULT NULL AFTER lft;

ALTER TABLE categories
    ADD INDEX idx_categories_mptt (lft, rgt);

ALTER TABLE categories
    ADD INDEX idx_categories_parent_active (parent_id, is_active, deleted_at);
