# Decisions journal

A dated running narrative of decisions and hurdles as they happen. **Distinct from the ADRs** in
[`architecture/decisions/`](architecture/decisions/): those are formal, one per hard-to-reverse
architectural choice. This is the log — including the things that turned out to be wrong, which are
often the more useful entries.

Newest first.

> **Entry format, adopted 2026-09-02.** Terse. Keep the **lesson**, the **reversal**, and facts that
> exist nowhere else; drop anything a durable document already records — constraint verdicts live in
> [`domain/constraints.md`](domain/constraints.md), architectural reasoning in the ADRs, machine and
> toolchain facts in [`../AGENTS.md`](../AGENTS.md). Reasoning is kept in full **only** where a
> decision reverses an earlier one, because those are what get re-litigated. Entries before this date
> were compressed to this standard in one pass; nothing was dropped that is not held elsewhere.

---

## 2026-09-08 (session five) — Track B7 tooling, and an edited migration that had already drifted

Preparing the Supabase click-through into something checkable. Two findings, both from measuring
rather than reading.

**Reversal — the connection string in the first draft of `ops/supabase-setup.md` was wrong.** It
said "use the direct connection (port 5432), not the pooled one", on the reasoning that the pooler
was unverified against `SET LOCAL ROLE`. But Supabase's direct connection is **IPv6-only** without
the paid IPv4 add-on, and this machine is IPv4-only — measured 2026-09-08: no `AAAA` resolution,
`ipv6.google.com:443` unreachable, no global IPv6 address on any interface. It would simply have
timed out. Corrected to the **session pooler** (`aws-N-<region>.pooler.supabase.com:5432`), which
is IPv4 on every plan and keeps full session state, so it is a direct connection in every way that
matters here. The **transaction** pooler (`:6543`) is a separate thing and is refused by
`db:remote:verify`: `SET LOCAL` is transaction-scoped so it is not *known* to break `withTenant`,
but it drops all other session state for no benefit at this scale.

**⚠️ The bigger find: an edited migration had silently diverged a database, and no gate could see
it.** `0009` originally created `audit_log` and was later edited in place to create
`command_journal` — legitimate under the pre-release "edit migrations in place" precedent. But the
persistent local dev cluster had already run the old version, and **the Supabase CLI tracks a
migration by its version prefix, never its content**, so `0009` stayed marked applied and was never
re-run. `0014` then failed on `relation "command_journal" does not exist` — a relation that plainly
does exist in the file. `db:check` and `api:check` are blind to this by construction: they build a
throwaway cluster from scratch every run, where every file is applied for the first time. Repaired
with `db:dev:reset` (the cluster held schema and zero rows; checked before wiping).

**So the precedent expires now.** Once `call-roster-prod` exists there is no `reset`, and the same
drift would be a manual repair against a live database of real people's movements. **Migrations are
append-only from the moment step 6 of the runbook succeeds** — recorded in
`.claude/rules/migrations.md` (path-scoped, so it costs nothing until a migration is touched)
rather than as another paragraph in an already-over-ceiling `AGENTS.md`. Nothing detects an edited
migration; the rule is the whole defence.

**Built:** `scripts/db-remote.ts` (`db:remote:migrate` / `db:remote:verify`) — the remote sibling of
`db-dev.ts`. `verify` writes nothing (its one `insert` runs in a transaction that always rolls
back), so it is safe against production. It checks the things a local gate structurally cannot: that
**`SET LOCAL ROLE app_user` is permitted at all** — locally the login role is a superuser and can
become anything, so every existing gate proves nothing about it, while on Supabase `postgres` is not
a superuser and a refusal there breaks every route at request time — plus `FORCE` RLS on every
table, live tenant isolation, `btree_gist`, migration completeness, and a report of what Supabase's
`anon`/`authenticated` roles have been granted in `public`. That last is reported, not failed:
revoking blind before seeing a real project would be guessing.

**Housekeeping, moved here out of `HANDOFF.md` to keep it under its ceiling:** `AGENTS.md` is 242
lines against its own 220 ceiling. Pre-existing and left alone deliberately — trimming the
standing-instructions file is the owner's call, not something to do quietly mid-task.

### Same day, once `call-roster-prod` actually existed — three more measurements

**The direct connection was confirmed dead, not merely suspected.** TCP to
`db.<ref>.supabase.co:5432` times out from here after 6s; both shared pooler hosts connect
immediately. Note the direct host *does* publish `A` records — but they are Cloudflare wildcard
addresses that do not serve Postgres, so "it resolves" is not "it connects". Only the `AAAA` is
the real AWS endpoint.

**The pooler host is not guessable and the region was not what the runbook assumed.** Found by
probing: Supavisor resolves the tenant *before* authenticating, so `Tenant or user not found` and
`password authentication failed` are different errors and only the first rules a host out — which
identifies the right endpoint with a deliberately wrong password and no secret in play. It came
back `aws-1-eu-west-1`: **`N` is not always `0`, and the region dropdown collapses to "Europe" and
defaults to Ireland, not Frankfurt.** Left alone — both are EU for POPIA, the Frankfurt preference
was only "nearest of seventeen", and the difference is tens of milliseconds monthly. Region cannot
be changed after creation, so the second project must be checked to match.

**⚠️ Supabase signs its Postgres endpoints with its own CA.** Every `aws-N-eu-*` pooler host fails
Node's default trust store with *"self-signed certificate in certificate chain"*. The universal
internet answer is `rejectUnauthorized: false` — encrypted but **unauthenticated**, which on this
link is a man-in-the-middle away from plaintext. Rejected. `db-remote.ts` instead requires the CA
downloaded per project (Project Settings → Database → SSL Configuration), verifies against it, and
**refuses to run without one**; `--insecure` exists but announces itself. `*.crt` added to
`.gitignore` and `.ignore`. Proven end to end: with `--insecure` and a junk password the script
reaches `password authentication failed`, so everything up to auth works.

**The create-project dialog's Security defaults are wrong for this product** — *Enable Data API*
and *Automatically expose new tables* are both on by default, publishing a PostgREST API over the
whole `public` schema. Nothing here uses PostgREST (`lib/server/db.ts` is a direct `pg` pool; no
`supabase-js` anywhere), so both go off. Changeable after creation (dashboard → Data API
integration overview), unlike region and Postgres type — **no need to recreate a project over
it**, which is worth stating because a project was recreated that evening and its ref vanished
from DNS mid-session, which is how the staleness was detected at all.

### ✅ Tracks B1 and (most of) B3 — the repository is public

[ReubenMiddleton/call-roster](https://github.com/ReubenMiddleton/call-roster), public, two commits,
CI green on `main`. CodeQL default setup (actions, javascript, javascript-typescript, python,
typescript), secret scanning, push protection and Dependabot security updates all enabled via the
API. **Owner-only remainder**: the Claude GitHub App install and the `CLAUDE_CODE_OAUTH_TOKEN`
secret — both need a browser OAuth flow, and without them `claude-review.yml` and
`claude-ci-watch.yml` cannot run. `secret_scanning_non_provider_patterns` and
`..._validity_checks` refuse to enable via the API and are left off.

**`publish:check` and git disagreed by 8 files at `git init`, and chasing it found a real bug.**
The script counted 266 publishable files against git's 258; the whole difference was
`solver/.ruff_cache/`. `.gitignore` writes `.ruff_cache/` unanchored, which git matches at every
level, but the script listed it only as a top-level directory name. Over-reporting is the safe
direction — which is exactly why it would never have been noticed. Fixed by matching the tool
caches at any depth; the two now agree **exactly**, which is a far stronger guarantee than either
number alone. Same pass: `.crt` added to the suspicious-extension list (`.pem`, `.key` and `.p12`
were already there and a `.crt` is the same family), the Supabase CA excluded by name, and a new
assertion that `.gitignore` still carries the `*.crt` rule — the same two-independent-statements
design the directories already had.

**CI failed on the repository's first ever run**, on `astral-sh/setup-uv@v10`: that action
publishes **no moving major-version tag** — `git/ref/tags/v10` is a 404, while `v10.0.0` and
`v10.0.1` exist. The job died before executing a line. Pinned exactly and commented, because the
obvious "tidy-up" is to shorten it back. The other four actions in these workflows (`checkout@v7`,
`setup-node@v7`, `gitleaks-action@v3`, `claude-code-action@v1`) do publish major tags, which is
what made the one exception easy to miss.

⚠️ **Dependabot opened six PRs immediately, and two of them are a pair**: `@vitest/coverage-v8`
and `vitest` both to 5.0.0. Merging either alone is a peer mismatch, and #3's CI already fails on
install proving it.

### ✅ Track B7 done — and `0017`, the migration only a managed host could have asked for

Both projects up on **PostgreSQL 17.6**, migrated and passing all seven checks. The whole case for
building `db-remote.ts` rather than trusting a clean migration is in what happened next: **all
sixteen migrations applied perfectly to `call-roster-prod`, and the application still could not
have run.**

**`SET LOCAL ROLE app_user` was refused** — *"permission denied to set role app_user"*. Every
transaction in `db.ts` opens with it, so every route would have 500'd **at request time**, against
a database that looked entirely healthy. The cause is a PostgreSQL 16+ rule, not a Supabase quirk:
a non-superuser with `CREATEROLE` that creates a role receives `ADMIN` on it (may grant it away)
but not `SET` (may not become it). Locally the connecting role is a superuser, which can always
`SET ROLE` — so **`db:check` and `api:check` are structurally incapable of catching this**, and
would have stayed green forever. Second finding, same run: `anon` and `authenticated` held grants
on all 28 tables from Supabase's default privileges in `public`.

`0017_managed_host_roles.sql` fixes both — `grant app_user to current_user with set true` (the
`WITH SET TRUE` is the operative clause; a plain re-grant need not add `SET` to an existing
admin-only membership), and a guarded revoke of the two PostgREST roles including their *default*
privileges so the next table does not re-inherit. `service_role` left alone: reachable only with a
secret key that never leaves the dashboard. **The first migration written under the new
append-only rule, one session after that rule was adopted.**

**Immediately after, a self-inflicted footgun removed.** Wiring both projects into `.env.local`
meant `DATABASE_URL` pointed at **production** — and Next.js loads that file automatically, so
`npm run dev` would have talked to the real database. Exposure was nil at the time (prod empty,
`app/` three scaffold files) and would have been severe the day the editor shipped: harmless while
you are looking at it, dangerous once you have stopped. Fixed by removing the default rather than
choosing a safer one — **`.env.local` no longer sets a bare `DATABASE_URL` at all**, so the app
falls through to the local cluster; the two projects live under `DATABASE_URL_PROD` and
`DATABASE_URL_TESTER`, read only by `db-remote.ts`, which now **requires** `--prod`, `--tester` or
`--url` and has no default target. `db:remote:*` became `db:prod:*` / `db:tester:*` so the command
names the database. Earlier entries here still say `db:remote:*`; that is what they were called on
the day, and this journal is not rewritten.

Two smaller facts kept because they cost time: the dashboard showed **no pooler section at all**
for these projects — only the project URL, a publishable key and the direct string — so the host
was recovered by probing (tenant resolution happens before authentication, so a wrong password
distinguishes the right endpoint from the wrong one). And `migrate` **failed once at "Connecting
to remote database" and succeeded on the immediate retry**; the shared pooler is occasionally
flaky, and a failure naming no SQL object means retry, not diagnose.

## 2026-09-08 (session five) — L3 solve-run diagnostics: the surface, not the pipeline

Started expecting to build a diagnostic surface on top of a working solve pipeline. There isn't
one — grepped `app/` and `lib/server/` for `solve_run` first, per this session's own established
habit of checking before building: zero matches. No `GenerateDraft` route, no worker, nothing
claiming rows with `FOR UPDATE SKIP LOCKED`. "The solver ships last" (AGENTS.md) is not a
suggestion; it means exactly this does not exist yet.

**Reset scope before writing anything**, to what's honestly buildable without inventing a
pipeline: enrich `solve_run`'s schema with the L3 fields (`0016_solve_run_diagnostics.sql` —
request hash, full pre-flight result, model snapshot, CP-SAT version, `num_workers`), have the
solver actually compute all of them, and prove the schema holds real data using the one place a
genuine solve already happens end to end — `scripts/check-solver-e2e.ts`. Most of the Python-side
work already existed in some form: `PreflightResult`, `PenaltyRegistry.violations()`, and
`BuiltModel.canonical_text()` (the model snapshot, already used for snapshot testing) were all
sitting there unexposed. Only `request_hash` and `cp_sat_version`/`num_workers` needed writing
from scratch.

**One RLS bug repeated and then fixed by reading a comment already written for it.** Inserting a
fresh `practice` row via `withAppUser` with `INSERT ... RETURNING id` failed —
`app/api/practices/route.ts` had already hit and documented this exact failure: `practice`'s
SELECT policy is `id = app_current_tenant_id()`, and Postgres RLS requires `RETURNING` to satisfy
it too, which nothing can before the row exists to become the tenant context. The fix already
existed in the codebase, as a comment: generate the id client-side, insert without `RETURNING`,
then adopt it as the tenant context. Should have grepped for the pattern before hitting the wall.

**A genuinely bigger gap surfaced while grounding this in the docs, named rather than folded in:
the formal solver response contract (`docs/architecture/solver-contract.md` — `contractVersion`,
`solveRunId`, nested `objective`, `relaxationOptions`, `unfilledSlots`, `ledgerAfter`) has never
actually been implemented.** What exists and is exercised is a different debug shape — the CLI's
`--json` output, consumed only by `check-solver-e2e.ts` — with a flat `objective`, no
`contractVersion`/`solveRunId`, and extra fields the contract doesn't mention. Not fixed here:
building the real response-assembly function is the natural companion to `GenerateDraft`, and both
are separate, real work — flagged in `solver-contract.md` itself and in `docs/architecture/api.md`,
not left for whoever eventually builds `GenerateDraft` to discover on their own.

`solver:check`/`solver:e2e` still green (152 Python tests unaffected; the e2e now also persists and
reads back one real `solve_run` row). `check`, `db:check`, `api:check` unaffected and still green.

---

## 2026-09-08 (session four) — Provenance stops being inert, and a stale confidence tag gets fixed

*"Inert until the product records it"* was the exact phrase in `HANDOFF.md` and
`docs/NEEDS_YOUR_INPUT.md` for months. The field existed — `shift_assignment.provenance`, and
`POST assignments` had already accepted an explicit value since the assignment schema landed — but
nothing had ever proven, end to end, that setting it actually changed the fairness arithmetic
through the real API, and one real code path silently ignored it altogether.

**The actual bug: `ApproveSwap` hard-coded `provenance = 'directed'`** on every reassignment,
regardless of why the swap was happening. A doctor asking a colleague to cover for them — the
textbook `requested` case docs/domain/fairness.md exists to separate out — got silently priced as
scheduler-directed. Fixed by capturing `provenance` on `RequestSwap` instead of inventing it at
approval time: the requester already states `reason` as free text, and is the one who actually
knows why, so `ApproveSwap` now reads `swap_request.provenance` back
(`0015_swap_request_provenance.sql`) rather than assuming.

**The higher-value proof wasn't the swap fix, it was showing the arithmetic actually works.**
`lib/analytics/ledger.ts` already excludes `requested` burden from equalisation correctly — that's
been unit-tested for a while. What had never been checked was whether a `provenance` value set
through the real API on a real assignment actually survives the round trip through
`recalculateLedger` and comes out the other side excluded. It does: a fresh `requested` assignment
increases raw `burden` by exactly its weight while leaving `equalisableBurden` untouched, proven in
`api:check` against real ledger output, not asserted against the pure function in isolation.

**A second, unrelated thing surfaced while grounding this in the docs: `docs/domain/fairness.md`'s
provenance section still said `[PROPOSED]`, not yet confirmed by the practice — but
`docs/product/glossary.md` (the canonical vocabulary source) and `lib/analytics/types.ts` both
already said `[CONFIRMED]` 31 August 2026, question R.** Not a new confirmation and not a tag
promoted on my own authority — glossary.md already carried the human source; fairness.md had simply
never been updated after it landed elsewhere. Fixed, citing the glossary. Left `ADR-0012`'s own
"provenance split is inert" caveat untouched — an ADR records a decision at a date, not a live
schema, the same reason `fte` still appears in `ADR-0008`.

`api:check` grew from 58 to 60 assertions. `check`, `db:check`, `api:check` all green.

---

## 2026-09-08 (session three) — L2 error records: one integration point, not a route-by-route scan

Started on ADR-0013's fourth layer. The design (`docs/ops/diagnostics.md`) names both a server
half (`instrumentation.ts`'s `onRequestError`) and a client half (error boundary, `window.onerror`,
`unhandledrejection`) — the client half stayed out of scope for the same reason L5's UI did: there
is no real client yet to attach it to (`app/` is still a scaffold).

**The scoping question that mattered: which of 33 `toErrorResponse(...)` call sites actually need
touching.** Not all of them — `toErrorResponse` already classifies every error into named branches
(an `ApiError`, four recognised SQLSTATEs), and every one of those is already an intentional,
expected outcome, exactly what L1's `journalRefusal` already covers with `outcome: 'refused'`. Only
the *fallback* branch — something genuinely unanticipated — is L2's job. So the fix was one line in
one shared function, not an audit of every route.

**That one line needed `toErrorResponse` to become `async`** (recording is a database write), which
looked like a 33-call-site migration until checking: every call site already does
`return toErrorResponse(error)` from inside an `async` route handler, so a `Promise<Response>`
return value needed no `await` added anywhere. Verified with a grep across `app/` before relying on
this, not assumed — the kind of check that's cheap to run and expensive to skip.

**`onRequestError` (`instrumentation.ts`) is real, and honestly likely to rarely fire.** Every route
handler already wraps its whole body in `try`/`catch`, so nothing currently escapes to Next's own
uncaught-error path. Built anyway, as documented defense in depth — a route that someday forgets
the pattern, or a genuine framework-level crash, is exactly what a component-level boundary can't
catch, and the cost of having it is one small file.

**`error_record.tenant_id` is nullable — the first table in this schema where that's true.** An
error can happen before tenant context exists (malformed input to `POST /api/practices`, a
framework-level failure). RLS still isolates by tenant when one is known; a null-tenant row is
invisible to every `app_user` context by construction, not merely unrecorded — proven in
`db:check`, including that `app_user` itself (not just the superuser) can insert one via `with
check (true)`, the same posture `practice`'s pre-tenant insert policy established first.

**One more real tension named rather than glossed: exception messages and stack traces are
genuinely free text**, outside L0's structural guarantee. That guarantee works for `command_journal`
because its payload shape is entity references the application controls; a caught exception says
whatever it happened to say. Checked (not assumed) that no throw site in this codebase interpolates
a display name into a message today — a discipline to maintain, not a guarantee the schema enforces.

Proven end to end, not just unit-level: a real `22P02` (invalid UUID syntax) triggered through the
actual `publish` route produces a correlated `error_record` row, read back and asserted against in
`api:check` — not a synthetic hook added only for the test. `api:check` grew from 57 to 58
assertions; `db:check` grew by one covering immutability, the missing `app_user` DELETE grant, and
the null-tenant RLS boundary. `check`, `db:check`, `api:check` all green.

---

## 2026-09-08 (session two, cont.) — Refused and failed commands are journaled too

Closed the gap logged a few hours earlier: *"only the `applied` outcome is journaled."*

**The real problem wasn't which routes to touch, it was where the write could actually survive.**
Every refusal happens by throwing inside the same `withTenant` transaction as the attempted
mutation — and `withTenant` rolls back the *entire* transaction on any thrown error, unconditionally.
A `writeCommandJournal` call made right before the `throw` would roll back along with everything
else; there is no way to keep a journal row from a transaction that ends in rollback. So the
refusal write has to happen **after** that transaction has already unwound, in its own transaction
— which is also exactly the shape `tryRecalculateLedger` already established for "run something
that must not affect the outer result." `journalRefusal` (`lib/server/command-journal.ts`) is that
shape applied to the opposite problem: not "don't let a side-effect's failure break success," but
"don't let recording a failure make it worse."

**One classifier, not seven ad-hoc ones.** `classifyOutcome` turns whatever a route's `catch`
block caught into `refused`, `failed`, or "don't journal this" — an `ApiError` (excluding 404, no
entity to attribute the attempt to) or a domain-constraint SQLSTATE (`23P01` exclusion, `23514`
H-03) is `refused`, reusing the `ApiError`'s own message as `reason` rather than re-deriving one;
an unanticipated SQLSTATE or exception is `failed`; a `ZodError` (malformed input) is skipped —
not an intent against a real entity. Same classifier, same helper, called identically from all
seven routes' `catch` blocks — the per-route work was capturing `tenantId`/`actorId`/`rosterId`
into a hoisted, catch-visible variable (a `const` inside `try` isn't visible in `catch`), not
reasoning about outcomes seven separate times.

**Proven against real refusals, not a synthetic one.** `api:check`'s existing H-03, no-op and
wrong-status-conflict test steps now double as journal-content assertions — the journal shows the
real reason strings those refusals already produced, not a placeholder. Also added: two 404s add
nothing to the journal, confirmed by count, not assumed.

`api:check` grew from 56 to 57 assertions. `check`, `db:check`, `api:check` all green.

---

## 2026-09-08 (session two) — Diagnostics L0/L1/L5: `audit_log` becomes the command journal

Started on ADR-0013's design (`docs/ops/diagnostics.md`) — the layer never built despite being
written up months before the pilot, on purpose ("diagnostics added after a fault are diagnostics
that missed it"). Scoped to the three layers actually askable of a database with no real client
yet: L0 (redaction), L1 (the command journal), and L5's server-side half (the bundle assembly).

**The load-bearing decision: `audit_log` and the L1 command journal are the same table, not two.**
The design doc says so explicitly — *"Do not build a second one"* — and `audit_log` was already
live across seven mutation routes. Rewrote `0009_audit_log.sql` in place into
`0009_command_journal.sql` (same precedent as `burden_weight`: no real Supabase project has ever
applied it), added every field the design lists, and mechanically re-pointed all seven call sites.
`db:check`'s append-only test and all 54 pre-existing `api:check` assertions passed unchanged
after the rename — the kind of boring result that means the mechanical part was actually
mechanical.

**A real tension, resolved rather than glossed over**: L0 says "no free text in a diagnostic
record"; L1 says it doubles as the ECTA s15(4) audit trail, which compliance.md requires to carry
a *reason*. Three existing call sites (`UnpublishRoster`, `ApproveSwap`, `RejectSwap`) already put
genuine free text there. Resolution: `reason` stays, as the one explicit, allowlisted exception —
product-supplied administrative text about the scheduler's own decision, not diagnostic telemetry,
and nowhere else durably stored for `UnpublishRoster`'s case specifically. Documented in the
migration's own column comment and in the new gate script, not left for someone to wonder about.

**The gate step earns its place by having actually caught something.** `scripts/check-diagnostics-safety.ts`
(`npm run diagnostics:check`, now in `npm run check`) fails on a free-text column beyond the
allowlist and on a `writeCommandJournal(...)` call passing a display-name-shaped key. Verified, not
just written: injected `doctorName: 'test'` into a real call site, confirmed the gate caught it,
reverted. `names:check` already covers the third thing the design doc names (a real surname in
diagnostics fixtures), so it wasn't duplicated.

**One real bug the full gate caught that a narrower check wouldn't have**: `lib/server/build-info.ts`
first resolved paths from `import.meta.dirname`, which came back `undefined` during Next's
Turbopack config-collection step and failed `npm run build` outright — not a lint or type error,
only visible by actually building. Switched to `process.cwd()`, matching the gate script's own
approach. A reminder that `npm run check`'s `build` step is pulling its own weight, not padding.

**Two gaps named, not hidden**: only the `applied` outcome is journaled — a refused/failed command
writes no row, so "why didn't my swap go through" isn't yet answerable from the journal alone.
And the L5 bundle omits view state (no client exists) and recent errors (L2 isn't built), saying so
in its own `notIncluded` field rather than silently thinning the response. `docs/ops/diagnostics.md`'s
checklist reflects exactly this — no box checked that isn't actually done.

`api:check` grew from 54 to 56 assertions. `check`, `db:check`, `api:check` all green.

---

## 2026-09-08 (post-final, cont.) — Ledger recalculation is automatic now, and never blocking

The other half of last session's "Also not automatic" gap, closed while Track B7 waits on the
owner. `docs/architecture/api.md` had explicitly flagged this as "a real design question, not
decided here" rather than silently punting it — so the actual work this time was answering that
question, not just wiring a function call.

**The design question was whether a full tenant-wide rebuild belongs on every publish/swap, or
should stay manual.** Settled by two observations, not a guess: `buildLedger`/`entitlementWeights`
are inherently period-wide and opportunity-set-based, so there is no cheaper "incremental" version
that stays correct — any trigger has to call the same full rebuild `recalculateLedger` already is.
And at this practice's scale (thousands of assignments across years, not millions), a full rebuild
on a monthly publish or an occasional swap is cheap enough that the question answers itself once
the "incremental" alternative is off the table.

**The part that actually needed care: `recalculateLedger` throws (400 with no schedule configured,
409 spanning schedule versions) — and "warn and scar, never block" (AGENTS.md) means neither can be
allowed to fail an already-committed publish or swap.** New `lib/server/ledger-refresh.ts`'s
`tryRecalculateLedger` runs the recalculation in its own transaction, *after* the publish/swap's own
transaction has committed, and turns any failure (including a genuinely unexpected one, logged
server-side) into a reported outcome on the response instead of an error. A tenant with no burden
schedule configured yet can still publish rosters and approve swaps — it just gets told, in the
`ledger` field of the response, that nothing was priced and why.

Wired into both `PublishRoster` and `ApproveSwap` — the two events
`docs/domain/commands-events.md`'s policy table names. `api:check` grew from 51 to 54 assertions:
the skipped-recalculation path (no schedule yet) on both endpoints, and the auto-recalculated path
once a schedule exists, checked against the persisted `burden_credit` rows it produces.

---

## 2026-09-08 (post-final) — Track B7 staged: researched, documented, not created

"Start on Track B7" ran into the same boundary as B1, B3 and B6 always have: **creating the two
Supabase projects is account creation**, and that is the owner's action, not something to do on his
behalf. So the actual scope here was everything *around* that one step — narrow it to a five-minute
click-through with nothing left to decide, verify the two things question 8 had flagged but not
answered, and leave the account creation itself untouched.

**Verified against Supabase's own docs and pricing page, not last month's research:** a Free-plan
project pauses after **7 days** of too-little activity (data and 1-year restore survive the pause);
the Free plan allows **2 active projects per organization**, exactly what the plan needs; and of the
17 AWS regions Supabase supports, **`eu-central-1` (Frankfurt)** is the one closest to South Africa
— a South African commenter on the still-open [region request](https://github.com/orgs/supabase/discussions/34614)
names it independently. All three write down what `environments.md` and question 8 had left as
"verify before relying on it." One real consequence: **a monthly solve cannot keep a project awake**
— 7 days is far short of a month — so the keep-alive ping question 8 already anticipated is now
confirmed necessary, not hypothetical. Logged as follow-up, not built (it needs a live project and
somewhere to run from).

New: [`docs/ops/supabase-setup.md`](ops/supabase-setup.md), the exact steps for the owner.
`environments.md`'s "open Postgres-host question" line was stale — decided 26 August, now says so.

**One false start worth recording:** first pass added a committed `.env.example` template. Wrong —
`check-publish-safety.ts` refuses to publish anything starting with `.env`, unconditionally, as a
deliberate secrets backstop, and special-casing an allowlist into a security check to make a
convenience file pass is exactly the kind of check-weakening `AGENTS.md` rules out. Removed; the one
env var the app reads today (`DATABASE_URL`) is documented inline in `supabase-setup.md` instead.

---

## 2026-09-08 (final) — `burden_weight` redesigned: the ledger stops hard-coding one tenant

Closes the gap logged a few hours earlier. `burden_schedule` + `burden_rule`
(migration `0013_burden_schedule.sql`) replace the old `burden_weight` table — removed from
`0005_fairness.sql` directly rather than dropped in a later migration, since nothing had ever
read or written it (checked before deleting it) and there is still no real Supabase project for
the distinction between "edit an old migration" and "add a new one" to matter yet.

**The new tables hold an ordered rule list, matching `BurdenMatch`/`BurdenRule` in
`lib/analytics/burden-types.ts` exactly** — `dayClass`, `shiftKind`, `patternId`, `specialDate`,
`weekday`, `fromHour`, each nullable and each meaning "not part of this rule's match" when null,
same as the TypeScript optional fields they mirror. `POST .../burden-schedules` validates
submitted rules with `validateBurdenSchedule` (the same function `resolveBurden` trusts) before
writing anything — a schedule with no catch-all, or a catch-all that isn't last, is rejected at
creation, not discovered mid-recalculation. Versioned properly: a GiST exclusion constraint stops
two versions overlapping for one tenant, and creating a new one closes whichever was open,
matching *"weight changes apply forward only."*

**`lib/server/ledger.ts` now reads the tenant's own schedule** instead of applying
`AGREED_BURDEN_V2` to everyone. One real limitation, named rather than hidden: if the assignments
being recalculated span more than one schedule version, recalculation refuses with a 409 instead
of guessing. `buildLedger`/`entitlementWeights` both take one schedule, not a per-date resolver,
and correctly merging across versions would mean changing those shared functions — real, separate
work, not something to get subtly wrong in the same change built specifically to stop the ledger
being subtly wrong. `resolveSingleSchedule` names the boundary explicitly.

`api:check` grew to 51 assertions, including the multi-version conflict path and a backdating
rejection. `check`, `solver:check`, `db:check`, `api:check` all green.

---

## 2026-09-08 (latest) — Notifications, ICS feeds and ledger recalculation: two finished, one honestly not

Three Distribution/Fairness pieces from `docs/domain/commands-events.md`, each landing at a
different point of completeness on purpose.

**Notifications**: the outbox pattern (`notification` table, migration 0012). `PublishRoster` and
`ApproveSwap` both enqueue real rows — every doctor with active membership on publish, both
doctors on a swap — but nothing sends them, because WhatsApp verification is deferred until after
the pilot (Track B6). Every row sits at `status: 'pending'` forever until a real sender exists.
This is the intended shape, not a stub: every call site that should notify already does, so wiring
delivery later is a new consumer of the table, not an audit of the codebase for the right place to
add it.

**ICS feeds**: fully working, no external dependency needed — `lib/server/ics.ts` builds a real
RFC 5545 `VCALENDAR`, `GET /api/ics/:token` serves it. The one genuinely hard part was RLS, not
the calendar format: the public feed endpoint has to resolve a bearer token to a tenant *before*
it has a tenant context, which plain RLS can't do (the table's own policy needs the very context
the lookup exists to produce). A bare superuser-connection bypass isn't a real fix either, since
production won't connect as a superuser at all. Solved with `resolve_ics_token`, a narrow
`SECURITY DEFINER` function — Supabase's own documented pattern for exactly this shape of
problem — verified directly against a running cluster before any route was written around it: a
bare `SELECT` as `app_user` with no context returns nothing, the function returns the row for a
valid token and nothing for an invalid one.

**Ledger recalculation**: real fairness arithmetic, reusing `lib/analytics/{ledger,burden,equity}.ts`
exactly as written rather than reimplementing burden logic in SQL — `buildLedger`,
`entitlementWeights` (`revealed-opportunity` basis), `computeLoadRatios` are the same functions
the solver and the seed-data reports use. `POST .../ledger/recalculate` rebuilds `burden_credit`
idempotently (delete-and-reinsert, since the table has no natural key to upsert against) and
returns both raw burden and load ratios.

**⚠️ One deliberate, load-bearing gap in the ledger, found while building it rather than assumed
away**: `recalculateLedger` prices every tenant with `AGREED_BURDEN_V2` — the pilot practice's own
agreed numbers, hard-coded. "Weights are data, versioned with a validity interval, never constants
in code" is the stated rule (`docs/domain/fairness.md`) and this breaks it. The schema's existing
`burden_weight` table can't hold a real schedule: burden prices by `dayClass × shiftKind ×
weekday × fromHour × specialDate` (`BurdenMatch`), and the current table only has
`(shift_kind, weight)` — "Friday from 17:00" and "Christmas night" are inexpressible in it.
Redesigning that table correctly is real, separate work; guessing at it while also shipping two
other features in the same session would have risked exactly the kind of silently-wrong fairness
number `fairness.md` calls the one bug class a ledger must never have. Logged rather than worked
around — `docs/architecture/api.md`.

`api:check` grew to 46 assertions. `check`, `solver:check`, `db:check`, `api:check` all green.

---

## 2026-09-08 (even later still) — Swaps close the loop the strict interim rule opened

Three endpoints implementing `RequestSwap`/`ApproveSwap`/`RejectSwap` exactly
(docs/domain/commands-events.md), scoped to the glossary's precise definition — "a transaction
moving an assignment between doctors after lock" — not a general reassignment or slot-move. New
migration: `swap_request` (0011), with a partial unique index enforcing at most one *pending*
request per assignment at the database level rather than an application check.

**Chose the `[CONFIRMED]` glossary term over the `[PROPOSED]` one.** `docs/product/lifecycle.md`
describes a `ChangeRequest` object for the pre-`LOCKED` review window, distinct from `Swap` in its
own telling, but that whole document is `[PROPOSED]` with three open questions (Y, Y2, Y3) the
owner hasn't answered. Built against `Swap` — settled vocabulary, a settled state-diagram command
— and left `ChangeRequest` as a named future refinement rather than guessing at an unconfirmed
design. Logged in [`architecture/api.md`](architecture/api.md) so the next session doesn't
re-litigate which term to build against.

**This is what makes yesterday's strict edit-block honest rather than a dead end.** Direct edits
to a non-`draft` roster are still refused outright, but `ApproveSwap` now provides the sanctioned
path the block was always meant to defer to: it updates `shift_assignment` (the exclusion
constraint and H-03 fire on `UPDATE` exactly as they do on `INSERT`, and a failed approve rolls
the whole transaction back — the swap request lands at `pending`, never half-applied) and
snapshots the result as the roster's next `roster_version`, chained onto whichever version came
before. `UnpublishRoster`'s diff, empty since it was built, now has something real to report the
day a swap changes a published roster before it's unpublished.

**Not built**: the notify/ICS-bump/ledger-recalculate parts of `ApproveSwap`'s full policy —
Distribution and Fairness infrastructure that doesn't exist yet, named explicitly in the docs
rather than left to be discovered missing.

`api:check` grew to 39 assertions. `check`, `solver:check`, `db:check`, `api:check` all green.

---

## 2026-09-08 (later) — The publish/lock lifecycle: four states, hash-chained versions, a deliberately strict interim rule

Four endpoints implementing `docs/domain/commands-events.md`'s state diagram exactly:
`publish` (`DRAFT→PUBLISHED`), `unpublish` (`→DRAFT`, with a diff), `close-review-window`
(`→LOCKED`), `archive` (`→ARCHIVED`, terminal) — one endpoint per named command rather than a
generic status PATCH, since each has different side effects (only publish writes a version).
Every lifecycle route locks the `roster` row (`select ... for update`) for the transaction, so two
concurrent calls can't both see the same precondition satisfied. Detail in
[`architecture/api.md`](architecture/api.md).

**A deliberate strictness beyond what the domain doc itself asks for**: `PUBLISHED` is supposed to
allow edits that create a new version, and `LOCKED` edits through a swap — neither versioned
editing nor swap transactions exist yet, so `assignments/route.ts` and
`rosters/:rosterId/slots/route.ts` now refuse to touch anything once a roster leaves `DRAFT`,
full stop. Allowing an edit that silently skipped version-bumping and the audit trail would be
worse than refusing it outright; the escape hatch is `UnpublishRoster` — back to draft, fix it,
republish. One direct consequence: `UnpublishRoster`'s diff (required by the domain doc so
"going backwards silently" never happens) will read empty until versioned editing exists, because
nothing can currently change between a publish and its unpublish. The comparison itself
(`lib/server/roster-diff.ts`) is real and correct; it simply has nothing to report yet.

**Actor attribution reuses the tenant-header pattern**: every lifecycle endpoint takes an optional
`actorId` instead of a session claim, same placeholder shape as `x-tenant-id`
(`lib/server/tenant-context.ts`). `lib/server/audit-log.ts` is now the one place every mutation's
audit entry gets written, and `lib/server/roster-detail.ts`/`roster-version.ts` factor out the
snapshot-building query so the roster-detail GET and the publish snapshot can never drift apart —
both existed as one inline query in `rosters/[rosterId]/route.ts` before this session.

`api:check` grew to 32 assertions, including the full state machine, hash-chain continuity across
two published versions, and every edit-guard rejection. `check`, `solver:check`, `db:check`,
`api:check` all green.

---

## 2026-09-08 — Shift patterns, slots and assignments; a fourth real bug, same shape as the other three

Seven more route handlers: `shift-patterns` (create/list, shifts bundled with their pattern),
`weekday-defaults` (upsert all seven at once — precedence level 4), `date-patterns` (upsert one
override — level 2), `rosters/:id` (the whole month's grid: every slot, its shift, whichever
doctor holds it), `rosters/:id/slots` (**generate** — reuses `lib/calendar/pattern-precedence.ts`
rather than re-deriving precedence in SQL), and `assignments` (POST/DELETE). Detail in
[`architecture/api.md`](architecture/api.md).

**Deliberately not wired up**: precedence levels 1 (a fully custom per-date shift set — zero
occurrences in 33 months) and 3 (holiday-driven pattern suspension — practice-specific
configuration with no tenant-scoped table yet; hard-coding the pilot's answer into the generic
route would reproduce the exact tenant-data-in-code mistake ADR-0010 exists to prevent).

**A fourth real bug, and it has the same shape as the WIN1252 encoding one from yesterday**:
`node-postgres` parses a SQL `date` column into a JS `Date` at **local-machine midnight**, not the
plain string every response shape assumed. `2026-10-05` came back as `2026-10-04T22:00:00.000Z` on
this machine (SAST, UTC+2) — wrong by exactly the local UTC offset, so the same code would be
wrong by a *different* amount on a server in a different timezone. It surfaced as a slot-date
filter in `api:check` matching nothing; the same silent corruption was already present in
`date_pattern.on_date` and `practice_membership.valid_at`'s bounds before anything exercised them.
Fixed once, globally (`types.setTypeParser` in `lib/server/db.ts`), not with a `::text` cast
remembered at each call site.

**The pattern across four bugs now (WIN1252, RLS-on-RETURNING, `next/server` resolution, this
one): every one of them is invisible to a type checker and invisible to a mock.** All four needed
a real server and real assertions to surface. `npm run db:check` and `npm run api:check` earned
their keep again.

`api:check` also exercises both hard invariants through the API for the first time rather than
raw SQL: assigning the same doctor to two shifts a synthetic overlapping pattern deliberately
creates is a 409 (`23P01`, the exclusion constraint); assigning a doctor outside their membership
interval is a 400 (`23514`, H-03 — given its own SQLSTATE this session specifically so the API
could branch on it instead of parsing the trigger's message text).

---

## 2026-09-07 (even later) — The JSON API has started, and three real bugs died against a real server

Five route handlers under `app/api/practices/`: create a practice, fetch one, create/list
doctors, create/list rosters. `npm run api:check` proves them by importing the handler modules
directly and calling them with constructed `Request` objects against a real throwaway Postgres —
the same "measure against a real server" discipline `db:check` established, extended to the API.
Detail in [`architecture/api.md`](architecture/api.md).

**Three things broke that a mocked test would never have caught:**

1. **`initdb` defaults to WIN1252 on this machine, not UTF-8.** Harmless until a client that
   declares UTF-8 sends a byte sequence WIN1252 can't represent — the Supabase CLI's migration
   runner hit this on an em dash in a migration comment; a doctor's name with a diacritic would
   have hit it in production. Fixed by pinning `-E UTF8 --locale=C` in the cluster helper, once,
   for every gate that creates a cluster.
2. **`INSERT ... RETURNING` also has to satisfy the table's SELECT policy on the new row** — not
   just the INSERT policy. Creating a `practice` (whose SELECT policy is `id =
   app_current_tenant_id()`) or a `person` (visible only via an existing membership) failed on
   the read-back, at the exact moment neither tenant context nor membership exists yet to satisfy
   it. Not a policy bug — the policies are doing their job — just an ordering problem: generate
   the id first, insert, then either adopt it as the tenant context or create the row that makes
   it visible, before reading anything back.
3. **`next/server` doesn't resolve under plain Node ESM** — only inside Next's own bundler. Since
   `NextResponse.json()` is sugar over a plain `Response` and this API uses none of
   `NextResponse`'s extras (cookies, rewrites), switching to a hand-written `jsonResponse` helper
   over the Web-standard `Response` removed the dependency entirely — which is also what makes
   `api:check`'s direct-import approach possible at all.

**Lesson, same shape as the ADR-0008 addendum a few hours earlier:** the schema and the ADR both
read as correct until something actually ran against a real server. Three sessions' worth of
plausible-looking code would have shipped all three bugs if the gate had been "does it type-check"
rather than "does a real Postgres accept it."

---

## 2026-09-07 (later) — The database exists: first migration, RLS from line one, and ADR-0008 didn't survive contact with the hosting decision

**Nine migrations** (`supabase/migrations/0001`–`0009`) build the full schema from
`docs/architecture/data-model.md`'s ER diagram: practice/site/person/membership, shift
structure, roster/roster_version/shift_slot/shift_assignment, recurring_slot, burden_weight/
burden_credit, preference/leave, violation/override, solve_run, audit_log. RLS is enabled and
forced on every tenant-scoped table in the same migration that creates it, never a follow-up —
ADR-0007. `npm run db:check` starts a throwaway cluster from the pinned `.tools/pgsql` binary,
applies every migration, and asserts real behaviour rather than trusting the SQL: the exclusion
constraint refuses an overlap, the containment trigger refuses an out-of-membership assignment,
RLS actually hides tenant B's rows from tenant A (tested as the non-superuser `app_user` role),
an unset tenant context sees nothing, and `audit_log` refuses UPDATE/DELETE.

**⚠️ ADR-0008's own SQL doesn't run on the host we're actually using, and nobody had checked.**
`PRIMARY KEY (doctor_id, valid_at WITHOUT OVERLAPS)` and the `PERIOD` foreign key are PostgreSQL
18 syntax — verified with a syntax error against the pinned 17.2 binary, not assumed. ADR-0008
was accepted 31 August on the working assumption that PG18 would be available; the Supabase
hosting decision, accepted a week later (question 8), fixes the host at 17. `setup-postgres.ps1`
had already discovered this independently — its own header says PostgreSQL 17 was pinned *"to
match what Supabase runs"* — without anyone tracing that back to ADR-0008 or logging it. Two
already-accepted decisions quietly contradicted each other for a week.

**Resolution, recorded as an addendum to ADR-0008 rather than a new ADR**: the GiST exclusion
constraint (double-booking prevention) is unaffected — it's ordinary PostgreSQL, not a PG18
feature, and it's the invariant that matters most. H-03 (containment — a doctor can only be
rostered while a member) drops from a native temporal foreign key to a `BEFORE INSERT OR
UPDATE` trigger, which is honestly a weaker guarantee (a trigger can be disabled; a constraint
cannot) and is named as such rather than glossed over. Swap-over to the native form is one
function deletion, whenever the host offers PostgreSQL 18.

**Lesson:** a research finding buried in a setup script's comment header is not the same as a
logged decision. The next time a script quietly works around something a design doc assumed,
that belongs in the doc's own decision record, not just in the script that happened to notice.

---

## 2026-09-07 — ⭐ Nine more answers, the tooling gap closed, and a sheet that was wrong

Full answers in [`NEEDS_YOUR_INPUT.md`](NEEDS_YOUR_INPUT.md). Three things matter beyond the answers
themselves.

**⚠️ The published roster is not always what happened, and the seed data records the sheet.** One of
September's three apparent preference overrides was not one: the principal *"made a mistake when
writing up the roster; the doctor never ended up working — D03 and D06 filled the gaps."* All 33
transcribed months are sheets, so the fairness ledger, every load ratio and every constraint verdict
rest on **what was published**, not on what was worked. Nothing in the repository can detect the
difference. Not a reason to distrust the data — it agrees with itself across 3,199 assignments — but
a reason never to call it ground truth about hours worked.

⭐ **And it is the clearest case for the product yet, arrived at by accident.** The app would have
shown *"D05 stated unavailable on 7 September"* **before the sheet went out.** A real month where
"warn and scar" would have paid for itself.

**⭐ Lock-and-regenerate — the owner's idea, and it changes ADR-0016's central difficulty.** Generate,
lock the cells that are right, regenerate the rest, repeat. Three things make it unusually cheap:
H-13 shipped the day before, so **the engine already supports it and this is UI work**; it matches
how he already edits (one move, then reassess); and **a lock is an unambiguous "this is right",
labelled by construction** — which is most of the attribution problem that steps 2 and 3 of ADR-0016
exist to work around. Amendment recorded there, including the two failure modes: locking can paint
into a corner (run pre-flight on the locked set *before* regenerating) and "show me another" can run
out (say so rather than silently repeating).

⚠️ **"Unlocked" must not be read as "rejected"** — indifference and rejection look identical in one
round, and only repetition separates them.

**Tooling: `npm run setup:postgres`.** PostgreSQL 17.2 and Supabase CLI 2.117.0, pinned and
checksum-verified into `.tools/`, nothing on PATH. **Docker deliberately not installed**: the
EnterpriseDB binaries zip runs a cluster from a folder with no installer, service or admin rights,
which is the whole of what was blocked.

⚠️ **The warning it discharges was specific — *"an unverified exclusion constraint looks done and is
not"* — so it was verified rather than assumed.** `EXCLUDE USING gist (doctor_id WITH =, during
WITH &&)` accepted two adjacent shifts for one doctor and two doctors at the same instant, then
**refused the overlap**. The invariant the whole data model leans on is now demonstrated.

**Two stale facts found while installing.** `AGENTS.md` said *"there is no system Python"* — a real
3.12.10 with pip 26.2.1 now sits ahead of the Store stub; true when written, quietly false since.
And `NEEDS_YOUR_INPUT.md` still carried a **⛔ Blocked** section saying the roster images *"exist
nowhere on disk"*; they arrived 26 August, and there are 18 images and 33 transcribed months.
**A stale blocker is worse than none — it stops a cold session that nothing is stopping.**

## 2026-09-07 — ⭐ Seven answers, and question 46 turned six facts into one rule

Full answers in [`NEEDS_YOUR_INPUT.md`](NEEDS_YOUR_INPUT.md). Three changed something:

**46 — it IS one rule, and it is now derived rather than listed.** *"Although there are exceptions
at times, the general rule is that all GPs will be unavailable on Saturday mornings."* Measured
before acting, across 146 Saturday mornings in 33 months: **D07, D08, D09, D10, D11 and D12 worked
zero, all six**; D13 nine and D06 six, about one every four or five months each; the anchors took
125 of 146. That is exactly *one rule with exceptions*.

⚠️ **Derived from the mechanism, not from a role.** `doctor-codes.md` records that anchor and pool
*"must not become an enum in the schema"*, so the rule attaches to the fact that already drives
H-10 — a doctor who never works a weekday before 17:00 is at their own surgery, and **a GP surgery
is open on a Saturday morning.** One fact, two consequences. The set went from six hard-coded codes
to the eight doctors with an inferred H-10 rule, and a ninth GP is now covered automatically.

⚠️ **An inference on top of an inference, stated plainly.** H-10's own membership rests on 68–155
shifts per doctor with zero contradictions, and the rule is elastic, so a wrong inclusion scars
rather than blocks. **First attempt keyed on `availability.keys()` and hit all thirteen doctors** —
`inferAvailability` returns an entry for everyone, most with an empty rule list. Caught by asserting
the derived set equals the H-10 set rather than by reading the output.

**36 — `fte` dropped**, before the first migration ever ran. ADR-0008 still shows it deliberately: an
ADR records a decision at a date, not a live schema.

**25 — the other doctors know.** This was the only thing making Track B1 time-sensitive, so
`git init` and the first push are now the owner's call rather than a question.

**37 — ADRs 0013–0017 accepted**, and 0016 gained a step on the owner's own suggestion:

> *"Prompt the user with questions, give them a few options to choose from and ask them to choose
> the most correct answer."*

**That is active learning, and it is stronger than the "extra data" he modestly claimed.** Every
other signal in 0016 is whatever the month happened to produce; a question can be aimed at the
weight the fit is *least sure of*, and a pairwise answer has none of an edit's attribution
ambiguity. The form is the constraint: **concrete pairwise roster comparisons, never abstract
questions** — people introspect weights badly and compare options well, and a pairwise answer *is*
the inequality the fit consumes. Budgeted at two or three a month; ten is how a non-technical admin
learns to dismiss the dialog. It moves the useful horizon from 6–12 months toward the 3–4 he
estimated.

**44 — the right direction, with a trap in one half.** He proposes changing the monthly ask from
*want* to *can*, plus a cannot-work list. The cannot-work list is pure gain. ⚠️ **Renaming the first
list from "want" to "can" makes it exhaustive**, so an unlisted date silently becomes *unavailable* —
the same self-confirming loop the change is meant to break, arriving faster. Recommendation
recorded: **three states with the default printed on the poll** ("everything else: available"), so
nobody enumerates anything and unlisted dates have a stated meaning rather than an inferred one.

## 2026-09-07 — The last three buildable items: `tentative`, `validFrom`, `lockedAssignments`

**1. `tentative` = "if necessary" — and the fix was a SIGN FLIP, not a smaller number.** This had
defeated two earlier attempts, both of which tried to express it as a weight discount. They could
not work: a firm `PREFER` penalises **not** assigning the date, so discounting that penalty makes
the solver spend the fallback *more* eagerly the cheaper it gets. The cost has to move to the other
variable.

The rule, applied to every type — **`tentative` moves a preference one step toward neutral and never
past it:**

| Type | Firm | Tentative |
|---|---|---|
| `PREFER` | missing it costs 20 (S-02) | **taking it up costs 10**, reported as S-03; missing it costs nothing |
| `PREFER_NOT` | assigning it costs 30 | assigning it costs 10 |
| `UNAVAILABLE` | `LEGAL`, ~50,000 | **`PREFERENCE`, 100** — demoted out of the tier, not discounted within it |
| `MUST` | H-09 | ❌ **refused at the wire.** A commitment made only if necessary is not one |

Verified against the practice's own September: D03's `±` dates 12–13 are now unrostered, and the
real sheet does not roster him either.

**2. [ADR-0017](architecture/decisions/0017-no-validity-interval-on-constraints.md) — no
`validFrom` on constraints.** The measurement said H-02, H-05 and H-07 move with the workforce and
H-06 does not. The decision is **not** to date them. Every available interval would be *derived from
the sheets*, and a derived date is a promoted confidence tag wearing a timestamp — the one thing
`AGENTS.md` forbids. The principal is not technical and will never fill the field in, so "supported"
would mean "populated by inference". Era-dependence instead raises a **question** with the
measurement attached, triggered by the workforce-composition change that caused every case measured.
⚠️ **The field itself is deliberately not built** — an unpopulated field is this project's most
expensive recurring mistake (`tentative`, H-03's dates, `timeBudgetSeconds`).

**3. H-13, locked assignments — the second structurally hard constraint, and a deliberate exception
to "warn and scar, never block".** That philosophy governs *the practice's rules*, every one of
which has been falsified at least once. A lock is not one of those: it is **the scheduler exercising
the override the philosophy exists to protect.** There is nobody to warn, and a tool that quietly
moves a cell he pinned cannot be used to make a promise. Enforced by fixing the variable to 1 — the
mirror of H-03, which is enforced by never creating it.

Safe to make hard **only** because the two payloads that could make it unsatisfiable are refused at
the wire, where the error can name a field: a lock on a non-member, and two locks on one slot.
Everything else stays elastic — two locks on one doctor in a day breach H-02 at a cost, and a lock
that consumes the last free doctor produces a reported coverage shortfall elsewhere. **No registry
entry**: a constraint that cannot be violated has nothing to report, and an always-zero slack would
sit permanently in every cost breakdown.

⚠️ **`parse_request`'s docstring no longer keeps a "validated but not consumed" list, and that is
the point.** That list was the most expensive thing in the project: `burdenLedger` and
`burdenWeights` sat on it until S-01, `previousPublished` until S-06, `lockedAssignments` until now
— and H-03's membership dates were parsed and discarded for weeks *without appearing on it at all*.
Every field the parser accepts now reaches the model.

## 2026-09-07 — ⚠️ CORRECTION: the model is under-determined, so "61.7%" was one draw

**The blind-comparison figures published on 6 September are less precise than stated, and this
entry supersedes them.** Repeated solves of an *identical* model return different rosters: four
distinct rosters observed, every one at objective **11,547**. Many assignments are genuinely
interchangeable — the pool slots have no dominant holder and every pool doctor prices the same — so
**"the optimal roster" is a set, not a roster**, and eight parallel workers return an arbitrary
member of it.

**What that does and does not invalidate:**

| | Status |
|---|---|
| **Anchored slots 88.6%** | ✅ **Solid.** Identical in every batch measured, deterministic and not |
| Rotated slots | ⚠️ **24–40%** across batches. All the variance lives here, which is exactly where doctors price identically |
| Overall | ⚠️ **54–63%.** Quoting **61.7%** as a point estimate was wrong |
| The handover fix itself | ✅ **Verified structurally, not sampled** — see below |

**The handover fix's effect, derived rather than sampled.** It moved **13 slots** from the rotation
pool into the anchor set (Mon afternoon D05, Tue afternoon D05, Mon morning D03). In the practice's
own sheet those 13 are **11 correct**; under rotation logic at ~34% they would have been ~4. So the
fix is worth about **+7 slots, or +7.4 points** — not the +12.8 the two single draws suggested. The
mechanism is exactly right and the headline was overstated by roughly half.

**The lesson is one this project already had and I applied to the wrong artifact.** `AGENTS.md`
says *do not snapshot generated rosters — CP-SAT is not deterministic.* I did not snapshot one; I
did something equivalent by treating a single solve's agreement with a target as a measurement.
**A number computed from one solve of an under-determined model is a sample, and must be reported
as one.**

**`solve(deterministic=True)` now exists for measurement — and two wrong versions came first, both
of which looked like they worked.** Dropping to `num_workers=1` does not make the search
reproducible, it makes it too slow to finish: three runs returned 13,130 / 13,281 / 13,242, all
worse than 11,547 and *less* reproducible than the default. Swapping in `max_deterministic_time`
fixed the stopping point and not the problem — 82 seconds of work still only reached 12,946. The
answer is `interleave_search` with all eight workers and a fixed seed: **four runs, all OPTIMAL at
11,547, one distinct roster, ~4s against ~0.4s.** ⚠️ **The parallel workers are not redundant
copies** — they run different strategies and need each other to close this model.

⚠️ **This also affects the product, not just measurement.** Pressing "generate" twice will show the
admin two different rosters. S-06's churn penalty handles that *across* published versions but not
within one sitting.

## 2026-09-06 — S-04 built, S-07 falsified before a line of it was written

The last two unmodelled softs. One was real and much narrower than catalogued; the other was
backwards.

**S-04 — measurement narrowed it a long way.** Of 1,979 consecutive-shift pairs in 33 months, only
**56 are under 8h, and 29 of those are two shifts on one day** — H-02's job, and pricing them here
would charge twice for one event. **All 27 genuine cases are the same shape: a night into the next
day's first shift.** There is no 1h–7h tail; the gap is 8h or it is zero. The rate also collapsed by
era — **3.00/month in Dec 2023, 1.58 in 2024, then 0.25 in both 2025 and 2026.** Built at weight 40,
`PREFERENCE`, strictly below 8h because the principal states 8h is fine. **Fired zero times on
September 2026 and the blind match stayed at 61.7%** — the honest result, and the one the
measurement predicted.

**S-07 — ❌ falsified, not built.** *"Avoid isolated single working days."* Measured first:

| | Isolated share of working days |
|---|---|
| D01–D05, the anchors | 9%, 11%, 18%, 20%, 24% |
| D06–D13, the pool | 63% … **89%** |
| Overall | **1,157 of 3,112 = 37%** |

**For a pool doctor an isolated single day is not a defect, it is the arrangement** — they run their
own practices and come in for one shift. Building it would have penalised **every shift a pool GP
works** and pushed the solver to bunch them into runs nobody has ever worked. It is an anchor-shaped
intuition applied to everyone: true of D01 at 9%, false of D11 at 89%.

**The tenth documented claim in the catalogue to fall, and the first caught before the code existed
rather than after.** The habit that caught it is the cheap one: measure the `[ASSUMED]` constraint
against the data *before* implementing it, not after it produces a strange roster.

⚠️ **Also found: the property test listed S-09 as a catalogued ID while its generator produced no
slot shares**, so the property had never once exercised it — the same hole that hid H-03 for weeks.
The generator now draws shares, and a probe confirms S-04 in 60/60 generated instances and S-09 in
8/60. **Listing an ID is not covering it**, and the list is what makes that invisible.

## 2026-09-06 — ⭐ The blind comparison: 49% → 62% against the practice's real September

The owner supplied the real hand-built September 2026 sheet. Our solve had never seen it.
Transcribed to codes in `private/actual-2026-09.json`; slot sets identical, 94 for 94.

| | Before the handover fix | After |
|---|---|---|
| **Exact slot match** | 46/94 = **48.9%** | 58/94 = **61.7%** |
| S-05 anchored slots | 28/31 = 90% | 39/44 = **89%** (13 more slots) |
| S-09 rotated slots | 18/63 = 29% | 19/50 = 38% |

**The one clear bug, and it was a documented known gap coming true.** `anchors.ts` already warned
that a trailing window is "a knowingly incomplete" stand-in for `validFrom`/`validUntil`. It cost
exactly what it said it would: **D05 took Monday and Tuesday 15:00–23:00 outright in July 2026** —
4/4 and 4/4 in July, 4/4 and 5/5 in August — but the six-month window held four pre-handover months
against two post-, and so reported **D03 at 58% of a Tuesday afternoon he had not worked in three
months.** 58% is under `ANCHOR_DOMINANCE`, so it did not even register as an anchor changing hands:
it became **a rotation between the old holder and the new one**, which is the one thing it was not.
The blind solve gave D03 three Tuesday afternoons; the practice gave him none.

Fixed with per-slot change-point detection — each month's outright majority holder, walked back from
the most recent while unchanged, requiring `HANDOVER_CONFIRM_MONTHS = 2` before believing it. Anchors
went 7 → 10, the three new ones being **Mon afternoon D05, Tue afternoon D05, Mon morning D03**, all
four-for-four in the real sheet. **D01's total went from 15 to exactly 16 against 16.**

**Where the remaining gap is, and why most of it is not fixable.** The 38% on rotated slots is
partly a scoring artefact: in a slot three doctors each take a third of, matching by *name* is luck.
Scored by monthly *count* instead, the rotations were 49% right before the fix. The genuinely
diffuse slots — Sunday afternoon (top share 19%), Friday evening (21%), Saturday night (19%) — have
no holder to predict and four slots shared across thirteen doctors.

**Three things the comparison validated rather than falsified:**

- **The request-diary transcription.** The real roster honours **62 of 65** stated-unavailable dates.
  Far too high to be chance, so the reading of the handwriting is sound.
- **"Warn and scar, never block."** The principal overrode a stated unavailability three times in one
  month — ~5%. A system that hard-blocked those would have been unusable in its first month. ⚠️ One
  of the three (D05 on the 7th) sits on a range boundary flagged `legible: medium` at transcription
  time, so it may be a reading error rather than an override.
- **S-08.** Heritage Day went to D03/D02/D01, all anchors — the opposite of what S-08 predicts, and
  the first instinct was that S-08 was wrong. **Measured across 25 weekday public holidays, anchors
  hold 41% of holiday slots against 65% of all shifts**, so the holiday skew is real and S-08 is
  right. September's holiday is the exception: six of thirteen doctors declared that week away,
  leaving D01/D02/D03/D05 as the practical field, and the practice simply ran the ordinary Thursday
  pattern. Our D10 morning is legal — H-10 exempts public holidays — but not what they did.

## 2026-09-06 — ADR-0016 proposed: learn weights from edits, not rules

The owner's observation, immediately after S-09 needed building by hand:

> *"If we have to tweak it this much then it will most likely also need adjustments for other
> practices even with all the data and accurate rules and arrangements provided (as humans there will
> always be something that isn't declared or entered into the data)."*

**The premise is right and it is the strongest argument in the project for adaptive weights.** Nobody
withheld the Saturday rotation — the principal answered eighteen questions in full. *"D01 takes about
two of four Saturday mornings"* is simply not a thing a person volunteers. It is not a rule; it is
what the rota does.

Recorded as [ADR-0016](architecture/decisions/0016-learn-weights-from-edits-not-rules.md). Three
points worth keeping outside the ADR because they are the ones that will get re-litigated:

- **The unit of signal is the edit, not the month.** Framed per-month the idea looks impossible — 4
  months is 4 data points. Framed per-edit it is ~30–50 pairwise comparisons a month. Same data, two
  orders of magnitude more signal.
- **The objective is already linear in the weights** because the penalty registry exists. That makes
  this inverse optimisation, not deep learning — a linear fit, auditable, on a handful of parameters.
- **The tier hierarchy is frozen.** One month where the admin leaves a slot uncovered is enough for a
  learner to price coverage below a preference, and that ordering is the only thing between the model
  and a roster with nobody on duty.

⚠️ **Nothing here is buildable.** No app, no database, no edits. The ADR is a constraint on what to
build — specifically that the **L1 command journal must record before/after from day one**, because
it cannot be reconstructed later.

## 2026-09-06 — Question 48 answered: available every Saturday, works at least two

The *"every Saturday morning"* claim was a misspeak, corrected by the owner: **available** every
Saturday, works **at least 2** in a typical month. Both already held — D01 carries no exclusion of
any kind, and S-09 gives him 2 of 4 in September and 2 of 5 in October.

**So the September failure was a missing objective term, not a missing rule**, which is the whole
argument for S-09 and for ADR-0016. Residual gap: `0.38 × 5 = 1.9` rounds to `[2, 2]`, so the model
gives exactly 2 and never volunteers a third; he worked 3 in two of the last fourteen months. Floor
right, ceiling slightly tight, a third available at cost 50.

## 2026-09-06 — ⭐ S-09: the 68% of the roster nothing was modelling

The owner reported that the practice principal works Saturday mornings and the generated September
gave him none. Both halves of that turned out to be worth measuring, and they disagreed.

**The claim, as stated, is not what the sheets record.** *"Currently working every Saturday
morning"* — measured month by month across fourteen months, he holds **1–3 of each month's 4–5,
never all, with no upward trend**, sharing them with D03 and D04 at roughly 38/27/23. Reported to
the owner rather than encoded, and he accepted it: *"there is no such thing as always, however to
not have my dad work a single Saturday morning when I told you that is one of the trends should be
incorrect."* **Zero was the bug; "every" was not the fix.**

**The cause was a two-state model of a three-state world.** S-05 needs a 2/3 dominant holder. Over
the six months to September that describes **7 slots and 183 assignments; the other 18 slots — 393
assignments, 68% of the roster — had no term in the objective at all** and were filled on fairness
arithmetic alone. D01 was not being starved: he had **15 shifts, second busiest of thirteen**, and
**twelve of them were his three S-05 anchors.** The anchors spent his load budget and nothing spoke
for Saturday morning. Near-misses were being discarded too — Tue night D04 **65%**, 1.7 points under
the bar.

⚠️ **Not fixed by lowering `ANCHOR_DOMINANCE`**, which is right for what S-05 *is*; a 51/49 slot
called an anchor makes every ordinary turn a departure. The error was that a *share* had no
representation. S-09 sends one per doctor per rotated slot, and the two **partition the slots** —
both sides of the wire refuse a slot carrying both.

**Three encodings, two of them wrong, and only the third survived measurement:**

1. `[floor, ceil]` free, priced outside. Passed every test and was **wrong in a way one month
   cannot show**: a free interval is a tie, and S-01 breaks every tie downward because large-share
   doctors are the heavily loaded ones. D01 got **1 of 4 in September and 1 of 5 in October** —
   inside the interval both times, below his real rate forever.
2. `[round, ceil]`. Fixed the bias and over-reached at the tail: D06 holds 15% of Sunday mornings,
   0.6 of a shift, and `round()` made that a **requirement** to take one.
3. `[round if expected ≥ 1 else 0, ceil]`. **A share smaller than one whole shift cannot demand
   one.** Plus a guard: rounding several doctors up can make the lows exceed the slot's supply, so
   the whole slot falls back to `floor` together rather than picking losers.

Result: D01 at **2 of 4 in September and 2 of 5 in October**, which is his rate in every one of the
fourteen months measured. Zero S-09 violations; S-02 breaches fell 33 → 31.

**Two holes in `contract:check`, found while bumping to 1.7.0 and both live:**

- **`contractVersion` was never compared to `CONTRACT_VERSION`.** The fixture and the spec had sat
  at **1.5.0 through the 1.6.0 and 1.7.0 bumps** — the document describing a payload two versions
  behind the one being sent, in the field whose only job is to let the receiver tell.
- **Nested parser fields were a note, not a failure.** So H-11's `cannotWork` and
  `maxShiftsPerWeekend` reached the parser in 1.6.0 with **no fixture and no documentation**. The
  top-level check could not see them because both are inside `doctors[]`. *A field the parser
  accepts and nothing documents is the same failure as one it silently drops, from the other side.*

Both now fail the gate, and both were verified by breaking the fixture deliberately — the first
attempt at that verification was itself wrong (stripped `share` from one of two entries, so
`allKeys` still found it and the check correctly stayed green).

## 2026-09-06 — ⭐ Question G closed: the Word source and the logo arrived

The January 2019 roster as a `.docx` and the practice letterhead as a PDF. Deliverables in
`private/template/`: a blanked template, the logo lockup, the mark alone, both originals in `source/`.
Measurements written up in [`product/export.md`](product/export.md#what-the-word-source-settles).

**The blank was made by stripping the original, not by rebuilding it.** Unzip, empty the cells, rezip
— so page setup, the `TableCalendar` style, the fonts and the embedded logo are the practice's own
bytes. A docx-js reconstruction would have been a guess wearing the right colours, which is precisely
the failure mode this artifact exists to prevent.

**What the photographs had got wrong, or could not see:**

- Columns are **not equal** — Sunday is 1771 twips against 1959/1960 for the other six.
- A week is **two table rows**, a thin date row above a tall entries row, not one cell with the number
  inside it. Only the date row has a top border and the style draws no `insideH`, so they read as one.
- Corbel 10 pt, Cooper Black in the banner, `#76C5EF` accent, `#7F7F7F` title band, `#BFBFBF` rules.
- Letter landscape, 0.5″ margins.

**Three judgement calls, each reversible:** row heights normalised to 270/1050 twips (the originals
are content-driven minimums, one of them 48); the month right-aligned as `Month Year` rather than
positioned with 89 literal spaces; the thumbnail and the `dc:creator` stripped, both of which named a
real doctor.

⚠️ **Not verified visually.** Word COM will not start in this sandbox and there is no LibreOffice or
poppler on this machine, so the file was checked structurally — every part parses, 11 rows × 7 cells,
no field codes, no real names — but nobody has looked at it rendered. **Open it once before relying
on it.**

⚠️ **It is 2019's sheet.** Four years older than the earliest photographed export, and not confirmed
as the file in use today.

## 2026-09-06 (last) — ✅ H-11 built, after the owner spotted two real breaches

**He was right on both counts, and the cause was the same: H-11 was catalogued on 4 September and
never built.** I had it listed as "buildable" and moved on.

The September roster had **D12 on a Saturday morning**, **D07 on a Saturday morning** and **D13 on a
Thursday** — three of the nine rules his dad gave, broken. Now modelled, at `Tier.CONTRACT` and
elastic like H-05, because every behavioural "never" in this catalogue has been falsified by the
practice's own rosters. **Zero H-11 violations after, each of the nine verified independently rather
than trusting the count.**

Two shapes, because his list has two. Eight are forbidden **cells** — (day class, shift kind) — with
"weekends only" expressed as exclusion from every weekday cell so one mechanism covers both. D04's
*"no two weekend shifts in the same weekend"* is a constraint on a **pair** of slots, so it is a
sequence constraint like H-04, keyed by the Saturday a slot sits beside.

⚠️ **`_day_class` had to be written a second time in Python**, and Saturday/Sunday outranking public
holiday is exactly the kind of rule that drifts between two implementations — the weekday-integer bug
again. Written once, documented as mirroring `classifyDay`, and the precedence stated at the top.

### ⚠️ And the second complaint was not a bug — it was a measurement

*"D01 didn’t work a single weekend shift."* True, and `doctor-codes.md` says he takes
"Saturday morning by default". **The data says 44% across 33 months and 38% across the last six** —
the largest share of anyone, and well below the two-thirds `inferRecurringSlots` requires. So no
recurring slot is inferred, nothing pulls him to Saturdays, and S-01 pushes him away because he is
over his cumulative share.

**Another documented claim the measurement does not support**, and the tenth this project has
produced. Deliberately **not fixed by inventing a Saturday rule from a 38% pattern** — that is
precisely what produced H-06's backwards model. Question 48 asks whether the Saturday is his by
arrangement or just how it falls, because an arrangement is a recurring slot and a tendency is
something the solver is entitled to change.

## 2026-09-06 — Solver audit: four findings, and the property tests were the weak point

Asked to make sure the solver was in a good place before comparing against the real September
roster. It was not, in four ways — and **three of the four are the same bug this project keeps
producing: something that exists, is documented, and is never actually used.**

**1. `timeBudgetSeconds` was accepted, documented and ignored.** The contract has always said *"the
solver returns its incumbent best when this expires"*. It was listed as a known field so it was not
rejected, then **never read and never type-checked** — `"timeBudgetSeconds": "banana"` passed
silently — and the budget actually used came from a CLI flag. Now parsed, validated, refused at zero,
and the request wins unless `--time-budget` is passed explicitly. **The fourth field this week**
after H-03's dates, `tentative`, and `burdenWeights`.

**2. The headline property never tested H-03.** *"If the solver returns a solution then every
genuinely hard constraint holds"* — and H-03 is now the **only** structurally hard constraint in the
model, added 3 September. The generator produced no membership windows, so the one rule that cannot
be violated at any price was the one never exercised. Generator and assertion both added.

**3. That immediately exposed a real bug in pre-flight.** Its per-day supply counted **every doctor
on the roll**, ignoring membership — so it reported *feasible* for days whose available doctors had
left, and the solver then left slots uncovered. Precisely the case `AGENTS.md` says belongs here:
*"if a solve fails for a reason pre-flight could have named, the fix belongs in pre-flight."*
H-10 is deliberately still excluded: it is elastic, so a pool GP on a weekday morning is expensive
rather than impossible, and subtracting it would refuse solvable months.

**4. A metamorphic test was rebuilding an `Instance` field by field**, so it silently dropped every
field added after it was written. Its "tighter" instance was a *different problem*, not a constrained
one, and its objective could legitimately fall. Now `dataclasses.replace`, which carries everything
and changes exactly one thing — **which is what a metamorphic test needs by definition.**

**The pattern worth keeping.** Every one of these was invisible to the gate and to code review, and
every one surfaced the moment something *generated data it had never seen*. The audit that found
them was mechanical: list every field on the `Instance`, count its references in `model.py`; list
every field the parser accepts, diff against what reaches the `Instance`. **Both diffs should be
empty or explained, and both are now checked rather than assumed.**

## 2026-09-06 — The request diary reaches the solver, and S-02 was counting wrong

**The September request diary had never been transcribed.** Its *notation* was decoded weeks ago —
`NOT` means not working, `±` means "if necessary" — but the page itself was never turned into data,
so every solve so far ran with `preferences: 0`. It now reads
`private/preferences-2026-09.json`, 23 preferences across all thirteen doctors.

**The transcription confirmed its own reading.** The diary's opening lists are ranges like 4-6,
11-13, 18-20, 25-27 — **exactly September 2026's four Friday-to-Sunday weekends.** That is what makes
"the first list is weekend availability" a finding rather than a guess.

⚠️ **Modelled as `PREFER`, not as exhaustive availability.** Reading the first list as "available on
these dates and no others" would silently mark every unlisted date unavailable — a far stronger claim
than the page makes. Only `NOT` has confirmed semantics, so only `NOT` becomes `UNAVAILABLE`.

### ⚠️ And that immediately exposed a bug in S-02

A whole-day `PREFER` was registered **once per shift**. So a doctor asking for the weekend of the
4th–6th generated nine wishes, and getting one shift reported **eight broken ones**. On this diary
that inflated S-02 to **170 violations and about a quarter of the objective** — and it would have
told a doctor their request was mostly refused when it had been granted.

Registered once per **date** now, satisfied by any shift that day. A preference naming specific
shifts keeps the per-shift treatment, because there each named shift genuinely is a separate wish.
**S-02 170 → 30, objective 14,140 → 11,340.**

**The bug was invisible until real preference data existed.** Nothing in the fixture exercised a
whole-day preference across a multi-shift day.

**Also:** `--names` renders surnames instead of codes, reading `private/doctor-codes.md` at run
time — the `labelFor` seam doing what it was built for. ⚠️ **`names:check` immediately caught a real
surname I had written into an example comment in the committed script.** The check earned its keep.

## 2026-09-06 — ✅ H-12 built, and September re-solved

**The floor was the whole point.** Contract **1.5.0** carries `monthlyMinimumShifts` and a
per-doctor `maxShiftsPerMonth`; both sit at `Tier.CONTRACT`, four orders below coverage, on the
principal's own instruction that neither is hard.

| September 2026 | Without H-12 | **With H-12** |
|---|---|---|
| D03, D08 | **0 shifts each** | **2 each** |
| D04 | 19 | 18 |
| Ceilings breached | — | **none** |
| Objective | 10,636 | 10,662 |

**Satisfying the floor cost 26 objective points.** It was never a trade-off; the objective simply
had no reason to prefer a roster with everyone in it.

⚠️ **A test I wrote failed twice, and both failures were my premise.** The control — *"without the
floor, this instance starves D01"* — first ran on two doctors and nine slots, where **coverage forces
everyone to work** and there is no slack to starve with. Rebuilt on four doctors it starved D01 to
**one** shift, not zero, because D01's excess is dominated by carry-in and handing them one shift
still lowers everyone else's. **S-01 starves *toward* zero, not reliably *to* it.** The assertion is
now the comparison that actually matters — below the floor without one, on it with one — and the
docstring records why demanding zero was wrong, so nobody "fixes" it by weakening the test above it.

## 2026-09-06 — ⭐ The export renderer, and the first full-loop roster

**The template and both logos arrived**, so question G is closed and the renderer is built:
`lib/export/render-html.ts` plus `npm run export:render`, printing through headless Chromium. Every
measurement comes out of the `.docx` — US Letter landscape, the ~10% narrower Sunday column, the
two-rows-per-week construction, Corbel at 10pt. One page, `MediaBox 792 × 612`.

**Verified by rendering December 2023 and holding it against the photographed sheet.** That caught a
real bug: `render-export.ts` was not passing `spillDays`, so the Monday cell was empty where his
sheet prints `1 Jan` beside a wrapped `31`. The layout had always handled it; the caller dropped the
input. `loadSeedPeriod` excludes spill days deliberately — they double-count burden — so the export
has to read them from the source document separately.

### ⚠️ Then the full loop ran, and produced a bad roster for an instructive reason

Solved September 2026 — a genuine out-of-sample month, since the data ends in August — and rendered
it end to end. `OPTIMAL`, all 94 slots covered, **objective 10,636** rather than the empty-objective
zero. And:

| D04 | D01, D02 | **D03, D08** |
|---|---|---|
| 19 shifts | 13 each | **0** |

**Two of thirteen doctors were given nothing.** The mechanism is exactly what S-01 is built to do:
both carry S-01 violations, so they are over their cumulative fair share, and the objective starves
them to converge. Nothing stops it reaching zero, **because H-12's minimum of two shifts a month is
catalogued and not yet modelled.**

**The lesson is about constraint ordering, not about S-01.** A fairness objective with no floor
under it does not produce a gentler roster — it produces an absurd one, and it does so while
reporting `OPTIMAL`. The principal's own framing three days ago had both halves in one sentence:
maxima are soft *because coverage matters*, and there is a minimum of two *for everyone*. Building
the maxima without the minimum would have been building the half that constrains and not the half
that protects.

**H-12 moves to the front of the queue**, and this roster is the argument for it.

## 2026-09-04 — ⭐ S-08 built: public holidays shared across the year

The one the principal asked for by name. Contract **1.4.0**, `holidayBurden` /
`holidayEntitlement` over a **twelve-month** window.

**The measurement changed what the constraint is for.** I expected to find holidays concentrated on
a few doctors and to be correcting it. The opposite: over 2024–2025 the four anchors take **12–18%
of all shifts and only 6–11% of holidays**, while the pool doctors take 2–5% of shifts and 5–9% of
holidays, and the top four rotates year to year. **Public holidays already run the other way round,
deliberately. He was telling us not to break it.**

**And the solver breaks it.** Asked for December 2026 with S-08 absent it gave **three of nine
holiday slots to D01**, who historically takes a tenth. On a real month the three holiday slots went
to three anchors with S-08 off, and two moved to pool doctors with it on.

**Why S-01 could not do this.** It equalises *total* burden and has no opinion about *composition* —
a doctor can sit at exactly 1.00 while carrying every holiday of the year. Worse, **H-10 exempts
public holidays** (a pool GP's own practice is closed), so on a holiday everyone is available and
nothing else in the objective prefers anyone. The slots get distributed arbitrarily. **A fairness
objective can be satisfied and still produce the thing the practice cares about avoiding.**

**Twelve months, not three, and the two windows are separate functions so they cannot be swapped.**
There are about 44 holiday slots in a year; three months of them is roughly eleven across thirteen
doctors, which is not enough to be fair with.

**Two things caught in passing.** `--future 2026-12` sends an **empty ledger** — the three-month
window lands entirely after the data ends, so *neither* S-01 nor S-08 runs. Not a bug, but a solve
that silently has no fairness objective looks identical to one that has. And the first ON/OFF
comparison I ran showed a difference that was pure CP-SAT nondeterminism, because the ledger was
empty; **the ledger row count is now the first thing to check before believing a comparison.**

## 2026-09-04 — The principal answered all eighteen questions

**The largest single input the project has had.** Full record in
[`NEEDS_YOUR_INPUT.md`](NEEDS_YOUR_INPUT.md); what is worth keeping here:

**⭐ Question 35 is closed — the burden weights are his own numbers.** `AGREED_BURDEN_V2`,
`[CONFIRMED]`. The biggest correction: **a weekday 15:00–23:00 is 1.75, not 1.0** — the placeholders
priced it identically to a morning, which was 60 shifts a month at the wrong weight. Sunday came
*down* to Saturday's 3.0 rather than Saturday going up; holiday 5.0 → 4.0; Christmas night 8.0 → 6.0.
Friday from 17:00 enters at 3.0, closing question W.

**The headline barely moved: Gini 0.179 → 0.183.** The practice-level verdict is robust to a
substantial reweighting; only the *ordering* within the four anchors moved. **That fragility caught
me out** — see the correction below.

**⚠️ I published a wrong correction, and it went into a conversation with the principal.** On
3 September I re-ran the report, found D02 ahead of D01, and recorded the document's "D01 55%,
D02 44%" as an error. On the confirmed weights the document was right: **D01 1.55, D02 1.45.** I had
re-derived a number from an `[ASSUMED]` weight table and presented it as more authoritative than the
prose. **The rule "when a script and a document disagree, re-run the script" needs a second half:
check what the script's inputs are worth.** Both figures were provisional and I said only one of them
was.

**⭐ He does not regard the anchor spread as an imbalance.** *"D01–D04 are all anchor doctors and
therefore generally work more during the week."* That reframes S-01: the four anchors sitting at
1.15–1.55 is **the roster he intends**, and a solver driving them to 1.00 would undo a deliberate
arrangement. S-01's job is the unintended drift on top of it, not the arrangement itself.

**⭐ `±` means "if necessary"** — every prior guess was wrong, including "approximately" and
"alternative dates". It is a **conditional availability**: not offered, but available if the roster
cannot be covered otherwise. That makes it a *fallback*, which belongs between an ordinary assignment
and a coverage shortfall — not a discounted preference. The solver still prices it as a firm
preference; recorded as knowingly wrong rather than left implicit.

**⚠️ Two of his answers contradicted the data, and he is right both times.** 15 December 2023 has the
shift structure of a holiday and was not treated as one — a structural signal is not a source, which
is why the tag was never promoted. And December is always short of cover even though the roster shows
December 2025 with *more* doctors than average: **rosters record who worked, never who asked to be
away.**

**New constraints from his list:** **H-11** (per-doctor cell exclusions) and **H-12** (monthly
maxima, minimum 2 for everyone). H-12 came with the clearest statement of *warn and scar, never
block* anyone has given, unprompted: *"these numbers shouldn't be treated as hard constraints,
because if the practice is low on doctors then some will need to work more."*

⚠️ **Six doctors share "no Saturday morning", and it is almost certainly one rule, not six** — they
are the pool GPs, and a GP practice is open on a Saturday morning. Same mechanism as H-10. **Not
generalised**, because turning his list into a theory is precisely the move that produced H-06's
backwards model. Question 46.

⚠️ **A POPIA boundary was nearly crossed.** One exclusion is religiously motivated, and the proposal
was for the principal to record the reasons. **Record the exclusion, never the reason** — a reason
field makes this s26 special personal information, which needs Information Regulator authorisation
before offshore transfer. Nothing changes operationally; he already holds the reasons.

**And the thing he volunteered, which outranks most of the above:** the fairness scale matters to
him, and specifically *"that all the public holidays throughout the year are shared so the same small
handful of doctors don't cover them every year."* **That is S-08**, unmodelled, and he has just made
it the priority among the three.

## 2026-09-03 — ⚠️ H-03 was never enforced, and `tentative` was dead code

Asked how close the solver is to final, so I counted rather than estimated. Fourteen of the
eighteen catalogued constraints are modelled. **One of the four missing was missing by accident,
and it is `[CONFIRMED]`.**

**H-03 — "a doctor is only assignable while a member of the practice" — was not enforced
anywhere.** `availableFrom` and `availableUntil` have always crossed the wire; `_DOCTOR_FIELDS`
has always validated them, so an unknown field was rejected — and then `_parse_doctors` returned
`list[str]` and threw the dates away. The rule existed in the catalogue, in the contract document
and in the contract's own tests, and nowhere in the model. **A doctor who left in May could be
rostered in September**, and this practice's roster records twenty-one workforce changes in
thirty-three months.

**Exactly the 2 September failure, mirrored.** That was four fields validated, documented and never
*sent*; this is two fields sent, validated and never *read*. Both sides of one boundary have now
produced the same bug, which says the bug is the boundary, not the side.

Fixed by **not creating the assignment variable** outside the window — the one structural bar in an
otherwise fully elasticised model, because a departed doctor on the roster is not the lesser of two
evils. It still degrades gracefully: H-01 coverage is elastic, so a month nobody is a member for
reports every slot uncovered rather than `INFEASIBLE`. Three tests, one of which asserts the
*variables* are absent rather than merely unused, so a future change cannot quietly re-price this as
a soft constraint.

**Second bug, same read:** `weight_scale = 1 if not tentative else 0`, used once as
`30 * max(weight_scale, 1)` — which is 30 either way. **`tentative` crossed the wire, was parsed,
was documented, and did nothing**, under a comment claiming "tentative = reduced". Not restored as a
discount: `tentative` carries the diary's `±`, whose meaning is question 5 and still open, and the
owner reads it as *"approximately"*, which does not obviously map to a cheaper penalty. Inventing a
factor would resolve an open domain question in the one place nobody would look. Now priced
identically to a firm preference, explicitly.

**Two stale claims fixed in the same file.** `model.py`'s docstring said *"only two constraints are
structurally hard"* and then listed three, two of which its own annotations described as
elasticised — and it omitted H-03, which was not enforced at all.

**Lesson: "validated" is not "used", on either side.** `contract:check` compares the parser's
accepted fields against the document and the fixture. It cannot see that a parsed field is then
discarded, and nothing else was looking.

## 2026-09-03 — Constraint verdicts per era, and the calendar wired into the wire

**`npm run seed:eras`.** `constraints.md` had stated the rule — *"a constraint verdict should state
the span it was computed over"* — and nothing enforced it. Now a command recomputes every evaluable
constraint once per era of stable composition, and it **reproduces the August 2024 finding from the
data**: H-02, H-05 and H-07 era-dependent, H-06 stable as a negative control. Found by hand twice
before, and got wrong once.

**Two denominator lessons, and the first cost a wrong published result.**

- **The occasion is the unit, not the assignment.** Built per-assignment first, H-07's era spread
  came out 19 points and the tool called it *stable* — the opposite of the documented finding. A
  Pattern B day carries ~4 shifts but is **one** chance to break the rule; on days the spread is 75
  points and the underlying 53%/9% matches the catalogue exactly. H-05 was worse: with D02's
  Saturday assignments as the denominator, every occasion is a breach and the rate is a constant
  100%.
- **A rule can turn on without moving far.** H-02 collapsed from 5% to zero — five absolute points,
  which any spread threshold calls stable. `becameSatisfied` is a second test for that shape;
  without it the tool missed one of the three cases it exists for.

**The tell, again: the tool disagreed with a documented finding.** Reconciling rather than believing
it is what surfaced both. Same lesson as 2 September, third instance.

**Also:** the request builder now asks `lib/calendar/holidays.ts` whether a date is a public holiday,
instead of falling back to `dayClass === 'public-holiday'`. That fallback was wrong in the case that
costs most — `classifyDay` lets Saturday and Sunday outrank public-holiday, so **Christmas on a
Sunday crossed the wire as an ordinary Sunday** and was priced as one. `declaredHolidays` on the
input carries proclaimed one-offs; an explicit `isPublicHoliday` still wins in both directions.

**Stale claim found and fixed:** `check-workforce-changes.ts`'s docblock still carried the H-07
figures retracted on 2 September ("8.1% to 1.9% across early 2025, as the roster grew from eleven
doctors to thirteen"). A fifth instance of a correction that did not propagate. Also `HANDOFF.md`
said ADRs 0001–0013 were accepted; 0013 is `proposed`.

## 2026-09-03 — The overfitting check: the denominator generalises, and it is still unfalsifiable

The owner asked whether fitting fairness to one practice's history would overfit, and proposed
blending a second fairness scale in "to a smaller degree, like 30%". Built
`npm run seed:entitlement` to answer it with numbers instead of an opinion — a walk-forward over
all 33 months, 68 windows at three horizons. **ADR-0015** records the decision.

**The concern was right; the proposed fix was aimed at the wrong component.** The objective is not
fitted to anything — leximax is a principle. The denominator is: `revealed-opportunity` is a model
of thirteen people trained on 33 months.

**Three findings.**

1. **No overfitting to noise.** Novelty ~3% a month, no trend over 27 months; a past-fitted
   denominator predicts the settled one to within 0.02–0.12 load-ratio points.
2. **The shrinkage blend — the owner's idea, relocated to the component that is actually fitted —
   was swept and does not pay.** Optimum λ≈0.1 against the noisy target, λ=0 against the settled
   one; worth 3% error at three months, nothing at twelve. **Smaller than the uncertainty in the
   burden weights it multiplies**, which are still `[ASSUMED]`. Declined on the measurement, not the
   principle.
3. **The finding that matters: ρ≈0.6 against unfitted bases.** The choice of denominator is most of
   the fairness verdict, and **no walk-forward can ever validate it** — every available target is
   itself revealed availability, so a doctor never offered Tuesday nights looks unavailable in all
   of them. The test proves stability, not correctness.

**Consequence: declared availability is promoted from a feature to the thing that makes the fairness
claim checkable at all.** Question 44, and it is now the highest-value question in the model.

**Built instead: envy as a reported cross-check** (`lib/analytics/envy.ts`) — a fairness scale with
no denominator to get wrong. **EF1 fails in all 68 windows**, median worst violation 27 burden units
a month against a healthy 36 comparable pairs. The load ratio calls the practice moderately unequal;
envy says it is nowhere near fair. **Both are right** — the load ratio forgives inequality that
availability explains, envy only forgives what no feasible swap could fix.

**Two things pinned by tests because they read backwards.** Envy containment runs envied ⊆ envious
(*"I would rather have your position"*), which is **not** the condition for moving the work — that
needs the reverse, and at this practice the two rarely coincide. And `isEf1` is meaningless without
`comparablePairs`: disjoint availability passes vacuously.

**Lesson, and it is the same one as 2 September.** The first shrinkage sweep I ran was rigged — the
target was ~97% the training set, so the unshrunk estimate won by construction. Adding the second,
honest target is what surfaced the real λ≈0.1. **A sweep with one target is a sweep you designed to
win.**

**Undocumented knob found:** S-01 already costs `10 × (worst − 1)⁺ + 1 × Σ(over − 1)⁺`, which is an
ordered weighted average with weights (11, 1, …, 1) — utilitarian at one end, leximax at the other.
The dial the owner asked for exists; it is the ratio between `S01_PEAK_WEIGHT` and
`S01_SPREAD_WEIGHT`, and nothing named it. Generalising it is deferred to question 43.

## 2026-09-02 — ✅ S-01 works. The earlier "not demonstrably fairer" was a measurement bug

**Correcting a conclusion recorded earlier the same day.** With both divergences removed and the
comparison put on one scale:

| Over the three-month window | His roster | The solver's |
|---|---|---|
| Worst-loaded doctor | 2.684 | **2.684** — identical, the unfixable carry-in |
| **Gini of load ratio** | 0.116 | **0.052** |

**Less than half the inequality**, on the same days with the same doctors. S-01 does what it is for.
The earlier entry said the hand-built roster was fairer; that was wrong, and the reason is worth more
than the result.

### The measurement was self-referential

`revealed-opportunity` derives a doctor's entitlement from the cells they were **observed** working.
That is correct for reporting on history — it is what ADR-0012 chose. **It is invalid for scoring a
candidate**: a roster that puts someone into a cell they have never worked *increases their own
denominator*, so two candidate rosters get marked against two different scales.

Fixed by computing the entitlement once from the history both rosters share and applying it to both
through the `explicit` basis. **The tell was that the number moved the wrong way when the model got
strictly better** — worth remembering as a signal, because a metric that disagrees with a known
improvement is more likely wrong than the improvement is.

### Contract 1.3.0 — the two divergences, deleted rather than aligned

1. **`shifts[].burdenWeight`**, resolved by the sender from its own schedule. The solver had been
   deriving weights from the flat five-key map, which cannot express Christmas night at 8.0 or a
   Pattern C long day at 1.5 — so it optimised one weighting while the analytics reported another and
   no test could see the gap. `burdenWeights` is superseded and retained only for reporting.
2. **The solver stopped computing opportunity.** It had been deriving each doctor's opportunity from
   H-05 and H-10 and *adding* it to the entitlement on the wire — two different definitions of *"could
   have worked"* summed into one number. `entitlementWeights` is now the single implementation, and
   it spans the whole period the verdict covers, this month included.

**The rule both follow: where a quantity exists on both sides of the boundary, send it rather than
recompute it.** Recomputing is how the weekday integers went wrong, and it is the same failure twice.

A third span mismatch surfaced while fixing the second — entitlement covered only the history while
the numerator covered history *plus* this month. The target month's half cannot come from
`revealed-opportunity` directly (a month being solved has no assignments, and for `--future` never
will), so the cells are learned from history and applied to the target month's days.

### What is still true

**One month still cannot repay a long ledger.** The worst-loaded doctor is identical under both
rosters because that is carry-in, not a choice available this month. What the solver improves is the
*distribution among everyone else*, which is exactly what a month-at-a-time objective can do. The
three-month window (question 43) is what makes even that possible.

---

## 2026-09-02 — a three-month ledger, the framework recorded, and a pre-push check

### The ledger is now bounded, and it is a policy not a constant

`LEDGER_WINDOW_MONTHS = 3`. The owner's steer on question 43, relayed the same day:

> *"My dad sees this as a new beginning. I don't think he would want to determine the next month's
> roster based on the previous year or two years' worth of injustices… only taking the previous 3
> months into account might be more in line with what he wants."*

**`[ASSUMED]`, not `[CONFIRMED]`** — it is the owner's reading of what the principal wants, and he
said he would check. Question 43 stays open.

It is also independently the right engineering default, which is worth separating from the steer:
against a 33-month ledger one month is ~3%, so S-01's objective is nearly flat and the solver picks
arbitrarily. Over three months a month is a quarter of the ledger and the objective has traction.

`ledgerCutoff()` is shared by the request builder and the measurement deliberately — **judging the
solver over a different window from the one it was given would be marking it against an exam it did
not sit.**

### ⚠️ S-01 is still not demonstrably fairer than the hand-built roster, and I stopped tuning

Over the three-month window the principal's own August 2026 roster scores Gini 0.082 against the
solver's 0.089. Two known inconsistencies explain why the comparison cannot yet settle it, and
**both are the same shape — two implementations of one concept**:

1. **Burden weights.** The solver optimises the contract's five flat keys; the analytics measure with
   `AGREED_BURDEN_V1`, which prices Christmas night at 8.0 and a long day at 1.5.
2. **Opportunity.** The solver derives it from H-05/H-10 structural rules; `entitlementWeights`
   derives it from observed day-class × shift-kind cells. Different definitions of *"could have
   worked"*, summed into one denominator.

**One change fixes both: send resolved per-slot burden weights and per-doctor opportunity over the
wire**, so the solver never re-derives either. That is the next solver task, and it is a contract
change rather than a tuning exercise. Continuing to sweep weights against a measurement known to be
inconsistent would have been chasing noise — the same mistake as fitting a hypothesis to a single
counterexample.

### ADR-0014: Next.js and React, not Angular

The owner asked whether to build in Angular. **The framework was never recorded** — `overview.md`
draws it, `AGENTS.md` states it, ADR-0009 rejects an alternative that presupposes it, and no ADR
chose it. That is the most expensive thing in the stack to change, and it was the one with no record.

Recommendation: **stay on Next.js**, and the reasoning is not inertia. The two properties actually
asked for — mobile and desktop from one codebase, and "support for everything we want to do" — are
**not framework properties**: the first is the PWA decision in ADR-0009, the second is the server
tier. Angular is client-first, so server-rendering the PDF export means adding Angular SSR or a
second Node service; Next gives route handlers in the same codebase, and **the export is the
product**. Angular's real strengths — enforced structure for large teams — answer a problem this
project does not have with one part-time developer and thirteen users.

Recorded `proposed`. Remix, SvelteKit, a plain SPA and native are in the alternatives table so none
of them gets re-proposed either.

### `npm run publish:check` — before the repo exists, not after

`HANDOFF.md` has said *"check `git status` shows no `private/` content before the first push"* since
Track B was written, and **that check has never been runnable** — there is no `.git` directory, by
design. So it now walks the tree and applies the ignore rules directly.

It catches the leak the other two cannot: **`names:check` and `gitleaks` look inside files**, and a
roster JPEG contains no matchable surname and no secret pattern. Copying a real sheet from
`private/source-artifacts/` into `docs/` was refused, and the same run passed once it was removed —
verified both directions, like `names:check`.

Two findings from its own first run, one of them mine: `require()` does not exist in these ESM
scripts, and my exclusion list was missing `.hypothesis/` and `.ruff_cache/` that `.gitignore` does
cover. **That disagreement is the design working** — the list is deliberately a second, independent
statement of the boundary rather than a `.gitignore` parser, which would agree by construction
including when `.gitignore` is wrong.

---

## 2026-09-02 — S-01 built, and it says the imbalance cannot be fixed in a month

S-01 is implemented: cumulative burden, normalised by opportunity, leximax level one plus a
per-doctor tie-breaker. `burdenWeights` and `burdenLedger` are consumed — **the third and fourth
fields found validated, documented and never sent**, after `recurringSlots` and following the same
pattern exactly.

### What it reports, which is the point

D01 is **55% above their fair share**, D02 44%, D04 16%, D03 15% — cumulative, over 33 months, and
per doctor with a number attached. Those are the four anchor doctors, and it matches the 52.2%
top-four concentration already in the analytics. **S-01 is not failing; it is telling the truth.**

### And what it cannot do

**Nothing the solver does to one month meaningfully changes a 33-month ledger.** Moving one shift
changes a doctor's cumulative ratio by roughly a tenth of a percentage point. So S-01's marginal gain
per disruption is tiny, and any weight large enough to matter strips weekend and night work off the
four anchors — producing a roster further from the practice's habits than any real month.

Measured, not argued. Sweeping the weights across 10/1, 2/1 and 1/1 moved weekend departure between
0.49 and 0.67 **non-monotonically**, which is the signature of a nearly flat objective: the solver is
choosing arbitrarily among thousands of near-equal rosters.

**So the trade is real and it is not a tuning problem.** The practice's established pattern *is* the
imbalance. No weight gives both.

### Two things ruled out along the way

- **Not the coarse wire weights.** Re-measuring under the solver's own five-key weighting instead of
  `AGREED_BURDEN_V1` still had the hand-built roster ahead (Gini 0.1799 vs 0.1877). The divergence is
  real and documented, but it is not what is happening here.
- **Not S-05's tier**, though that was genuinely wrong. It sat at `Tier.CONTRACT` while every other
  soft constraint sits at `PREFERENCE`, pricing one anchor miss at 6,000 against a 10% fairness gain
  at 100 — a 60:1 trade, and the reverse of the catalogue's own table (S-01 100, S-05 60). **Demoted,
  and it changed nothing measurable.** Kept because it aligns code with the catalogue and removes a
  latent 100× distortion; recorded as *not* the fix, because a correction that happens to be right
  for another reason is still worth separating from the one you were looking for.

### The contract gained `burdenLedger[].entitlement` — 1.1.0 → 1.2.0

The first implementation divided a **cumulative** numerator by a **single month's** opportunity
share. A doctor who joined recently carried almost nothing against a full month's share, read as
enormously under-loaded, and the solver handed them the month. The denominator now spans the same
period as the numerator, computed on the TypeScript side by `entitlementWeights` so there is no
second implementation of `revealed-opportunity` to drift.

### What is left is a question, not code

**How fast should the system correct an imbalance it inherits?** Correcting D01's 55% quickly means
giving them almost no work for months; correcting it over a year is invisible per month. That is a
policy the practice has to choose, and it is now question 43 with the real numbers attached.

---

## 2026-09-02 — the solver was building rosters nobody would accept, and nothing said so

The owner asked for alternative rosters plus *"a confidence interval for how likely the configuration
is to match previous months"*, so he could see *"definitively if the solver is being valuable."*
Building the measurement found that **the solver was not being valuable at all.**

### The finding

`npm run seed:solver-departure` solves a month the practice already built by hand and scores both
against the same history. For August 2026:

| axis | his roster | the solver's |
|---|---|---|
| share of shifts | 0.17 | **0.47** |
| nights | 0.16 | **0.72** |
| weekends | 0.18 | **0.47** |
| anchor slots | 0.14 | **0.76** |

Every axis further from the practice's habits **than any real month in three years.** 25 anchor slots
missed against his 4. And the solver reported `OPTIMAL`, objective 0, zero violations.

**Cause: `scripts/build-solve-request.ts` never sent `recurringSlots`.** S-05 — *prefer the anchor
doctor in their own recurring slot* — iterates `instance.recurring_slots`, so an empty array
registered no penalties. Nothing in the objective pulled toward the way the practice works.

Fixed by deriving the slots from history (`lib/analytics/anchors.ts`, a trailing six-month window so
a handover is visible). Anchor misses **25 → 0**, share of shifts **0.47 → 0.15**, against his 0.17.

**The lesson: `OPTIMAL` with objective 0 is not a good result, it is an empty objective.** Every
feasible roster was optimal because almost nothing was being scored. The solver's own outputs could
not show this — 25 tests passed throughout — and it took a measurement from outside the model.

**Still broken and now measurable:** nights 0.45 and weekends 0.32 remain far outside the band,
because **S-01 is not implemented and `burdenLedger` is not consumed.** Nothing distributes nights or
weekends at all. That is the next solver task and it now has a target number.

### The design call: departure is an indicator, never a verdict

**A similarity score would have been actively harmful, and the glossary already says why.**
*"Presenting an indicator as a verdict is the main hazard in this area"*, and the load ratio is
*"the only figure the product presents as a fairness verdict."*

Here it matters more than usual: **the historical rosters are the thing the project exists to improve
on** — Gini 0.179, top four carrying 52.2%. Scoring options by resemblance to history would rank the
one reproducing that unfairness highest. The history also contains known transcription-verified
errors, so "matches history" would score reproducing a 22-hour day as good.

So: reported **beside** the load ratio, never blended, and low departure is never presented as better.
And **no single blended number** — `analytics.md` already lists *"a single fairness score"* under what
is deliberately not measured, for the same reason.

**"Confidence interval" was also the wrong object.** A CI is a range estimate for a population
parameter. What was wanted is an **empirical reference band**: score all 33 real months against their
own preceding history and report the spread. That supports the sentence actually intended — *"about
as different from your usual pattern as an ordinary month"* — and it is measured rather than asserted.
The bands came out tight (`share 0.12–0.16`, `nights 0.19–0.26`, `weekends 0.15–0.20`,
`anchor 0.12–0.23`) and the outliers are the months the domain docs already call unusual: December
2025 tops the anchor axis at 0.50.

---

## 2026-09-02 — the project can now roster a month that has not happened

`node scripts/build-solve-request.ts --future 2026-10` → **OPTIMAL, 98 of 98 slots covered, zero
violations.** October 2026 has no sheet and never needed one: the days come from
`lib/calendar/month-days.ts` — the calendar, the weekday defaults, the holiday rules — and the
doctors from whoever worked the most recent transcribed month.

**Until now every path into the solver read a month that had already happened.** `loadSeedPeriod`
needs a sheet. That is the right way to seed a fairness ledger and useless for rostering October,
which is the operation the product exists to perform.

The refusal loop works end to end and is the shape the editor will use:

```
$ … --future 2027-03
2027-03 needs a decision before it can be built.
  2027-03-26  Good Friday falls on a Friday, which normally runs pattern B … Pattern A is
              suggested, not applied.
    → re-run with --pattern 2027-03-26=A
$ … --future 2027-03 --pattern 2027-03-26=A     → OPTIMAL, 96/96
```

**An undecided date is held out of `days`, not emitted with an empty pattern.** A day with no pattern
has no shifts, and a day with no shifts disappears from the roster silently — the worst available
failure. It comes back in its own array instead, so a caller that ignores it gets a month with a hole
it was told about.

**Fixed in passing: `--out` had never worked.** Positionals were `argv.filter(a => !a.startsWith('--'))`,
which swept up the value of every flag, so `--out private/solve-request.json` put that path into the
positionals where it was read as a seed directory — and the script reported "no seed data found" for
a form its own docblock advertises.

---

## 2026-09-02 — three constraints, one workforce event, one month

Answering a note the catalogue left open: *"H-07 went from 3 to 26 counterexamples, far more than
proportional. **Worth a look before the constraint is weighted.**"* Nobody had looked.

**The suspicion was right and the recorded boundary was a year out.** D01 worked **53% of Pattern B
Fridays before August 2024 and 9% after** — quarterly, 100% / 58% / 54%, then 8% in 2024 Q3 and never
above 20% again. `constraints.md` had said *"8.1% to 1.9% across early 2025, as the roster grew from
eleven doctors to thirteen."* Both the date and the mechanism were wrong.

**The mechanism, visible in the assignments:** `fri-early` went from D01 (14) / D03 (10) / D02 (8) to
D03 (35) / D02 (32) / **D04 (27)**, D01 down to 6. D04's overall load went from **0.09 to 0.47 shifts
a day** across the same boundary. **The same doctor, the same month, that the catalogue already blamed
for H-02's 34 doubles stopping.** H-05 fits too — D02's Saturdays go 23% → 4%, 8 of 12 counterexamples
before the boundary.

**So one workforce event falsified three constraints.** *"A constraint can be an artefact of
headcount"* was written about H-02 as a curiosity; it is the general case.

Two consequences that change what gets built:

- **H-07 stays OFF even if the principal confirms it.** He would be describing the last two years
  accurately, and the behaviour followed a colleague's availability — if D04 left it would likely
  reverse, and an encoded rule would then fight the roster he wants.
- **Constraints need a `validFrom`**, like people, weights and memberships already have. H-02, H-05
  and H-07 are all true about the practice since August 2024 and all false about it before, so a
  verdict without a span is not a verdict. Raised as a design question, not built.

Also corrected: a false claim in `solver/.../instance.py`, which told every reader that *"on every
Friday that was actually a Pattern B day, D01 is absent."* There are 26. The rescoping had been fitted
to one counterexample and never checked against the rest — the same mistake the H-07 case study in
`constraints.md` warns about, sitting in the source file the case study is about.

---

## 2026-09-02 — the pattern resolver, and a `[CONFIRMED]` claim it falsified

`lib/calendar/pattern-precedence.ts` + `npm run seed:patterns`. The executable form of the
*Precedence* section of `shift-patterns.md`, and the missing link between *"solve a month that
already happened"* and *"set up next month"* — everything upstream derived a month's days from
transcribed history, so the project could not describe a month that has not happened yet.

### The measurement nobody had taken

Over 1,005 transcribed days: **the weekday default is correct on 97.8%**, 0.8% need a human
decision, 1.4% were run differently. Two product consequences:

1. **"Set up next month" arrives 97.8% right** and asks about roughly one date every four months. It
   does not need to be a wizard.
2. **All 14 deviations are a switch to Pattern C.** Not one is A→B or B→A. So the editor needs one
   override affordance — *"this day is short-staffed, run the reduced day"* — not a pattern picker.
   `[INFERRED]` from 33 months, cheap to widen.

### ⚠️ A `[CONFIRMED]` section was wrong, and had been for a week

`holidays.md` said *"Good Friday 2025 used Pattern C … encoding 'holiday Friday → Pattern A' would be
wrong three times out of four."* **False.** All **eight** holiday Fridays in the source ran Pattern A;
zero ran C. The claim rested on a date the project brief mislabelled — 4 April 2025 was an *ordinary*
Friday running Pattern C, and Good Friday 2025 was the 18th.

**The seed transcription caught the mislabelling on 26 August 2026 and wrote it into that month's
anomalies. `holidays.md` never followed.** And the same mislabelled date had propagated twice more
into `shift-patterns.md`, which listed *"Good Friday 2025 (4 Apr)"* as a Pattern C instance and also
still said holidays *"abandon this table entirely"* — wording `holidays.md` itself corrected on
26 August. All three fixed.

Counting the full source rather than four remembered instances closed an open question and found two
things: **fourteen** Pattern C days, **none on a public holiday** (so the open question *"is Pattern C
on a holiday chosen for the same reason as elsewhere"* had a false premise — it has never happened),
and **eight of the fourteen in December or January**, which is `workforce.md`'s year-end capacity
collapse showing up in the shift structure rather than the assignments.

**The lesson is about where corrections land.** Both corrections were made — in a seed file's
`anomalies` array and in one document — and neither propagated. `docs:check` cannot catch this: the
links resolve and the IDs exist, and the prose is simply false. **A correction recorded only next to
the data it came from is half a correction.**

### And the decision not to act on 8-for-8

Tempting, and refused. `[CONFIRMED]` H-05, H-06 and H-07 were each written from *"zero
counterexamples in sixteen months"* and each was later falsified by the primary source. The evidence
goes into a new `suggestion` field — pre-selected in the prompt, **never** into `patternId` — so a
consumer that skips the prompt still gets nothing, which is the correct outcome.

### It also moved question 40 a long way

Across 144 Fridays, Pattern A appears exactly eight times, and **seven of the eight are confirmed
public holidays. The eighth is 15 December 2023**, the Rugby World Cup declaration the transcription
did not flag. A Friday drops its four-shift split only on a holiday, so the structure on that date
behaves like a holiday's. `[INFERRED]` and **not promoted** — structure is not a human source, and
that date is a Friday, so flagging it would move a real burden weight. The exemption stands; he can
close it by looking at the sheet.

---

## 2026-09-02 — S-06 built, and the solver boundary now runs end to end in the gate

Two of the three "buildable right now with no input" items from `HANDOFF.md`. The third, the holiday
calendar, is the entry below.

### S-06, the churn penalty

`previousPublished` had been validated-and-discarded since the parser was written. It now reaches
`Instance` and the model penalises moving a slot that was already published.

**Priced at `Tier.PREFERENCE` weight 80, not `Tier.CONTRACT`, and that is the decision worth
recording.** At CONTRACT it would outweigh a hundred `PREFER_NOT`s, so a re-solve would preserve the
old roster while trampling the preferences that *caused* the re-solve — the opposite of what a
re-solve is for. Within PREFERENCE it sits above S-03 (30) and S-02 (20), exactly as the catalogue's
relative weights say.

**Noticed while doing it: S-05 sits at `CONTRACT` and is the only soft constraint that does.** That
makes the anchor preference outrank every doctor preference 100×. It may well be deliberate, but
nothing records it, so it is now a row in `constraints.md` marked for confirmation rather than a
silent asymmetry.

**The graduated churn dial is not built and was not faked.** The catalogue asks for a *"how much can
it rearrange?"* control; `mode: "OFF"` is its coarsest form. A dial needs a **bounded in-tier** weight
on the wire, and the contract deliberately ignores per-request weights because an unbounded one lets a
caller reorder the tier hierarchy — which is the safety property the whole scheme exists for. Contract
change, not a model change; written up in `solver-contract.md`.

**A test I wrote was flaky and I nearly shipped it.** The first version used two doctors and three
slots, where covering everything and leaving a slot uncovered *both* cost exactly 10⁶ — a tie broken
by whichever smaller term happened to win. It passed, then failed on the next run. Rebuilt on three
doctors and three slots, where every permutation costs zero on the hard terms and churn is the only
live one. **The lesson generalises: an elasticised model makes cost ties easy to construct by
accident, and a test resting on one is non-deterministic without looking it.**

### The boundary check

`npm run solver:e2e`, now the fourth step of `solver:check`: `fixtures/seed-data` → `loadSeedPeriod` →
`inferAvailability` → `buildSolveRequest` → JSON → `parse_request` → `build` → `solve`, asserted.

**The gap it closes is specific.** `contract:check` compares field *names*, and
`fixtures/solver-request.json` is **hand-written** — so both prove the parser reads what somebody
typed, and neither would notice if the request `buildSolveRequest` actually emits stopped parsing.
**Verified by injecting a field into the emitted request and watching it fail with the JSON path**,
then reverting.

Runs on the synthetic fixture, not the real months, on purpose: it tests the boundary rather than the
data, and staying synthetic means it behaves identically on a fresh clone and keeps the intermediate
file written to the OS temp directory invented.

`call-roster-solver` gained `--request`, `--json` and `--time-budget`. Before this it could only solve
the hand-written `september_2026()`, so the CLI proved the model worked and said nothing about the
wire.

---

## 2026-09-02 — the holiday calendar became executable, and it found four wrong flags

`lib/calendar/holidays.ts` + `npm run seed:holidays`, now the twelfth step of the gate.

**The lesson: an unchecked hand-typed flag is a silent liability, and 1,023 of them had accumulated.**
Every transcribed day carried `isPublicHoliday`, nothing in the gate compared it to anything, and no
analytics module read it — while `classifyDay` turns it into a burden weight. Four disagreements on
the first run, from three different transcription sessions.

Three were **missed** holidays and all three are weekend dates, so `classifyDay` gives Saturday and
Sunday priority and **no burden weight changed**: 2025-04-27 (Freedom Day, Sunday), 2025-08-09
(Women's Day, Saturday), 2026-08-09 (Women's Day, Sunday). Corrected in `private/seed-data/`. June
2024 had already flagged both halves of a Sunday holiday and written the reasoning into its notes;
the two later months did not follow it. **The rule was documented and still applied inconsistently** —
which is the argument for computing it rather than typing it.

The fourth, **15 December 2023**, is *not* corrected. It is a Friday, so flagging it would move a real
shift's burden, and the December 2023 sheet is not in `private/source-artifacts/` to check. Carried as
the one entry in `ACCEPTED_DIVERGENCES` — question 40. A stale exemption is itself checked for.

### Two findings the document did not have

**The "unpredictable" 27 December declarations are predictable.** `holidays.md` lists 2011, 2016 and
2022 as ad hoc proclamations. All three are the years **Christmas fell on a Sunday**: s2(1) moves it
to the Monday, which is already Day of Goodwill, so the automatic rule yields no day off and a
proclamation has to. Over 1995–2080 it is the *only* collision the statutory rules can produce. Next:
**2033, 2039, 2044** — so the product can warn instead of being surprised. `[INFERRED]`; election days
and the 2023 Rugby World Cup declaration stay genuinely unpredictable.

**Two statutory holidays can share one date.** 21 March 2008 was Human Rights Day *and* Good Friday —
the only coincidence in the window. One holiday, both names, one cell. s2(1) substitutes only for a
Sunday, so nothing extra is granted and none is invented.

### Two test premises were wrong before the code was

Written from intuition and falsified immediately: *"2027 has no Sunday holiday"* (it has two), and
*"the next collisions are 2033 and 2039"* (2044 too). Both were **my assertions, not the module's**,
and the loop-over-a-century property tests caught both. The synthetic fixture also had 1 January 2027
running Pattern B — a holiday Friday, which `holidays.md` confirms drops Pattern B. Fixed, and it now
exercises that rule instead of contradicting it.

---

## 2026-09-02 — DECISIONS.md compressed, and MCP servers researched

**Compressed this file 1,902 → 921 lines** to the terse format noted at the top. Kept every lesson and
every reversal; dropped what a durable document already records. The recurring saving is in the
*writing* — future entries are a third the length.

**⚠️ It tripped `names:check`, which found a real limitation in the check itself.** An allowlisted
literal was broken across a line by 100-column prose wrapping, so `indexOf` could not match it and the
check fired on an already-approved phrase. **Third time writing *about* the check has tripped it.**

Fixed properly rather than by adding a second allowlist entry: allowlist matching is now
**whitespace-insensitive across the phrase interior**. This does not loosen anything — the surname
patterns are matched separately — it only lets an approved phrase be recognised when wrapped. **Proven
both directions**: a bare surname still fails the gate, a wrapped allowlisted phrase passes.

### MCP servers — researched, and the answer is "almost none, for now"

The registry returned **no connectors** for this account, so this is a config-file decision.

**MCP tool definitions cost roughly 250 tokens per tool, charged every turn** — three servers with 81
tools measured at 20,000+ tokens before any work started, and the GitHub server alone at ~55,000. **So
adding servers works directly against the thing this session just fixed.**

The test became: *does it do something a CLI or an existing tool cannot?* Mostly no — `gh` is already
installed, file and browser tools already exist. Full table in
[`ops/environments.md`](ops/environments.md).

**⚠️ The finding that matters: a Postgres MCP pointed at the pilot database would defeat this
repository's entire architecture.** The repo holds no real names because everything uses `D01`…`D16`.
**The running application is the opposite — the `doctor` table is exactly where the thirteen real names
live**, because the principal must see them on what he prints. Querying it pulls those names into a
third-party model: a POPIA s72 transfer, and the exact sub-processor leak ADR-0013 exists to prevent.

So: **dev database with synthetic names only, read-only, connection string never committed.** Same
reasoning that keeps Graphify's semantic extraction off. **The tool being useful has never been the
question.**

---

## 2026-09-02 (later) — measured where the credits actually go, and halved the per-session floor

Measured rather than guessed: the four files loaded every session came to **1,970 lines / 113 KB ≈ 28k
tokens before any work started.** Now 827. Ceilings for all four are in `AGENTS.md`, with the
instruction to *split or archive, not shave prose.*

**⚠️ The finding: I was writing every session's history twice.** `HANDOFF.md` had 22 top-level
sections, 19 of them history — and CLAUDE.md tells a cold session to read it *"in one read"*. Every
one of those 19 duplicated a `DECISIONS.md` entry written the same session. **The waste was in the
writing as much as the reading**, and output tokens are the expensive ones.

I wrote the rule this broke — *"many small documents beat one big one"* — and then spent fifteen
sessions violating it. **An append-only file does not feel like a growing cost while you are appending
to it.**

Fix: `DECISIONS.md` is the one journal (read on demand, so length is free); `HANDOFF.md` is current
state only and is **overwritten**, ceiling 200 lines; 1,169 lines archived to `history/`, marked *do
not read, do not add to*.

Two more:

- **`.ignore` added.** This repo has no `.git` yet, and **ripgrep only honours `.gitignore` inside a
  git repository** — so every search walked `.next/`, `coverage/` and `.hypothesis/`. Not theoretical:
  a search that morning returned five `.hypothesis/constants/` hits, each a single line containing
  every string literal in the solver.
- **Graphify was already built and unused.** Four runs in `graphify-out/`, latest 1,198 nodes over 108
  files, and its own report says **`Token cost: 0 input · 0 output`** — extraction is deterministic.
  Refreshing is free, so it should be the first move for "where is X", not a fallback.

---

## 2026-09-02 — diagnostics for the pilot: ADR-0013, and a "no" worth writing down

Owner asked for rigorous log collection for his dad's pilot month, so faults can be fixed **without
asking him how it broke.** Researched, decided, documented. Nothing built — documentation was the ask.
[ADR-0013](architecture/decisions/0013-first-party-diagnostics.md) carries the eleven rejected
alternatives; [`ops/diagnostics.md`](ops/diagnostics.md) the six-layer design.

**The decisive fact was already in the repo.** Supabase has no South African region (found 26 August,
re-verified). So the roster data already crosses the border under **one** operator agreement, and
logging into that same Postgres adds no new transfer, no second s72 agreement, no second
sub-processor. A third-party tracker adds all three, for two months and one user. `compliance.md` had
already predicted precisely this — *"where the leak actually is: not the database, the
sub-processors."* ADR-0013 implements a position the project already held.

**The insight that shaped it: the bugs will mostly not be crashes.** A roster editor's real faults are
a warning that fires when it should not, an export that comes out wrong, a cell that refuses an
assignment. **Nothing throws**, so an exception tracker would see none of it. The primitive is
therefore the **intent stream, not the stack trace** — an append-only command journal, replayable
because published rosters are already immutable snapshots. Strictly better than a recording:
breakpoints work and the reproduction becomes the regression test. **It also collapses two jobs into
one** — the journal *is* the ECTA s15(4) audit trail `compliance.md` requires.

**⚠️ Session replay prohibited permanently.** It is the obvious answer to "let me see what he did",
which is why it is rejected explicitly rather than silently. The main screen is a grid of thirteen
identifiable doctors' movements; masking is opt-in per element and one missed cell uploads exactly what
the repository architecture exists to prevent. A rare case where the privacy-preserving option is also
the technically better one.

Three rules that came out of it:

- **`console.log` prohibited in production paths.** A host's log drain **is** third-party log
  aggregation — an unregistered sub-processor. It looked like the zero-cost option.
- **Redaction is a type, not a habit.** A diagnostic record cannot express a name. And stated
  explicitly: **doctor codes are pseudonyms, not anonymisation**, so retention still applies.
- **`appRunId`, not `sessionId`** — the glossary reserves `session` as a rejected synonym for `shift`.

---

## 2026-09-01 (last, and the boundary is closed) — history → solver, nothing hand-written in between

`npm run seed:request` runs the real pipeline: 33 months of sheets → `loadSeedPeriod` →
`inferAvailability` → `buildSolveRequest` → `parse_request` → CP-SAT → **OPTIMAL, 0 violations.** The
eight availability rules the solver received were *derived from history*, not typed in, and they match
what `september_2026()` has hand-written. **Two implementations, opposite directions, same answer.**

Two more boundary mismatches, found the same way as the day before — by writing the code that crosses
it:

**6. `ShiftKind` was a different enum on each side.** Python had seven members, TypeScript five. A
TS-built request would have been rejected on `long-day`, which is the *good* case. The bad case:
Python applied `fri_evening` to **Pattern C's evening shift**, and a Pattern C day is not a Friday —
the label already lied for one of three patterns. TypeScript's vocabulary won on the glossary's own
terms: it defines the burden axis as *"day class × shift kind"*, so `kind` is a **burden** concept,
while `fri_early` describes a *position in a pattern* that `patternId` already states.

Fixing it fixed a visible bug: the debug grid hard-coded `morning`/`afternoon`/`night` rows, so
**three of Friday's four shifts were invisible.**

**7. ⚠️ `dayClass` is lossy about the calendar.** `classifyDay` deliberately lets Saturday and Sunday
outrank `public-holiday` — the principal said a holiday on a Saturday *"counts once as a Saturday"* —
which is right for burden and means **a weekend holiday is not in `dayClass` at all.** The builder
would have sent `isPublicHoliday: false` for every one. Two different facts, so two fields now:
`dayClass` answers *"how is this weighted"*, `isPublicHoliday` answers *"was the country on holiday"*.
**It happens not to bite H-10** — that rule does not apply at weekends — which is exactly why it would
have survived a long time.

**The builder is deliberately not a validator.** The Python parser is the authority; duplicating its
rules would give two disagreeing answers. The builder's job is to make the rejected things
*impossible to express* — weekdays converted in one place, `endsNextDay` derived from arithmetic,
`kind` off the typed definition. It refuses only what the parser cannot see: a day whose pattern was
not supplied (which would let the solver fall back to its own table — the single-tenant leak), a
second availability rule, a day outside the horizon.

Two defects of mine caught by the gate: `?? new Map()` infers `Map<any, any>` and the `any` propagated
into nine `no-unsafe-*` errors; and a dead `buildWorkforceTimeline` call whose docstring **described
code that was not running.** Also fixed: `npm run solver:run` could not execute at all — nested quotes
in the PowerShell command.

---

## 2026-09-01 (last) — the request parser, and why the contract had five holes in it

The plan was one line: feed `inferAvailability` into the solver instance. Doing it meant writing the
Python side of the boundary, and **writing the parser is what found the problems** — not reading the
document, which I had read several times.

**The root cause: the parser did not exist.** The only way to obtain an `Instance` was a hand-written
fixture, so the contract described a payload **nothing could read** and every field was unverified by
construction. **A document is not a contract until something parses it.**

Five mismatches:

1. **`availability` was not in the request at all** — H-10 existed on both sides and could never have
   crossed.
2. **Weekday integers meant different days on the two sides.**
3. **`fte` cannot be defined here** — no doctor works full time at this practice.
4. **`days[].shifts[]` was sent and then ignored.** `Day.shifts` read a module-global `PATTERNS` table;
   the contract sent shifts, the solver used its own, and they agreed **only because there is exactly
   one practice.** The single-tenant leak
   [ADR-0010](architecture/decisions/0010-productisation-seams-first.md) exists to prevent.
5. **Shift objects had no `kind`**, which `is_night` needs, which H-04 needs. Inferring it from
   `endsNextDay` works for all three current patterns *by coincidence*, and the first pattern that
   broke it would break H-04 silently.

Four parser rules, one of them unusual. Unknown fields are rejected **at every level** — a field the
sender believes is honoured and the receiver drops surfaces as a wrong roster months later in another
language. Weekdays arrive as names. Shifts come from the payload. **No silent default for anything
semantic** — *"sensible default"* is how a roster gets built on the wrong assumption. The unusual one:
**`constraints[].weight` is deliberately not applied.** Modes are read, but a per-request weight
override would let a caller reorder the tier hierarchy, and **that hierarchy is the safety property.**

**`npm run contract:check`, and I proved it.** Three-way check with no hand-maintained duplicate: it
extracts `_*_FIELDS` from `contract.py`, parses the JSONC out of the contract document, reads the
shared fixture. Ten deliberate defects planted one at a time, **all ten caught** — including "the
parser was restructured so no field sets are found", because a regex extractor that silently finds
nothing would make every other check pass **vacuously.** It also found a false positive in itself:
`burdenWeights.weekday_day` is a burden *class*, not a weekday.

**⚠️ Where I disagree with an instruction I wrote earlier.** `AGENTS.md` and the contract both said
boundary types are *"generated from `solver-contract.md`, never hand-written."* **Generating types
from a prose document is the wrong direction** — the schema should be the machine source and the
document its rendering; a spec written for humans is a bad parser input. Both files now say the truth:
hand-written today, known gap, `contract:check` is the stopgap, generation still the intent **from a
single machine-readable schema.** Zod waits until there is an API route to validate at.

---

## 2026-09-01 (later, again) — contract 1.1.0: a live weekday bug, and a field that cannot exist

**⚠️ A weekday integer means two different days, and it was already live.**

| | | `MONDAY` | `SUNDAY` |
|---|---|---|---|
| TypeScript | `Date.getUTCDay()` | **1** | **0** |
| Python | `date.weekday()` | **0** | **6** |

Neither side is wrong — each matches its own standard library, and neither can reasonably change. So
D07's Monday exception is `1` in one file and `0` in another. **Sent as an integer it becomes Sunday on
arrival with no error anywhere** — the roster is simply wrong, on the one day nobody was looking at.
Already present in `AvailabilityRule.exceptWeekdays` and `RecurringSlot`; it had not bitten only
because nothing crossed the boundary yet.

Fix: **the wire type for a weekday is a name**, converted once per side in
[`lib/contract/weekday.ts`](../lib/contract/weekday.ts) and `wire.py`. Both reject an unknown name
rather than defaulting, and both reject an out-of-range integer — Python's negative indexing would
otherwise turn `-1` into `SUNDAY` silently. **Their tests pin the asymmetry deliberately**: `MONDAY
=== 1` here, `MONDAY == 0` there, so anyone "fixing" either side to agree breaks a build.

**H-10 had no wire representation.** The workaround a reader would reach for is the trap: encoding
*"D06 cannot work weekday mornings"* as `UNAVAILABLE` preferences spends the H-08 budget on a fact the
doctor never chose, needs every date enumerated so it expires at the horizon, and **loses the
public-holiday exemption** — the counter-intuitive part, so the part that would break.

**`fte` removed from the contract.** No doctor works full time here, including the principal, so there
is no baseline to take a fraction of and any value would be invented. It sat one line from
`burdenLedger`, which is exactly where it would have been misused —
[ADR-0012](architecture/decisions/0012-fairness-normalised-by-opportunity.md) is explicit that burden
÷ FTE is the trap. Annotated but kept in `data-model.md` as question 36, since dropping a column is
the owner's call. **`ADR-0008` still shows `fte numeric` and was left alone deliberately** — an ADR
records what was decided at the time, and editing one retroactively destroys the thing it is for.

---

## 2026-09-01 (last) — H-10 in the solver, and H-06 was modelling an effect as a cause

**H-06 was backwards, and expensively so.** The solver held `friday_back_half_excluded = {D01–D04}` as
a list of **banned** doctors at effectively 10⁵. That is an effect modelled as a cause: **the anchors
are not banned from Friday evening** — 17:00 is simply the first hour the pool exists, so the pattern
is a consequence of who is *available*. Two independent reasons the weight was wrong: the principal
confirmed the breaches were **requested**, and there are 11 across 33 months, so at 10⁵ the solver
would have refused Friday evenings to anchors who wanted them. **Demoted to PREFERENCE weight 1**, with
the real cause modelled as **H-10**.

**H-10 is deliberately distinct from H-08.** H-08 is a doctor *declaring* unavailability for a date,
and is budgeted because unpriced declarations inflate until the model jams invisibly. H-10 is a
standing fact about where the doctor *is* — no declaration, no budget, no per-date variation. The
**holiday exemption lives inside `AvailabilityRule.blocks()`**, not at the call site, so a caller
cannot forget it.

**⚠️ My first weighting was wrong, and a test caught it.** I priced H-10 *equal* to a coverage
shortfall, reasoning that a doctor at another practice and an empty slot both leave nobody in the
building. The test expecting a violation found none — the solver had worked out that leaving two slots
empty was cheaper than assigning an unavailable doctor twice.

Investigating produced the better model. **Equally empty is not equally bad:** an empty slot is visible
and tells the principal he has a problem, while a phantom doctor produces a roster that **looks
complete and is not.** H-10 now costs twice a shortfall, so the model leaves the gap showing.

**Worth noting how it surfaced:** not by reasoning about weights, but by writing a test that asserted
the wrong thing and asking why it failed. **The failing test was right to fail.**

---

## 2026-09-01 (later still) — availability derived from data, and two of my own errors caught by it

`lib/analytics/availability.ts` now derives the anchor/pool split that `capacity.ts` previously took as
two hard-coded arrays.

**The distinction the module refuses to blur.** The GP fact is **availability** — a pool doctor cannot
work a Tuesday morning, and no penalty weight makes it possible. D03's no-nights is a **preference**,
`[CONFIRMED]` *"yes but flexible"*; modelling it as unavailability would silently remove a flexibility
the principal told us he has.

Given only 33 months of who-worked-what, it derives **anchors D01–D05, everyone else pool** — exactly
what he confirmed — and independently finds the D07/D09 Monday exception. **The holiday exemption is
load-bearing in the inference, not just the rule:** a pool doctor working a holiday daytime shift is
*not* evidence they can work an ordinary weekday, and counting those 40 shifts would reclassify most of
the pool as anchors.

**⚠️ Two errors of mine, both caught by running it.** My first `tierOf` was binary and returned
'anchor' for anyone with *any* weekday exception. Over the real data it classified **D07, D09 and D16
as anchors**, overcounting anchor capacity by three and **understating the pressure** — the wrong
direction for a warning. The quantity is genuinely graded, so `restrictedEligibility` returns a
**fraction**; those three come out at 19.5%, one weekday in five.

**And figures I had already published were wrong.** `workforce.md` said *ten of 33 months could not
have tolerated an anchor absence, four with no slack*. With graded eligibility it is **six and two**.
Corrected in place. **Worth noting the direction: the correction makes things *less* alarming, which is
the direction a reader is least likely to challenge and therefore the one most worth catching.**

Lint caught a third: `AvailabilityRule` was a single-member discriminated union, so its discriminant
check was provably dead. That file's own comment says *"a rule nobody needs is a rule that gets
misused"* — which applied to itself.

---

## 2026-09-01 (night) — pre-flight capacity, and a hypothesis that failed

**The feature I set out to build does not work, and the one that fell out of it does.**

I wanted anchor pressure as a **predictor of H-02 breaches**. The reasoning was clean: the doubles
cluster in 2024, 2024 had three anchors instead of five. **It does not predict them** — correlation
0.611 across 33 months. May 2025 ran at 0.91 pressure with **zero** doubles; March 2024 ran at 0.64
with three. **The date separates the eras, not the load**: what changed in August 2024 was D04 taking
Tuesday night — composition, not pressure. Recorded as failed in the module, the tests and the
script's output, with the *"this does NOT predict breaches"* caveat asserted by a test, because that is
exactly the sentence a later reader would drop.

**What fell out is better, and uncomfortable.** Pool GPs cannot work a weekday slot before 17:00, so a
month's slots split into two pools that **cannot substitute for each other** — ~42 restricted, ~53
open. Pool doctors covered **14 of 1,356** restricted slots. Restricted slots consume **74% of an
anchor's whole monthly capacity** before any night, weekend or holiday shift.

**The consequence that matters commercially: adding pool doctors does not help.** Recruiting five more
GPs changes nothing about the bottleneck, because none can work a Tuesday morning. Asserted as a test,
because it is what a naive headcount forecast gets wrong and the first thing a practice under pressure
would try.

It needs no solver — it is subtraction, and it answers *"how many of us can be away at once"*, which is
the question the principal actually has.

---

## 2026-09-01 (late) — an audit for incoming-information blockers, and the missing trigger

The owner asked whether anything would block when the information he was gathering arrived.

**⚠️ The burden schedule could not express the answer to question W**, which was close to embarrassing:
the whole point of an ordered rule list was that agreeing a weight becomes a *data* change.
`patternId: 'B'` looks like it expresses "a Friday from 17:00" — **it does not.** A Friday that is a
public holiday runs Pattern **C**, whose `red-evening` is also 17:00–23:00. A pattern-keyed rule would
have priced Good Friday evening as a weekday and every other Friday evening as a weekend. Fixed by
giving `BurdenMatch` `weekday` and `fromHour`, and `validateBurdenSchedule` now rejects a weekday of 7
or an hour of 24 — those silently never match, so the schedule would look correct and quietly price
everything at the catch-all.

**The branding seam was documented but not built**, so the logo and template would have arrived with
nowhere to go. Two decisions worth keeping: **a logo must be a `data:` URI, not a URL** (an external
image fails offline, fails in a PDF, and leaks a request to whoever hosts it), and **`labelFor` is a
function, not a map**, so the code-to-name mapping never has to exist in the export layer.

**A near-miss worth recording.** I thought `parseMonth` would accept `'2025-XX'` because `NaN < 1` and
`NaN > 12` are both false. It does not — the NaN propagates to `dayOfWeek`, which rejects it. **The
validation is correct by luck of composition rather than by intent**, and a refactor that stops calling
`dayOfWeek` would reopen it.

**The trigger this project had twice said it needed**, now built as `lib/analytics/workforce.ts`. H-02
and H-07 both turned on **headcount**, not habits, and the catalogue only ever got re-verified when
somebody *stated* a new rule. Given only the assignments it derives **D04 joined 2024-03-21** — the
exact date read off the sheet by eye.

**And it produced a finding about our own past work:** the original 15-month window **contains four
workforce changes**, so even that verdict was averaging across compositions and nothing flagged it. The
longest genuinely stable span in 33 months is **eight months**. That reframes the guidance: *"re-verify
when the workforce changes"* is not enough when the workforce changes every three months. The usable
version is **a verdict should name the span it was computed over.**

---

## 2026-09-01 (evening) — the export layout, built from the photographs

**H-07's jump from 3 counterexamples to 26 is a behavioural change, not a measurement artefact.** D01
worked **8.1%** of Pattern B slots before April 2025 and **1.9%** after — a four-fold drop across a
boundary coinciding with the practice growing from 11 doctors to 13. The consequence matters: **H-07 as
written is a rule about the present applied to the past.** Weighted over the whole history it looks
broken twice a month; over the last eighteen months, twice a year. Which raises a design question —
**constraints may need a `validFrom` like everything else in the temporal model.** People, weights and
memberships have one; constraints do not.

**The seasonal capacity claim fails its second test too.** Distinct doctors working: non-December mean
**12.9**, Dec 2023 **11**, Dec 2024 **12**, Dec 2025 **14**. December 2025 had *more* doctors than an
average month. The effect appears in one year of three — the year with the fewest doctors. **The likely
reading is better than the original: the effect faded as the roster grew.** So the real risk is
headcount slack going negative in *any* month, not the calendar; a December-keyed forecast would have
fired uselessly twice and missed the mechanism.

**The export layout built and verified against 1,023 real cells across 33 months**, every one in the
correct weekday column, wired into the gate as `npm run seed:layout`.

**The five-row rule is the find.** A Sunday-start calendar needs six week-rows for ten of the
forty-eight months 2023–2026 — and the practice never prints six. Trailing days wrap into row one's
*leading* empty cells. Not cosmetic: a sixth row changes row height, which changes whether the grid
fits a page. December 2023 forced wrapping and spilling to be one computation, because it does both.

**The rendering is deliberately not built.** The template has not arrived, and it is precisely the
details he said he would notice that a photograph cannot settle — column widths, print size, how an
over-long name is handled. **A wrong colour is fixed on Tuesday; a cell in the wrong column prints and
looks plausible.**

One test of mine was wrong and the code was right: I asserted a spill into a wrapped March 2025 would
be dropped for want of a free Tuesday cell. Row one's Tuesday *is* free in a wrapped month, and that is
calendar-correct.

---

## 2026-09-01 (later) — all nineteen sheets transcribed, and H-02 falsified after all

**33 continuous months, 3,145 assignments, December 2023 to August 2026, zero validation errors.**

### The H-02 sequence is the most instructive thing in this project

On 31 August the principal said one-shift-per-day *"should be absolute but it has happened, and so the
app should still allow for it."* At that moment there were **zero counterexamples in 1,430
assignments.** His answer contradicted the data. It was acted on anyway — a human source outranks an
incomplete dataset. The next day the older sheets produced **34 counterexamples.**

**A system that had trusted 1,430 assignments over the practice principal would have shipped a hard
constraint refusing roughly one roster a month for the whole of 2024.** The clearest vindication of the
confidence-tag discipline this project has produced — and **it only paid because it was followed when
it felt wrong.**

### A constraint can be an artefact of headcount

The 34 are not scattered: **D03 held both Tuesday afternoon and Tuesday night for most of 2024.** D04
does not appear anywhere before 21 March 2024, and the doubles stop in **August 2024**, the month D04
takes Tuesday night, never recurring. So H-02 was false for eight months and then became true — **not
because a rule changed, but because the roster gained a doctor.**

### The rest

- **The fairness normalisation held across a doubled dataset**: Gini on raw burden rose 0.341 → 0.375
  while Gini on **load ratio** fell 0.186 → **0.179**. The right direction, because the added months
  hold more short-tenure doctors whose raw totals are small and whose opportunity sets are too. The
  strongest available evidence that ADR-0012 is not overfitted to the original fifteen months.
- **The GP availability fact got stronger**: 1.3% of pool shifts start before 17:00 on a weekday, down
  from 2.6%, and pool doctors work **40** daytime shifts on public holidays.
- **A third date-label error, all the same fault** — the Word template repeats a day number in the
  trailing cell. **Every adjacent pair of sheets agrees on its shared date**, so the cross-validation
  chain is unbroken across all 33 months.
- **The 29 May 2024 general election was a declared public holiday** — not one of the twelve statutory
  dates, so a calendar built from computus plus fixed dates would miss it. Ad hoc holidays must be
  data.
- Two overclaims of mine in the March 2024 notes were corrected once April's data contradicted them.
  Both said the doubles *"stop dead"* when D04 arrives; they become intermittent and stop five months
  later.

---

## 2026-09-01 — nineteen more sheets, and a claim of mine falsified

Nineteen sheets covering December 2023 – June 2025 arrived, closing the May/June 2025 gap that had made
per-doctor totals non-comparable.

**A doctor was missing from the code mapping entirely** — present throughout Dec 2023 – Jun 2025 and
never in the original window. Assigned **D16**. ⚠️ **Their surname was not in the SURNAMES block, so
`names:check` would not have caught it leaking into a committed file.** Added; the check now protects
19 patterns. **Second time the data boundary has been extended by new source material arriving, and the
pattern is worth naming: the check is only as good as the list, and the list grows when history does.**

**A claim of mine was falsified.** `fairness.md`'s seasonal-capacity section was built on December 2025
and read it as evidence the principal absorbs an exceptional December every year. Three Decembers and a
22-month baseline say otherwise: **December 2025 was 1% *below* his own mean**, December 2024 19%
below, and only December 2023 heavy (+51%) — in the year the practice was three doctors short. **Two
mistakes made it: a single month read as a pattern, and composition mistaken for volume.** Christmas
night and three year-end long days are *visible*; priced correctly they do not make an exceptional
month.

What survives is better supported: the annual Christmas rotation is real and visible — **D08 → D11 →
D01** across 2023–2025, with D01 working no Christmas shift at all in 2024. The owner's decision that
absorbed burden stays in the objective also survives untouched; it was a policy judgement, not an
inference from that month.

The validator gained a **declared-anomaly escape for H-02**, deliberately narrow (the double must be
declared per date), because a transcription slip is the likelier cause. A validator refusing to ingest
history the principal actually produced would be the same mistake the solver stopped making the day
before.

---

## 2026-08-31 (evening) — the practice principal answered thirty-one questions

Full record with exact wording in [`NEEDS_YOUR_INPUT.md`](NEEDS_YOUR_INPUT.md).

### I had the principal's own code wrong

**D01 is the practice principal, not D02.** The repository had it right throughout — but I addressed
several questions to him using **D02's** figures, so two answers are second-hand about a different
doctor and are tagged that way. **The error was in conversation, not in the code: the docs were the
reliable copy and my working memory was not**, which is exactly the argument for writing things down
that this project already makes.

### The most explanatory fact in the project, and it was verified

*"GPs can't work before 17:00 since they are working at other practices."*

Rather than accept it, a script tested it: of 505 pool-doctor shifts only **13 start before 17:00 on a
weekday (2.6%)**, and eleven of thirteen pool doctors have zero. **The mechanism verified too, which is
the part that matters:** on *public holidays* pool doctors do work daytime shifts, because their own
practices are closed. The constraint holds on weekdays and dissolves on holidays, exactly as the stated
cause predicts — much harder to get by coincidence than the pattern alone.

It explains four things previously recorded as unrelated oddities: H-06, Pattern C, the diary's
Friday–Sunday triples, and why the weekend boundary is 17:00.

**Deliberately not given a constraint ID.** It is not a rule the practice applies; it is a fact about
where thirteen people are on a Tuesday afternoon. As a constraint it would sit in the penalty registry
**reporting a "violation" every time it was respected.** Its home is per-doctor availability data.

### The weight table is agreed, and one thing his answer did not settle

Schedule promoted `illustrative-v1` `[ASSUMED]` → **`agreed-v1` `[CONFIRMED]`**.

- **Question S is closed and I was wrong about it.** I had flagged Sunday-night-equals-Sunday-morning as
  an obvious shortcoming, with a test comment saying the test *should* fail once real weights arrived.
  They arrived and it does not. The equality is deliberate.
- **Saturday and Sunday now outrank `public-holiday`** — *"it counts once as a Saturday, not a Saturday
  and a holiday."* Sunday is `[INFERRED]` by symmetry; he was asked about Saturday only.
- **⚠️ The agreed table has no Friday row**, so a Friday evening still prices as a Tuesday while the
  weekend demonstrably starts at Friday 17:00. **He approved a table that does not mention Friday,
  which is not the same as deciding Friday is weekday work.** Logged as **W** and not guessed: it would
  move ~120 shifts between bands and would *raise* the load ratios of the three doctors already showing
  as most overloaded. `isWeekendShift` and `resolveBurden` are kept separate, with a test asserting it.

### 29 reorders the priorities

> *"That everyone gets accommodated as close as possible to their requests."*

**Not fairness and not speed.** The pitch had been leading with the cross-month fairness ledger; his own
answer is preference satisfaction. Not in conflict — the ledger is what stops accommodation being
captured by whoever asks loudest — but the ordering was the other way round.

### The rest

- **H-02 stopped being hard** — the fourth constraint in that file caught by the same mistake. No
  database change needed: the GiST constraint forbids *overlapping* shifts, and 07:00–15:00 alongside
  23:00–07:00 does not overlap.
- **Anchors work 14–15 shifts a month, pool doctors 3–6**, matching the transcribed data closely
  (D01 15.3, D07 5.2, D12 3.2). Usable for forecasting; **not** as an entitlement, because he said
  there is no set amount.
- **The 90-day departure threshold was my guess and it matched his.** Promoted from `[INFERRED]`.
- **Everyone is a contractor**, so BCEA rest provisions do not bind; the 8-hour turnaround is confirmed
  acceptable for the third time. **No doctor pairs** need special handling.
- **Tick marks in the diary are that doctor's monthly shift count** — an independent cross-check on
  transcription accuracy, worth wiring into `seed:check`.
- **The roster is private to the doctors.** No switchboard, no nursing manager.
- **Six hours a month** is the baseline to beat; the worst part is collecting requests and fitting them
  together.
- **The 3am sick call: a considered "don't build it."** *"Each time it happens it's different and so is
  the solution."* Agreed on automating the *decision*. One distinction kept: **recording** the change
  must stay trivial, because the 1 January disagreement is exactly such a change and it left two sheets
  contradicting each other.
- **The draft-then-final lifecycle is his own proposal**, written up in
  [`product/lifecycle.md`](product/lifecycle.md) with the seven failure modes it must be designed
  against. The honest position is recorded there: **a draft round can make the job worse**, and whether
  it helps rests on an unproven hypothesis. The measurement after the pilot is not *"did it work"* but
  *"did the six hours go down"*.

---

## 2026-08-31 (later) — twelve owner answers, and the one that exposed a real gap

### 19 was a requirement, not an answer — and it was not being met

> *"…without having doctors that have left skew the analytics or fairness scale."*

Checking rather than assuming found two failures, both invisible to reasoning. **The two departed
doctors were excluded from the headline only by luck** — they trip the 20-shift bar, but a departed
doctor with 25 shifts would have sat in the fairness average permanently. And **a recent joiner was
being judged**: D05 cleared both absolute thresholds and was reported as carrying 30% more than his
share **on ten weeks of evidence.**

Added `membership` (90-day trailing gap) and `presenceShare` (under 50% of the period is low-sample
regardless of shift count). Neither group is hidden — both keep correctly-scoped rows; what they lose is
a vote in the practice-wide headline, which is a claim about who is being rostered *now*.

### 8 answered the weekend question and immediately exposed a pricing gap

Friday is part of the weekend — which explains Pattern B rather than merely observing it. But the burden
schedule puts Friday in `weekday`, so **a Friday night prices at 2.5 and a Friday evening at 1.0, the
same as a Tuesday.** If Friday is weekend work, every load ratio computed so far under-credits whoever
works Fridays.

**And it matters *who*: D02 worked 45 Fridays, D03 43, D04 33 — and D01 only 4.** The three doctors
already showing as most overloaded are the ones absorbing the under-priced shifts, **so the real figures
are worse than reported.** Added a `fridays` count so the gap is visible rather than silent.

That same count quantified H-07 as a by-product: **D01 worked 4 Fridays in 230 shifts, 1.7%** — still
WARN, but a far better description than "usually".

### 22 was stronger than what had been recorded

> *"There are no doctors on this roster, including the principal, that works full time at this
> practice."*

The earlier note said most *pool* doctors had a primary practice elsewhere. In fact every doctor does.
**There is no full-time baseline anywhere, so FTE is not a missing measurement — it is an undefined
quantity.** That makes ADR-0012's opportunity-based denominator the only one with a defensible
definition rather than the best of four, and it retires "overtime" as a word this product can use.

### T answered in the most useful way available

> *"I think they have an unwritten rule between the two of them but it's not a formal rule that gets
> enforced."*

So the weekend split is real and informal, which rules out the tempting move. **No constraint, no ID, no
solver rule** — an unwritten arrangement between two colleagues becomes a cage the moment a system
enforces it. Recorded under a new *"Observed tendencies that are deliberately not constraints"* heading
in [`domain/constraints.md`](domain/constraints.md), which exists so a future session does not
rediscover it and promote it.

### Smaller

- **ADRs 0001–0012 accepted.** A new ADR still starts `proposed`.
- **Q retracts evidence.** The duplicate April 2025 sheet was two copies in one batch, not a reissue, so
  the version/reissue concept now rests only on the 1 January cross-sheet disagreement.
- **32 is still open and worth being precise about**: he approved the *scheme*, but has not read
  `private/doctor-codes.md`. The code-to-name pairs remain unverified, and the whole ledger is keyed to
  them.
- **WhatsApp verification deferred** until after a pilot month. One consequence: for the pilot, requests
  keep arriving by WhatsApp and the principal types them in — so **v1 needs a *good* manual
  preference-entry screen, not a stopgap.** It is the tool that replaces the paper diary.

---

## 2026-08-31 — the analytics engine, and normalising fairness across unequal availability

Two owner requests turned out to be one problem: a comprehensive analytics section, and *"a way to
normalize the data for the doctors that only work weekends or only work weekdays"*. Design in
[ADR-0012](architecture/decisions/0012-fairness-normalised-by-opportunity.md).

### The owner named half the failure mode; the other half is worse

He described a lightly-committed doctor being pushed to work more because the analytics call them a
slacker. **The mirror image is more damaging and it is the one that would have shipped:** a
weekends-only doctor works nothing but high-burden shifts, so **any** per-head or per-FTE divisor makes
them look chronically overloaded, the objective responds by taking weekends away, and weekends are the
only thing they can work. The system concludes *"give this person less work"* about someone who may want
more.

**The previous recommendation in `fairness.md` was `burden / fte_i`, and that is the trap rather than
the fix** — FTE captures how *much* someone works and says nothing about the *mix*.

The fix puts the **burden of the opportunity set** in the denominator, so a weekend-heavy numerator sits
over a weekend-heavy denominator and cancels. Proven rather than asserted: in a synthetic period where
five doctors with mutually exclusive availability each work every slot open to them,
`revealed-opportunity` returns exactly **1.00 for all five** and a Gini of 0.00. `equal` and
`active-days` both call the Sunday doctor overloaded and the morning doctor a slacker.

**"Normalise by opportunity" is not a named approach in the literature** — searching turns up
FTE-proportional contract models and fair-share CPU schedulers, neither of which prices the
*composition* of the opportunity. **So this is a design, not an adoption**, and is recorded as one
rather than dressed in borrowed authority.

### A recommendation in `fairness.md` was wrong, and research corrected it

That document previously endorsed mean absolute deviation and sum-of-squares as fairness objectives.
Matl, Hartl and Vidal's survey ([arXiv:1605.08565](https://arxiv.org/abs/1605.08565)) shows why not:
**monotonic equity functions are the appropriate ones**, because non-monotonic measures admit
Pareto-optimal solutions that are *workload inconsistent*.

MAD, sum-of-squares, standard deviation, Gini, Jain and range are **all** non-monotonic — each can be
"improved" by giving the least-loaded person more work. **Leximax is the objective; the rest are
reported indicators.** Enforced as an executable property, not a comment: `equity.test.ts` proves
leximax monotonic and Gini non-monotonic over generated distributions.

One qualification kept because it changes how much the warning bites: in vehicle routing total workload
is elastic, whereas rostering has hard coverage, so total burden is fixed. That defuses the sharpest
pathology for *reporting* and not for *optimising*.

### Three property tests failed, and all three were real

- **A genuine bug.** `jainIndex([0, 5e-324])` returned `NaN` — squaring underflowed to zero, giving
  `0/0`. A `NaN` reaching a fairness dashboard reads as a broken product, not a bad roster.
- **⚠️ A property I stated wrongly.** I claimed *"adding burden to the least-loaded person always
  improves Gini"* and had derived it algebraically. fast-check falsified it in twenty cases: the
  derivation assumed sort order was preserved. **The intuitive version of the claim is the wrong one**,
  and this is the second time a plausible generalisation of mine was falsified within minutes of writing
  it.
- **A worked example that did not demonstrate its own point.** My "range is perverse" case was
  `[10,4,4,4] → [10,8,4,4]`, and both have range 6.

### Running it over the real months produced two findings and one guard

**The guard**, found by running the thing rather than thinking about it: a departed doctor with sixteen
shifts scored a load ratio of 2.16 — higher than any anchor — because sixteen observations make a tiny,
unstable denominator. Added a low-sample threshold; the ratio is still shown, marked provisional, and
excluded from the practice-wide figure.

**Finding 1 — roughly half the inequality is explained by availability and half is not.** Gini falls
0.341 → 0.182, but the four anchors still sit at **1.34–1.49 after normalising**, so they genuinely
carry ~40% more than their share of what they were available for. **Neither the naive reading ("the
anchors are overworked") nor the cynical one ("they just have more availability") is right, and the
normalisation is what makes it possible to say so.**

**Finding 2 — an undocumented weekend split.** D01 worked 30 Saturdays and 6 Sundays; D02 worked 4
Saturdays and 26 Sundays. H-05 records only half of this as one doctor's preference. **Not modelled**,
because guessing here is exactly how H-07 was written wrong twice.

### Question M's answer changed the schema, not a penalty weight

The owner's answer — most breaks were the doctor asking to work more, the December 2025 ones forced —
was **not one of the three options offered.** The real content is that **the same break means different
things depending on who initiated it**, and nothing in the roster recorded which.

So `provenance` is a field on every assignment: `directed`, `requested`, `absorbed`, `unknown`.
**`requested` burden is excluded from equalisation**, because crediting it means a doctor who asks for
extra shifts gets less work next month as a direct consequence — **the system punishing someone for
volunteering, invisibly.**

**Corollary that is a v1 requirement, not a refinement:** none of the historical assignments can be
classified, so the split is inert until the product captures provenance at assignment time.

### Sequencing: the engine now, the dashboard later

The owner asked for visual analytics; what was built is the **metrics engine**, and the charts
deliberately were not. The engine is not premature — three things need the identical arithmetic (solver
objective, doctor-facing ledger, export footer) and there are real rosters to validate it against
*today*. **Charts cannot be validated against anything** and can be built in an afternoon once the
numbers are agreed.

Ordering stays **export → editor → analytics UI**. Bringing the UI forward means shipping a screen of
`[ASSUMED]` numbers to thirteen colleagues, which is the fastest available way to lose their trust.

### Smaller

- **`allowImportingTsExtensions: true`** so scripts share types with the engine instead of
  reimplementing the arithmetic in a second `.mjs`.
- **Coverage thresholds raised to two tiers** — global 80/85/75/80, and 90/95/80/90 for
  `lib/analytics/**`. Each number sits just below what the suite achieves, so a real regression is
  visible without a one-line refactor breaking the build.
- **`PILOT_PATTERNS_V1`, not the practice's town.** The first draft named the constant after the town.
- **A burden schedule is an ordered, most-specific-first rule list**, and `validateBurdenSchedule`
  rejects a catch-all placed above specific rules. That misconfiguration is **silent and expensive**:
  the schedule looks complete and prices every shift at 1.0.

---

## 2026-08-26 — planning session: A1–A4 plus A6 research

The scaffold, the documentation tree, ADRs 0001–0009, the solver prototype and the unblocked research.
Detail that survives lives in the ADRs, `ops/environments.md` and `AGENTS.md`; what follows is what
exists nowhere else.

### The data boundary, and why the check is deliberately conservative

Private material moved to a gitignored `private/`. **The brief's own warning named the brief and the
research folder and missed `HANDOFF.md`** — a committed root file carrying one surname seven times.
**A written warning about a class of problem does not reliably enumerate every instance of it**, which
is the argument for the mechanical check over the documented rule.

`check-no-real-names.mjs` is case-sensitive, word-boundary anchored, capitalised-only, with an
allowlist. Seven of the fifteen surnames are ordinary English or Afrikaans words. **The reasoning is
about failure modes, not thoroughness: a check that fires on the word "winter" gets switched off by the
first person it annoys, and then it protects nothing.** Under-matching a rare edge case is recoverable;
being disabled is not.

**Proven rather than assumed** — planted name fails, allowlisted literals pass, lowercase common words
pass. Its marker-block parser has its own thirteen-case suite, because **if that parser silently
returns an empty list the check passes everything.** Two amusing confirmations: piping the check's own
stderr into the repo created a new violation the next run caught, and writing the entry about it
tripped the check a second time because the draft quoted both surnames while explaining them —
**evidence that the mechanical check catches what a documented rule would not, since I was actively
thinking about the boundary at the time and still wrote them down.**

### Two version decisions, one of which I got wrong first

- **TypeScript pinned to 5.9.x, not 7.** `typescript-eslint` peers `<6.1.0`, so adopting 7 silently
  drops type-aware linting. Recorded here rather than as an ADR because it reverses the moment support
  ships.
- **ESLint pinned to 9, not 10 — and I got this wrong first.** I took the latest major on the reasoning
  that the brief's "ESLint 9" was a floor, and `eslint-config-next` declaring `>=9.0.0` supported that
  reading. It failed at runtime: its bundled `eslint-plugin-react` still calls the context API ESLint
  10 removed. **The declared peer range was optimistic and the brief was right.**

### Tooling hurdles worth not rediscovering

- **`biome.json` does not permit comments — only `biome.jsonc` does.** Worse than a plain error: Biome
  reported config errors **and still ran with its defaults**, reformatting sixteen files before I
  noticed.
- **`prepare` cannot assume a git repository.** `git init` is the owner's call, so `lefthook install`
  fails and npm treats a failing `prepare` as a failed install. Related, and the opposite choice:
  `run-gitleaks.mjs` **fails hard** when gitleaks is missing rather than skipping, because **a secret
  scan that quietly does nothing is worse than no scan, since it is believed.**
- **PowerShell 5.1 reads `.ps1` as ANSI without a BOM**, so an em-dash in a comment became mojibake and
  the following apostrophe terminated a string. All PowerShell scripts are ASCII-only — a latent parse
  error that fails at run time, not at write time.
- **js-yaml: I introduced a high-severity advisory and then fixed it.** The risk was genuinely
  negligible — a dev-only dependency parsing our own trusted YAML — but **leaving a high-severity
  finding in a public healthcare-adjacent repo is the first thing a security review flags, and a
  failing `npm audit` trains people to ignore `npm audit`.**

### A5 — the solver prototype found two real things

**Pre-flight was missing, and a property test proved why.** Hypothesis generated a 2-doctor, 3-day
instance where three slots were structurally uncoverable. The solver behaved correctly and reported a
shortfall — **but that is a useless answer for a non-technical admin, because it looks like the
software failed.** What he needs is *"you cannot cover 1–3 January: 9 shifts need filling but 2 doctors
covers at most 6"*, which is arithmetic needing no solver at all. **The general rule: if a solve fails
for a reason pre-flight could have named, the fix belongs in pre-flight.**

**The Sunday-night exclusion list really is derived, not a rule.** The model reproduces the behaviour
with no list encoded. **Hard-coding those five names would have broken the moment a Monday anchor slot
changed hands** — which happened in June 2026.

For the record: 13 doctors × 30 days × 94 slots = 1,222 booleans, solved in **0.2–0.5s**. Performance
is not a risk at this scale.

**Hypothesis, not fast-check, for the solver** — the solver is Python. Driving it from a JavaScript
runner to honour the letter of the plan would add a process boundary to the most valuable test in the
suite for no benefit.

**N802 suppressed in tests, deliberately.** Catalogued constraint IDs in test names are what make
"implement AC-H04" unambiguous and coverage grep-able; lowercasing them would break the one convention
tying the catalogue to the suite. The reason sits next to the suppression, not only here.

### All fifteen months transcribed — and every behavioural constraint was falsified

Only the three **structural** constraints survived — the ones the database enforces rather than the
practice's habits. H-04 through H-07 each had counterexamples. **Had they shipped as `BLOCK`, the app
would have refused fifteen rosters the principal actually built and distributed.**

**The general rule, and it has held up since: in this domain "X never happens" means "X happens about
three times a year and I don't think of it as breaking a rule."**

**⚠️ H-07 is a process failure, not just a data one.** I rewrote it twice and it was falsified twice.
Version 1 was "never any Friday"; I found one counterexample, noticed it fell on a Pattern C day,
inferred the tidier rule "never a Pattern B shift", and shipped that — **without checking the tidier
rule against the rest of the data.** The script found three more counterexamples in seconds. **Fitting
a hypothesis to a counterexample almost always succeeds; that is not evidence.**

The sharper lesson from the same episode: **a constraint whose real subject is the shift structure must
be written against `patternId`, never against `weekday`.** A weekday-scoped version misbehaves on
precisely the days the pattern changes, which is where the exceptions live.

**H-04's falsification also killed the Sunday-night reasoning**, and exposed a limitation worth
keeping: `test_sunday_night_exclusions_are_derived_not_listed` passes, **because it verifies the model
behaves as designed, not that the design matches reality.** A green test told us nothing about the
domain; only the data did.

**Two undocumented patterns surfaced and neither was modelled** — D03 with 3 night shifts in 201, and
D14 working only Friday/Saturday nights. **Inferring a rule from an absence is the documented
over-fitting trap**: *"never worked a Sunday night"* becoming *"cannot work Sunday nights"* is wrong and
invisible.

**Data-boundary decision: the transcribed history lives in `private/seed-data/`.** **Pseudonymous codes
are not anonymisation when the mapping exists and the practice is identifiable.** Committed instead:
the validator, the analyser, a synthetic fixture, and a deliberately-broken fixture that proves the
validator fails.

**The historical data contains errors** — one day summing to 22 hours with 15:00–17:00 uncovered. Two
consequences: seeding must **validate arithmetically and flag anomalies**, never trust the images; and
it is a persuasive demo, since the app finds a real error in a real month in seconds.

### B2 arrived, and the summary did not survive contact with the source

Reading four of seventeen roster exports produced four corrections within minutes.

**A `[CONFIRMED]` hard constraint had a counterexample.** H-05, sourced to the principal's own
interview *plus* "zero counterexamples in sixteen months", is contradicted by 22 August 2026. The
uncomfortable part: **that is about as strong as evidence gets on this project, and it was still
wrong.** The general conclusion — **the practice's rules are softer than any summary of them, and every
"never" checked so far has an exception** — is a much better argument for warn-and-scar than the one
originally given.

**The export is a calendar, not a matrix.** All seventeen are 7-column Sun–Sat month calendars. The PRD
specified doctors-as-rows × days-as-columns, which is sound for the *editor* and wrong for the artifact
of record.

**The meta-point, and the reason this mattered:** no amount of testing would have caught any of it. **A
perfect suite would have faithfully enforced all four errors.** This is the evidence that the dominant
risk is building the wrong thing correctly, and why `domain/worked-examples.md` was left deliberately
empty rather than written from summaries — writing three months from the brief's own figures would
produce plausible, internally consistent months **that nobody could check against anything.**

### The year-end burden — an owner correction that improved the design

I recommended marking the principal's year-end burden "voluntarily absorbed" and excluding it from
equalisation. **The owner corrected this and his reasoning is better than mine.** The cause is
structural: most doctors have a primary practice elsewhere, at year end their commitment here is the one
that gives, and the principal covers the gap. His position — *"this should affect the fairness objective
because it shouldn't work that way"* — is right. **It is not generosity to be preserved but a recurring
operational failure absorbed through one person, and hiding it destroys the evidence needed to fix it.**

But the objective alone cannot fix it, and saying otherwise would be false confidence: **a solver cannot
create doctors.** What helps is forecasting the shortfall in October rather than on 20 December.

**The multi-practice fact explains more of the observed data than anything else found** — the
anchor/pool split, why pool doctors work weekends, why Friday's back half is pool-only, and the year-end
collapse. It upgrades the `Person ↔ Membership ↔ Practice ↔ Site` graph from prudent future-proofing to
a confirmed property of the workforce.

### A6 research — the top open question is answered, and the answer is No

**Supabase does not offer a South African region**, and the longest-standing request is unanswered by
staff — not rejected, not committed. **Neon does not offer one either.** AWS, Azure and Google Cloud all
do. Recommendation and trade-off in [`ops/environments.md`](ops/environments.md).

**Owner decision, taken the same session: Supabase's nearest region for the pilot, with schema
portability as a hard constraint.** The pilot's binding risk is *never shipping* rather than residency —
one practice, no procurement in the loop. **The condition is the engineering part, not a caveat: plain
Postgres only, nothing Supabase-specific beyond RLS and auth hooks**, so a move stays a costed migration
rather than a rewrite.

**Also decided: the practice and hospital are not named in anything committed, and the principal's family
relationship to the owner is not described.** No real doctor name was ever outside `private/`, but
committed files did name the hospital and the relationship — neither a doctor's name, so both sat
*inside* the stated boundary while still, together, arguably identifying him by inference on a public
repo tied to a named account. **The asymmetry decided it and it generalises: naming the practice later is
easy, un-publishing is impossible.** Forks, caches and mirrors persist, so the reversible option goes in
first.

### A8 — Graphify, and a real hole it exposed in the data-boundary check

`names:check` failed on a Graphify artifact. The match was a false positive: the convex hull
algorithm *"Andrew's monotone chain"* inside bundled visualisation JavaScript.

**But it exposed a genuine hole.** `graphify-out` was in the checker's ignored-directories list, added
when the directory did not yet exist. Three of its files are **committed**, so the data-boundary check
was blind to three files bound for a public repository.

The fix chosen was **scope, not sensitivity**: the directory is scanned again with only its `cache`
subdirectory excluded, and excluded **by relative path** rather than directory name, so a legitimately
named `cache` elsewhere is still scanned. Verified both directions. Also stopped committing the 600KB
vendored `graph.html`.

**The general lesson: an exclusion added to a checker "because that directory is generated" must be
re-examined the moment anything in it becomes committed. A check is only as good as its scope, and scope
rots silently — nothing fails when a checker quietly stops looking somewhere.**

Semantic extraction stays **off**: it needs an API key, and the documentation it would index describes
thirteen identifiable people's working patterns, so sending it to a third-party model is a POPIA s72
transfer.

### Two brief-internal contradictions, and the ADR format

The brief said both *archive the brief into `docs/`* and *it never leaves `private/`*; the second wins,
since archiving it would publish thirteen names. Same for the six research reports.

**The ADR format is a deliberate upgrade on the sibling repos**, whose ADRs are Nygard-flavoured with
**no rejected alternatives**. That section is the entire point: **without it, an agent re-proposes what
was already rejected every session, forever.**

**No Tailwind** — the roster grid needs exact print control, and the export is the product.

---

## Earlier

Everything before this session is in `private/PROJECT-BRIEF.md`, prepared 26 August 2026 from sixteen
months of the practice's real rosters, a photograph of the request diary, an interview with the
practice principal, and six commissioned research streams. It stays in `private/` because it names
thirteen real doctors throughout — see [`ops/compliance.md`](ops/compliance.md).
