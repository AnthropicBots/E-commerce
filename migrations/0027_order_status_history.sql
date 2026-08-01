-- ============================================
-- ORDER STATUS HISTORY (#1351)
-- ============================================
--
-- This began as `fix_order_status_logs.sql`, which created `order_status_logs`
-- from scratch because the only prior definition -- the un-numbered
-- `order_status_tracking.sql` -- declared INT foreign keys against CHAR(36)
-- primary keys and so could never run.
--
-- 0022 has since folded that same legacy file into the sequence and fixed the
-- same defect, so the table now exists before this migration runs. Two
-- `CREATE TABLE IF NOT EXISTS` statements for one table is exactly the failure
-- mode migrations/README.md documents: the second is skipped in silence, and
-- the shape a database ends up with depends on apply order. So this migration
-- amends 0022's table rather than declaring a second one.
--
-- 0022's column names win -- `old_status`, `new_status`, `updated_by`,
-- `updated_by_name`. They are already applied, already written by
-- `order.service.js`, and read by 0022's trigger, its two views and its three
-- stored procedures. Renaming them to this branch's preferred spelling would
-- have meant rewriting all of that; the service reads them under aliases
-- instead.
--
-- What 0022 genuinely lacks is `source`, and what it has that is now actively
-- wrong is the trigger. Both are addressed below.

-- ============================================
-- SOURCE
-- ============================================
--
-- 0022 records `is_auto`: a boolean for "nobody did this". That cannot
-- distinguish a customer cancelling their own order from an admin cancelling
-- it, or a courier webhook from a payment callback -- and which of those it was
-- is the first question support asks. `is_auto` is left in place and still
-- written, so 0022's `get_order_timeline` procedure keeps working.

ALTER TABLE order_status_logs
    ADD COLUMN source ENUM('admin', 'customer', 'courier', 'system', 'payment')
        NOT NULL DEFAULT 'system' AFTER updated_by_name;

-- Existing rows predate the distinction. `is_auto` is the only signal they
-- carry, so it is the only one used: everything else stays at the 'system'
-- default rather than being guessed into a more specific value.
UPDATE order_status_logs
   SET source = 'admin'
 WHERE is_auto = 0 AND updated_by IS NOT NULL;

-- The timeline is read per order oldest-first (0022 covers that with
-- idx_order_status_logs_order_created) and audited per actor over time, which
-- 0022 covers only by `updated_by` alone.
CREATE INDEX idx_order_status_logs_actor_created
    ON order_status_logs (updated_by, created_at);

-- ============================================
-- RETIRE THE STATUS TRIGGER
-- ============================================
--
-- 0022's `trg_order_status_change` writes a log row on every UPDATE of
-- `orders.status`. The application now writes its own row for each transition,
-- inside the same transaction as the status change, carrying the actor, the
-- source, the reason and the request metadata -- none of which a trigger can
-- see, because a trigger sees only the row.
--
-- Leaving both in place would put two rows in the customer-facing timeline for
-- every single transition. This is not a new hazard introduced here:
-- `order.service.js` on main already inserts explicitly *and* updates the
-- status, so the duplicate is present today and simply had no reader until
-- there was a timeline to show it in.
--
-- The cost is that a status changed by direct SQL is no longer recorded. That
-- was the trigger's stated purpose, and it is a real loss -- but a status
-- changed by direct SQL also skips the timestamp stamping, the courier
-- reconciliation and the customer notification, so it was never a supported
-- path, only a logged one.

DROP TRIGGER IF EXISTS trg_order_status_change;

-- ============================================
-- BACKFILL
-- ============================================
--
-- Every order that has no history at all gets one synthetic entry recording its
-- current state, so the timeline is never empty for an order that predates the
-- table. It is marked `system` with an explicit reason: inventing a plausible
-- sequence of transitions for orders whose real ones were never recorded would
-- be worse than admitting the record starts here.
--
-- `created_at` is the order's own creation time, so these entries sort with the
-- order rather than bunching every historical order at the migration timestamp.

INSERT INTO order_status_logs (
    order_id, old_status, new_status, source, is_auto, reason, created_at
)
SELECT
    o.id,
    NULL,
    o.status,
    'system',
    1,
    'Imported when status history was introduced; earlier transitions were not recorded',
    o.created_at
FROM orders o
WHERE NOT EXISTS (
    SELECT 1 FROM order_status_logs l WHERE l.order_id = o.id
);

-- ============================================
-- TERMINAL TIMESTAMPS
-- ============================================
--
-- `orders` has carried delivered_at, cancelled_at and refunded_at from the
-- start, and only cancelled_at was ever written, and only on the refund path --
-- so an order marked `delivered` kept a NULL delivered_at forever and no
-- fulfilment-time reporting was possible.
--
-- `shipped_at` needs no ALTER here: 0022 added it.
--
-- Only the terminal state is knowable after the fact. An order that is now
-- `delivered` was certainly shipped at some point, but nothing recorded when,
-- so shipped_at is deliberately left NULL rather than guessed.

UPDATE orders
   SET delivered_at = COALESCE(delivered_at, updated_at)
 WHERE status = 'delivered' AND delivered_at IS NULL;

UPDATE orders
   SET cancelled_at = COALESCE(cancelled_at, updated_at)
 WHERE status = 'cancelled' AND cancelled_at IS NULL;
