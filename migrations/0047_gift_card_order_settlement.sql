-- ============================================
-- A REDEEMED GIFT CARD HAS TO PAY FOR SOMETHING
-- ============================================
--
-- `applyToOrder(code, orderId, amount)` wrote `orderId` into
-- `gift_card_transactions.order_id` and did nothing else with it. The order was
-- never read, so nothing established that it existed, that it belonged to the
-- caller, that it was unpaid, or that `amount` bore any relation to what was
-- owed on it (#1478).
--
-- The half that costs customers money is not the missing ownership check. It is
-- that even in the honest case -- your own card, your own order, a sensible
-- amount -- `orders` was untouched. The balance was spent, a `redeem` row was
-- written, and the customer was still asked for the full amount at checkout.
-- Gift cards were a way to destroy store credit.
--
-- This adds the column that records what a card paid, so the redemption and the
-- order can be reconciled and so the amount owed actually comes down.

-- ============================================
-- WHAT THE CARDS HAVE PAID
-- ============================================
--
-- A column of its own rather than reusing one that exists. `orders` already
-- carries `discount`, `discount_amount`, `final_amount` and `total_amount`, and
-- checkoutService writes `priced.total` into `total`, `total_amount` *and*
-- `final_amount` -- three copies of one figure. Folding store credit into any
-- of them would make a paid-with-credit order indistinguishable from a
-- discounted one, and store credit is not a discount: it is a payment, it came
-- out of a balance somebody bought, and it has to be refundable back to that
-- balance.
--
-- Outstanding on an order is `total - gift_card_amount`.

DELIMITER //

CREATE PROCEDURE AddGiftCardSettlementColumn()
BEGIN
    IF NOT EXISTS (
        SELECT * FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME   = 'orders'
          AND COLUMN_NAME  = 'gift_card_amount'
    ) THEN
        ALTER TABLE orders
        ADD COLUMN gift_card_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER discount_amount;
    END IF;

    IF NOT EXISTS (
        SELECT * FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
        WHERE TABLE_SCHEMA     = DATABASE()
          AND TABLE_NAME       = 'orders'
          AND CONSTRAINT_NAME  = 'chk_orders_gift_card_amount'
    ) THEN
        ALTER TABLE orders
        ADD CONSTRAINT chk_orders_gift_card_amount CHECK (gift_card_amount >= 0);
    END IF;
END //

DELIMITER ;

CALL AddGiftCardSettlementColumn();
DROP PROCEDURE AddGiftCardSettlementColumn;

-- Backfilled to zero by the DEFAULT, which is correct rather than merely
-- convenient: no redemption has ever reduced what an order owed, so every
-- existing order has had exactly zero paid for it by a card. The
-- `gift_card_transactions` rows that name an order are real -- balances were
-- genuinely spent -- but they settled nothing, and inventing a settlement for
-- them now would mark orders paid that were, in fact, paid in full by other
-- means. Those customers are owed their balance back; see the note below.

-- ============================================
-- THE CURRENCY A CARD IS ISSUED IN
-- ============================================
--
-- `gift_cards.currency` defaults to 'USD'. The store has exactly one currency
-- and declares it in backend/config/currency.js, where it is INR -- has been
-- since the fix that stopped the storefront showing rupees while invoices
-- printed dollars and payment intents were raised in USD.
--
-- So every card ever issued through the service's default is labelled in a
-- currency the store does not price in, and `applyToOrder` never compared the
-- two. With one currency configured that was latent; the moment a redemption
-- actually reduces an order total it stops being latent, because the figure
-- coming off the order is denominated in something else.
--
-- The default moves to the store's currency. New cards are labelled correctly.

DELIMITER //

CREATE PROCEDURE AlignGiftCardCurrencyDefault()
BEGIN
    IF EXISTS (
        SELECT * FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA   = DATABASE()
          AND TABLE_NAME     = 'gift_cards'
          AND COLUMN_NAME    = 'currency'
          AND COLUMN_DEFAULT = 'USD'
    ) THEN
        ALTER TABLE gift_cards
        MODIFY COLUMN currency CHAR(3) NOT NULL DEFAULT 'INR';
    END IF;
END //

DELIMITER ;

CALL AlignGiftCardCurrencyDefault();
DROP PROCEDURE AlignGiftCardCurrencyDefault;

-- Existing rows are deliberately NOT rewritten.
--
-- Relabelling a balance from one currency to another is choosing an exchange
-- rate, and there is no rate a migration can defensibly pick -- 1:1 is a rate
-- too, and the wrong one by a factor of about eighty. The service now refuses a
-- redemption whose card currency does not match the store's, so a card in this
-- state fails loudly at the point of use instead of being applied across
-- currencies without anyone noticing.
--
-- That does strand those balances until somebody decides what they are worth.
-- Stranded and visible is better than spent at an invented rate. To see them:
--
--     SELECT id, balance, currency, created_at
--       FROM gift_cards
--      WHERE currency <> 'INR' AND status = 'active' AND balance > 0;
--
-- The customers with a `gift_card_transactions` row naming an order are owed
-- their balance back regardless -- the redemption took their credit and settled
-- nothing. `giftCardService.issue` can make them whole:
--
--     SELECT t.gift_card_id, t.order_id, t.amount, t.created_at
--       FROM gift_card_transactions t
--      WHERE t.type = 'redeem' AND t.order_id IS NOT NULL;
