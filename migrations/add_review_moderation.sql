-- ============================================
-- REVIEW ENGAGEMENT & MODERATION
-- ============================================
--
-- Addresses #1349.
--
-- `reviews` already declares helpful_count, reported_count, is_approved,
-- is_verified, moderation_notes, title, images, deleted_at and deleted_by.
-- None of them had a writer, and `is_approved` had no reader either -- so a
-- rejected review still appeared on the product page and still counted toward
-- the product's star rating.
--
-- This migration adds what the existing columns need in order to work:
-- a vote table (a counter alone cannot express "has this person already
-- voted"), a real moderation status, and the indexes the new reads need.

-- ============================================
-- REVIEW VOTES
-- ============================================
--
-- One row per (review, user, vote type). The UNIQUE key is the entire point:
-- with only `reviews.helpful_count` to go on, one shopper can vote the same
-- review up a hundred times, and a "report" button with no memory can be held
-- down until a review disappears.
--
-- Both helpful votes and reports live here rather than in two tables: they are
-- the same shape, they are counted the same way, and keeping them together
-- means "has this user interacted with this review" is one lookup.

CREATE TABLE IF NOT EXISTS review_votes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    review_id INT NOT NULL,
    user_id CHAR(36) NOT NULL,

    vote_type ENUM('helpful', 'report') NOT NULL,

    -- Only meaningful for reports. Free text is deliberately allowed alongside
    -- the reason code: moderators need the "other" case, and a fixed
    -- vocabulary is the thing that needs a migration the first time somebody
    -- reports something the list did not anticipate.
    reason VARCHAR(50),
    details VARCHAR(500),

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_review_votes_review
        FOREIGN KEY (review_id) REFERENCES reviews(id) ON DELETE CASCADE,
    CONSTRAINT fk_review_votes_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,

    -- Idempotence, enforced by the database rather than by a read-then-write
    -- in application code that two concurrent requests can both pass.
    UNIQUE KEY uq_review_votes_once (review_id, user_id, vote_type),

    INDEX idx_review_votes_review (review_id, vote_type),
    INDEX idx_review_votes_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- MODERATION STATUS
-- ============================================
--
-- `is_approved` is a boolean, and moderation has three states, not two:
-- approved, rejected, and *waiting for a human*. Without the third, a review
-- auto-flagged by reports is indistinguishable from one a moderator has
-- actively rejected.
--
-- The boolean is kept and derived from the status rather than dropped, so any
-- reader that has not been updated still sees something correct.

ALTER TABLE reviews
    ADD COLUMN IF NOT EXISTS moderation_status
        ENUM('approved', 'pending', 'rejected') NOT NULL DEFAULT 'approved'
        AFTER is_approved;

ALTER TABLE reviews
    ADD COLUMN IF NOT EXISTS moderated_by CHAR(36) NULL AFTER moderation_notes,
    ADD COLUMN IF NOT EXISTS moderated_at DATETIME NULL AFTER moderated_by;

-- Existing rows: everything currently visible stays visible. `is_approved`
-- defaulted to 1 and was never written, so this is a no-op in practice --
-- stated explicitly rather than assumed.
UPDATE reviews
   SET moderation_status = CASE WHEN is_approved = 0 THEN 'rejected' ELSE 'approved' END
 WHERE moderation_status = 'approved';

-- ============================================
-- BACKFILL is_verified
-- ============================================
--
-- createProductReview has always refused reviews from anyone without a
-- `delivered` order containing the product, so every existing row is a
-- verified purchase -- and every one carries is_verified = 0, because nothing
-- ever set it. The badge these reviews have already earned was switched off.

UPDATE reviews r
   SET r.is_verified = 1
 WHERE r.is_verified = 0
   AND EXISTS (
       SELECT 1
         FROM orders o
         JOIN order_items oi ON oi.order_id = o.id
        WHERE o.user_id = r.user_id
          AND oi.product_id = r.product_id
          AND o.status = 'delivered'
   );

-- ============================================
-- COUNTER RECONCILIATION
-- ============================================
--
-- helpful_count and reported_count are denormalised caches of review_votes.
-- They start at zero because there are no votes yet; this statement is here so
-- the same migration can be re-run to reconcile them if they ever drift.

UPDATE reviews r
   SET r.helpful_count = (
           SELECT COUNT(*) FROM review_votes v
            WHERE v.review_id = r.id AND v.vote_type = 'helpful'
       ),
       r.reported_count = (
           SELECT COUNT(*) FROM review_votes v
            WHERE v.review_id = r.id AND v.vote_type = 'report'
       );

-- ============================================
-- INDEXES FOR THE NEW READS
-- ============================================
--
-- The public list is now filtered by status and sortable by helpfulness, and
-- the moderation queue reads by status across all products. Neither pattern
-- was served by the existing per-product index.

CREATE INDEX idx_reviews_product_status
    ON reviews (product_id, moderation_status, deleted_at);

CREATE INDEX idx_reviews_helpful
    ON reviews (product_id, helpful_count);

CREATE INDEX idx_reviews_moderation_queue
    ON reviews (moderation_status, reported_count, created_at);
