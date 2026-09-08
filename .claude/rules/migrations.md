---
paths: ["supabase/migrations/**/*.sql"]
---

# Migrations

Loaded only when a migration is touched.

## ⚠️ Append-only — this is now LIVE, not pending

`call-roster-prod` and `call-roster-tester` both exist and are migrated to `0017` as of
2026-09-08. The condition below is met. **New file, next number, always.**

Editing an already-applied migration in place used to be fine here, and two were: the
`burden_weight` reshape and `0009`, which originally created `audit_log` and now creates
`command_journal`. That licence has expired.

**The Supabase CLI tracks a migration by its version prefix, never by its content.** A file edited
after it was applied is silently never re-run, so the database keeps the old shape while the
repository shows the new one — and nothing reports a difference. The failure surfaces later, in an
unrelated migration, as a missing relation or column that plainly *does* exist in the file you are
reading.

Measured 2026-09-08: the persistent local dev cluster still had `audit_log` and no
`command_journal`, with `0009` recorded as applied. `0014` then failed on
`relation "command_journal" does not exist`. `db:check` and `api:check` could not see it — they
build a throwaway cluster from scratch every run, where every file is applied for the first time
and the drift cannot exist.

- **Local drift is repairable**: `npm run db:dev:reset`. It wipes `.tools/pgdata-dev` and reapplies
  every migration from `0001`. **Check for rows first** — it is destructive, and the schema-only
  state that makes it free today will not last.
- **Remote drift is not repairable.** Once `call-roster-prod` exists, a change to an applied
  migration is unrecoverable without a manual repair against a live database holding real people's
  movements. So: **new file, next number, always.**
- `npm run db:prod:verify` compares versions on disk against
  `supabase_migrations.schema_migrations` — that catches a *missing* migration, not an edited one.
  Nothing catches an edited one. The rule is the whole defence.

## ⚠️ What the gates cannot prove — run `db:prod:verify`

Two independent blind spots, both measured, not theorised:

1. **Wrong tool.** `db:check` and `api:check` apply migrations with raw `psql -f` per file
   (`scripts/lib/pg-test-cluster.ts`). `db-dev.ts` and `db-remote.ts` use the **Supabase CLI**,
   which is what runs against a real project. A migration can pass both gates and still fail the
   CLI — the drift above did exactly that for three days.
2. **Wrong role.** Both gates connect as a **cluster-owning superuser**, which can `SET ROLE` to
   anything and is subject to no default grants. Supabase's `postgres` is neither. On 2026-09-08
   all sixteen migrations applied cleanly to prod and **every route would still have failed**:
   `SET LOCAL ROLE app_user` was refused, which `db.ts` does at the top of every transaction. See
   [`0017`](../../supabase/migrations/0017_managed_host_roles.sql). No local gate can ever catch
   this class — the privilege the check depends on is one the local connection always has.

So after touching a migration, all three: `npm run db:check`, `npm run db:tester:verify`,
`npm run db:prod:verify`. **There is no default target** — naming the database is the point.

## Shape

- **RLS from line one**, never retrofitted (ADR-0007): `enable row level security` **and**
  `force row level security` on every table, plus explicit `grant`s to `app_user`.
  `db:*:verify` fails on a table missing either.
- Target **PostgreSQL 17**. Not 18: no native temporal `PERIOD` foreign keys or
  `WITHOUT OVERLAPS` primary keys — use a GiST exclusion constraint and, for H-03, a trigger. See
  the addendum to
  [ADR-0008](../../docs/architecture/decisions/0008-temporal-validity-intervals.md).
- **Temporal validity intervals, not soft deletes.** No `is_active`, no `deleted_at` on anything
  people-shaped.
- `person.full_name` is where the thirteen real names land at runtime. **Never seed a real surname
  into a migration, fixture or example** — `npm run names:check` reads the repository, and cannot
  see inside a running database.
