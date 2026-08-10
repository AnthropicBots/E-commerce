-- ============================================
-- SOMEWHERE FOR A NEWSLETTER SIGN-UP TO GO
-- ============================================
--
-- The newsletter form is on eight pages and has three separate handlers, none
-- of which sends the address anywhere (#1459). One writes it to the visitor's
-- own localStorage; the other two `setTimeout` and print a success message, one
-- of them saying "Check your inbox" for a mail nothing in this repository was
-- able to send. `grep -ri newsletter migrations/` returned nothing before this
-- file.
--
-- WHY DOUBLE OPT-IN
--
-- A form anyone can type any address into is a form anyone can use to sign
-- somebody else up. Without a confirmation step the list fills with addresses
-- whose owners never asked for anything, and the first mailing to them is
-- indistinguishable from spam -- which is a deliverability problem for every
-- other address on the list, not just theirs.
--
-- So a row starts `pending` and only becomes `confirmed` when a link mailed to
-- the address is followed. Only `confirmed` rows are a mailing list.
--
-- WHY THE TOKENS ARE HASHED
--
-- Both tokens are stored as the SHA-256 of a value only the recipient ever
-- sees, the same way refresh tokens are handled in this codebase. A backup or
-- a `SELECT *` then contains nothing that can be replayed: an unsubscribe token
-- is a bearer credential for someone else's subscription, and a confirm token
-- is a bearer credential for adding them to the list.
--
-- WHY UNSUBSCRIBING KEEPS THE ROW
--
-- The row is not deleted on unsubscribe, it is moved to `unsubscribed`. Delete
-- it and the address becomes eligible to be re-added by anyone who types it
-- into the form again, and the record that they asked not to be mailed is gone.
-- Keeping it is what makes "we will not mail this address" durable, and what
-- lets the unsubscribe link keep working when it is clicked twice.

CREATE TABLE IF NOT EXISTS newsletter_subscribers (
    id INT AUTO_INCREMENT PRIMARY KEY,

    -- Stored lowercased and trimmed by the service. UNIQUE so a second
    -- sign-up for the same address updates the existing row rather than
    -- creating a duplicate the mailer would send to twice.
    email VARCHAR(255) NOT NULL,

    status ENUM('pending', 'confirmed', 'unsubscribed') NOT NULL DEFAULT 'pending',

    -- SHA-256 hex of the raw tokens. Never the raw values.
    confirm_token CHAR(64) NULL,
    confirm_token_expires_at DATETIME NULL,
    unsubscribe_token CHAR(64) NOT NULL,

    -- The consent record. Which page the form was on, when it was submitted and
    -- from where -- the three things anyone asking "why is this address on your
    -- list?" actually wants, and none of which can be reconstructed afterwards.
    source_page VARCHAR(255) NULL,
    consent_ip VARCHAR(45) NULL,
    consent_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- Best-effort link to an account when the visitor happened to be signed in.
    -- Deliberately NOT a foreign key with a cascade: a subscription is to an
    -- address, not to an account, and closing an account must not silently drop
    -- the address off the list without an unsubscribe ever being requested.
    user_id CHAR(36) NULL,

    confirmed_at DATETIME NULL,
    unsubscribed_at DATETIME NULL,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uniq_newsletter_email (email),

    -- The mailer's query: every confirmed address. Without it that is a table
    -- scan on the one query this table exists to serve.
    INDEX idx_newsletter_status (status),

    -- Token lookups. Both are single-row fetches by an exact hash, and both are
    -- reachable unauthenticated, so neither may become a scan.
    INDEX idx_newsletter_confirm_token (confirm_token),
    INDEX idx_newsletter_unsubscribe_token (unsubscribe_token),

    -- Housekeeping: expired pending rows that were never confirmed.
    INDEX idx_newsletter_pending_expiry (status, confirm_token_expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
