# Diagnostics

**How we find out what broke without asking the principal what he clicked.**

The decision and the rejected alternatives are [ADR-0013](../architecture/decisions/0013-first-party-diagnostics.md).
This is the design. Nothing here is built yet — it is written before the pilot on purpose, because
**diagnostics added after a fault are diagnostics that missed it.**

Read [`compliance.md`](compliance.md) first if you are about to add anything that sends data anywhere.

---

## The premise

The pilot exists to find out what breaks. Its only user is the practice principal: not technical, the
sole scheduler, working alone at month-end under time pressure.

So the requirement is not "collect logs". It is:

> **Given a report as vague as *"the roster went funny on Tuesday"*, reconstruct exactly what
> happened, locally, without him in the loop.**

Three things follow, and they shape everything below.

**1. The interesting failures are not crashes.** A roster editor's realistic faults are a warning
that fires when it should not, an export that comes out wrong, a cell that silently refuses an
assignment, a fairness number he does not believe. Nothing throws. **An exception tracker would see
none of it.**

**2. So the primitive is the intent stream, not the stack trace.** What makes those faults
diagnosable is the ordered sequence of commands that produced the state, plus the state they started
from. That is replayable. A video is not.

**3. Diagnostics must never cost him work.** A failed log write, a full buffer, an unreachable server
— none of it may block, slow or lose a user action. **The roster always wins.** This is the same
principle as *warn and scar, never block*, applied to our own instrumentation.

---

## L0 — Redaction by construction

**Not "remember to scrub". Structurally unable to hold a name.**

The repository's data boundary keeps names out of committed files. It does nothing about a running
app, which necessarily renders all thirteen. `compliance.md` already identified telemetry as where the
real POPIA exposure is, so the redaction has to be a type-level guarantee rather than a habit.

- **Identity fields are typed.** A diagnostic record takes a doctor *reference* — the `D01`…`D16`
  code — never a display string. A function that cannot accept a name cannot leak one.
- **No free text in a diagnostic record.** The same hard boundary the product already holds for
  preferences, and for the same reason: a free-text field reliably collects things nobody intended to
  collect. Diagnostic messages are **enumerated codes plus typed parameters**, not sentences.
- **Names exist in exactly one table** and are joined at render time. A name is never copied into a
  diagnostic row, so there is no row to scrub later.
- **No IP addresses, no geolocation, no user agent beyond a coarse platform token.** None of it helps
  diagnose a roster fault, and all of it is personal information.
- **A gate step** — the check that matters here. It must fail on: a free-text column in a diagnostics
  table, a string literal in an identity position at a call site, and a real surname anywhere in
  diagnostics fixtures. `names:check` already covers the last one; the first two are new.

> Doctor codes are **pseudonyms, not anonymisation** — the mapping exists in `private/`, so a
> re-identifiable record is still personal information under POPIA. This layer reduces sensitivity by
> a large factor. It does not make the data non-personal, and nothing below should be written as
> though it did.

---

## L1 — The command journal

**The replay mechanism, and the reason session replay is not needed.**

Every user intent is appended as a command row. The vocabulary is already established in
[`../domain/commands-events.md`](../domain/commands-events.md) — a **command** is an intent that may
fail, an **event** is a fact that happened. Both are recorded; they are not the same row.

| Field | Note |
|---|---|
| `appRunId` | One browser lifetime. **Not "session"** — [the glossary](../product/glossary.md) reserves that word as a shift synonym, and re-using it here would reintroduce exactly the ambiguity the reservation prevents |
| `seq` | Monotonic per `appRunId`. Gaps are visible, which matters when the buffer has dropped |
| `rosterId`, `rosterVersion` | Published rosters are immutable snapshots, so a version plus a command sequence is a complete starting state |
| `type` | Enumerated command name |
| `payload` | Entity references only — codes, dates, shift ids |
| `issuedAt` | **Server time, never the client clock.** `compliance.md` requires this for evidential weight, and a pilot user's laptop clock is not evidence |
| `clientAt` | The client's own timestamp, kept *alongside* server time so clock skew is measurable rather than confusing |
| `outcome` | `applied` / `refused` / `failed`, plus the constraint IDs involved on a refusal |
| `appVersion`, `schemaVersion` | Which build produced this. Without it, a replay reproduces today's code against last week's fault |

### Why this is better than a recording

Given the snapshot of version N and the commands since, **the state is reproducible on a developer
machine, deterministically, offline.** That is strictly more useful than watching a video of it:
breakpoints work, the failing assertion can be added as a test, and the reproduction becomes a
regression test — which the project already requires for every bug fix.

### One mechanism, two purposes

This journal **is** the append-only audit trail `compliance.md` requires for ECTA s15(4) evidential
weight — actor, timestamp, before/after, reason, override records preserved. **Do not build a second
one.** If a field is needed for the audit trail, it belongs here.

The consequence for retention is in L6: this is not disposable diagnostic exhaust.

---

## L2 — Error records

For the failures that *are* exceptions.

### Server

`instrumentation.ts` at the project root, which has been stable since Next.js 15:

- `register()` — process-level setup, runs before application code.
- **`onRequestError`** — a framework-level hook that fires for errors in Route Handlers, Server
  Actions, Server Components and Middleware **regardless of any error boundary.** This is the one
  worth knowing about: it catches what a component-level boundary cannot.

Note the architectural fit: the interactive core is client components against a JSON API, so in
practice `onRequestError` covers the API surface and the PDF/export endpoints.

### Client

Three sources, because they catch different things and none is sufficient alone:

1. A React error boundary — render-phase failures.
2. `window.onerror` — everything outside React's tree.
3. `unhandledrejection` — the async failures that otherwise vanish silently. **In practice the most
   common real-world gap.**

### Field names

**OpenTelemetry exception semantic conventions**: `exception.type`, `exception.message`,
`exception.stacktrace`. All three OTel signals reached stable across major SDKs in 2026 and the
exception conventions are stable.

We adopt **the vocabulary, not the SDK.** It costs nothing now and turns any future exporter into a
field mapping rather than a re-instrumentation.

### Correlation

Every error carries the `appRunId` and, where one exists, the `commandId` that was in flight. **An
error that is not tied to an intent is a puzzle; one that is, is usually already solved.**

### Stack traces

Production bundles are minified. Rather than ship source maps to a third party:

- Build source maps are **kept locally, outside the repository** (they are a reverse-engineering aid
  and have no business in a public repo).
- Traces are resolved **offline** against the map for the recorded `appVersion`.

Entirely tractable for one build and one user. It stops being tractable at a second tenant — which is
ADR-0013's first revisit trigger, stated there as such.

---

## L3 — Solver run diagnostics

The solver is a separate Python service behind a Postgres job queue, so a failure there is invisible
to the web app by design. The `solve_run` row is the diagnostic surface.

**The standard: a failed or surprising solve must be reproducible from its row alone.**

- The **request payload** as sent, plus its hash. `fixtures/solver-request.json` shows the shape;
  `parse_request` is the only thing that reads it.
- The **pre-flight arithmetic result** — if the solve failed for a reason pre-flight could have named,
  that is a pre-flight bug, and this is how you find out.
- The **model snapshot** — a canonical serialisation of the constraints, which the testing strategy
  already mandates snapshotting instead of rosters.
- The **penalty registry projection** — every violation with its slack value, weight and cost. Every
  explanation in the product derives from this, so a row without it cannot explain itself.
- **CP-SAT version and `num_workers`.** ⚠️ Non-negotiable: **CP-SAT is not deterministic across
  versions or worker counts.** A reproduction that does not pin both is not a reproduction, and this
  is the same fact that makes golden-file rosters forbidden in tests.
- Status and wall clock. `TIMED_OUT` with a usable roster is normal and is a quality statement, not a
  failure — the row should make that distinction legible rather than alarming.

---

## L4 — The client buffer

Diagnostics that only work while the network does would miss the faults most worth having.

- **IndexedDB queue**, flushed with exponential backoff. Needed regardless — the product is PWA-first
  and must survive being offline.
- **Bounded** — a fixed record count and byte ceiling, dropping oldest first.
- **⚠️ A drop is itself recorded.** A silent truncation reads as "nothing happened here", which is
  worse than a gap, because a gap prompts a question. This mirrors the project's existing rule about
  never applying a silent cap.
- **Never blocking.** Writes are fire-and-forget; a rejected flush retries later; a full quota drops
  records rather than throwing into a user action. Restated because it is the rule most likely to be
  broken by a well-meaning `await`.

---

## L5 — The diagnostic bundle

**The single most important layer for the pilot, and the cheapest.**

A persistent, unobtrusive **"Something looks wrong"** control. One tap produces one downloadable
file: current view state, the last N commands, recent errors, app and schema version, and the active
roster version identifier.

He sends it by WhatsApp — **the channel he already uses for everything**, including the shift requests
this product is replacing.

Why this matters more than it looks:

- **It works when the network and the database are both dead.** Every server-side layer above has
  nothing to say in exactly that case. This one still does.
- **It needs no explanation.** No console, no reproduction steps, no "can you check whether it
  happens again". A non-technical user can do it, once, correctly, under pressure.
- **It fits the product's own principle** — *every screen needs an export*, and *he must be able to
  abandon the app mid-month with zero loss*. The bundle is that principle applied to faults.
- **He stays in control of what leaves.** The bundle opens with a plain-language page saying what it
  contains and confirming it holds no patient information. Nothing is sent automatically.

**Design constraint:** the bundle must be readable both by a person and by a script — the same file
should be openable by him and replayable by us.

---

## L6 — Retention and minimisation

POPIA s14 requires records not be kept longer than necessary. Two clocks, because there are two
purposes:

| What | Retention | Why |
|---|---|---|
| **Error records, buffered client diagnostics, solve-run diagnostics** | **90 days, then hard delete** `[ASSUMED]` | Diagnostic exhaust. Useless after a fix ships; a liability if kept |
| **The command journal** | **Kept with the roster it belongs to** | It is the audit trail. ECTA s15 evidential weight depends on it existing when a question is asked years later |

**Enforced by a scheduled job, not by this document.** A retention policy nobody implemented is a
retention policy that failed. The deletion job's own run is logged — to the command journal, not to
the table it is emptying.

The 90 days is `[ASSUMED]` and is the owner's call — logged in
[`../NEEDS_YOUR_INPUT.md`](../NEEDS_YOUR_INPUT.md).

---

## Volume, so nobody proposes ClickHouse

One practice, thirteen doctors, roughly **100 slots a month**. A heavy editing month plausibly
produces a few thousand commands and a handful of errors.

**That is nothing.** It fits in a Postgres table with room to spare and is queryable with `SELECT`.
Any proposal involving a columnar store, a streaming pipeline or a log shipper is solving a problem
this project will not have for years — and ADR-0013 records the volume triggers that would change
that.

---

## What we deliberately do not collect

Written as a list because each one will be suggested eventually.

- **No session replay or screen recording.** The main screen is a grid of thirteen identifiable
  doctors' movements. Masking is opt-in per element, defaults do not cover everything, and one
  unmasked cell uploads exactly what the repository architecture exists to prevent. **L1 diagnoses
  better anyway.**
- **No keystroke capture.**
- **No free text.** See L0.
- **No patient or health data.** The product holds none, and this must stay true of its telemetry.
- **No IP addresses or geolocation.**
- **No third-party analytics of any kind** during the pilot.
- **⚠️ No `console.log` in production paths.** Not a style rule. A host's log drain **is** third-party
  log aggregation — an unregistered sub-processor — and unstructured strings are precisely how a name
  ends up offshore. Use the sink.

---

## The sink, and how this stays reversible

All instrumentation is written against a **`DiagnosticSink`** interface, never a vendor:

| Sink | Where |
|---|---|
| `PostgresSink` | The pilot |
| `FileSink` | Local development |
| `NullSink` | Tests — diagnostics must never make a test flaky or slow |
| *later* `OtlpSink` / Sentry-compatible | A configuration change, not a re-instrumentation |

The escape hatch is deliberately concrete: **GlitchTip accepts the same Sentry SDKs and the same DSN
format and runs in 512 MB across four containers.** So "self-host a Sentry-compatible endpoint" stays
a config decision rather than a rewrite — which is what makes ADR-0013's "no third party" cheap to
reverse, and therefore safe to choose now.

---

## Checklist before the pilot starts

Ordered by what hurts most to be missing. **L5 first** — if only one layer ships, it is that one.

- [ ] **L5 diagnostic bundle**, with its plain-language cover page. Works offline. ⏳ *2026-09-08:
      the server-side assembly endpoint exists (`GET .../diagnostic-bundle`,
      `docs/architecture/api.md`) — app/schema version, active roster version, last 50 commands.
      No UI control, no cover page, no offline capture: there is no real client yet to build them
      into.*
- [ ] **L0 typed diagnostic API** and the gate step that keeps it honest. ✅ *2026-09-08: typed
      `CommandJournalEntry`/`CommandType`; `npm run diagnostics:check` fails on a free-text column
      beyond the allowlist or a display-name-shaped key at a call site — verified against a
      deliberately injected violation, not just written and trusted.*
- [ ] **L1 command journal**, doubling as the audit trail. ✅ *2026-09-08: `command_journal`
      replaces `audit_log` in place, wired into all seven non-draft mutation routes — `applied`
      from the route body, `refused`/`failed` from each route's `catch` block
      (`journalRefusal`/`classifyOutcome`, `lib/server/command-journal.ts`), proven against real
      refusals in `api:check` (H-03, a no-op, a wrong-status conflict), not just written. Real
      remaining gap: `appRunId`/`seq`/client-correlation fields populate only once a real browser
      client sends them, and none does yet.*
- [ ] **L4 client buffer**, bounded, drop-recording, non-blocking.
- [ ] **L2 error capture** — `onRequestError`, error boundary, `unhandledrejection`. ⏳ *2026-09-08:
      the server half is real — `error_record` (OTel field names), `instrumentation.ts`'s
      `onRequestError`, and (the actual coverage) every route's `toErrorResponse` fallback branch
      recording via `lib/server/error-record.ts`, proven end to end in `api:check` against a real
      `22P02` failure, not a synthetic hook. No error boundary, no `window.onerror`, no
      `unhandledrejection` — all inherently client-side, and there is no client yet.*
- [ ] **L3 solve-run diagnostics**, including CP-SAT version and worker count. ⏳ *2026-09-08:
      `solve_run` carries every L3 field (`0016_solve_run_diagnostics.sql`) and the solver computes
      all of them (`call-roster-solver --json`) — request hash, full pre-flight result, the model
      snapshot, CP-SAT version, `num_workers`. Proven by `solver:e2e` persisting one real row from
      one real solve and reading it back. **Not built: the pipeline that would ever call this in
      production** — no `GenerateDraft` route, no worker claiming rows — "the solver ships last"
      remains true; this is the diagnostic surface waiting for it, not a live pipeline.*
- [ ] **L6 retention job**, with the owner's confirmed number.
- [ ] Source maps retained per build, outside the repository, with the offline resolution step
      written down in [`runbook.md`](runbook.md).
- [ ] One rehearsal: **break something deliberately, produce a bundle, and reproduce the fault from it
      alone.** An unproven diagnostic pipeline is not a diagnostic pipeline — the same standard
      applied to `contract:check` and `names:check`.
