-- ============================================
-- THE MEDIUM-RISK SIGNUP QUEUE
-- ============================================
--
-- `detectSyntheticIdentity` scores every signup and does one of four things:
--
--   critical -> 403, blocked, and the caller is told
--   high     -> 202, verification required, and the caller is told
--   medium   -> allowed through, and queued for a human to look at later
--   low      -> allowed through
--
-- The medium band is the only one whose decision leaves no trace anywhere else,
-- which makes the queue the whole of its record. `flagForMonitoring` has been
-- writing that record to `fraud_monitoring_queue` since the middleware landed,
-- and no migration has ever created the table (#1674).
--
-- Renumbered from 0049 (#1700). Three migrations claimed that version, and the
-- runner refuses to load the directory at all when versions collide -- so
-- nothing at all could be applied, not just the three. 0049 stays with
-- 0049_coupons_schema.sql, which merged first.
--
-- Every insert therefore failed with ER_NO_SUCH_TABLE. The catch around it
-- swallows the error into a console.error -- correctly, because a monitoring
-- write must never fail a signup -- so the account was created, nothing was
-- queued, and the only evidence was a line on stdout.
--
-- Note this is not the same defect as #1673. That one is a view in 0014 that
-- stops the sequence from applying at all; this is a table the sequence never
-- declared in the first place. Both had to be fixed for the fraud path to work
-- end to end.

CREATE TABLE IF NOT EXISTS fraud_monitoring_queue (
    id INT PRIMARY KEY AUTO_INCREMENT,

    -- The columns flagForMonitoring names, in the order it names them.
    --
    -- `email` and not `user_id`: the middleware runs before the account row
    -- exists, so there is no id to reference yet and no foreign key to declare.
    -- It is nullable for the same reason the detector is defensive about its
    -- input -- a request that reached the detector without a parseable address
    -- is itself worth queueing, and losing the row to a NOT NULL would discard
    -- the more interesting case.
    email VARCHAR(255) NULL,
    risk_score INT NOT NULL DEFAULT 0,

    -- Same ENUM as synthetic_identity_detections in 0014, so the two tables
    -- describe a band the same way. Only 'medium' is written today; the full
    -- set is declared because the band that gets queued is a policy decision
    -- the application should be able to change without a migration.
    risk_level ENUM('low', 'medium', 'high', 'critical') NOT NULL DEFAULT 'medium',

    flags JSON NULL,
    ip_address VARCHAR(45) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- A queue nobody can close is a log. These let an entry be marked done and
    -- kept out of the next read, which is what makes it a queue.
    reviewed_at DATETIME NULL,
    reviewed_by CHAR(36) NULL,
    review_notes VARCHAR(500) NULL,

    -- The queue read: oldest unreviewed first.
    INDEX idx_fraud_queue_pending (reviewed_at, created_at),
    INDEX idx_fraud_queue_created (created_at),
    INDEX idx_fraud_queue_level (risk_level),
    INDEX idx_fraud_queue_email (email),
    INDEX idx_fraud_queue_ip (ip_address)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
