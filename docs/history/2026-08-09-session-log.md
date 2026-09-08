# Session history — August–September 2026

**Archived from `HANDOFF.md` on 2 September 2026. Nothing here is current state.**

## Why this file exists

`HANDOFF.md` is supposed to *"orient a cold session in one read"*. It had grown to **1,530 lines
across 22 top-level sections**, 19 of which were session history — so every session paid roughly
**21,000 tokens** of context to read a file where a new session needed one section.

That broke the project's own rule, stated in [`../../AGENTS.md`](../../AGENTS.md):

> **Many small documents beat one big one.** A 400-line file costs 400 lines of context to answer one
> question; four 100-line files cost 100.

## ⚠️ Read [`../DECISIONS.md`](../DECISIONS.md) instead

Every entry below has a corresponding `DECISIONS.md` entry written in the same session, usually
longer and with better reasoning. **That duplication was the actual waste** — two journals maintained
by hand, both describing the same work.

The rule now: **`DECISIONS.md` is the one dated journal. `HANDOFF.md` is current state only, and it
is overwritten rather than appended.**

Kept rather than deleted because it is cheap to keep and deleting someone's record of their own
project is not a call to make for a few kilobytes. Do not add to it.

---

# DIAGNOSTICS DESIGNED — 2 SEPTEMBER 2026

**Documentation only. Nothing built — that was the ask.** Gate green.

You asked for rigorous log collection for your dad's pilot month, so a fault can be fixed without
asking him how it broke. Researched, decided, written down.
[ADR-0013](../../docs/architecture/decisions/0013-first-party-diagnostics.md) +
[`docs/ops/diagnostics.md`](../../docs/ops/diagnostics.md).

## The decision in one line

**Our own Postgres, no third party, no session replay ever, and a "Something looks wrong" button that
produces a file you get by WhatsApp.**

## Why not Sentry — the honest version

Sentry is a good product and I nearly recommended it. Three things decided against it *for the pilot*:

1. **The database is already offshore** — Supabase has no South African region (the repo already found
   this on 26 August; I re-verified). So the roster data already crosses the border under **one**
   operator agreement. Logging into that same database adds **no new transfer, no second s72
   agreement, no second sub-processor.** Sentry adds all three, for two months and one user.
2. **You said no accounts.** Every hosted option needs one.
3. **Self-hosting it needs 4 CPU, 16 GB RAM and 20+ containers** — a second production system to
   monitor the first.

**It stays available.** The instrumentation is written against a sink interface, and GlitchTip accepts
the same Sentry SDKs and DSN format in 512 MB — so switching on a third party later is a config
change, not a rewrite. That is what makes "no third party now" a cheap decision rather than a
commitment.

## The bit I think is genuinely important

**The bugs will mostly not be crashes.** A roster editor's real faults are *a warning that fires when
it shouldn't*, *an export that looks wrong*, *a cell that won't accept an assignment*. **Nothing
throws** — so an error tracker would see none of it.

The primitive is therefore the **intent stream, not the stack trace**: an append-only command journal
that is **deterministically replayable**. Published rosters are already immutable snapshots, so
version N plus the commands since is a complete starting state. I can reproduce his exact fault
locally and turn it into a regression test.

**And it doubles as the audit trail** `compliance.md` already requires for ECTA s15 evidential
weight. One mechanism, two jobs.

## ⚠️ Session replay: no, permanently

It is the obvious answer to "let me see what he did", so the ADR rejects it explicitly. **The main
screen is a grid of thirteen identifiable doctors' movements.** Masking is opt-in per element in every
vendor, defaults don't cover everything, and one missed cell uploads exactly what this repo's whole
architecture exists to prevent.

The command journal diagnoses better anyway — replayable beats watchable.

## The layer that matters most, and it's the cheapest

**A "Something looks wrong" button → one file → he sends it to you on WhatsApp.**

It is the **only layer that works when the network and the database are both dead**, which is the case
we're actually afraid of. It needs no explanation, no console, no "does it happen again". He sees a
plain-language page saying what's in it before anything leaves. Nothing automatic.

If only one thing ships, it's that. The checklist is ordered that way.

## Also now rules

- **`console.log` is prohibited in production paths.** A host's log drain **is** third-party log
  aggregation — an unregistered sub-processor. It looked free; it quietly breaches the boundary.
- **A diagnostic record cannot hold a name** — type-level, not a scrubbing step. Free text refused
  outright, same boundary as preferences.
- **`appRunId`, not `sessionId`** — the glossary reserves `session` as a shift synonym.
- `.claude/rules/diagnostics.md` is path-scoped, so it costs no context until diagnostics code exists.

## Three questions for you

- **37** — sign off ADR-0013? It is `proposed`; nothing is blocked, but say yes and I mark it accepted.
- **38** — retention for diagnostic data. `[ASSUMED]` 90 days. The command journal is separate and kept
  with its roster.
- **39** — **will your dad actually send a file on WhatsApp when something looks wrong?** If not, the
  design needs a different escape hatch, and I would rather know before building it.

## Next without input

1. **`previousPublished` and the churn penalty** — validated but unconsumed; 33 consecutive months is
   unusually good material.
2. **The export renderer** — still the highest-value thing, still blocked on the template (**G**).
3. **Diagnostics L0/L1 schema** — buildable behind the swappable sink once there is a database, which
   is Track B.

---

# THE BOUNDARY IS CLOSED — 1 SEPTEMBER 2026, LAST

**Both gates green. 251 JS tests / 17 files, 78 solver tests.**

`npm run seed:request` runs the pipeline the product will actually run:

```
33 months of sheets → loadSeedPeriod → inferAvailability → buildSolveRequest → JSON
                                                                  ↓
                                    contract.py::parse_request → CP-SAT → OPTIMAL
```

**13 doctors, 31 days, 97 slots, OPTIMAL, 0 violations** — and the eight availability rules the solver
received were **derived from observed history, not typed in.** They match `september_2026()`'s
hand-written ones, D07's and D09's Monday exception included. Two implementations, opposite
directions, same answer.

## Two more mismatches, found the same way as the first five

**6. `ShiftKind` was a different enum on each side.** Python had seven members, TypeScript five. A
TypeScript request would have been rejected on `long-day` — the good case. The bad case: Python
applied `fri_evening` to **Pattern C's evening shift**, and a Pattern C day is not a Friday. The label
already lied for one of three patterns.

TypeScript won on the glossary's terms — it defines the burden axis as *"day class × shift kind"*, so
`kind` is a **burden** concept, while `fri_early` is a pattern *position* that `shiftId` already says.

**Fixing it fixed a visible bug:** the debug grid hard-coded `morning`/`afternoon`/`night` rows, so
**three of Friday's four shifts were invisible.** Rows now derive from the kinds present, and the
`even` row shows up for the first time.

**7. ⚠️ `dayClass` is lossy about the calendar.** `classifyDay` deliberately lets Saturday and Sunday
outrank `public-holiday` — your dad's *"it counts once as a Saturday"*. Right for burden, and it means
**a holiday on a weekend is not in `dayClass` at all.** The builder would have sent
`isPublicHoliday: false` for every weekend holiday. `RosterDay` now carries the fact separately; the
seed loader had it and was discarding it at one line.

It happens not to bite H-10 — the rule does not apply at weekends — which is why it would have
survived a long time.

## New this stretch

| File | What it is |
|---|---|
| `lib/contract/request.ts` | `buildSolveRequest` — this side of the wire |
| `lib/contract/request.test.ts` | 32 tests, conversions and refusals |
| `scripts/build-solve-request.ts` | `npm run seed:request` — real history in, request out |

## Two of my own defects the gate caught

- **`?? new Map()` infers `Map<any, any>`** — nine `no-unsafe-*` errors from one omitted type
  argument.
- **A dead `buildWorkforceTimeline` call** whose docstring claimed the 90-day rule was doing work it
  was not. Departed doctors drop out because they worked no shift in the target month. The docstring
  described code that was not running.

Also: **`npm run solver:run` could not execute at all** — nested quotes in the PowerShell
`-Command`. Now uses the console entry point `pyproject.toml` already declared.

## Next without input

1. **Zod schemas** once the first API route exists. At that point the schema becomes the contract's
   machine source and `check-contract.mjs` compares against it instead of scraping Python. Premature
   before there is an edge to validate at.
2. **`previousPublished` and the churn penalty.** The field is validated and unconsumed; the seed data
   has 33 months of consecutive rosters to test churn against, which is unusually good material.
3. **The export renderer** — still the highest-value thing, still waiting on the template (**G**).

---

# THE REQUEST PARSER — 1 SEPTEMBER 2026, LAST

**Both gates green. 219 JS tests / 16 files, 78 solver tests.**

Set out to feed `inferAvailability` into the solver instance. That meant writing the Python side of
the wire boundary, and **writing the parser is what found the problems** — not re-reading the
document, which I had done several times.

## The root cause: there was no parser

The only way to get an `Instance` was the `september_2026()` fixture. So the contract described a
payload **nothing could read**, and every field was unverified by construction. A document is not a
contract until something parses it.

## Five mismatches

1. **`availability` was not in the request at all** — H-10 could never have crossed. *(Fixed earlier
   today.)*
2. **Weekday integers meant different days on the two sides.** *(Fixed earlier today.)*
3. **`fte` cannot be defined here.** *(Removed; question 36.)*
4. ⚠️ **`days[].shifts[]` was sent and then ignored.** `Day.shifts` read a module-global `PATTERNS`
   table. The contract sent shifts; the solver used its own; they agreed **only because there is
   exactly one practice.** A second tenant would silently have been rostered on this one's hours.
   `Day.explicit_shifts` now carries the payload's shifts; the table survives only as a fixture
   convenience.
5. ⚠️ **Shift objects had no `kind`**, which `Shift.is_night` needs, which H-04 needs. Deriving it
   from `endsNextDay` works for all three current patterns by coincidence, not definition.

## New files

| File | What it is |
|---|---|
| `solver/src/call_roster_solver/contract.py` | `parse_request` — the boundary's missing half |
| `solver/src/call_roster_solver/wire.py` | weekday names ↔ this side's integers |
| `lib/contract/weekday.ts` | the same, from the other side |
| `fixtures/solver-request.json` | one payload **both** test suites read |
| `fixtures/README.md` | why the directory exists, and what each field in the fixture is for |
| `scripts/check-contract.mjs` | three-way drift check, **in the gate** |

## `npm run contract:check`, and it is proven

Extracts the `_*_FIELDS` sets from `contract.py`, parses the JSONC examples out of the contract
document, reads the fixture. **No hand-maintained duplicate of anything** — each field set comes from
the file that owns it.

**Ten deliberate defects planted one at a time; all ten caught**, including "the parser was
restructured so no field sets are found", because an extractor that silently finds nothing would make
every other check pass vacuously.

It also found a false positive in itself on the first run — `burdenWeights.weekday_day` is a burden
*class*, not a weekday. Recorded in the code rather than quietly fixed.

## ⚠️ I disagree with an instruction I wrote earlier, and changed it

`AGENTS.md` and the contract both said boundary types are *"generated from `solver-contract.md`, never
hand-written."*

**Generating types from a prose document is the wrong direction.** The schema should be the machine
source and the document its rendering. Both files now say the truth: hand-written today, known gap,
`contract:check` is the stopgap, generation still the intent **from a single machine-readable
schema**. Zod is not installed and adding it now is premature — there is no API route to validate at
yet.

`AGENTS.md` also said the gate was nine steps. It was ten before today and is eleven now. Corrected.

## Next without input

1. **Feed `inferAvailability` into a request builder** — the original goal, now unblocked. The TS side
   can emit a `solver-request.json` from 33 months of history and the Python side will parse it.
2. **The export renderer** — still waiting on the template (question **G**).
3. **Zod schemas** when the first API route exists, at which point the schema becomes the contract's
   machine source and `check-contract.mjs` can compare against it instead of Python regexes.

---

# CONTRACT 1.1.0 — 1 SEPTEMBER 2026, LATER AGAIN

**Both gates green. 208 JS tests, 41 solver tests.**

Went to feed `inferAvailability` into the solver instance and found the wire format could not carry
it. Three findings, one an actual latent bug.

## 1. H-10 had no wire representation

The request carried `preferences` and no `availability` — so H-10 existed on both sides and **the
solver could never have been told about it in production.** Added in 1.1.0.

The contract now also spells out why encoding it as `UNAVAILABLE` preferences is wrong: it spends the
H-08 budget on a fact the doctor never chose, needs every date enumerated so it expires at the
horizon, and **loses the public-holiday exemption** — the counter-intuitive part, so the part that
would break.

## 2. ⚠️ A weekday integer means two different days

| | | `MONDAY` | `SUNDAY` |
|---|---|---|---|
| TypeScript | `Date.getUTCDay()` | **1** | **0** |
| Python | `date.weekday()` | **0** | **6** |

Both correct, neither can change. D07's Monday exception is `1` in `availability.ts` and `0` in
`instance.py`. **As an integer on the wire it becomes Sunday with no error anywhere.**

Already live in `AvailabilityRule.exceptWeekdays` and `RecurringSlot`; hasn't bitten only because
nothing crosses the boundary yet.

**Fix: weekdays cross as names.** New `lib/contract/weekday.ts` and
`solver/src/call_roster_solver/wire.py`, one conversion per side. Both reject unknown names and
out-of-range integers — Python's `-1` would otherwise return `SUNDAY` silently.

**The tests pin the asymmetry on purpose.** `MONDAY === 1` here, `MONDAY == 0` there. "Fixing" either
side to match the other breaks a build, which is the intent.

## 3. `fte` cannot be defined here

No doctor works full time at this practice, including the principal — so there is no baseline to take
a fraction of, and any value would be invented. It also sat one line from `burdenLedger`, and
ADR-0012 says **burden ÷ FTE is the trap, not the fix**.

**Removed from the contract. Annotated but kept in `data-model.md` as question 36** — dropping a
schema column is your call, and you may want it for billing or a contracted minimum. Safe to leave
unpopulated; not safe to fill in. Cheap now, a migration after the first one runs.

ADR-0008 still shows `fte numeric`. **Left alone deliberately** — editing an ADR retroactively
destroys the thing it is for.

## Next without input

1. **Generate the contract types** on both sides — Zod and Pydantic — from
   `solver-contract.md`. The document has said to do this since day one and neither side does; the
   weekday bug is what that gap looks like in practice. This is now the largest unbuilt safety net.
2. **Then** feed `inferAvailability` into the instance builder, which is what I set out to do. It
   needs the generated types to be worth doing properly.
3. **The export renderer** — still waiting on the template (question **G**).

---

# H-10 IN THE SOLVER — 1 SEPTEMBER 2026, LAST

**Both gates green. 198 JS tests, 30 solver tests.**

Wired structural availability into the solver, and it revealed that a `[CONFIRMED]` constraint had
been backwards since the brief.

## H-06 was modelling an effect as a cause

The solver held `friday_back_half_excluded = {D01–D04}` as a list of **banned** doctors at
`Tier.LEGAL` weight 10 — effectively 10⁵.

**The anchors are not banned from Friday evening.** 17:00 is the first hour the pool exists, so "the
back half goes to pool doctors" is a consequence of *availability*. Two reasons the weight was wrong:
the principal confirmed those breaches were **requested**, and there are **11 across 33 months** — at
10⁵ the solver would have refused Friday evenings to anchors who wanted them.

**Demoted to `Tier.PREFERENCE` weight 1.** The cause is now modelled directly as **H-10**.

## H-10, and why it is not H-08

- **H-08** — a doctor *declares* unavailability for a date. Budgeted, because unpriced declarations
  inflate until the model jams invisibly.
- **H-10** — a standing fact about where the doctor *is*. No declaration, no budget, no per-date
  variation.

The **holiday exemption lives inside `AvailabilityRule.blocks()`**, not at the call site, so it cannot
be forgotten. Those 40 holiday daytime shifts are what confirmed the mechanism.

## ⚠️ My first weighting was wrong and a test caught it

I priced H-10 **equal** to a coverage shortfall. The test expecting an H-10 violation found none: the
solver had correctly worked out that leaving two slots empty was cheaper than assigning an unavailable
doctor twice.

Investigating gave the better model. **Equally empty is not equally bad** — an empty slot is visible
and tells the principal he has a problem; a phantom doctor produces a roster that **looks complete and
is not**. H-10 now costs **twice** a shortfall, so the model leaves the gap showing.

Pinned by `test_H10_leaves_the_gap_showing_rather_than_inventing_cover`. It surfaced by writing a test
that asserted the wrong thing and asking why it failed.

## Penalty tiers as they now stand

| Constraint | Tier | Note |
|---|---|---|
| H-01 coverage, H-03 membership | structural | |
| **H-10** availability | COVERAGE × 2 | above a shortfall, deliberately |
| H-02 one shift per doctor per day | COVERAGE × 1 | elasticised 31 Aug |
| H-04 back-to-back nights, H-05 Saturday | LEGAL | |
| **H-06** Friday back half | **PREFERENCE** | demoted from LEGAL |
| H-07 D01 on a Friday | flag, default off | |

## Next without input

1. **Feed `inferAvailability` into the instance builder**, so availability comes from history rather
   than being hand-written in `september_2026()`. Both sides already agree on the answer; this makes
   the agreement structural instead of coincidental.
2. **Provenance in the assignment schema** — needs the data model, which needs a database. Track B.
3. **The export renderer** — still waiting on the template (question **G**).

---

# AVAILABILITY DERIVED FROM DATA — 1 SEPTEMBER 2026, LATER STILL

**Both gates green. 198 JS tests, 26 solver tests.** Coverage: analytics 95.9%, export 96.1%.

`lib/analytics/availability.ts` closes the gap flagged when `capacity.ts` was written — it no longer
takes `anchors` and `pool` as hard-coded arrays.

## It reproduces the principal's own classification from the data alone

Given only who-worked-what across 33 months, `inferAvailability` derives **anchors D01–D05, everyone
else pool** — exactly what he confirmed. It independently finds the D07/D09 Monday exception too.

**The holiday exemption is load-bearing in the inference, not only the rule.** A pool doctor working a
holiday daytime shift is *not* evidence they can work an ordinary weekday — their practice was closed.
Counting those 40 shifts would reclassify most of the pool as anchors. There is a test for it.

**The hard/soft line is not blurred.** The GP fact is *availability* (hard — physically elsewhere);
D03's no-nights is a *preference* (`[CONFIRMED]` "yes but flexible"). Only hard availability is in
this module.

## ⚠️ Three errors of mine, all caught by running it

**The binary tier was wrong.** My first `tierOf` called anyone with *any* weekday exception an anchor.
Over the real data that made **D07, D09 and D16 anchors**, overcounting anchor capacity by three
doctors and **understating pressure** — the wrong direction for a warning. Replaced with
`restrictedEligibility`, a fraction. Those three come out at 19.5%: one weekday in five.

**So figures I had published were wrong.** `workforce.md` said ten of 33 months could not tolerate an
anchor absence, four with no slack. It is **six and two**. Corrected in place, and worth noting the
direction — the correction makes things *less* alarming, which is the direction a reader is least
likely to challenge.

**Lint caught a third.** `AvailabilityRule` was a single-member discriminated union, so its
discriminant check was dead code. That file's own comment — *"a rule nobody needs is a rule that gets
misused"* — applied to itself.

## What the capacity forecast gained

Two properties, both asserted as tests:

- **Adding pool doctors still does not relieve the pressure.** The commercially important one.
- **"How many can be away" removes the largest contributors first**, so it is the worst case rather
  than a flattering average. An answer that depends on *which* doctor is on leave is not an answer.

## Next without input

1. **Provenance capture in the assignment schema** — the last piece of the fairness design that is
   still inert.
2. **The export renderer** — waiting on the template (question G).
3. Possibly: wire `availability` into the solver's instance model, so the GP fact becomes a hard
   constraint there rather than an emergent property of the data.

---

# PRE-FLIGHT CAPACITY — 1 SEPTEMBER 2026, NIGHT

**Both gates green. 176 JS tests, 26 solver tests.** Coverage: analytics 95.5%, export 96.1%.

`lib/analytics/capacity.ts`, reported by `npm run seed:workforce`.

## ⚠️ The feature I set out to build does not work

I expected anchor pressure to **predict** constraint breaches — the 34 H-02 doubles cluster in 2024,
and 2024 had three anchors instead of five. **Correlation is 0.611.** Not enough:

- **May 2025**: 0.91 pressure, three anchors, **zero** doubles.
- **March 2024**: 0.64 pressure, **three** doubles.
- Every month from August 2024 has zero regardless of pressure.

The **date** separates the eras, not the load — August 2024 is when D04 took the Tuesday-night slot.
The failed hypothesis is recorded in the module comment, in a test, and in the script's own output. A
test asserts the caveat *"does NOT predict constraint breaches"* is present, because that is exactly
the sentence a later reader would delete.

## What fell out of it is better, and uncomfortable

The **structural** measurement holds. A month's slots split into two pools that **cannot substitute
for each other**:

| | Who | Typical month |
|---|---|---|
| **Restricted** — weekday, before 17:00, not a holiday | Anchors only | ~42 of ~95 |
| **Open** | Anyone | ~53 of ~95 |

- Pool doctors covered **14 of 1,356** restricted slots across 33 months — **1.0%**.
- Restricted slots consume **74% of an anchor's whole month** before any night, weekend or holiday.
- **Ten of 33 months could not have tolerated one anchor absence.** Four had no slack at all.

**And the commercially important consequence: adding pool doctors does not help.** Five more GPs
change nothing about the bottleneck, because none can work a Tuesday morning. Asserted as a test —
it is what a naive headcount forecast gets wrong and what a practice under pressure would try first.

## Why this replaces the December trigger

The earlier correction found the December shortfall appears in one year of three. This forecast keys on
**anchor headcount against restricted demand in any month** instead. A December-keyed forecast would
have fired uselessly in 2024 and 2025; this one flags January 2024 and May 2025 — the months genuinely
at the limit.

No solver needed. It is subtraction, and it answers *"how many of us can be away at once"*.

## Next without input

1. **Per-doctor default availability** — the GP fact, D03's no-nights preference and the
   Wednesday-night group all belong there, and the capacity module currently takes anchor/pool as a
   parameter rather than reading it from data.
2. **Provenance capture in the assignment schema.**
3. **The export renderer** — still waiting on the template (question G).

---

# AUDIT + THE MISSING TRIGGER — 1 SEPTEMBER 2026, LATE

**Both gates green. 164 JS tests, 26 solver tests.** Coverage: analytics 95.2%, export 96.1%.

Asked to self-check for blockers before tonight's information arrives. **Two real gaps found and
fixed**, plus the trigger this project had twice identified as missing.

## The audit

| Finding | Status |
|---|---|
| ⚠️ **The burden schedule could not express the answer to question W.** `patternId: 'B'` looks like it says "a Friday from 17:00" — but a Friday that is a public holiday runs Pattern **C**, whose `red-evening` is *also* 17:00–23:00. A pattern-keyed rule would have priced Good Friday evening as a weekday | **Fixed.** `BurdenMatch` gained `weekday` and `fromHour`. W is now genuinely two lines of data |
| ⚠️ **The branding seam was documented but not built** — the logo and template would have arrived with nowhere to go | **Fixed.** `lib/export/branding.ts` |
| A suspected `parseMonth` bug (`'2025-XX'`) | **Not a bug** — NaN propagates to `dayOfWeek`, which rejects it. A near-miss worth knowing: correct by composition, not by intent |
| Fresh-clone path | **Clean.** All five seed scripts run on `fixtures/seed-data` alone |
| Stale figures in four docs | **Refreshed.** All pre-dated the dataset doubling |
| `lib/export` had only the global 80% coverage floor | **Raised** to the same 90/95/80/90 as the fairness arithmetic |

Two decisions inside the branding seam worth not undoing: **a logo must be a `data:` URI**, because an
external image fails offline, fails in a PDF and leaks a request to whoever hosts it; and **`labelFor`
is a function, not a map**, so the code-to-name mapping never has to exist in the export layer.

## The trigger — `npm run seed:workforce`

`lib/analytics/workforce.ts`. H-02 and H-07 both turned on **headcount**, and the catalogue only ever
got re-verified when somebody *stated* a new rule.

**It reproduces the story independently, which is the test that matters.** From the assignments alone
it derives **D04 joined 2024-03-21** — the exact date read off the March 2024 sheet by eye.

**And it produces a finding about our own past work:** the original 15-month window contains **four**
workforce changes; the full 33-month window contains **ten**. Every constraint verdict is an average
across compositions, and nothing flagged it.

**So "re-verify when the workforce changes" is not a usable rule** — it changes here about every three
months. The usable version is now in `docs/domain/constraints.md`:

> A verdict should state the span it was computed over, and say so when that span crosses a change.

Longest stable span in 33 months: **eight** (May–December 2025).

## Nothing is blocked

Everything tonight brings has somewhere to land:

| Arriving | Lands in |
|---|---|
| Word template + logo | `lib/export/branding.ts` — validated, then the renderer |
| **W**: Friday weight | Two lines in `AGREED_BURDEN_V1`. The match fields now exist |
| Sunday holiday confirmation | One line in `classifyDay` |
| **32**: verified code mapping | Nothing changes in code — codes are already the interface |
| **X**, **Z**, **AA**, M's label | Documentation and penalty weights only |
| `validFrom` on constraints | A design decision, not a blocker. Argued in `constraints.md` |

## Next

1. **The export renderer** — the only thing waiting on the template.
2. **Capacity forecast keyed on headcount slack**, not December — the seasonal finding says the
   calendar is the wrong trigger.
3. **Per-doctor default availability**, then **provenance capture at assignment time**.

---

# EXPORT LAYOUT BUILT — 1 SEPTEMBER 2026, EVENING

**Both gates green. 131 JS tests, 26 solver tests.** Owner at work all day, so this session did only
things needing no input.

**Tonight's agenda is at the top of [`docs/NEEDS_YOUR_INPUT.md`](../../docs/NEEDS_YOUR_INPUT.md)** under
*🌙 For tonight* — fourteen items, grouped by who can answer and what each unblocks.

## The export's geometry is built and verified

[`lib/export/calendar-layout.ts`](../../lib/export/calendar-layout.ts), derived from the nineteen
photographed sheets and checked against **1,023 real cells across 33 months** — every one in the
correct weekday column.

```bash
npm run seed:layout   # in the gate
```

**The five-row rule is the find.** A Sunday-start calendar needs six week-rows for ten of the
forty-eight months between 2023 and 2026, and **the practice never prints six** — trailing days wrap
into row one's *leading* empty cells. Eight of our 33 months need it. Not cosmetic: a sixth row changes
the row height, so it changes whether the grid fits a page.

**December 2023 forced wrapping and spilling into one computation** — it does both at once, 31 December
wrapped into Sunday beside 1 January spilled into Monday.

**The rendering is deliberately not built.** The Word template has not arrived, and it is exactly the
details he said he would notice that a photograph cannot settle — column widths, font at print size, how
an over-long name is handled, the precise greys. Full reasoning in
[`docs/product/export.md`](../../docs/product/export.md).

## Two questions answered by analysis

**H-07 is *becoming* true, not occasionally broken.** D01 worked **8.1%** of Friday shifts before April
2025 and **1.9%** after. So H-07 as written is a rule about the present applied to the past: weighted
over all history it looks broken twice a month, over the last eighteen months twice a year. **Tune the
solver on recent behaviour.** And it raises a design question — constraints may need a `validFrom`
like people, weights and memberships already have.

**The seasonal capacity claim fails its second test.** Distinct doctors per month: non-December mean
**12.9**, Dec 2023 **11**, Dec 2024 **12**, Dec 2025 **14**. The shortfall appears in one year of three —
the year with the fewest doctors. **The effect faded as the roster grew.**

**That changes what to build:** the pre-flight forecast should watch **headcount slack in any month**,
not December. A December-keyed forecast would have fired uselessly in 2024 and 2025.

## Next

1. **The export renderer** — needs the template (question G). Everything above it is done.
2. **Re-verify-on-workforce-change** — still nothing triggers a constraint re-check when a doctor joins
   or leaves, and both H-02 and H-07 turned on exactly that.
3. **Capacity forecast keyed on slack, not the calendar.**
4. **Per-doctor default availability**, then **provenance capture**.

---

# ALL NINETEEN SHEETS TRANSCRIBED — 1 SEPTEMBER 2026

**33 continuous months, 3,145 assignments, December 2023 to August 2026. Zero validation errors, 36
declared-anomaly warnings.** Both gates green. Still no `.git`.

Reproduce any of the below:

```bash
npm run seed:check        # validates all 33 months arithmetically
npm run seed:analyse      # every catalogued constraint against the data
npm run seed:report       # the fairness and analytics report
npm run seed:availability # the GP-before-17:00 verification
```

## ⚠️ H-02 is falsified after all — read this one

On 31 August the principal said H-02 "should be absolute but it has happened". **At that moment there
were zero counterexamples in 1,430 assignments.** His answer contradicted the data and was acted on
anyway. The next day the older sheets produced **34 counterexamples.**

A system that had trusted the data over him would have shipped a hard constraint that refused roughly
one roster a month for the whole of 2024. **The confidence-tag discipline only paid because it was
followed when it felt wrong.**

**Every behavioural constraint in the catalogue is now falsified.** Only H-01 and H-03 survive, and
both are enforced by the database rather than by habit.

## The doubles are a headcount artefact — a new kind of finding

**D03 held Tuesday 15:00–23:00 and Tuesday 23:00–07:00 simultaneously for most of 2024.** D04 does not
appear anywhere before 21 March 2024, and from 2025 holds Tuesday night. The doubles stop in **August
2024**, the month D04 takes that slot, and never recur.

So H-02 was false for eight months and became true when the roster gained a doctor. **A constraint can
be an artefact of headcount**, which means the catalogue needs re-verifying when the *workforce*
changes, not only when someone states a rule. **Nothing in the project currently triggers that** —
worth building.

## What else the 33 months settled

**Question 18 confirmed.** Christmas night: D08 (2023) → D11 (2024) → D01 (2025). D01 worked no
Christmas shift in 2024.

**The GP availability fact got stronger.** 1.3% of pool shifts start before 17:00 on a weekday, down
from 2.6%, and 40 pool daytime shifts on public holidays. The asymmetry testing the *mechanism* now has
twice the evidence.

**The fairness normalisation is stable.** Gini on load ratio moved 0.186 → **0.179** while raw-burden
Gini rose 0.341 → 0.375. Right direction, and the strongest evidence available that ADR-0012 is not
overfitted to the original fifteen months.

## Data quality, now measurable

- **The cross-validation chain is unbroken:** every adjacent pair of sheets agrees on its shared date.
- **Three date-label errors**, all the same Word-template fault — a day number repeated in the trailing
  cell. Resolved against the adjacent sheet each time.
- **Two more coverage gaps** (Saturdays 21 and 28 December 2024), both circled in red on the sheet by
  the practice. Same class as 28 January 2026.
- **The 29 May 2024 general election** was a declared public holiday — not one of the twelve statutory
  dates, so ad hoc holidays must stay data.
- **D16 added** to the code mapping and to the SURNAMES protection list.

## Open, and worth a look

- **H-07 went from 3 counterexamples to 26**, far more than proportional. Check before weighting it.
- **The four December 2023 doubles still want an eyeball**, though the 2024 pattern makes them much
  more credible than when first flagged.
- **32** — the D01–D16 code mapping is still unverified against real names.

## Next

1. **The export.** Now the only thing standing between this and a usable product. Specified: must match
   the Word template, which the owner is providing.
2. **Re-verify-on-workforce-change** — nothing triggers a constraint re-check when a doctor joins or
   leaves, and the H-02 story shows why that matters.
3. **Per-doctor default availability** — the GP fact, D03's no-nights preference and the
   Wednesday-night group all live there.
4. **Provenance capture at assignment time**, or the fairness split stays inert.
5. **Count distinct available doctors per December** — the untested half of the seasonal claim.

---

# NINETEEN MORE SHEETS — 1 SEPTEMBER 2026

**22 months, 2,094 assignments, zero validation errors.** Both gates green.

Nineteen sheets covering **Dec 2023 – Jun 2025** arrived in chat. **Seven transcribed; eleven months of
2024 remain** (2024-01 through 2024-11). The source images live only in the conversation — they were
never written to `private/source-artifacts/`, because images cannot be saved there from chat. **Ask
the owner to drop them in** if they are wanted on disk.

## What the new data settled

**The May/June 2025 gap is closed.** The run is continuous.

**Question 18 is confirmed in the data.** Christmas night went **D08 (2023) → D11 (2024) → D01 (2025)**
— three different doctors, and D01 worked no Christmas shift at all in 2024. The annual rotation the
principal described is real.

⚠️ **And it falsified a claim in `docs/domain/fairness.md`.** That document read December 2025 as
evidence the principal absorbs an exceptional December every year. He does not:

| | Shifts | Burden | vs his own 22-month mean |
|---|---|---|---|
| Dec 2023 | 20 | 42.0 | **+51%** |
| Dec 2024 | 14 | 22.5 | −19% |
| Dec 2025 | 14 | 27.5 | **−1%** |

The correction is written into that document rather than the claim quietly deleted. **The owner's
*decision* about absorbed burden survives untouched** — it was policy, not an inference from that
month. What is now untested is whether the practice-wide year-end shortfall is real as distinct from
his share of it; that needs a count of distinct available doctors, which has not been run.

## Three things the older sheets changed

**D04 did not exist in December 2023.** Their Tuesday-night and Thursday-morning slots were covered by
D01, D02 and D03 before the join.

**D16 assigned** — a doctor appearing Dec 2023 – Jun 2025 and never in the later window, so absent from
the mapping. Distinct from D12; the 3 December 2023 sheet lists both. ⚠️ **Their surname was not in the
SURNAMES block, so `names:check` would not have caught it leaking.** Added; 19 patterns now.

**Four suspected H-02 doubles in December 2023** — the counterexamples the principal said existed.
**All four need eyeball confirmation against the sheet**; two involve D03 on consecutive Tuesdays,
which is either a real arrangement in a month with no D04 or a systematic misread of the same cells.
`validate-seed-data.mjs` gained a narrow declared-anomaly escape for H-02 so the history can be
ingested without hiding them.

## Next

1. **Transcribe 2024-01 to 2024-11.** Eleven months. Everything is in place for them.
2. **Count distinct available doctors per December** — the untested half of the seasonal claim.
3. **Re-run `seed:analyse`** once 2024 is complete: every constraint verdict was computed on 15
   months and now has 33 to answer to.
4. **The export.** Still the most important unbuilt thing, and now specified: it must match the Word
   template, which the owner is providing.

---

# THE PRINCIPAL ANSWERED — 31 AUGUST 2026, EVENING

**Thirty-one answers.** Both gates green: 92 JS tests, 26 solver tests. Still no `.git`.

Full record with exact wording in [`docs/NEEDS_YOUR_INPUT.md`](../../docs/NEEDS_YOUR_INPUT.md); reasoning in
[`docs/DECISIONS.md`](../../docs/DECISIONS.md). **Read those two before re-deriving anything below.**

## ⚠️ Correction: D01 is the principal, not D02

The repository always had this right. I got it wrong in conversation and addressed two questions
(**H-05**, **O**) to him using D02's figures, so those two answers are second-hand about a different
doctor. Tagged as such. Nothing in the code was wrong.

## What changed in the code

| Change | Why |
|---|---|
| Burden schedule `illustrative-v1` `[ASSUMED]` → **`agreed-v1` `[CONFIRMED]`** | *"All the weights are fair."* Reports lose the weights caveat |
| **Saturday and Sunday now outrank `public-holiday`** in `classifyDay` | *"It counts once as a Saturday, not a Saturday and a holiday."* Those dates drop 5.0 → 3.0. Total burden 2961.5 → 2955.5 |
| **`isWeekendShift`** — Friday 17:00 to Monday 07:00 | The weekend is defined at last. **Not a burden concept** — see question W |
| **H-02 elasticised** in the solver, at the COVERAGE tier | *"It should be absolute but it has happened, so the app should still allow for it."* Was `add_at_most_one()`. The fourth constraint in that file caught by the same mistake |
| `DEPARTURE_GAP_DAYS` → `[CONFIRMED]` | My 90-day guess matched the number he already had in his head |

**Question S is closed and I was wrong about it.** I had flagged Sunday-night-equals-Sunday-morning as
an obvious shortcoming, with a test comment predicting the test would fail once real weights arrived.
Real weights arrived; it does not. The equality is deliberate.

## The finding worth reading in full

**Pool GPs cannot work weekday shifts starting before 17:00** — they are at their own practices.
`[CONFIRMED]`, and **verified**: of 505 pool shifts only 13 start before 17:00 on a weekday (2.6%),
and eleven of thirteen pool doctors have zero.

**The mechanism verified too**, which is the part that matters: on *public holidays* pool doctors do
work daytime shifts, because their own practices are closed. The rule holds on weekdays and dissolves
on holidays, exactly as the stated cause predicts.

It explains **H-06**, **Pattern C**, the diary's Friday–Sunday triples and the Friday 17:00 boundary —
four things previously recorded as unrelated oddities. Full write-up with the numbers in
[`docs/domain/workforce.md`](../../docs/domain/workforce.md).

**No constraint ID, deliberately.** It is not a rule the practice applies; it is a fact about where
people are. As a constraint it would report a violation every time it was *respected*. Its home is
per-doctor default availability. Reproduce the verification with:

```bash
node scripts/check-gp-availability.mjs
```

*(that script lives in the scratchpad, not the repo — re-create it if needed, it is ~60 lines)*

## Two new questions, both from the answers themselves

- **W** — the agreed weight table has **no Friday row**, so a Friday night still prices at 2.5, the
  same as a Tuesday, while the weekend demonstrably starts at Friday 17:00. Deliberately not guessed:
  it moves ~120 shifts between bands and would *raise* the load ratios of the three doctors already
  showing as most overloaded. `isWeekendShift` and `resolveBurden` are kept separate, with a test
  asserting they stay that way.
- **X** — **D07 and D09 alternate the Monday 15:00–23:00 shift fortnightly.** The only two exceptions
  to the GP availability fact, and they are systematic. Looks like an undocumented recurring slot.

## The priority order changed

Question 29 — *if it could only do one thing well* — answered: **"that everyone gets accommodated as
close as possible to their requests."** Not fairness, not speed. The pitch has been leading with the
fairness ledger; his own answer is preference satisfaction. The solver's phase order already puts
preferences above fairness, and that now has a stated reason.

## New document: the lifecycle

[`docs/product/lifecycle.md`](../../docs/product/lifecycle.md) — his own draft-by-the-20th → review →
final-before-month-end proposal, worked through against seven failure modes.

**The honest position is recorded there and should not be softened:** a draft round can make the job
*worse*. He spends six hours a month today; a second pass that becomes a second full negotiation
makes it twelve. It rests on the hypothesis that change requests against an existing roster are cheap
to apply — plausible, unproven. **The measurement after the pilot is not "did it work" but "did the
six hours go down."** If not, drop the draft round rather than optimise it.

## ⏳ Data promised, not yet on disk

**May and June 2025, plus fifteen months from 2023.** Found, not delivered. `private/seed-data/` still
holds the same 15 months. When they land:

1. `npm run seed:check` validates them arithmetically before anything else touches them.
2. **The 2023 data tests two claims that cannot be tested now** — that Christmas *rotates annually*
   (question 18), and H-02's counterexample, which appears nowhere in the current 1,430 assignments.
3. Expect doctors who have since left and current doctors who were not there. `membership` and
   `presenceShare` already handle that; the 2023 set will be the first real test of them.
4. It also makes the cross-year strategy comparison buildable for the first time — but only with a
   named-period concept, per [`docs/product/analytics.md`](../../docs/product/analytics.md).

## Next

1. **The export.** Unblocked, and now specified harder: it must look **exactly** like his Word table,
   and he is providing a blank template. Still the most important unbuilt thing in the project.
2. **Per-doctor default availability** — the model needs it before the GP fact can be used, and it is
   also where D03's no-nights preference and the Wednesday-night group live.
3. **Provenance capture at assignment time.** Without it the fairness split stays inert.
4. **Transcribe the new months** when they arrive, then re-run `seed:analyse` and `seed:report`.
5. **Track B** — repo creation and the first commit are still the owner's call.

---

# TWELVE OWNER ANSWERS — 31 AUGUST 2026, LATER THE SAME DAY

**ADRs 0001–0012 are now `accepted`.** Both gates green, 87 JS tests, 25 solver tests. Still no
`.git`.

Answered: **A** both export layouts · **R** provenance words confirmed · **G** logo yes · **Q** the
duplicate April sheet was a batch duplicate, not a reissue · **8** Friday is part of the weekend ·
**19** D15 gone, plus a requirement · **20** anchor/pool confirmed · **22** nobody works here full
time · **31** ADRs accepted · **T** the weekend split is informal · **P** the missing sheets exist ·
**5** `±` probably means approximately.

Full record with the exact wording in [`docs/NEEDS_YOUR_INPUT.md`](../../docs/NEEDS_YOUR_INPUT.md);
reasoning in [`docs/DECISIONS.md`](../../docs/DECISIONS.md).

## The three that changed code

**19 was a requirement and it was not met.** Departed doctors were excluded from the headline only by
luck, and a doctor who joined ten weeks before the period ended was being reported as carrying 30%
more than his share. Added `membership` (90-day trailing gap) and `presenceShare` (under 50% of the
period is low-sample). Covered by [`membership.test.ts`](../../lib/analytics/membership.test.ts). Headline
Gini 0.182 → 0.186 — the number barely moved; what changed is that it now describes twelve
well-sampled *active* doctors.

**8 exposed a pricing gap.** Friday is confirmed weekend work, but the burden schedule prices it as an
ordinary weekday — a Friday night at 2.5, the same as a Tuesday. Added a `fridays` count so the gap is
visible; logged **question V** rather than guessing a weight. **D02 worked 45 Fridays, D03 43, D04 33,
D01 only 4** — so under-pricing Friday under-credits exactly the three doctors already showing as most
overloaded. The real figures are worse than reported, not better.

**22 removed FTE as a concept.** No doctor works here full time, the principal included. FTE is not a
missing measurement, it is undefined — which makes the opportunity-based denominator in ADR-0012 the
only defensible one rather than the best of four.

## Two things not to redo

**T is answered and must not become a constraint.** The D01-Saturday / D02-Sunday split is real but
*informal* — *"an unwritten rule between the two of them but not a formal rule that gets enforced."*
Recorded under a new *"Observed tendencies that are deliberately not constraints"* heading in
[`docs/domain/constraints.md`](../../docs/domain/constraints.md), which exists precisely so a future session
does not rediscover it and promote it.

**32 is still open even though it looks answered.** He approved the *scheme* (real names → D01–D15) but
has not read `private/doctor-codes.md` and said so. The code-to-name pairs are unverified, and
everything in the ledger is keyed to them.

## Next

Remaining questions go to the practice principal **tonight**: the per-rule split on **M**, plus **18**,
**S**, **V**, **N**, **30**, **17**, and the Part-4 tail. Nothing is blocked on them.

Then: **the export.** It is now unblocked — two layouts, matrix to build and calendar to export — and it
is the most important unbuilt thing in the project. Also: capture `provenance` in the assignment
schema, and build a *good* manual preference-entry screen, because WhatsApp intake is deferred and the
principal will be typing requests in throughout the pilot.

---

# SESSION 2 — THE ANALYTICS ENGINE AND THE FAIRNESS NORMALISATION

**31 August 2026.** Both gates green. 99 JS tests, 25 solver tests. Nothing committed; there is
still no `.git`.

Two owner requests, which turned out to be the same problem: a comprehensive analytics section, and
*"a way to normalize the data for the doctors that only work weekends or only work weekdays"*.

**Read in this order if you are picking this up cold:**
[ADR-0012](../../docs/architecture/decisions/0012-fairness-normalised-by-opportunity.md) →
[`docs/product/analytics.md`](../../docs/product/analytics.md) →
[`docs/domain/fairness.md`](../../docs/domain/fairness.md) (the Normalisation and Provenance sections).

## What was built

`lib/analytics/` — the metrics engine. Nine modules, 99 tests, 94.9% statement coverage on that
directory, validated against all 1,430 real assignments.

```bash
npm run seed:report                      # the full report over private/seed-data
npm run seed:report -- --basis equal     # the naive basis, to see why it is wrong
```

| Module | What it holds |
|---|---|
| `types.ts` | The vocabulary. Tenant-agnostic: doctor codes are opaque strings, patterns are a parameter |
| `shifts.ts` | The pattern catalogue and day classification. `PILOT_PATTERNS_V1` |
| `burden-types.ts`, `burden.ts` | Versioned burden schedule as an ordered rule list, plus a validator |
| `equity.ts` | Gini, Jain, CV, MAD, leximax, load ratio. **The module doc says which may be optimised and which may only be reported** |
| `ledger.ts` | Burden accumulation, provenance split, revealed availability, entitlement weights |
| `metrics.ts` | The reported metric catalogue, the low-sample guard, and the caveat generator |
| `seed-period.ts` | Loads transcribed history. **Excludes spill days by default** — including them double-counts |
| `synthetic.ts` | Built-not-transcribed periods. For tests, and for demos that cannot use real data |

**Charts were deliberately not built.** The engine is shared by the solver objective, the ledger and
the export footer, and there are fifteen months to validate it against *today*. A chart can be
validated against nothing and built in an afternoon. Ordering stays **export → editor → analytics
UI**; see the sequencing note in `docs/product/analytics.md`.

## The design, in four sentences

1. **Load ratio is the only fairness verdict**: burden carried ÷ fair share, where fair share is
   normalised by the **burden of the slots the doctor could actually have worked**. Everything else
   is an indicator.
2. **Leximax is the objective; no dispersion measure ever is.** Gini, Jain, CV, MAD and range are
   all non-monotonic — each improves when the least-loaded doctor is given more work.
3. **Provenance is a field on every assignment** (`directed` / `requested` / `absorbed` /
   `unknown`), and `requested` burden is excluded from equalisation.
4. **Every report carries its own caveats**, naming its `[ASSUMED]` and `[INFERRED]` inputs.

## What the first real run found

```
Gini, raw burden          0.341
Gini, load ratio          0.182   <-- the headline
Top-four concentration    50.5% of all burden
```

**Roughly half the apparent inequality is explained by availability and half is not.** The four
anchors sit at load ratios of **1.34 to 1.49 after normalising**, so they genuinely carry about 40%
more than their share of what they were available for. Neither the naive reading ("the anchors are
overworked") nor the cynical one ("they just have more availability") is correct — and this is what
the normalisation was built to be able to say honestly.

### ⚠️ A new undocumented pattern — question T, and it may be the best finding yet

Across fifteen months:

| | Saturdays | Sundays |
|---|---|---|
| **D01** | **30** | **6** |
| **D02** | **4** | **26** |
| D03 | 25 | 13 |
| D04 | 24 | 14 |

D01 has **zero Sundays in nine of fifteen months**; D02 has **zero Saturdays in eleven of fifteen**.
D03 and D04 are balanced.

H-05 records only half of this — *"D02 never works a Saturday"* — and frames it as one doctor's
preference. If it is really **one rule, the two senior doctors splitting the weekend**, that is a
materially better model than two independent "never" rules, and it is stronger evidence than most of
the catalogue.

**Not modelled.** Guessing here is exactly how H-07 came to be written wrong twice.

## Question M is partly answered, and it changed the schema

The owner's answer: **most breaks were the doctor asking to work more**; the December 2025 ones were
forced by absence. That is not one of the three options that were offered, and the real content is
that **the same break means different things depending on who initiated it** — which nothing in the
roster records.

Hence `provenance`. `requested` burden is excluded from equalisation because crediting it means a
doctor who asks for extra shifts gets *less* work next month as a direct consequence: the system
punishing someone for volunteering, invisibly.

**Still open:** which of H-04/05/06/07 is mostly requested and which mostly forced. The fourteen-row
walk-through in `docs/NEEDS_YOUR_INPUT.md` is the form to take to the principal.

**Corollary that is a v1 requirement, not a refinement:** none of the 1,430 historical assignments
can be classified. Provenance must be captured at assignment time or the split stays inert forever.

## Two corrections to earlier work

**`fairness.md` recommended the wrong objective.** It endorsed mean absolute deviation and
sum-of-squares. Matl, Hartl and Vidal ([arXiv:1605.08565](https://arxiv.org/abs/1605.08565)) show
monotonic equity functions are the appropriate ones; MAD and sum-of-squares are not monotonic. The
document now says so, and `equity.test.ts` enforces it as a property rather than a comment.

**`fairness.md` recommended the wrong denominator.** It said `burden / fte_i`. FTE captures how
*much* a doctor works and nothing about the *mix*, so it leaves a weekends-only doctor looking
overloaded by construction — the trap, not the fix. Kept as the `explicit` basis; not the default.

## Three property-test failures, all real

Recorded because the fast-check investment paid within minutes, and one failure was mine not the
code's.

1. **A genuine bug.** `jainIndex([0, 5e-324])` returned `NaN` — squaring underflowed to `0/0`. Fixed
   by scaling to the maximum first.
2. **A property I stated wrongly.** I claimed *"adding burden to the least-loaded person always
   improves Gini"* and had derived it algebraically. fast-check falsified it in twenty cases: the
   derivation assumed sort order held, and a large enough increment makes that doctor the
   *most*-loaded. **The intuitive version of the claim was the wrong one.**
3. **A worked example that did not demonstrate its own point.** `[10,4,4,4] → [10,8,4,4]` has the
   same range in both.

## New in the gate

`npm run check` now runs **nine** steps: `format:check` → `lint` → `typecheck` → `test:coverage` →
`build` → `docs:check` → `names:check` → `seed:check` → `workflows:check`.

**Coverage thresholds are no longer 0.** Global floor 80/85/75/80; `lib/analytics/**` at
90/95/80/90. Two tiers because the global figure is held down by `app/`, still the stripped
scaffold. Do not lower either to make a change pass.

`allowImportingTsExtensions: true` is now on, so `.ts` import specifiers are required inside
`lib/analytics/`. That is what lets Node 24 run `scripts/analytics-report.ts` directly and share
types with the engine instead of reimplementing the arithmetic in a second `.mjs`.

## What to do next, in order

1. **Answer T, R and S** — all three are short and all three are blocking real decisions.
   T (the weekend split) is the highest-value; R names the provenance terms; S prices a Sunday
   night.
2. **The export.** Still the most important unbuilt thing in the project, and still gated on
   question **A** (calendar or matrix). Nothing in this session moved it forward.
3. **Capture provenance in the assignment schema** when the data model lands. Without it the
   fairness design is half-inert.
4. **Pre-flight capacity forecasting.** `fairness.md` argues it beats the objective for the year-end
   problem, and it needs no solver. The metrics engine already has the arithmetic.
5. **Track B** — repo creation and the first commit are still the owner's.

**Do not** build the analytics dashboard before the export. That ordering is argued in
`docs/product/analytics.md` and it is the single most likely way this project fails.

---

# ⚠️ THE HISTORY IS TRANSCRIBED, AND IT BROKE MOST OF THE SPEC

All 15 months are in `private/seed-data/` — 1,430 assignments, arithmetically validated. Two
scripts: `npm run seed:check` (in the gate) and `npm run seed:analyse` (constraint verification +
fairness-ledger prototype).

**Run `npm run seed:analyse` before touching any constraint.** It checks every catalogued rule
against the real data, and the result is stark:

| Verdict | Constraints |
|---|---|
| ✅ Holds | H-01 coverage, H-02 one-shift-per-day (all 1,430), H-03 membership |
| ❌ **Falsified** | **H-04 (4 counterexamples), H-05 (4), H-06 (4 — one per excluded doctor), H-07 (3)** |

**Every behavioural "never" in the catalogue is false.** Only the three structural constraints
survive. Had H-04 to H-07 shipped as `BLOCK`, the app would have refused **fifteen rosters the
principal actually built and distributed.**

**The rule to carry:** in this domain *"X never happens"* means *"X happens about three times a year
and I do not think of it as breaking a rule."* Treat every such statement as a strong preference
until a script says otherwise. Detail in
[`docs/domain/constraints.md`](../../docs/domain/constraints.md).

**Two process lessons worth more than the findings:**

1. **H-07 was rewritten twice and falsified twice.** I found one counterexample, inferred a tidier
   rule that explained it, shipped that, and did not check the tidier rule against the rest of the
   data. The script found three more in seconds. **Fitting a hypothesis to a counterexample almost
   always succeeds; that is not evidence.**
2. **A green test told us nothing about the domain.**
   `test_sunday_night_exclusions_are_derived_not_listed` passes, but it verifies the *model* behaves
   as designed — not that the design matches reality. The data falsifies the design. Beware tests
   that check a model against itself.

**Two undocumented patterns**, logged as questions and NOT modelled: D03 has worked 3 nights out of
201 (roster average 32%); D14 worked only nights, only Fri/Sat. Inferring a rule from an absence is
the documented over-fitting trap.

**The set is 15 months, not 17** — April 2025 appears twice on different templates, April 2026 twice
byte-identically, and **May and June 2025 are absent.**

**Data boundary:** the transcription lives in `private/seed-data/` and is never committed. 15 months
of day-by-day movements for 13 identifiable people is exactly what the boundary exists for, and
pseudonymous codes are not anonymisation when the mapping exists. Committed instead: the scripts, a
synthetic fixture, and a deliberately-broken fixture that proves the validator fails.

---

# B2 ARRIVED, AND IT CHANGED THE SPEC

The 17 roster exports (July 2025 – August 2026) and the September 2026 diary page are now in
`private/source-artifacts/`. Reading four of them **corrected four documented `[CONFIRMED]` facts**
within minutes. Full write-up:
[`docs/domain/source-artifact-findings.md`](../../docs/domain/source-artifact-findings.md).

The two that matter:

1. **H-05 had a counterexample.** "D02 is never assigned a Saturday shift", sourced to the
   principal's own interview *plus* zero counterexamples in sixteen months — contradicted by
   22 August 2026. **Had it shipped as `BLOCK`, the app would have refused a roster he actually
   built.** Now WARN, never BLOCK.
2. **The export is a CALENDAR, not a matrix.** All 17 exports are 7-column Sun–Sat month calendars
   with 3–4 `Name  time` lines per cell, a practice logo in a banner, and holidays outlined in red.
   The PRD specified doctors × days — sound for the *editor*, wrong for the artifact of record.
   **Needs his confirmation before C-01/C-02 are built.**

Also: the Thursday-morning anchor named in the brief is the wrong doctor (it alternates), holidays
*vary* rather than abandon the anchor pattern, and the diary's first list includes midweek dates so
"weekend availability" is an approximation, not a definition.

**A second, deeper pass then produced five more** —
[`docs/domain/worked-examples.md`](../../docs/domain/worked-examples.md):

3. **H-07 falsified too, and the fix makes it a better constraint.** D01 worked the long day on
   Friday 2 January 2026 — a Friday running Pattern C, so the four-shift split did not exist. On
   every Friday that *was* a Pattern B day he is absent. **The rule is about the pattern, not the
   weekday.** Solver corrected, flag renamed, regression test added. General lesson: a constraint
   whose subject is the shift structure must be written against `patternId`, never `weekday`.
4. ⚠️ **A new product requirement.** In December 2025 the principal worked 14 shifts including
   Christmas night and three of four year-end long days. **A cumulative min-max objective would
   read that as an injustice and spend January "correcting" a deliberate choice.** The ledger needs
   a "voluntarily absorbed" concept. **Do not ship a cumulative objective including his year-end
   burden until this is answered** (question H).
5. **Two adjacent sheets disagree** about the night of 1 January 2026. Seeding rule: the sheet whose
   own month owns the date wins. Also concrete evidence that published rosters change after
   publication.
6. **The historical data has errors** — 28 January 2026 leaves 15:00–17:00 uncovered. Seeding must
   validate arithmetically and flag, never trust the images.
7. **Anchor slots rotate** more than documented, so seed per-date facts and never expand a
   recurrence to reconstruct history.

**The conclusion to carry forward:** the practice's rules are **softer than any summary of them** —
every "never" checked so far has an exception. And **no amount of testing would have caught any of
this**; a perfect suite would have enforced all four errors faithfully. This is why
`docs/domain/worked-examples.md` must be written from the images before the solver is taken
seriously, and it is now unblocked.

# POSTURE FOR THE BUILD — two new ADRs

Decided with the owner, 26 August 2026:

**[ADR-0010](../../docs/architecture/decisions/0010-productisation-seams-first.md) — productise by
building the seams first.** This is a multi-tenant SaaS product, not a bespoke tool. Most of that was
already decided (ADR-0007's RLS, the four-entity membership graph, rules-as-data), so there was no
large rework. The rule for what to build now: **would adding this later require a migration, or just
a feature?** Migrations now — multi-tenancy, RLS, locale/holiday seams, per-tenant export branding,
audit trail. Features later — billing, self-serve onboarding, admin console, white-labelling.

**[ADR-0011](../../docs/architecture/decisions/0011-tiered-testing.md) — tier testing by blast radius.**
Four tiers, detailed in [`docs/ops/testing-strategy.md`](../../docs/ops/testing-strategy.md). Maximum
rigour on the unrecoverable (solver correctness, tenant isolation, audit trail, data boundary);
containerised visual regression on **the export only**; ordinary rigour on functionality;
deliberately light on cosmetics.

Two things in there will be re-proposed, so they are written down: **visual regression runs only in a
pinned container** (font rendering differs across machines; screenshot-on-host is the fastest route
to a permanently red suite), and **Tier 4's low coverage thresholds are a decision, not an
oversight.**

---
