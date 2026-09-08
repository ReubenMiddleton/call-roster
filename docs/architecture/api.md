# JSON API

The interactive core is client components against this API, not Server Actions
([ADR-0009](decisions/0009-pwa-first-no-native-wrapper.md)). Route handlers live under `app/api/`
and return a plain Web `Response`, never `next/server`'s `NextResponse` — see
[*Why plain `Response`*](#why-plain-response-not-nextresponse) below. Every handler is a thin
shell: validate with Zod, run one `withTenant`/`withAppUser` transaction
(`lib/server/db.ts`), map the result to JSON.

## ⚠️ Tenant identity is a header, and that is temporary

There is no authentication yet (`HANDOFF.md`: *"Auth, and anything multi-user"* does not exist).
Every tenant-scoped route reads the tenant from a plain `x-tenant-id` request header
(`lib/server/tenant-context.ts`), which means **anyone who can set a header can claim to be any
tenant**. This must never run against real data — only against local or CI databases seeded with
synthetic tenants.

Every route goes through `requireTenantId` / `requireTenantForPractice`, so replacing the header
with the real session's tenant claim the day auth exists is a change to that one file, not a
search-and-replace across every route.

## Response shape

Success: the resource as JSON, `id`/timestamps as plain strings (ISO 8601), never a raw driver
row (`snake_case` columns are mapped to `camelCase` in every handler).

Error: `{ "error": { "code": string, "message": string } }`. Codes in use today:

| HTTP status | `code` | When |
|---|---|---|
| 400 | `bad_request` | A Zod validation failure, a missing/malformed `x-tenant-id`, **H-03** (the doctor isn't a member of this practice on that date — Postgres `23514`, raised by the containment trigger, see the ADR-0008 addendum), or a foreign-key violation (`23503` — a referenced id doesn't exist) |
| 404 | `not_found` | The resource doesn't exist, **or** the tenant header doesn't match the path — the two are indistinguishable on purpose, so a wrong tenant never learns that a practice it can't access exists |
| 409 | `conflict` | A unique-constraint violation (`23505`), the GiST exclusion constraint (`23P01` — the doctor already holds an overlapping shift), or an application-detected conflict — a roster/swap command applied to the wrong status, a backdated burden schedule, or a ledger recalculation spanning more than one schedule version (see below) |
| 500 | `internal_error` | Anything else. Logged server-side; the client never sees the real message |

`lib/server/api-error.ts` is the only place this mapping is defined.

## Endpoints

All request/response bodies are JSON. `practiceId` in a path is also the tenant id.

| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/api/practices` | `{ name }` | Creates a tenant. The one write that doesn't need `x-tenant-id` — there is no tenant to scope to until the row exists (`practice`'s RLS insert policy is `with check (true)`, ADR-0010) |
| GET | `/api/practices/:practiceId` | — | |
| GET | `/api/practices/:practiceId/doctors` | — | Lists people with a current-or-past membership in this tenant |
| POST | `/api/practices/:practiceId/doctors` | `{ fullName, validFrom, validTo? }` | Creates a `person` and their first `practice_membership` in one transaction. `validTo` omitted means an open-ended membership |
| GET | `/api/practices/:practiceId/rosters` | — | |
| POST | `/api/practices/:practiceId/rosters` | `{ month }` (`YYYY-MM`) | Creates a draft roster. A second POST for the same month is a 409 |
| GET | `/api/practices/:practiceId/rosters/:rosterId` | — | The whole month's grid data: every slot, its shift definition, and whichever doctor (if any) holds it |
| GET | `/api/practices/:practiceId/shift-patterns` | — | Each pattern with its shifts nested |
| POST | `/api/practices/:practiceId/shift-patterns` | `{ name, shifts: [{ shiftKey, startHour, hours, kind }] }` | Creates a pattern and its shifts together — a pattern with no shifts covers no hours and can never back a roster. `shifts` must sum to exactly 24 hours (docs/domain/shift-patterns.md) |
| GET | `/api/practices/:practiceId/weekday-defaults` | — | `{ sunday: patternId \| null, ..., saturday: ... }` |
| PUT | `/api/practices/:practiceId/weekday-defaults` | All seven weekdays → pattern id | Upsert. Precedence level 4 (docs/domain/shift-patterns.md) |
| GET | `/api/practices/:practiceId/date-patterns` | — | Every per-date override |
| POST | `/api/practices/:practiceId/date-patterns` | `{ onDate, patternId, reason? }` | Upsert — precedence level 2. "The admin can override at any level," including changing a prior override |
| POST | `/api/practices/:practiceId/rosters/:rosterId/slots` | — | **Generates** the roster's `shift_slot` rows for its month, resolving each date via `lib/calendar/pattern-precedence.ts` (levels 2 and 4 only — see below). Idempotent: safe to call again after fixing a weekday default or adding an override |
| POST | `/api/practices/:practiceId/assignments` | `{ shiftSlotId, doctorId, provenance? }` | Assigns a doctor to a slot. `period` is derived server-side from the slot's date and shift definition — the client never sends one, so a mismatched period/slot is structurally impossible. **Draft only** — see below |
| DELETE | `/api/practices/:practiceId/assignments/:assignmentId` | — | Unassigns. A hard delete, not a soft state — `shift_assignment` isn't the audit boundary; `command_journal` is. **Draft only** |
| POST | `/api/practices/:practiceId/rosters/:rosterId/publish` | `{ actorId? }` | `DRAFT → PUBLISHED`. Snapshots the roster into a hash-chained `roster_version` row *before* flipping the status |
| POST | `/api/practices/:practiceId/rosters/:rosterId/unpublish` | `{ actorId?, reason? }` | `PUBLISHED → DRAFT`. Returns `{ diff }` — see below |
| POST | `/api/practices/:practiceId/rosters/:rosterId/close-review-window` | `{ actorId? }` | `PUBLISHED → LOCKED` |
| POST | `/api/practices/:practiceId/rosters/:rosterId/archive` | `{ actorId? }` | `LOCKED → ARCHIVED`, terminal |
| GET | `/api/practices/:practiceId/swap-requests` | — | Optional `?status=pending\|approved\|rejected` filter |
| POST | `/api/practices/:practiceId/swap-requests` | `{ shiftAssignmentId, requestedDoctorId, requestedBy?, reason?, provenance? }` | `RequestSwap`. Only on a `PUBLISHED`/`LOCKED` roster's *existing* assignment — nothing changes yet. `provenance` defaults to `directed`, same as `POST assignments` — see below |
| POST | `/api/practices/:practiceId/swap-requests/:swapRequestId/approve` | `{ actorId? }` | `ApproveSwap`. Reassigns the doctor and creates the next `roster_version` — see below |
| POST | `/api/practices/:practiceId/swap-requests/:swapRequestId/reject` | `{ actorId?, rejectionReason? }` | `RejectSwap`. No data change beyond the request's own status |
| GET | `/api/practices/:practiceId/notifications` | — | The outbox. Optional `?status=pending\|sent\|failed` filter — every row reads `pending` today, see below |
| POST | `/api/practices/:practiceId/doctors/:doctorId/ics-feed` | — | `RegenerateIcsToken`, and the initial mint besides. Revokes any existing active feed first |
| DELETE | `/api/practices/:practiceId/doctors/:doctorId/ics-feed` | — | Revokes the doctor's active feed |
| GET | `/api/ics/:token` | — | **Public — no `x-tenant-id`.** Returns `text/calendar`: the token alone resolves the tenant and doctor |
| GET | `/api/practices/:practiceId/ledger` | — | Persisted totals per doctor from `burden_credit` — raw burden only, no load ratios (see below) |
| POST | `/api/practices/:practiceId/ledger/recalculate` | — | `RecalculateLedger`, runnable by hand. Rebuilds `burden_credit` from every non-`draft` assignment and returns burden **and** load ratios. Needs a burden schedule to exist first. Also runs automatically after `PublishRoster`/`ApproveSwap` — see below |
| GET | `/api/practices/:practiceId/burden-schedules` | — | Every schedule version this tenant has created, each with an `active` flag |
| POST | `/api/practices/:practiceId/burden-schedules` | `{ version, validFrom, confidence, rules: [{ label, match: {...}, weight }] }` | Creates the next version, closing whichever one was open. `rules` is most-specific-first and must end in a catch-all (`match: {}`) — validated with `validateBurdenSchedule` before anything is written |
| GET | `/api/practices/:practiceId/command-journal` | — | L1, read back. Optional `?rosterId=` filter, `?limit=` (default 50, max 500). Most-recent-first — see below |
| GET | `/api/practices/:practiceId/rosters/:rosterId/diagnostic-bundle` | — | L5's assembly endpoint — see below |

### Two precedence levels aren't wired up yet, deliberately

`resolveMonth` supports four precedence levels; slot generation only uses two of them:

- **Level 1 (a fully custom, per-date shift set)** has zero occurrences in 33 months of real
  data (docs/domain/shift-patterns.md) — nothing to build against yet.
- **Level 3 (a public holiday suspending a pattern, e.g. dropping Friday's four-shift split)** is
  practice-specific configuration (`PILOT_HOLIDAY_SUSPENDS_V1` in
  `lib/calendar/pattern-precedence.ts`) with no tenant-scoped table yet. Hard-coding the pilot's
  answer into the generic route would be exactly the tenant-data-in-code mistake ADR-0010 exists
  to prevent. A new tenant with nothing configured correctly gets "holidays don't change the
  structure" — a legitimate configuration the resolver itself documents. Real public holidays are
  still computed and reported (`isPublicHoliday`); they just don't suspend anything yet.

## The lifecycle: `DRAFT → PUBLISHED → LOCKED → ARCHIVED`

The four states and the commands between them are `docs/domain/commands-events.md`'s state
diagram, implemented exactly: `PublishRoster`, `UnpublishRoster`, `CloseReviewWindow`,
`ArchiveRoster`. Each is its own endpoint (not a generic `PATCH status`) because each has
different side effects — publish writes a version, the others don't — matching the command
vocabulary rather than blurring it into one verb.

Every lifecycle route locks the `roster` row (`select ... for update`) for the transaction, so two
concurrent calls on the same roster can't both see the precondition satisfied. Every transition,
successful or refused, checks the *current* status and 409s with the actual status in the message
if the precondition doesn't hold (`lib/server/api-error.ts`'s `conflict`) — there's no
in-between "did that work?" state to wonder about.

**Direct edits (`POST`/`DELETE assignments`, `POST slots`) are refused outright once a roster
leaves `DRAFT`.** Swaps are the sanctioned path for `PUBLISHED`/`LOCKED` changes instead — see
below. Once versioned editing covers more than "one doctor for another on an existing assignment,"
this line will need revisiting; today it's exactly right for what swaps do.

**`UnpublishRoster`'s diff will read empty until a swap is approved between a publish and its
unpublish** — before this session it always read empty; now it's real. It compares the roster's
live state against its last published version's snapshot (`lib/server/roster-diff.ts`).

**`PublishRoster` also triggers a best-effort ledger recalculation** (`lib/server/ledger-refresh.ts`,
same helper `ApproveSwap` uses — see below), because publishing is the moment assignments move out
of `draft` and become eligible for `burden_credit`. Never blocks the publish itself: the response's
`ledger` field reports `{ recalculated: false, reason }` rather than failing the request if no
burden schedule is configured yet, or if the assignment history spans more than one schedule
version.

**Actor attribution is the same pre-auth placeholder as the tenant header**: every lifecycle and
swap endpoint accepts an optional `actorId` (a `person` id) instead of reading it from a session,
and `command_journal.actor_id` is nullable for exactly this reason. `writeCommandJournal`
(`lib/server/command-journal.ts`) is the one place every mutation's journal entry is written,
matching "when any mutation occurs, append to the audit log with actor, server timestamp,
before/after and reason" — server-side time only, via the column's own `default now()`, never a
client clock. See *Diagnostics: L0, L1 and L5* below for the full account of this table.
⚠️ `actorId` is not validated against practice membership — any real `person` id is accepted, so
the audit trail could attribute a swap to the wrong tenant's doctor. Not an access-control gap
(RLS still scopes everything), and low priority until real auth exists, but worth fixing before
`actorId` becomes load-bearing for anything.

## Swaps: `RequestSwap` → `ApproveSwap` / `RejectSwap`

*"A transaction moving an assignment between doctors after lock. Not a silent edit"*
(`docs/product/glossary.md`). Scoped precisely to that: reassigning an **existing** assignment to
a different doctor. Not moving it to a different slot, and not filling an empty slot — `swap_request`
always points at a `shift_assignment` row that already exists.

- **Request** (`swap-requests` POST) only succeeds against a `PUBLISHED` or `LOCKED` roster; a
  `DRAFT` one is edited directly, and an `ARCHIVED` one is read-only. Requesting the doctor who
  already holds the assignment is a 400 (a no-op). At most one **pending** request per assignment
  at a time — `swap_request_one_pending_per_assignment`, a partial unique index, not an
  application check, so it holds even under concurrent requests.
- **Approve** (`.../approve` POST) is where the doctor change actually happens: it locks the
  roster row, updates `shift_assignment.doctor_id`, and — this is the point of the whole
  feature — snapshots the *new* state as the roster's next `roster_version`
  (`lib/server/roster-version.ts`), never mutating the previous one. The roster's own `status`
  (`PUBLISHED` or `LOCKED`) is untouched; a swap changes what the roster contains, not which
  lifecycle state it's in.
- **The exclusion constraint and H-03 get their chance here too**, on `UPDATE` rather than
  `INSERT` — approving a swap into an overlapping shift or outside the target doctor's membership
  interval fails with the same `23P01`/`23514` mapping assignment creation uses, and the whole
  transaction rolls back: the swap request lands back at `pending`, not stuck in some
  half-approved state, and nothing about the assignment changes.
- **Reject** (`.../reject` POST) touches nothing but the request's own status. Both approve and
  reject refuse to act twice — a `pending`-only precondition, same `conflict` pattern as the
  roster lifecycle.

`ApproveSwap` also enqueues a notification for both doctors and bumps the `SEQUENCE` of any active
ICS feed either of them holds — see the next section for both — and triggers the same best-effort
ledger recalculation `PublishRoster` does, matching the domain policy's own words: *"When
`SwapApproved` → ... recalculate the ledger"* (`docs/domain/commands-events.md`). See the ledger
section below for exactly what "best-effort" means here and why.

**`provenance` is captured on the request, not invented at approval time.** `RequestSwap` accepts
the same `directed`/`requested`/`absorbed`/`unknown` enum `POST assignments` does, defaulting to
`directed` — the requester is the one who knows *why* the swap is happening, the same reasoning
`reason` already follows. `ApproveSwap` reads `swap_request.provenance` back and writes it onto
`shift_assignment` (migration `0015_swap_request_provenance.sql`), **closing a real gap**: every
swap before this migration hard-coded `'directed'` regardless of circumstances, silently mispricing
a doctor-requested swap as scheduler-directed in the ledger. Proven end to end in `api:check`, not
just unit-tested — a `requested` assignment (via `POST assignments`, the more common path) is shown
to increase raw `burden` while leaving `equalisableBurden` unchanged, and a swap requested as
`absorbed` is shown to carry that provenance through to the resulting assignment rather than the
old hard-coded value.

**Not built yet**, deliberately out of this slice: share links (a read-only link to the printed
grid itself, distinct from a doctor's personal ICS feed), recurring slots, preferences,
violations/overrides, and the review-window `ChangeRequest` concept `docs/product/lifecycle.md`
proposes for the pre-`LOCKED` review period (that document is still `[PROPOSED]`, with open
questions Y/Y2/Y3 unresolved — swaps were built against the `[CONFIRMED]` glossary definition
instead). `docs/HANDOFF.md` tracks what's next.

## Notifications, ICS feeds, and the ledger

Three Distribution/Fairness-context pieces (`docs/domain/commands-events.md`), each finished to a
different point on purpose — see each subsection for exactly where the line sits and why.

### Notifications: recorded, not delivered

`PublishRoster` and `ApproveSwap` both enqueue rows in `notification`
(`lib/server/notifications.ts`) — every doctor with active membership that month, on publish; both
doctors involved, on an approved swap. **Nothing sends them.** WhatsApp business verification is
deferred until after the pilot (Track B6, `docs/NEEDS_YOUR_INPUT.md`), so `status` sits at
`'pending'` forever until a real sender exists to flip it to `'sent'` or `'failed'`. This is the
outbox pattern deliberately: every place a notification *should* fire already fires one, so wiring
up delivery later is a new consumer of an existing table, not a hunt through the codebase for the
right call sites.

### ICS feeds: a real, working RFC 5545 feed, no external dependency

Unlike notifications, this one needed no channel to finish — calendar subscription is just text
generation plus a bearer token, both fully self-contained. `POST .../ics-feed` mints a token
(`lib/server/ics.ts`); `GET /api/ics/:token` serves `text/calendar` built live from that doctor's
`published`/`locked`/`archived` assignments (never `draft` — nothing speculative belongs on a
personal calendar). `ApproveSwap` bumps the feed's `sequence` for both doctors involved, matching
the policy's literal words: *"bump the ICS feed's SEQUENCE."* One `sequence` per feed, not per
event — every `VEVENT` in a fetch carries the same value, which is enough for a well-behaved
client since the whole feed regenerates fresh on every request rather than being diffed.

**The interesting part is the RLS problem this raised, not the ICS format.** The public feed
endpoint has to resolve a bearer token to a tenant *before* it has a tenant context to query
with — plain RLS can't do that, since the table's own isolation policy requires the context the
lookup exists to produce. Skipping the tenant-scoping machinery and connecting as a superuser
isn't a real answer either, because production won't authenticate that way (see *Local
development*, below) — a shortcut like that would silently stop working the day a real Supabase
project exists. The fix is `resolve_ics_token`, a narrow `SECURITY DEFINER` Postgres function
(`supabase/migrations/0012_notification_and_ics_feed.sql`) that runs with its owner's privileges
for this one deliberately narrow lookup, while every other access to `ics_feed` stays fully
isolated — verified directly against the database, not just inferred: a bare `SELECT` as `app_user`
with no tenant context returns zero rows, `resolve_ics_token` with a valid token returns the row,
and with an invalid one returns none.

### Burden schedules: an ordered rule list per tenant, not one hard-coded constant

`burden_schedule` + `burden_rule` (migration `0013_burden_schedule.sql`) replace an earlier,
wrongly-shaped `burden_weight` table (`(tenant_id, shift_kind, weight)`, removed from
`0005_fairness.sql` — never used by any route, verified before deleting it) that could not have
expressed a real schedule in the first place: burden prices by `dayClass × shiftKind × weekday ×
fromHour × specialDate` (`BurdenMatch` in `lib/analytics/burden-types.ts`) — *"Friday from
17:00"* and *"Christmas night"* are inexpressible in a flat `(shift_kind, weight)` pair.

A `burden_schedule` row is metadata (`version`, `validFrom`, `validTo`, `confidence`); its
`burden_rule` rows are the ordered, most-specific-first list `resolveBurden`
(`lib/analytics/burden.ts`) already knows how to evaluate — `POST .../burden-schedules` validates
the submitted rules with the *same* `validateBurdenSchedule` function before writing anything, so
a schedule with no catch-all rule, or one where the catch-all isn't last, is rejected at creation
rather than discovered the first time a shift can't be priced.

**Versioned properly, not just in name.** `burden_schedule` carries a GiST exclusion constraint
(`tenant_id`, `daterange(valid_from, valid_to)`) so two versions can never be simultaneously valid
for one tenant, and creating a new one automatically closes whichever was still open —
*"weight changes apply forward only"* (`docs/domain/fairness.md`). Nothing is ever edited or
deleted; a correction is a new version, the same rule as every other temporal entity in this
schema (ADR-0008).

### The ledger: real fairness arithmetic, reading the tenant's own schedule

`POST .../ledger/recalculate` (`lib/server/ledger.ts`) is the "runnable by hand" path
`RecalculateLedger`'s own description calls for. It reads every assignment on a non-`draft`
roster, and — critically — **reuses `lib/analytics/{ledger,burden,equity,shifts}.ts` exactly as
written**, not a reimplementation: `buildLedger` for the raw accumulation, `entitlementWeights`
with the `revealed-opportunity` basis for each doctor's fair share ("the default",
`docs/domain/fairness.md`), `computeLoadRatios` for the dimensionless verdict — priced against
whichever `burden_schedule` version the tenant has actually created, not a hard-coded constant.
Rebuilds `burden_credit` by deleting and re-inserting the tenant's rows in one transaction —
idempotent by construction, rather than upserting against a natural key `burden_credit` doesn't
have. `GET .../ledger` reads those persisted totals back; it does not recompute load ratios live,
because that needs the full opportunity-set machinery a flat `burden_credit` row can't supply on
its own.

**A 400 if no schedule is configured yet** — a tenant must `POST .../burden-schedules` before its
first recalculation, and gets a clear, specific error rather than silently being priced against
someone else's numbers.

**⚠️ One real, named limitation, not a silent one**: if the assignments being recalculated span
more than one schedule version (the earliest and latest assignment dates resolve to different
`burden_schedule` rows), recalculation refuses with a 409 rather than guessing which version
applies to what. `buildLedger` and `entitlementWeights` both take a single schedule, not a
per-date resolver, and changing those shared, widely-used functions to merge correctly across
versions is real, separate work — not something to get subtly wrong in the same change that exists
specifically to stop the ledger being subtly wrong. `lib/server/ledger.ts`'s
`resolveSingleSchedule` is where this is enforced, and is exactly the function to revisit if
multi-version recalculation becomes a real need.

**Now automatic on `PublishRoster` and `ApproveSwap`**, matching what the domain policy calls for
both (`docs/domain/commands-events.md`) — `lib/server/ledger-refresh.ts`'s `tryRecalculateLedger`
wraps the same `recalculateLedger` in its own transaction, called *after* the publish or swap's own
transaction has already committed. **This never blocks the publish or the swap**: "warn and scar,
never block" (AGENTS.md) applies here too, so a `badRequest` (no schedule yet) or `conflict`
(spans more than one schedule version) is caught and reported in the response's `ledger` field —
`{ recalculated: true, scheduleVersion }` or `{ recalculated: false, reason }` — rather than
surfacing as a failure of an already-successful roster change. A genuinely unexpected error is
logged server-side and reported the same soft way, for the same reason. The full tenant-wide
rebuild this triggers is cheap at this practice's scale (thousands of assignments across years, not
millions); if that stops being true, `tryRecalculateLedger` is the one place to revisit, not every
call site.

## Diagnostics: L0, L1, L2, L3 and L5, the first slice of `docs/ops/diagnostics.md`

Five of the six layers ADR-0013 designs, built to the point they're actually load-bearing rather
than sketched. **L4 (client buffer) and L6 (retention) are not built** — named explicitly rather
than left to be discovered missing.

### L1: `command_journal` replaces `audit_log`, in place

*"This journal IS the append-only audit trail ... Do not build a second one"* — so rather than add
a second table alongside the original `audit_log`, `supabase/migrations/0009_command_journal.sql`
rewrites that migration in place (the same call made for `burden_weight` in 0005, and for the same
reason: nothing has ever applied it against a real project). Every field `docs/ops/diagnostics.md`
specifies exists — `appRunId`, `seq`, `rosterId`/`rosterVersion`, `outcome`, `issuedAt`/`clientAt`,
`appVersion`/`schemaVersion` — plus `before`/`after` (kept from the original `audit_log` rather
than adding a third, redundant `payload` column: every call site already expresses its payload
that way) and `reason` (the one sanctioned free-text column — ECTA s15(4) requires it survive on
the audit trail; see the migration's own comment). Append-only, enforced by a trigger, unchanged
from the original.

`lib/server/command-journal.ts`'s `writeCommandJournal` is the one writer, called from all seven
routes that mutate roster state once it leaves `DRAFT` (`PublishRoster`, `UnpublishRoster`,
`CloseReviewWindow`, `ArchiveRoster`, `RequestSwap`, `ApproveSwap`, `RejectSwap`) — direct
draft-stage edits (`POST`/`DELETE assignments`) are deliberately outside the audit boundary, as
they always were.

**✅ `refused`/`failed` are journaled too**, from every one of the seven routes' `catch` blocks —
`journalRefusal` (`command-journal.ts`) runs in its own transaction, *after* the command's own
transaction has already rolled back, because a rolled-back transaction cannot carry a row
recording what it failed to do. `classifyOutcome` decides what's worth keeping: an `ApiError`
(400/409, excluding 404 — no entity to attribute the attempt to) or a domain-constraint SQLSTATE
(`23P01` exclusion, `23514` H-03) becomes `refused`, with the `ApiError`'s own message reused
verbatim as `reason` rather than re-derived; an unanticipated SQLSTATE or exception becomes
`failed`; a `ZodError` (malformed input, not an intent against a real entity) is not journaled at
all. Never blocks the response either way — a failure to journal a refusal is logged and swallowed,
matching "diagnostics must never cost him work."

**⚠️ One real, named gap, not a silent one:**

- **`appRunId`/`seq`/`clientAt`/`appVersion`/`schemaVersion` are populated only when a caller
  supplies them**, and none does today — there is no real browser client yet (`app/` is still a
  scaffold). The replay mechanism these fields exist for is real once a client sends them, not
  simulated here. `seq`'s own computation (`nextSeq` in `command-journal.ts`) is a best-effort
  `max + 1` inside the same transaction, safe for the one caller pattern that exists today and not
  proven under real concurrent writers — the `(app_run_id, seq)` unique index turns a race into a
  loud constraint violation rather than silent corruption, which is the safe failure mode until a
  real client makes it worth solving properly.

### L0: redaction by construction, and a gate that actually catches something

`CommandJournalEntry`'s `before`/`after` hold entity references only — the same discipline the
product schema already follows everywhere else (a `doctor_id` uuid, never a name; `person` is the
one table a name lives in, joined at render time). `scripts/check-diagnostics-safety.ts`
(`npm run diagnostics:check`, in the gate) enforces two of the three things `docs/ops/diagnostics.md`
names: no free-text column on `command_journal` beyond an explicit, commented allowlist
(`command_type`, `outcome`, `reason`, `app_version`, `schema_version` — each a closed vocabulary or
build metadata, never a name), and no call to `writeCommandJournal(...)` passing a
display-name-shaped key (`doctorName`, `fullName`, and similar) — verified by deliberately
injecting one during this work and confirming the gate caught it before reverting. The third thing
the design doc names — a real surname anywhere in diagnostics fixtures — is already covered by
`names:check`, which scans the whole repository rather than diagnostics specifically.

### L2: error records, for the failures that ARE exceptions

`error_record` (migration `0014_error_record.sql`) is L1's complement, not an overlap: the command
journal covers the far more common case of nothing throwing at all (a warning that fires when it
shouldn't, an export that comes out wrong); this table is for the exceptions. OTel exception
semantic conventions for field names (`exception_type`/`exception_message`/`exception_stacktrace`)
— "the vocabulary, not the SDK", so a future exporter is a field mapping (ADR-0013).

**One integration point, not a scan of every route.** `lib/server/api-error.ts`'s `toErrorResponse`
already classifies every error every route sees; only its fallback branch — a `pg` SQLSTATE none
of the four named branches recognise, or a genuinely unanticipated exception — represents something
L2 should record, since every other branch is already an intentional, named outcome (and exactly
what `journalRefusal`'s `outcome: 'refused'` already covers for L1). `toErrorResponse` became
`async` for this — one database write — with **zero call-site changes needed**: every one of its
33 call sites already does `return toErrorResponse(...)` from inside an `async` route handler, so
returning a `Promise<Response>` there needed no `await` added, verified by grepping every usage
before relying on it, not assumed.

`instrumentation.ts` (project root, stable since Next.js 15) wires the framework's own
`onRequestError` hook to the same `recordError` — genuine defense in depth, but **honestly likely
to rarely fire in this codebase**: every route handler already wraps its whole body in its own
`try`/`catch`, so an error essentially never reaches Next's own uncaught-error path today. The
real coverage is `toErrorResponse`.

**Tenant correlation is enriched on the seven L1 routes, not universal.** Those seven already hoist
a `journalContext` for `journalRefusal`; passing `journalContext.tenantId`/the request path into
`toErrorResponse`'s optional second argument was nearly free there. The other ~18 routes (mostly
`GET`s) still call `toErrorResponse(error)` unchanged — their errors are still recorded, just
tenant-less, the same honest degradation `recordError` already handles for a truly pre-tenant
failure. Extending every route is real, separate, low-value work (most of what breaks happens in
mutations, which are covered).

**⚠️ `tenant_id` is nullable here — the one table in this schema where that's true.** An error can
happen before tenant context exists at all. RLS still isolates by tenant when one is known; a
null-tenant row is invisible to every `app_user` tenant context by construction, reachable only by
direct database access — proven in `db:check`, not assumed. `command_id` (correlating an error to
the command that was in flight) stays `null` for the same reason `appRunId` does across this
slice: the exceptional path that reaches this table doesn't have the command journal row's id
in hand, and no real client sends an `appRunId` yet either.

**⚠️ Exception messages and stack traces are genuinely free text**, deliberately outside L0's
guarantee — that guarantee works by construction for `command_journal` because its payload shape
is entity references the application controls; a caught exception says whatever it happened to
say. No throw site in this codebase interpolates a display name into a message today, but that's
an ongoing discipline, not a structural guarantee — named in the migration's own column comment
rather than glossed over.

### L3: solve-run diagnostics — the schema and the solver side, not the pipeline

*"A failed or surprising solve must be reproducible from its row alone"* (`docs/ops/diagnostics.md`).
`solve_run` (`0008_solve_run.sql`) already existed with `request`/`result`/`status`, but not the
fields that make a solve actually reproducible; `0016_solve_run_diagnostics.sql` adds them:
`request_hash` (sha256, computed from the raw bytes as received — proof of what actually arrived,
not what either side later decided it meant), `preflight_result` (the pre-flight arithmetic's own
verdict — `feasible`/`totalDemand`/`totalSupply`/`failures`, not just whether it passed),
`model_snapshot` (`BuiltModel.canonical_text()`, already used for snapshot testing — a canonical
serialisation of the *constraints*, never the solved roster, which is not deterministic across
CP-SAT versions), and `cp_sat_version`/`num_workers` — non-negotiable per the design doc, since a
reproduction that doesn't pin both is not a reproduction. All five are now returned by
`call-roster-solver --request ... --json` (`solver/src/call_roster_solver/__init__.py`), which
already computed most of this internally and simply had nowhere durable for it to land.

**⚠️ This is the schema and the solver-side computation, not the pipeline.** Nothing writes to
`solve_run` in the product — there is no `GenerateDraft` route and no worker claiming rows with
`FOR UPDATE SKIP LOCKED` (the migration's own original comment); "the solver ships last" (AGENTS.md)
remains true. What's proven today: `scripts/check-solver-e2e.ts` (`npm run solver:e2e`), after
running one real solve through the TypeScript→Python boundary, now also persists a genuine
`solve_run` row from that solve's actual output and reads every L3 field back, confirming the
schema holds real diagnostic data correctly — not a synthetic row inserted just to exercise the
table, and not a claim resting on the Python-side computation alone.

**A real gap surfaced while grounding this: the formal wire response `docs/architecture/solver-contract.md`
documents (`contractVersion`, `solveRunId`, `objective: {total, byTier}`, `relaxationOptions`,
`unfilledSlots`, `ledgerAfter`) has never actually been implemented.** What exists and is
exercised today is a *different*, overlapping debug shape — the CLI's `--json` output — with a
flat `objective`, no `contractVersion`/`solveRunId`, and extra fields the contract doesn't mention
(`preflightOk`, `slots`, `doctors`, `days`). Building the real contract-shaped response function is
real, separate work, tracked in `docs/DECISIONS.md` rather than silently folded into this change or
left to be discovered by whoever builds `GenerateDraft`.

### L5: the bundle-assembly endpoint, not the whole layer

`GET .../rosters/:rosterId/diagnostic-bundle` returns `appVersion`/`schemaVersion`
(`lib/server/build-info.ts` — `package.json`'s version, and the latest migration filename), the
roster's `activeRosterVersion`, and its last 50 journalled commands. **Recent errors still aren't
included, for a more precise reason than "L2 isn't built" now that it is**: `error_record` has no
`roster_id` column, only a `command_id` that's always `null` today (see L2 above) — there is
nothing to scope "this roster's errors" by yet. Wiring it in once command correlation is real is
the natural next step, not a rewrite. **Current view state is still absent too** — inherently
client-side, and there is no client yet — named in the response's own `notIncluded` field rather
than silently dropped. **Not built**: the "Something looks wrong" UI control, the plain-language
cover page, and offline capture (L4) — this is the server-side half only.

## Local development

```bash
npm run db:dev:start
```

Starts a **persistent** local cluster from the pinned `.tools/pgsql` binary (port `54329`,
`postgresql://postgres@127.0.0.1:54329/postgres`) and applies every pending migration with the
Supabase CLI (`supabase migration up`, tracked in `supabase_migrations.schema_migrations` — the
same mechanism a real Supabase project uses, so there is nothing to relearn when one exists).
`lib/server/db.ts` defaults to this connection string; set `DATABASE_URL` to point anywhere else.
`npm run db:dev:stop` stops it without deleting data; `npm run db:dev:reset` wipes and
re-initialises. ⚠️ The Supabase CLI's own startup is slow (its Go runtime, not this script) —
give the first `db:dev:start` a couple of minutes.

Everything here connects as `postgres` and immediately `SET LOCAL ROLE app_user` for the rest of
the transaction — that shortcut only works because local dev owns the whole cluster. Production
will authenticate as `app_user` (or Supabase's `authenticated` role) directly.

## Verification

Two gates, separate from `npm run check` for the same reason `solver:check` is — spinning up a
Postgres process is not something every `check` run should pay for:

- **`npm run db:check`** — schema invariants against a throwaway cluster: the exclusion
  constraint, the H-03 containment trigger, RLS isolation, audit-log immutability. Proves the
  *database*.
- **`npm run api:check`** — imports the route handler modules directly (no dev server) and calls
  them with constructed `Request` objects against another throwaway cluster: validation, the
  error-shape table above, and that a wrong tenant header is a clean 404. Proves the *API*.

## ⚠️ `pg` silently corrupts `date` columns unless told not to

`node-postgres` parses a SQL `date` value into a JS `Date` at **local-machine midnight**, not the
plain `YYYY-MM-DD` string every route handler's response shape assumes. Verified 2026-09-08: the
literal date `2026-10-05` came back as `2026-10-04T22:00:00.000Z` on this machine (SAST, UTC+2) —
wrong by two hours, and the exact wrongness depends on the server's timezone. It surfaced as a
`shift_slot.on_date` filter matching nothing in `api:check`; the same bug was silently present in
every other `date` column (`date_pattern.on_date`, `lower/upper(practice_membership.valid_at)`)
before it was caught.

Fixed once, globally, in `lib/server/db.ts`: `types.setTypeParser(types.builtins.DATE, (v) => v)`
registers the identity parser for every connection this pool ever opens. Every `date` column in
this schema is a calendar date, never a timestamp, so there is no case where the default behaviour
is wanted — don't reach for a per-query `::text` cast instead, the whole point is not needing to
remember it at every call site.

## Why plain `Response`, not `NextResponse`

`next/server`'s `NextResponse` only adds cookies, rewrites and `next()` — none of which this API
uses — and `NextResponse.json(...)` is otherwise sugar over the standard `Response`. Importing
`next/server` outside Next's own bundler fails under plain Node ESM resolution (verified
2026-09-07: `Cannot find module '.../next/server'`), which would make `api:check`'s direct-import
approach impossible. Building on plain `Response` (`lib/server/api-error.ts`'s `jsonResponse`)
avoids the dependency entirely, and Next's Route Handlers accept a plain `Response` just as
readily as a `NextResponse`.
