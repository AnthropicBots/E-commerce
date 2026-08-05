-- ============================================
-- SOMEWHERE FOR A CONTACT MESSAGE TO GO, AND A SHARE TO BE RECORDED AS
-- ============================================
--
-- Two endpoints the frontend has always called and the API has never mounted
-- (#1445). Both need a place in the schema before a route over them is worth
-- anything.
--
-- CONTACT MESSAGES
--
-- contact.html has posted to /api/contact since it was written. Nothing has
-- ever served that path, and nothing has ever stored the result: there is no
-- contact table anywhere in this sequence. The form has been reporting
-- "Message submitted successfully!" over a 404 the whole time, because the
-- frontend's apiRequest resolves on a non-2xx instead of rejecting.
--
-- `user_id` is nullable and is not a foreign key onto users with a cascade:
-- a message must outlive the account that sent it, or a shopper closing their
-- account erases the complaint that made them close it. It is recorded when
-- the sender happened to be signed in and left NULL otherwise; the email in
-- the body is the address support replies to either way.
--
-- `status` is the smallest useful workflow. Without one, "have we answered
-- this?" has no answer that is not somebody's memory.

CREATE TABLE IF NOT EXISTS contact_messages (
    id INT AUTO_INCREMENT PRIMARY KEY,

    -- Who wrote it. The account is best-effort; the email is not.
    user_id CHAR(36) NULL,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,

    subject VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,

    status ENUM('new', 'in_progress', 'resolved', 'spam') NOT NULL DEFAULT 'new',

    -- Kept for abuse handling: the limiter counts requests, this is what an
    -- investigation reads afterwards.
    ip_address VARCHAR(45),
    user_agent TEXT,

    responded_at DATETIME NULL,
    responded_by CHAR(36) NULL,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    -- The two questions the queue is read by: what is unanswered, and what did
    -- this person send us before.
    INDEX idx_contact_messages_status_created (status, created_at),
    INDEX idx_contact_messages_email (email),
    INDEX idx_contact_messages_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- SHARE INTERACTIONS
-- ============================================
--
-- product.js records a share as `type: 'share'`. `user_interactions`
-- .interaction_type is an ENUM of view / cart_add / wishlist_add / purchase,
-- so every one of those writes would have been rejected by the column even
-- once the route existed -- MySQL in strict mode refuses a value outside the
-- enum rather than coercing it.
--
-- Adding the member is additive: the four existing values keep their ordinal
-- positions, so no stored row changes meaning. A new value must go at the end
-- for that to hold, which is why 'share' is appended rather than inserted
-- alphabetically.

ALTER TABLE user_interactions
    MODIFY COLUMN interaction_type
        ENUM('view', 'cart_add', 'wishlist_add', 'purchase', 'share') NOT NULL;
