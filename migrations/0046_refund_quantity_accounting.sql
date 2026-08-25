-- ============================================
-- RETURNS ARE COUNTED IN UNITS, NOT IN LINES
-- ============================================
--
-- `refundController.createRequest` asked one question before accepting a
-- return: does this order line already have a request that is pending or
-- approved? A yes/no was doing the work of an arithmetic check, and it was
-- wrong in both directions (#1477).
--
-- Too strict: a line of five units, two returned and approved, and the
-- remaining three could never be returned -- `approved` is where every
-- successful return stops, since no route moves a request past it.
--
-- Too loose: a request that left that pair released the whole line. Reject one
-- request for five units and submit another; approve it, and
-- `stockCounter.restoreStock` credits five units that were never sold. With
-- `product_variants.stock` authoritative since 0032, that phantom stock is
-- immediately sellable.
--
-- The rule the controller now enforces is a sum: the units claimed by a line's
-- pending, approved and refunded requests may not exceed the units bought on
-- it. Rejected requests consume nothing.
--
-- Nothing here changes data. `refund_requests` needs no new columns -- quantity
-- and status were always there and always sufficient; what was missing was
-- anyone adding them up.

-- ============================================
-- AN INDEX FOR THE SUM
-- ============================================
--
-- The check runs on every return submission and now reads every request for the
-- line rather than stopping at the first. `idx_refund_requests_order_item`
-- covers the lookup but not the status filter, so the engine reads each matching
-- row to decide whether it counts. Adding status to the key lets the filter be
-- satisfied from the index.
--
-- The count is taken inside the submission's transaction, after the order line
-- is locked, so it is on the latency path of a request a customer is waiting
-- on -- which is why it is worth the index rather than a note in review.

DELIMITER //

CREATE PROCEDURE EnforceRefundQuantityAccounting()
BEGIN
    IF NOT EXISTS (
        SELECT * FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME   = 'refund_requests'
          AND INDEX_NAME   = 'idx_refund_requests_item_status'
    ) THEN
        ALTER TABLE refund_requests
        ADD INDEX idx_refund_requests_item_status (order_item_id, status, quantity);
    END IF;
END //

DELIMITER ;

CALL EnforceRefundQuantityAccounting();
DROP PROCEDURE EnforceRefundQuantityAccounting;

-- ============================================
-- WHAT IS NOT DONE HERE, AND WHY
-- ============================================
--
-- Two things a reviewer will reasonably ask about.
--
-- No CHECK constraint enforcing the sum. MySQL's CHECK cannot reference another
-- table, and the quantity a line was bought at lives on `order_items`. A
-- trigger could, but a trigger that rejects an INSERT is invisible at the call
-- site and would duplicate the rule the controller states plainly -- and the
-- controller holds a row lock, so it is not racing anything the trigger would
-- catch. The invariant stays in one place.
--
-- No backfill of over-returned lines. Rows written under the old rule may
-- already sum past the quantity bought, and the honest correction is a refund
-- reversal and a stock adjustment, neither of which a migration can decide.
-- What the new rule does guarantee is that such a line accepts nothing further:
-- the sum is already at or past the limit, so every subsequent request is
-- refused. The existing overage is left visible rather than quietly rewritten.
