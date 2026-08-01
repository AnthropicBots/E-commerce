# Migrations

Every change to the database schema lives here as a numbered `.sql` file. The
sequence is ordered, forward-only and immutable, and it is the only supported way
to build or upgrade the schema.

```bash
cd backend
npm run migrate          # apply everything pending
npm run migrate:status   # list applied vs pending, change nothing
npm run migrate:baseline # adopt the baseline on a pre-existing database
```

## Rules

- **Name files `NNNN_short_name.sql`** with a four-digit prefix one higher than
  the last. Files that do not match are ignored and reported, because a
  migration nobody can order is a migration nobody can apply reproducibly.
- **Never edit an applied migration.** The runner records a checksum per file and
  refuses to run if one changed, since the database's real shape would then be
  unknown. Add a new migration instead.
- **Do not pipe SQL into `mysql` by hand.** Anything applied outside the runner
  is not recorded, so the runner will try to apply it again.
- **A table has exactly one owning migration.** Later files amend it with
  `ALTER TABLE`. A second `CREATE TABLE IF NOT EXISTS` for a table that already
  exists is skipped silently, which is how the schema came to depend on apply
  order in the first place.

## Baseline

`0001_baseline_schema.sql` is the schema established installations already had,
adopted verbatim. It declares stored procedures, so it is not safe to re-run:
a database that already has these tables records it with `npm run migrate:baseline`
and then migrates forward normally. A fresh database runs it like any other
migration.

## Resolved duplicate definitions

Several tables used to be declared in more than one file, in shapes that
disagreed. Because every declaration said `IF NOT EXISTS`, the shape a database
ended up with depended on which file somebody happened to run first, and the
disagreement never surfaced as an error — only as a query failure later. Each is
now resolved to one shape, produced by one owning migration.

| Table | Was declared in | Resolution |
| --- | --- | --- |
| `cart_items` | baseline and a standalone cart change file | Baseline shape wins; the standalone file's surrogate key was retired. The key is the full cart line — product, variant, colour, size — scoped to the cart the line is in. It was scoped to the account until guest baskets arrived, which need a line the account cannot identify. |
| `chat_conversations`, `chat_messages` | baseline and a chat feature file | Baseline shape wins. The chat file's copies referenced users by integer id and dropped the priority, moderation and soft-delete columns the baseline carries. |
| `blocked_ips` | crawler protection and crawler verification | Union of both. Crawler protection owns the table and keeps `expires_at`; the verification audit columns are added by an explicit `ALTER TABLE`. |
| `device_fingerprints` | bot protection and synthetic identity fraud | Union of both. Bot protection owns the table and keeps `is_suspicious`; the client-environment columns are added by an explicit `ALTER TABLE`. |
| `agent_liability_registrations`, `agent_authorizations`, `liability_assignments`, `agent_insurance_policies`, `liability_claims` | two liability feature files | The fuller framework definition wins; the subset file was retired. |
| `agent_merchant_access` | liability framework and account takeover | The definition with the foreign key to the agent registry wins. |
| `agentic_ato_alerts` | ATO detection and ATO audit trail | Detection owns the table, keeping `agent_id` at `VARCHAR(100)` like every other agent table; `severity` is added by an explicit `ALTER TABLE`. |
| `refresh_tokens` | baseline and the user-security change file | Baseline shape wins: it hashes the token and carries the family and reuse-detection columns the token service reads. The change file's plaintext `token` copy was retired. |
| `user_addresses` | baseline and an un-numbered address change file | Baseline shape wins; the two agreed. Only the `orders.address_id` link and the backfill were folded in. |

A view name collided the same way: refund fraud and synthetic identity fraud both
declared a `fraud_detection_dashboard` over unrelated tables, so whichever was
created second either failed or silently replaced the other. Each is now named
for the feature it reports on.

## Sessions

`auth_sessions` is now part of the baseline, so it needs no migration of its
own. The un-numbered `add_auth_sessions.sql` and the second copy under
`backend/sql/` are retired: both declared the same table, and the baseline's
`cleanup_old_data` already sweeps expired rows. The column drop those files
carried (`users.refresh_token`) is also already reflected in the baseline.

### Unresolved: `auth_sessions` and `refresh_tokens` overlap

**The baseline declares two tables that model the same thing, and both are
live. Maintainers need to pick one.**

| Table | Written by | Shape |
| --- | --- | --- |
| `auth_sessions` | `backend/services/authSessionService.js` | `family_id`, `token_hash`, `replaced_by`, `revoked_reason` |
| `refresh_tokens` | `backend/services/refreshTokenService.js` | `family_id`, `token_hash`, `parent_token_hash`, `status` including `reuse_detected` |

Both keep one row per signed-in device, store only a digest of the refresh
token, group rows into a family, and rotate by superseding a predecessor so
that a superseded row presented again is a replay rather than an ordinary
expiry. They arrived from separate pieces of work and neither knows about the
other, so the same sign-in is recorded twice, revoking a device through one
path leaves the other path's row live, and reuse detection only sees half the
traffic.

Choosing a winner, migrating the rows and retiring the loser is a product
decision with its own backout, not something a schema consolidation should
settle. It is recorded here so it is findable rather than rediscovered.

`user_sessions`, also from the baseline, is a third take on the same idea: it
keeps its session token in plaintext and has no notion of a family or
supersession, so it cannot express rotation at all. No code reads or writes it.
It is left in place rather than dropped, because retiring a table is its own
change and folding one into a consolidation puts unrecoverable data loss
somewhere nobody would look for it.

## Key strategy: UUIDs for users, products and orders

`users`, `products` and `orders` are keyed by `CHAR(36)` UUIDs generated by the
application. Everything else uses `AUTO_INCREMENT` integers. Any column that
references one of those three tables must be `CHAR(36)`.

This settles a question the schema had been carrying both answers to. UUIDs won
because that is what the running system already does: the baseline declares those
three primary keys as `CHAR(36)`, insert statements supply the id explicitly
rather than relying on the database, and the request layer treats user and product
ids as opaque strings throughout. Switching to integers would mean rewriting all
of that; adopting UUIDs meant correcting the columns that had drifted.

The integer answer only ever appeared in places that were not working anyway: the
legacy dump, and feature files whose integer foreign keys against a `CHAR(36)`
parent could not be built, so those files failed to apply at all. Those columns
are now `CHAR(36)`.

Integers are kept for surrogate keys on child and lookup tables. They are
narrower, they cluster well in InnoDB, and nothing outside the database needs to
mint them, so the reasons for UUIDs on the three core tables do not apply.

The abandoned `change_to_uuids.sql` change file is retired rather than rewritten.
It converted `users`, `products` and `orders` from integer keys to UUIDs, a
starting point no database reachable through this sequence has: the baseline
already declares them as UUIDs, so the file's first statement — narrowing `id`
back to `INT` — would have destroyed the keys it was meant to migrate.

## Change files that could not be applied as written

Three hand-written change files were rewritten while being folded in, because
they were not applicable to any MySQL database:

- The user-security change file used `ADD COLUMN IF NOT EXISTS`, which is MariaDB
  syntax that MySQL rejects, and declared `user_id INT` against a `CHAR(36)`
  parent so its foreign keys could not be built. It also introduced
  `lockout_until` next to the baseline's `locked_until` for the same purpose;
  `locked_until` is the name the lockout code reads, so that one won.
- The order-status change file had the same `IF NOT EXISTS` problem, re-declared
  indexes the baseline already defines, and used `CREATE OR REPLACE PROCEDURE`,
  which MySQL does not support.
- The address-book change file used `ADD COLUMN IF NOT EXISTS` too. Its adds are
  now guarded by `INFORMATION_SCHEMA` checks rather than made unconditional,
  because that file shipped as something runnable and a database may already
  carry the column, the foreign key or the index.

The crawler verification file had the same `CREATE OR REPLACE PROCEDURE` problem
and now drops each procedure before creating it.

## The legacy dump

`docs/legacy/ecommerce-mysql-dump.sql` is a `mysqldump` of an old development
database, kept only for reference. It is not part of the setup path: it declares
`users`, `products` and `orders` with integer primary keys, contradicting the key
strategy above. Do not apply it.

## Tables added to match the application's queries

These were queried by application code and created by nothing, so the features
that used them failed with "table doesn't exist" on a database built as
documented. Their shapes come from the queries: `billing_plans`, `subscriptions`,
`product_views`, `wishlist_shares`, `login_history`, `user_fingerprints` and
`promo_usage_logs`.

Two names that look like duplicates are deliberately separate concerns:

- `product_views` is an append-only view log; `recently_viewed` keeps one row per
  user and product. Recommendations count repeat views, so both are needed.
- `promo_usage_logs` records a promotion being applied and is what the per-user
  limit counts; `promo_usage` links a promotion to an order once that order
  exists.

Where the code disagreed with itself rather than with the schema, the code was
corrected: the promotion usage counter is `usage_count`, which is what the schema
and the order service already used, and the trending-products query now joins
`wishlist_items` like the rest of the application rather than a `wishlist` table
that never existed.

`security_logs` had its time column renamed to `timestamp`, which is what the
admin endpoint orders by.

## Known remaining gap: the analytics modules

The metrics, CQRS read-model and parts of the recommendation services query a
different data model from the one the rest of the application uses: a `carts`
aggregate with abandonment and segment columns, `orders.total_amount`,
`orders.cart_id`, `orders.product_id`, `products.image_url`, `products.category`,
and an order status of `completed`. The transactional code uses `cart_items`,
`orders.total`, `order_items`, `products.image`, `products.category_id` and a
status of `delivered`.

This is not a naming slip that can be migrated away. Whether a cart exists as a
first-class row with a lifecycle — which is what abandonment reporting needs — is
a product decision, and inventing the table here would only make those queries
return zeros. It is left as it is, deliberately, rather than guessed at.

## Feature schemas not yet in the sequence

`backend/sql/` still holds self-contained feature schemas that have not been
folded in. They are independent of one another and of the core tables, so their
order is not load-bearing, but they are not applied by `npm run migrate` either —
see `backend/sql/README.md`. New feature schemas belong here, not there.
