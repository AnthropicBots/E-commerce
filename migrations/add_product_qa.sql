-- ============================================
-- PRODUCT QUESTIONS & ANSWERS
-- ============================================
--
-- Addresses #1353.
--
-- A shopper with a pre-purchase question had nowhere to put it. Reviews cannot
-- fill the gap for a structural reason: createProductReview refuses anyone
-- without a `delivered` order containing the product, which is correct for
-- reviews -- it is what makes the verified-purchase badge mean anything -- but
-- means the only people who can post about a product are those for whom the
-- purchase decision is already made.
--
-- backend/schema.sql carries the same definitions for fresh installs.

-- ============================================
-- QUESTIONS
-- ============================================

CREATE TABLE IF NOT EXISTS product_questions (
    -- CHAR(36) throughout, matching products.id and users.id (#1025).
    id CHAR(36) PRIMARY KEY,
    product_id CHAR(36) NOT NULL,

    -- The asker is by definition someone who has not bought yet, so there is
    -- no purchase check here. That is the entire point of the feature.
    user_id CHAR(36) NOT NULL,

    body VARCHAR(1000) NOT NULL,

    -- Denormalised so a list of questions does not need one COUNT per question
    -- to show "3 answers". Recalculated from product_answers rather than
    -- incremented: `count = count + 1` is only correct if it has been correct
    -- every time before.
    answer_count INT NOT NULL DEFAULT 0,
    helpful_count INT NOT NULL DEFAULT 0,
    reported_count INT NOT NULL DEFAULT 0,

    -- Three states, not a boolean: approved, rejected, and waiting for a
    -- human. Without the third, an item auto-flagged by reports is
    -- indistinguishable from one a moderator actively rejected.
    --
    -- Public reads filter on this. Shipping a moderation flag that nothing
    -- filters on is the mistake #1349 was about; it is not worth repeating.
    status ENUM('approved', 'pending', 'rejected') NOT NULL DEFAULT 'approved',
    moderation_notes VARCHAR(1000),
    moderated_by CHAR(36),
    moderated_at DATETIME,

    deleted_at DATETIME,
    deleted_by CHAR(36),

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_product_questions_product
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    CONSTRAINT fk_product_questions_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,

    -- The product page read: approved questions for one product.
    INDEX idx_product_questions_product (product_id, status, deleted_at),
    -- "Most useful first" ordering.
    INDEX idx_product_questions_helpful (product_id, helpful_count),
    -- The moderation queue, across all products.
    INDEX idx_product_questions_queue (status, reported_count, created_at),
    -- An unanswered question is the one worth chasing.
    INDEX idx_product_questions_unanswered (product_id, answer_count)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- ANSWERS
-- ============================================

CREATE TABLE IF NOT EXISTS product_answers (
    id CHAR(36) PRIMARY KEY,
    question_id CHAR(36) NOT NULL,
    user_id CHAR(36) NOT NULL,

    body VARCHAR(2000) NOT NULL,

    -- The answerer's standing, resolved once at write time and stored.
    --
    -- Stored rather than computed on read for two reasons: the read path would
    -- otherwise need a purchase lookup per answer, and -- more importantly --
    -- standing is a fact about the moment the answer was written. Someone who
    -- owned the product when they answered still did, even if that order is
    -- later refunded.
    --
    -- `owner` uses exactly the check createProductReview performs, so the badge
    -- means precisely what the verified-purchase badge on a review means.
    author_type ENUM('owner', 'seller', 'staff', 'shopper') NOT NULL DEFAULT 'shopper',

    helpful_count INT NOT NULL DEFAULT 0,
    reported_count INT NOT NULL DEFAULT 0,

    status ENUM('approved', 'pending', 'rejected') NOT NULL DEFAULT 'approved',
    moderation_notes VARCHAR(1000),
    moderated_by CHAR(36),
    moderated_at DATETIME,

    deleted_at DATETIME,
    deleted_by CHAR(36),

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_product_answers_question
        FOREIGN KEY (question_id) REFERENCES product_questions(id) ON DELETE CASCADE,
    CONSTRAINT fk_product_answers_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,

    INDEX idx_product_answers_question (question_id, status, deleted_at),
    -- Ordering: an answer from someone holding the product outranks a guess,
    -- then by votes.
    INDEX idx_product_answers_ranking (question_id, author_type, helpful_count),
    INDEX idx_product_answers_queue (status, reported_count, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- VOTES
-- ============================================
--
-- One table for both, because they are the same shape and are counted the same
-- way. `target_type` distinguishes them.
--
-- The UNIQUE key is the point: a bare counter cannot express "has this person
-- already voted", so helpful_count could be voted up repeatedly and a report
-- button with no memory could be held down until an item disappeared.

CREATE TABLE IF NOT EXISTS product_qa_votes (
    id INT AUTO_INCREMENT PRIMARY KEY,

    target_type ENUM('question', 'answer') NOT NULL,
    target_id CHAR(36) NOT NULL,
    user_id CHAR(36) NOT NULL,

    vote_type ENUM('helpful', 'report') NOT NULL,
    reason VARCHAR(50),
    details VARCHAR(500),

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_product_qa_votes_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,

    -- Idempotence enforced by the database, not by a read-then-write that two
    -- concurrent requests can both pass.
    UNIQUE KEY uq_product_qa_votes_once (target_type, target_id, user_id, vote_type),

    INDEX idx_product_qa_votes_target (target_type, target_id, vote_type),
    INDEX idx_product_qa_votes_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- No foreign key on target_id: it points at one of two tables depending on
-- target_type, which a single FK cannot express. Both parent tables cascade
-- their own deletes, so the cleanup path is a scheduled sweep rather than a
-- constraint. Stated explicitly because a missing FK otherwise reads as an
-- oversight.
