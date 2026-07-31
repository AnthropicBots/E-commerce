# Feature schemas awaiting migration

The files here are **not applied by `npm run migrate`** and are not part of the
setup path. They are per-feature schemas that were written to be piped into
`mysql` by hand, which is how the project ended up with no reliable path from an
empty database to a working one.

Each is self-contained — it creates its own tables and does not depend on the
others — so nothing here is needed for the core application to work. They are
being folded into `migrations/` as they are next touched, so that folding them in
comes with a review of the feature that owns them.

Everything still in this directory is unfolded, including files that arrived
after the consolidation started: `agent_performance_monitoring.sql`,
`identity_verification.sql` and `multi_agent_coordination.sql` are new, and
`outbox_pattern.sql` has been changed since. A fresh database therefore does not
have the tables any of them declare, and the features that own them will not
work on one until they are folded in.

## If you are adding a schema change

Put it in `migrations/`. Do not add a file here.

## If you are folding one of these in

1. Move it to `migrations/NNNN_<name>.sql` with the next number.
2. Check that any reference to `users`, `products` or `orders` uses `CHAR(36)`.
   Several of these files declare `INT` foreign keys against those tables, which
   cannot be built and makes the whole file fail.
3. Check for `ADD COLUMN IF NOT EXISTS`, `DROP COLUMN IF EXISTS` and
   `CREATE OR REPLACE PROCEDURE`. All are MariaDB-only; MySQL rejects them
   outright.
4. If it declares a table another migration already declares, keep one owner and
   express the difference as an explicit `ALTER TABLE`.
5. Apply it against an empty database to confirm it runs.
