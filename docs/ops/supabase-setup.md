# Creating the two Supabase projects (Track B7)

This is the one piece of Track B7 that has to be done by a human with an account — creating a
Supabase organization and two projects. Everything else (schema, migrations, the connection code)
already exists and does not change based on who runs this. Researched and the facts below verified
2026-09-08; see [`environments.md`](environments.md) for the trade-off that led here and
[`NEEDS_YOUR_INPUT.md`](../NEEDS_YOUR_INPUT.md) question 8 for the full reasoning.

## Before you start

- **Region: `eu-central-1` (Frankfurt) for both projects.** Supabase has no South Africa region —
  the [community request](https://github.com/orgs/supabase/discussions/34614) has sat unanswered
  since April 2025 — and Frankfurt is the nearest of the 17 available AWS regions. A South African
  commenter in that same thread independently names Frankfurt as their own closest region.
- **Two projects, one organization, both on the Free plan.** The Free plan allows 2 active
  projects per organization, which is exactly the plan: `call-roster-prod` (the real practice,
  when there is one) and `call-roster-tester` (synthetic data only — see
  [`tester-programme.md`](tester-programme.md), this split is a POPIA requirement, not a
  convenience).
- **Free-plan projects pause after 7 days with too little database activity.** This product is
  used once a month, which is far short of 7 days, so **both projects will pause between sessions
  until a keep-alive ping exists.** A paused project keeps its data and can be restored from the
  dashboard for up to a year — nothing is lost by a pause, it is just an extra click before the
  next session. Building the scheduled ping is follow-up work (needs a place to run it from, e.g.
  GitHub Actions once Track B1 exists) and is not part of this step.
- **Never paste a database password, connection string, or API key into chat.** Put it straight
  into a local `.env.local` file (already gitignored — see `.gitignore`) or a password manager.
  This file lists what to put there; it does not need the values themselves.

## Steps

1. **Sign up** at [supabase.com](https://supabase.com) (GitHub OAuth is the fastest route) and
   create an organization if you don't have one yet.
2. **Create the first project** — name it `call-roster-prod`, region `eu-central-1 (Frankfurt)`.
   Supabase generates a database password at creation time; save it in a password manager
   immediately, it is shown only once.
3. **Create the second project** the same way, named `call-roster-tester`, same region.
4. **Copy the SESSION POOLER connection string**, per project: the **Connect** button in the
   dashboard header → **Session pooler**. It looks like

   ```
   postgresql://postgres.<project-ref>:[YOUR-PASSWORD]@aws-N-<region>.pooler.supabase.com:5432/postgres
   ```

   Replace `[YOUR-PASSWORD]` with the password from step 2, brackets included, and
   [percent-encode](https://developer.mozilla.org/en-US/docs/Glossary/Percent-encoding) it if it
   contains `@ : / ? # [ ] %`. Note the username is `postgres.<project-ref>`, not plain
   `postgres` — that is how the pooler knows which project you mean, and it is the single most
   common thing to get wrong when hand-editing one of these.

   ⚠️ **Not the "Direct connection", and not the "Transaction pooler".** See below — this is the
   one instruction here that was wrong in the first draft of this document.

   **If the Connect panel offers only a direct connection string** (it did, 2026-09-08 — the
   dashboard showed the project URL, a publishable key, the direct string and the CLI commands,
   with no pooler section anywhere), there are two ways out, in order of preference:

   - Take the **Transaction pooler** string if one is shown and change the port `6543` → `5432`.
     Nothing else differs; Supabase's documentation gives the pair as identical strings on
     different ports, because the port is what selects the mode.
   - Otherwise **derive it from the project ref**, which is the `<ref>` in
     `https://<ref>.supabase.co`. The username is `postgres.<ref>` and the database is `postgres`;
     the only unknown is the `aws-N-<region>` host, and `N` is *not* always `0`. Find it by
     probing: **Supavisor resolves the tenant before it authenticates**, so a connection with a
     deliberately wrong password returns *"Tenant or user not found"* from the wrong host and
     *"password authentication failed"* from the right one. That identifies the endpoint with no
     secret in play. Both projects landed on `aws-1-eu-west-1` on 2026-09-08.

5. **Download Supabase's CA certificate, once** — Project Settings → **Database** → **SSL
   Configuration** → *Download certificate* — and save it in the repo root as
   `prod-ca-2021.crt` (or `supabase-ca.crt`). It is gitignored. **One download covers both
   projects**; see step 8.

   This is not optional politeness. **Supabase signs its Postgres endpoints with its own CA**, so
   Node's default trust store rejects them outright — measured 2026-09-08 against every
   `aws-N-eu-*.pooler.supabase.com` host, all returning *"self-signed certificate in certificate
   chain"*. The usual internet advice is `rejectUnauthorized: false`, which leaves the connection
   encrypted but **unauthenticated** — fine for a toy, not for a link carrying thirteen
   identifiable people's movements. With the CA on disk, `db:prod:verify` does real
   verification. It refuses to run without one, and `--insecure` is a loud, deliberate diagnostic
   rather than a default.

6. **Put the connection string in a local `.env.local`** (repo root — already covered by the `.env*` line in
   `.gitignore`, and deliberately not published even as a template: see
   [`check-publish-safety.ts`](../../scripts/check-publish-safety.ts), which refuses to publish
   anything starting with `.env`, on purpose):

   ```
   DATABASE_URL_PROD=postgresql://postgres.<prod-ref>:<password>@aws-N-<region>.pooler.supabase.com:5432/postgres
   DATABASE_URL_TESTER=postgresql://postgres.<tester-ref>:<password>@aws-N-<region>.pooler.supabase.com:5432/postgres
   ```

   ⚠️ **Note there is no plain `DATABASE_URL`, and that is the point.** `DATABASE_URL` is what
   `lib/server/db.ts` reads *and* what Next.js loads automatically from this file — so setting it
   to a Supabase project makes `npm run dev` talk to that project. Pointed at prod, that is a
   mistake shaped the worst possible way: harmless today, because there is no editor UI, and
   severe on the day there is. Leaving it unset means the app falls through to
   `LOCAL_DEV_CONNECTION_STRING` and the local `.tools/pgsql` cluster.

   These two names are read **only** by [`db-remote.ts`](../../scripts/db-remote.ts), and only
   when it is given `--prod` or `--tester`. Nothing reads a Supabase API key: there is no Supabase
   Auth integration, so `ANON_KEY`/`SERVICE_ROLE_KEY` are not needed and are not invented ahead of
   that work.

7. **Apply the schema, then check it actually works.** There is **no default target** — every
   command names its database, and prints which one it resolved to before doing anything:

   ```bash
   npm run db:prod:migrate && npm run db:prod:verify
   ```

   `db:prod:migrate` is `supabase migration up` pointed at `DATABASE_URL_PROD` instead of the
   local cluster — the same command [`db-dev.ts`](../../scripts/db-dev.ts) already runs.
   `db:prod:verify` then interrogates the result: see the next section for what it checks and why.
   It **writes nothing** — its one `insert` runs in a transaction that always rolls back — so it
   is safe against the production project.

   ⚠️ **If `migrate` fails with no SQL error in the output, just run it again.** The shared pooler
   is occasionally flaky: on 2026-09-08 the same migration failed once at the *"Connecting to
   remote database"* step and applied cleanly on the immediate retry. Migrations are tracked
   individually, so a retry resumes rather than repeating. A failure that *names* a relation or
   column is the opposite — that is real, and the script says what it usually means.

8. **Repeat 4, 6 and 7 for `call-roster-tester`** — its string goes in `DATABASE_URL_TESTER`, and
   then:

   ```bash
   npm run db:tester:migrate && npm run db:tester:verify
   ```

   **Step 5 does not need repeating.** Verified 2026-09-08 by downloading both: the certificate is
   the same file for every project — `CN=Supabase Root 2021 CA`, self-signed, valid 2021-04-28 to
   2031-04-26. One `prod-ca-2021.crt` in the repo root covers both projects, so there is no `--ca`
   juggling and a second downloaded copy is just a duplicate.

## ⚠️ Turn the Data API OFF at creation time

The create-project dialog has a **Security** block with three switches, and the defaults are wrong
for this product:

| Switch | Default | Set it to | Why |
|---|---|---|---|
| **Enable Data API** | on | **off** | Autogenerates a public PostgREST API over the whole `public` schema. **Nothing here uses it** — `lib/server/db.ts` is a direct `pg` pool, and there is no `supabase-js` anywhere. Off removes the entire internet-facing surface in front of a database of thirteen identifiable people's movements |
| Automatically expose new tables | on | off | Grants the Data API roles privileges on every new table. Moot once the Data API is off, but the dialog itself says *"We recommend disabling this to control access manually"* |
| Enable automatic RLS | off | leave off | An event trigger that enables RLS on new tables. Harmless, and redundant: **every migration here already does `enable` *and* `force` row level security** explicitly, which is the stronger form |

**These are changeable after creation** — open the **Data API integration overview** in the
dashboard and turn *Enable Data API* off; Supabase's own documentation confirms an existing
project can do this, and that once it is off *none* of the generated REST endpoints respond
regardless of grants or RLS. **There is no need to delete and recreate a project over this.** The
*Advanced Configuration* block below them — Postgres type, and the region — is the part that
genuinely cannot change afterwards. `db:*:verify` reports what the `anon`/`authenticated`
roles have actually been granted either way.

⚠️ **The region dropdown collapses to just "Europe" and defaults to `eu-west-1` (Ireland), not
Frankfurt.** Both are EU and equivalent for POPIA; the Frankfurt preference was only ever
"nearest of the seventeen", and the difference from South Africa is tens of milliseconds on an
application used once a month. Not worth recreating a project over — but **check the second
project matches the first**, because the region cannot be changed afterwards.

## ⚠️ Migrations become append-only the moment step 7 succeeds

Editing an already-applied migration in place has been fine so far — two were edited that way
before any of this existed. **That stops here.** The Supabase CLI tracks a migration by its version
prefix, never its content, so an edited file is silently never re-run: the database keeps the old
shape, the repository shows the new one, and nothing reports a difference until some unrelated
later migration fails on a column that plainly does exist in the file you are reading.

This is not hypothetical. Found while writing this document, 2026-09-08: the local dev cluster
still had the `audit_log` table that `0009` used to create, with `0009` recorded as applied, so
`0014` failed on `relation "command_journal" does not exist`. Neither `db:check` nor `api:check`
could see it — they build a throwaway cluster from scratch on every run, where every file is
applied for the first time and the drift cannot exist. Locally the repair was one command
(`npm run db:dev:reset`, which wipes and rebuilds). **Against `call-roster-prod` there is no
equivalent.** New file, next number, always.

## Which connection string, and why it is not the direct one

Supabase offers three, and the difference is not a performance preference:

| | Host | Port | Network | Session state |
|---|---|---|---|---|
| Direct | `db.<ref>.supabase.co` | 5432 | **IPv6 only** without the paid IPv4 add-on | Full |
| **Session pooler** | `aws-N-<region>.pooler.supabase.com` | **5432** | **IPv4 on every plan** | Full |
| Transaction pooler | `aws-N-<region>.pooler.supabase.com` | 6543 | IPv4 on every plan | **None between queries** |

- **The direct connection cannot be reached from this machine.** Measured 2026-09-08: no `AAAA`
  record resolves, `ipv6.google.com:443` is unreachable, and no interface holds a global IPv6
  address. This network is IPv4-only, so `db.<ref>.supabase.co` would simply time out. The IPv4
  add-on costs money and, per Supabase's own documentation, *swaps* the `AAAA` record for an `A`
  record rather than serving both.
- **The transaction pooler is the wrong shape for this application.** Every query in
  [`db.ts`](../../lib/server/db.ts) opens with `SET LOCAL ROLE app_user` and
  `set_config('app.tenant_id', …, true)`, which is what makes row-level security bind at all.
  Both are transaction-scoped, so transaction mode is not *known* to break them — but it also
  drops prepared statements and every other piece of session state, and there is no reason to
  accept that risk for a once-a-month application with a handful of connections. Session mode is
  identical to a direct connection in every way that matters here, over IPv4.

`db:*:verify` refuses a `:6543` connection string for exactly this reason, rather than
letting it half-work.

## What `db:*:verify` checks, and why each one

The point is that *"the migrations applied cleanly"* is not evidence the app will work. Locally
the app connects as a real superuser that owns the entire cluster; Supabase's `postgres` is not a
superuser. The checks are the places that difference can bite:

- **The TLS certificate is genuinely verified**, against the CA from step 5 — not
  `rejectUnauthorized: false`. See step 5 for why that distinction is not pedantry here.
- **The connection is session-mode.** A `:6543` transaction-pooler string is refused rather than
  allowed to half-work.

- **`SET LOCAL ROLE app_user` is permitted.** The single most important one. Every transaction in
  `lib/server/db.ts` starts with it, `app_user` is created by migration 0001 with `NOLOGIN`, and
  switching to it requires the login role to be a member. Locally that is free — a superuser can
  become anything — so the local gates prove nothing about it. If this fails, **no route works at
  all**, and it fails at request time rather than at migration time. The fix it prints is
  `GRANT app_user TO postgres;`.
- **`app_user` is neither `SUPERUSER` nor `BYPASSRLS`.** Either would make RLS decorative, and RLS
  is the enforcement boundary (ADR-0007), not care at the call site.
- **RLS is `ENABLE`d *and* `FORCE`d on every table.** `FORCE` is the half that matters on a managed
  host: without it the table owner silently bypasses every policy it wrote.
- **Tenant isolation holds, live.** Inserts a practice, confirms it is visible under its own tenant
  context and invisible under another, then rolls back. Reading the policies is not the same as
  running them.
- **`btree_gist` is installed**, and which schema it landed in — every GiST exclusion constraint in
  this schema, including the one that makes double-booking impossible, depends on it.
- **Every migration on disk is recorded** in `supabase_migrations.schema_migrations`.
- **PostgREST exposure**, reported rather than failed: Supabase grants its `anon`/`authenticated`
  roles default privileges in `public`, so tables created there can be reachable over the
  project's public REST endpoint. RLS should still deny every row — no `app.tenant_id` is ever set
  on such a request and the policies fail closed — but nothing in this product uses PostgREST, and
  these tables will hold thirteen identifiable people's movements. **Revoking those grants is
  follow-up work**, deliberately not done blind before seeing what the check reports.

## ✅ What the first real run found — 2026-09-08

Both projects are up, migrated to `0017` and passing all seven checks. Recorded because **the two
failures below are exactly the ones the local gates cannot see**, and anyone rebuilding this from
scratch will hit them again.

All sixteen migrations applied cleanly to `call-roster-prod` — and the application still could not
have run:

1. **`SET LOCAL ROLE app_user` was refused**: *"permission denied to set role app_user"*. Every
   transaction in [`db.ts`](../../lib/server/db.ts) opens with it, so every route would have
   500'd, at request time, against a database that looked perfectly healthy. The cause is a
   PostgreSQL 16+ rule rather than a Supabase quirk: a non-superuser with `CREATEROLE` that
   creates a role gets `ADMIN` on it (may grant it away) but not `SET` (may not become it).
   Locally the connecting role is a superuser, which can always `SET ROLE` — so the gap is
   structurally invisible to `db:check` and `api:check`.
2. **`anon` and `authenticated` held grants on all 28 tables**, from Supabase's default privileges
   in `public` — even with the Data API off.

Both are fixed by [`0017_managed_host_roles.sql`](../../supabase/migrations/0017_managed_host_roles.sql),
which grants the membership `WITH SET TRUE` and revokes the two PostgREST roles (including the
default privileges, so the *next* table does not re-inherit them). `service_role` is deliberately
left alone — it is reachable only with a secret key that never leaves the dashboard.

Also worth knowing: both projects run **PostgreSQL 17.6**, which matches what this schema targets
(17, not 18 — see the [ADR-0008 addendum](../architecture/decisions/0008-temporal-validity-intervals.md)).
Prod is `x86_64`, the tester `aarch64`; nothing here depends on that, but it is a reminder the two
are not identical machines.

**Project refs, passwords and connection strings live in `.env.local` and `private/` only.** They
are not secrets in the way a password is, but naming the project that holds thirteen identifiable
people's movements is free information disclosure in a public repository. `npm run publish:check`
covers `private/`; the `.env*` rule covers the rest.

## Still to do after this, and not part of it

- **The keep-alive ping**, and where it runs from. Without it both projects pause every 7 days.
  This is now the only thing standing between a working setup and finding it paused next month.
- **Point the Supabase↔GitHub connection at the repository**, once Track B1 has created it. The
  GitHub account is connected but not aimed at a repo, which is the right order.
- **Seed `call-roster-tester` with synthetic data only**, never the real practice's history.
- **Point `app_current_tenant_id()` at `auth.jwt()`** if and when Supabase Auth is adopted —
  migration 0001 is written so that is a one-function change, not a schema migration.

## Sources

- [Connect to your database — Supabase Docs](https://supabase.com/docs/guides/database/connecting-to-postgres)
  — the three connection modes, their hostnames and ports, and which are IPv4-compatible.
- [Dedicated IPv4 Address — Supabase Docs](https://supabase.com/docs/guides/platform/ipv4-address)
  — the add-on, and that it replaces the `AAAA` record rather than adding an `A` record.
- [Project Pausing — Supabase Docs](https://supabase.com/docs/guides/platform/free-project-pausing)
  — the 7-day inactivity threshold and the 1-year restore window.
- [Supabase Pricing](https://supabase.com/pricing) — the 2-active-projects-per-organization limit
  on the Free plan.
- [Available regions — Supabase Docs](https://supabase.com/docs/guides/platform/regions) — the 17
  AWS regions Supabase supports; no `af-south-1`.
- [GitHub discussion #34614](https://github.com/orgs/supabase/discussions/34614) — the standing,
  unanswered request for a South Africa region.
