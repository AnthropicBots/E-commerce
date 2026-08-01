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
| `cart_items` | baseline and a standalone cart change file | Baseline shape wins: the primary key is the full cart line (user, product, variant, colour, size), which is what the cart code's upsert relies on. The standalone file's surrogate key was retired. |
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
`users`, `products` and `orders` with integer primary keys, which contradicts the
baseline. Do not apply it.

## Feature schemas not yet in the sequence

`backend/sql/` still holds self-contained feature schemas that have not been
folded in, including ones added after this consolidation was written. They are
independent of one another and of the core tables, so their order is not
load-bearing, but they are not applied by `npm run migrate` either — see
`backend/sql/README.md`, which lists what is there and what it means for a fresh
install. New feature schemas belong here, not there.
