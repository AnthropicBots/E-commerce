-- ============================================
-- CART RESTORE LINKS
-- ============================================
--
-- A recovery message is only worth sending if acting on it is one click, and
-- the shopper reading it is usually not signed in -- that is most of why the
-- basket was left behind. So the link has to carry its own authority.
--
-- Nothing existing was suitable to carry it. The session JWT authenticates a
-- person for everything they can do; putting one in an email would turn a
-- forwarded message into a handover of the account. What this needs is the
-- opposite: an authority that can do exactly one thing, to exactly one basket,
-- for a bounded time, and that is worth nothing to anyone who did not receive
-- the message.

CREATE TABLE IF NOT EXISTS cart_restore_tokens (
    -- CHAR(36) to match carts.id and users.id, both of which this table
    -- references. A CHAR(36)/INT mismatch is how a foreign key in this schema
    -- has failed before.
    id CHAR(36) PRIMARY KEY,

    -- The SHA-256 of the token, never the token. A link is only ever in the
    -- message and in the shopper's browser; reading this table gives an
    -- attacker the set of baskets with live links and no way to open any of
    -- them.
    token_hash CHAR(64) NOT NULL,

    -- The one basket this authority covers. The redeeming request supplies no
    -- cart id at all, which is what makes "replayed against someone else's
    -- cart" unrepresentable rather than merely rejected: there is nowhere in
    -- the request to name a different cart.
    cart_id CHAR(36) NOT NULL,

    -- Recorded so a redemption can be tied back to the account it was issued
    -- for. Not used to authenticate the redeemer -- the link is not a login,
    -- and the endpoint that spends it establishes no session.
    user_id CHAR(36) NOT NULL,

    expires_at DATETIME NOT NULL,

    -- Single use. Set by a guarded update, so two requests arriving together
    -- cannot both spend the same link: the second finds zero rows changed and
    -- is refused. A spent link stays in the table rather than being deleted,
    -- because "this was already used" and "this never existed" are different
    -- answers and the shopper deserves the accurate one.
    redeemed_at DATETIME NULL,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    UNIQUE KEY uq_cart_restore_token_hash (token_hash),

    -- Superseding the previous link for a basket means finding it first.
    INDEX idx_cart_restore_cart (cart_id),
    -- The expiry sweep's access path.
    INDEX idx_cart_restore_expires (expires_at),

    CONSTRAINT fk_cart_restore_cart
        FOREIGN KEY (cart_id) REFERENCES carts(id) ON DELETE CASCADE,
    CONSTRAINT fk_cart_restore_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
