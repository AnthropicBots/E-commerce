-- ============================================
-- ORDER STATUS HISTORY (corrected)
-- ============================================
--
-- Addresses #1351. Supersedes migrations/order_status_tracking.sql, which
-- could never have run: it declared
--
--     order_id   INT NOT NULL,   -- orders.id is CHAR(36)
--     updated_by INT,            -- users.id is CHAR(36)
--
-- with foreign keys onto both. MySQL rejects that with errno 150,
-- "Foreign key constraint is incorrectly formed", and the failure takes the
-- rest of the file with it -- the trigger and all three reporting views
-- included. It was written before the UUID migration in #1025 and never
-- revisited.
--
-- Two deliberate departures from that file:
--
--   * The types match the keys they reference.
--   * There is no trigger. A trigger fires invisibly and can only see the row,
--     so it cannot record *who* changed the status or *why* -- and those are
--     the two questions a status history exists to answer. The application
--     writes the row explicitly, inside the same transaction as the status
--     change, which is both more informative and possible to debug.
--
-- backend/schema.sql carries the same definition for fresh installs.

-- ============================================
-- ORDER STATUS LOGS
-- ============================================

CREATE TABLE IF NOT EXISTS order_status_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,

    -- CHAR(36), matching orders.id. This is the defect that made the original
    -- file unrunnable.
    order_id CHAR(36) NOT NULL,

    -- NULL for the very first entry, which records an order coming into
    -- existence and therefore has no previous state.
    from_status VARCHAR(50),
    to_status VARCHAR(50) NOT NULL,

    -- Who. NULL when nobody did it -- a courier webhook or a scheduled job.
    -- ON DELETE SET NULL rather than CASCADE: deleting a staff account must
    -- not erase the record of what they did.
    changed_by CHAR(36),
    changed_by_name VARCHAR(255),

    -- What kind of actor. Distinguishing a customer cancellation from an admin
    -- one from a courier update is the first question support asks, and it
    -- cannot be inferred from changed_by alone (both admin and customer paths
    -- populate it).
    source ENUM('admin', 'customer', 'courier', 'system', 'payment') NOT NULL DEFAULT 'system',

    -- Why. Free text, shown to the customer for their own actions and to
    -- admins for everything.
    reason VARCHAR(500),

    -- Anything the specific path wants to keep: courier tracking numbers,
    -- refund ids, the payload that triggered a webhook.
    metadata JSON,

    -- Kept for support, never returned on the customer-facing endpoint.
    ip_address VARCHAR(45),
    user_agent TEXT,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_order_status_logs_order
        FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    CONSTRAINT fk_order_status_logs_user
        FOREIGN KEY (changed_by) REFERENCES users(id) ON DELETE SET NULL,

    -- The timeline read: one order, oldest first.
    INDEX idx_order_status_logs_order (order_id, created_at),
    -- Fulfilment reporting: "how many orders shipped last week".
    INDEX idx_order_status_logs_status (to_status, created_at),
    -- Auditing a particular staff member.
    INDEX idx_order_status_logs_actor (changed_by, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- TIMESTAMP COLUMNS
-- ============================================
--
-- `orders` already has shipping_date, delivered_at, cancelled_at and
-- refunded_at. Only cancelled_at was ever written, and only on the refund
-- path, so an order marked `delivered` kept a NULL delivered_at forever and no
-- fulfilment-time reporting was possible. `shipped_at` is added as the clearer
-- name; `shipping_date` is left alone rather than renamed under a running
-- application.

ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS shipped_at DATETIME NULL AFTER shipping_date;

-- ============================================
-- BACKFILL
-- ============================================
--
-- Every existing order gets one synthetic entry recording its current state,
-- so the timeline is never empty for an order that predates this table. It is
-- marked `system` with an explicit reason, because inventing a plausible
-- history for orders whose transitions were never recorded would be worse than
-- admitting the record starts here.
--
-- `created_at` is the order's own creation time so the entry sorts sensibly
-- rather than bunching every historical order at the migration timestamp.

INSERT INTO order_status_logs (order_id, from_status, to_status, source, reason, created_at)
SELECT
    o.id,
    NULL,
    o.status,
    'system',
    'Imported when status history was introduced; earlier transitions were not recorded',
    o.created_at
FROM orders o
WHERE NOT EXISTS (
    SELECT 1 FROM order_status_logs l WHERE l.order_id = o.id
);

-- Fill the timestamp columns where the current status implies them. Only the
-- terminal state is knowable after the fact -- an order that is now
-- `delivered` was certainly shipped at some point, but nothing recorded when,
-- so shipped_at is deliberately left NULL rather than guessed.

UPDATE orders
   SET delivered_at = COALESCE(delivered_at, updated_at)
 WHERE status = 'delivered' AND delivered_at IS NULL;

UPDATE orders
   SET cancelled_at = COALESCE(cancelled_at, updated_at)
 WHERE status = 'cancelled' AND cancelled_at IS NULL;
