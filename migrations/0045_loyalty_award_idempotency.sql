-- ============================================
-- ONE ORDER, ONE AWARD
-- ============================================
--
-- `loyaltyService.award()` writes an `earn` row every time it is called, and it
-- is called by an `{ async: true }` ORDER_CREATED subscriber -- fire-and-forget,
-- errors swallowed by design. So the number of times a customer is paid for an
-- order is the number of times that event is delivered for it, and points are
-- spendable at REDEEM_RATE, which makes a replay a way of printing money
-- (#1476).
--
-- 0004_loyalty_points.sql gave `loyalty_transactions` this:
--
--     INDEX idx_order (order_id)
--
-- An index, not a constraint. The database will accept as many `earn` rows for
-- one order as it is sent. The service is being taught to check first, but a
-- check in application code is a convention; two application instances handling
-- the same republished event race straight past it. The constraint below is
-- what makes it impossible.
--
-- (user_id, order_id, type) rather than (order_id, type): the ledger has no
-- foreign key to `orders` and `order_id` is an INT here, so scoping to the
-- account is the narrower claim and the one that is certainly true.
--
-- NULL `order_id` is unaffected. MySQL treats NULLs as distinct in a UNIQUE
-- index, so the `redeem` and `adjust` rows -- which all carry NULL -- can still
-- be written without limit. That is the behaviour this constraint needs: only
-- rows that name an order are being made unique.

-- ============================================
-- CLEAR THE DUPLICATES ALREADY IN THE TABLE
-- ============================================
--
-- The index cannot be added while any exist, and there is no reason to assume
-- none do -- the whole point is that nothing has ever stopped them.
--
-- A duplicate is every `earn` row for a (user, order) pair except the earliest,
-- which is the one that corresponds to the order actually being placed. The
-- surplus is not a bookkeeping artefact: those points were credited to a real
-- balance and can already have been spent. So the balance is corrected first,
-- then the rows are removed, then the tier is recomputed from the corrected
-- lifetime total.
--
-- Order matters. Deleting first would lose the amounts needed to correct by.

CREATE TEMPORARY TABLE loyalty_award_surplus AS
SELECT
    t.user_id,
    SUM(t.points) AS surplus_points
FROM loyalty_transactions t
JOIN (
    SELECT user_id, order_id, MIN(id) AS keep_id
    FROM loyalty_transactions
    WHERE type = 'earn' AND order_id IS NOT NULL
    GROUP BY user_id, order_id
    HAVING COUNT(*) > 1
) first_award
  ON  first_award.user_id  = t.user_id
  AND first_award.order_id = t.order_id
WHERE t.type = 'earn'
  AND t.order_id IS NOT NULL
  AND t.id <> first_award.keep_id
GROUP BY t.user_id;

-- Balance is clamped at zero. Lifetime is clamped too, and for a different
-- reason: it is a monotonic total that decides the tier, so letting it go
-- negative would put an account below Bronze, which is not a state the ladder
-- has. An account that has already spent the duplicated points lands on zero
-- rather than in debt -- the alternative is a balance the customer cannot
-- settle, over an error that was not theirs.

UPDATE loyalty_accounts a
JOIN loyalty_award_surplus s ON s.user_id = a.user_id
SET a.points_balance  = GREATEST(a.points_balance  - s.surplus_points, 0),
    a.lifetime_points = GREATEST(a.lifetime_points - s.surplus_points, 0),
    a.updated_at      = NOW();

DELETE t
FROM loyalty_transactions t
JOIN (
    SELECT user_id, order_id, MIN(id) AS keep_id
    FROM loyalty_transactions
    WHERE type = 'earn' AND order_id IS NOT NULL
    GROUP BY user_id, order_id
    HAVING COUNT(*) > 1
) first_award
  ON  first_award.user_id  = t.user_id
  AND first_award.order_id = t.order_id
WHERE t.type = 'earn'
  AND t.order_id IS NOT NULL
  AND t.id <> first_award.keep_id;

-- Tiers, from the corrected lifetime totals. The thresholds are the TIERS
-- ladder in services/loyaltyService.js; that constant stays authoritative at
-- runtime and this only brings stored rows back in step with it. An account
-- that was promoted on duplicated points is demoted here, which is the honest
-- outcome -- it never reached the threshold.

UPDATE loyalty_accounts a
JOIN loyalty_award_surplus s ON s.user_id = a.user_id
SET a.tier = CASE
        WHEN a.lifetime_points >= 20000 THEN 'Platinum'
        WHEN a.lifetime_points >=  5000 THEN 'Gold'
        WHEN a.lifetime_points >=  1000 THEN 'Silver'
        ELSE 'Bronze'
    END;

DROP TEMPORARY TABLE loyalty_award_surplus;

-- ============================================
-- THE CONSTRAINT
-- ============================================
--
-- Guarded so the file is safe to re-run: the runner records a checksum and will
-- not re-apply an unchanged migration, but a database that adopted the baseline
-- by hand may already carry the index, and `ADD UNIQUE KEY` on an existing name
-- is an error rather than a no-op.

DELIMITER //

CREATE PROCEDURE EnforceLoyaltyAwardIdempotency()
BEGIN
    IF NOT EXISTS (
        SELECT * FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME   = 'loyalty_transactions'
          AND INDEX_NAME   = 'uniq_loyalty_award_per_order'
    ) THEN
        ALTER TABLE loyalty_transactions
        ADD UNIQUE KEY uniq_loyalty_award_per_order (user_id, order_id, type);
    END IF;
END //

DELIMITER ;

CALL EnforceLoyaltyAwardIdempotency();
DROP PROCEDURE EnforceLoyaltyAwardIdempotency;
