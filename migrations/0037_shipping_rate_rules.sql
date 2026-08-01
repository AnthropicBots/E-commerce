-- ============================================
-- SHIPPING RATE RULES (#1430)
-- ============================================
--
-- A delivery option carries one flat rate. Real delivery pricing is not flat:
-- it moves with where the parcel is going, how heavy it is and what the basket
-- is worth. Hardcoding those three would put the store's commercial policy in
-- a deployment, so they are rows.
--
-- The free-shipping threshold is one of these rules rather than a special case
-- beside them. Before this it was a constant in the pricing engine, which is
-- why it could not be varied by destination, could not be run as a campaign,
-- and could not be turned off. Expressing it as a waiver over basket value
-- makes "free delivery over 999" and "free delivery to Mumbai" the same kind
-- of thing.
--
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS shipping_rate_rules (
    id INT AUTO_INCREMENT PRIMARY KEY,

    -- Shown to operators and echoed on a quote, so a shopper asking "why does
    -- this cost that" has an answer that is not a row id.
    name VARCHAR(100) NOT NULL,

    -- The option this rule prices. NULL applies it to every option, which is
    -- what a value threshold usually wants -- earning free delivery should not
    -- depend on which service was picked.
    method_code VARCHAR(50) NULL,

    -- ============================================
    -- WHAT THE RULE MATCHES
    -- ============================================
    --
    -- Every condition left at its permissive value matches everything, so a
    -- rule states only what it cares about. All stated conditions must hold.

    -- Destination is expressed against what serviceable_pincodes already
    -- knows: the pincode itself, or the city or state it resolves to. A second
    -- notion of "where" -- zones, regions, postcode ranges -- would have to be
    -- kept in step with that table by hand.
    destination_scope ENUM('any', 'pincode', 'city', 'state') NOT NULL DEFAULT 'any',
    destination_value VARCHAR(100) NULL,

    -- Half-open weight and value windows: the minimum is inclusive and the
    -- maximum is exclusive, so adjacent bands tile without overlapping and
    -- without a gap. NULL is unbounded on that side.
    min_weight_kg DECIMAL(10,3) NULL,
    max_weight_kg DECIMAL(10,3) NULL,

    -- Compared against the post-discount subtotal, which is the same base the
    -- tax and shipping rules have used since the pricing engine landed.
    -- Earning free delivery on a discount the shopper did not pay for is how
    -- a promotion funds its own shipping twice.
    min_order_value DECIMAL(10,2) NULL,
    max_order_value DECIMAL(10,2) NULL,

    -- ============================================
    -- WHAT THE RULE DOES
    -- ============================================
    --
    --   set_rate   replaces the option's rate outright
    --   surcharge  adds to it
    --   waive      covers part or all of it
    --
    -- `amount` is required for set_rate and surcharge. On a waive it may be
    -- NULL, meaning "cover the default option's rate" -- the standard cost of
    -- delivery -- which is what free shipping has always meant here and what
    -- keeps an upgrade costing its difference rather than nothing.
    effect ENUM('set_rate', 'surcharge', 'waive') NOT NULL,
    amount DECIMAL(10,2) NULL,

    -- Lowest number is considered first. Only one set_rate can win; surcharges
    -- all apply; the largest single waiver applies, because stacking waivers
    -- is how a store ends up paying customers to accept delivery.
    priority INT NOT NULL DEFAULT 100,

    is_active TINYINT(1) NOT NULL DEFAULT 1,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT chk_shipping_rules_amount CHECK (amount IS NULL OR amount >= 0),
    CONSTRAINT chk_shipping_rules_weight CHECK (
        min_weight_kg IS NULL OR max_weight_kg IS NULL OR max_weight_kg > min_weight_kg
    ),
    CONSTRAINT chk_shipping_rules_value CHECK (
        min_order_value IS NULL OR max_order_value IS NULL OR max_order_value > min_order_value
    ),
    -- A scoped destination without a value matches nothing and is almost
    -- certainly a half-finished rule; an 'any' scope with a value is a stated
    -- condition that would be silently ignored. Both are refused.
    CONSTRAINT chk_shipping_rules_destination CHECK (
        (destination_scope = 'any' AND destination_value IS NULL)
        OR (destination_scope <> 'any' AND destination_value IS NOT NULL)
    ),

    CONSTRAINT fk_shipping_rules_method
        FOREIGN KEY (method_code) REFERENCES shipping_methods(code)
        ON DELETE CASCADE ON UPDATE CASCADE,

    -- The pricing access path: every active rule, in the order they are
    -- considered. The whole set is small and is read as one, so this is a scan
    -- of the index rather than a lookup through it.
    INDEX idx_shipping_rules_active_priority (is_active, priority),
    INDEX idx_shipping_rules_method (method_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- THE THRESHOLD THAT ALREADY EXISTED
-- ============================================
--
-- 999 and "the whole standard rate" are exactly what the pricing engine has
-- applied since it took ownership of totals, so this seed changes nobody's
-- bill. It only moves the decision somewhere it can be changed.
--
-- No destination or weight rule is seeded. Those are commercial decisions, and
-- a migration that quietly started surcharging heavy parcels would change what
-- customers pay without anyone deciding to.

INSERT INTO shipping_rate_rules (
    name, method_code, destination_scope, min_order_value, effect, amount, priority
)
SELECT
    'Free delivery over 999', NULL, 'any', 999.00, 'waive', NULL, 100
FROM DUAL
WHERE NOT EXISTS (
    SELECT 1 FROM shipping_rate_rules WHERE name = 'Free delivery over 999'
);
