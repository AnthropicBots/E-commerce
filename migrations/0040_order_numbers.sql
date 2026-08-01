-- ============================================
-- ORDER NUMBERS
-- ============================================
--
-- `orders.order_number` has been in the schema, unique and indexed, since the
-- baseline. Nothing has ever written it, so every row holds NULL and the only
-- handle on an order is its primary key.
--
-- That was survivable while every order belonged to an account: the account
-- lists its own orders and never has to name one. A shopper without an account
-- has no list to read, so they need something they can be given at checkout
-- and quote back afterwards -- and it cannot be the primary key, which is an
-- internal identifier that turns up in URLs and logs and was never meant to
-- prove anything.
--
-- So the number has to be unguessable. Half of what authorises a guest order
-- lookup is knowing it; the other half is the email the order was placed with,
-- which for a shopper's own address is not a secret at all. Sixty-four bits of
-- randomness in the suffix is what carries that weight. The date prefix is
-- there for the humans reading it out over the phone and adds nothing to the
-- entropy.
--
-- The column stays nullable. Two other checkout paths -- the agent checkout
-- and the standalone checkout service -- also insert orders and do not supply
-- a number yet; making it mandatory before they do would turn a schema change
-- into an outage on paths this change does not touch.

UPDATE orders
SET order_number = CONCAT(
    'ORD-',
    DATE_FORMAT(COALESCE(created_at, NOW()), '%Y%m%d'),
    '-',
    -- UUID() rather than the id alone: derived from the id, the number would
    -- be recoverable by anyone who has seen an order URL, which is exactly the
    -- property it must not have.
    UPPER(SUBSTRING(SHA2(CONCAT(id, UUID()), 256), 1, 16))
)
WHERE order_number IS NULL OR order_number = '';
