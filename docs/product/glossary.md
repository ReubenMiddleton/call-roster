# Glossary — the ubiquitous language

**Read this before naming anything.** If you need a domain term that is not here, stop and ask.
Do not invent one, and do not pick a plausible synonym.

The reason is concrete rather than stylistic. Agents search a repository for the exact names they
are given, so imprecise naming spends effort on the wrong code. Medical rostering is a
terminology minefield where the same word means different things in different hospitals, and
without a pinned vocabulary you end up with `Shift`, `Duty` and `Session` as three types
modelling one concept, discovered in week six.

Confidence tags follow the project convention: `[CONFIRMED]` · `[INFERRED]` · `[ASSUMED]` ·
`[UNKNOWN]`. See [`../README.md`](../README.md).

---

## Words we use, and words we do not

| Use | Never use | Why |
|---|---|---|
| **roster** | rota, schedule | "Rota" is UK, "schedule" is US. South African practice says roster. Pick one and never mix — it appears in types, routes, UI copy and the domain language |
| **doctor** | provider, resource, employee, staff member | "Provider" is US payer vocabulary. **"Employee" is actively wrong and legally dangerous** — see *employment status* below |
| **shift** | duty, session, block | One continuous period of cover with a start and an end. `Session` and `block` are reserved and currently unused |
| **assignment** | booking, allocation, entry | The link between one doctor and one shift slot |
| **practice** | clinic, organisation, tenant (in UI) | The practice is the customer and the owner of the roster. `tenant_id` remains the database column name |
| **site** | hospital, facility, location | The hospital whose emergency centre the practice staffs. Distinct from the practice — one doctor may hold privileges at several |

---

## Core terms

### Shift
One continuous period during which exactly one doctor is on duty. Has a start time, an end time
and a named pattern. An overnight shift **belongs to the day it starts on** and runs into the
next calendar day. `[CONFIRMED]`

### Shift slot
A shift on a specific date, awaiting or holding an assignment. The unit the solver assigns. There
is exactly one doctor per slot and no double cover anywhere in sixteen months of data.
`[CONFIRMED]`

### Shift pattern
The named set of shifts that divides a single date's 24 hours. Three are in use — see
[`../domain/shift-patterns.md`](../domain/shift-patterns.md). **A pattern is a property of the
date, not of the weekday.** The weekday supplies a default; any date can override it.
`[CONFIRMED]`

### Assignment
One doctor assigned to one shift slot. Carries whether it was placed by the solver, by the admin,
or by an override, and whether it is locked.

### Roster
The complete set of assignments for one practice over one calendar month, plus its lifecycle
state. The month is the unit because the practice builds monthly, around the 20th. `[CONFIRMED]`

### Roster version
An immutable snapshot of a roster as published. Editing a published roster creates version N+1;
it never mutates version N. *"What was published"* and *"what is current"* are different
questions, and conflating them is the classic rostering bug.

---

## On call — the term that needs the most care

**"On call" is ambiguous and the ambiguity is legally load-bearing.** It can mean physically
present, contactable by phone, compensated, or counted against working-hours limits. Under the
European *SiMAP* and *Jaeger* judgments, time spent **resident on call — including asleep on
site — counts fully as working time**, whereas at-home on call generally counts only the worked
portion. A rule pack cannot be implemented correctly if "on call" is a single boolean.

So the codebase does not use the bare term. It uses:

| Term | Meaning |
|---|---|
| **on duty** | Physically present and responsible for the emergency centre. What every shift in this practice currently is. `[CONFIRMED]` |
| **resident on call** | Required to be on site, may be resting. Counts fully as working time under EWTD. Not currently used by this practice `[CONFIRMED]`, modelled because rule packs need it |
| **at-home on call** | Contactable and required to attend if called. Generally only the worked portion counts |

`[CONFIRMED]` that this practice runs **on duty** only: 24/7 single cover, one doctor physically
present at all times, for roughly a decade.

---

## Weekend — Friday 17:00 to Monday 07:00 `[CONFIRMED]`

**Answered by the project owner, 31 August 2026:**

> *"Yes a weekend will include Friday as far as I know, this is also why the Friday shifts are a bit
> different from the rest of the weekdays."*

That settles the part that was genuinely 50/50. The calendar reading — Saturday 00:00 to Sunday
24:00 — is **out**. It also explains Pattern B rather than leaving it as an oddity: Friday has four
shifts instead of three because Friday is not an ordinary weekday.

**The boundary was settled the same evening by the practice principal: *"weekend starts at Friday
17:00."*** So the weekend is **Friday 17:00 → Monday 07:00**, implemented as `isWeekendShift` in
[`../../lib/analytics/shifts.ts`](../../lib/analytics/shifts.ts).

That is not an arbitrary hour. It is the moment the workforce changes shape: **pool GPs cannot work
weekday shifts starting before 17:00**, because they are at their own practices — verified at 97.4%
across 1,430 assignments. See [`../domain/workforce.md`](../domain/workforce.md). The same fact
explains H-06, Pattern C and why the request diary lists Friday-to-Sunday triples.

**Why the difference matters, and it is worth more than it looks.** Under A, a Friday 07:00–12:00
shift is weekday work. Under B it is weekend work. Fifteen months contain roughly sixty Fridays with
two morning-side shifts each, so the choice moves about 120 shifts between two burden bands — enough
to reorder the fairness table.

### The consequence nobody had noticed: Friday is currently under-priced

The burden schedule classifies dates as `weekday` / `saturday` / `sunday` / `public-holiday`, and
Friday falls in `weekday`. So a Friday night is priced at **2.5** and a Friday evening at **1.0** —
the same as a Tuesday. If Friday is weekend work, both are too low, and every load ratio computed so
far is slightly wrong in a direction that under-credits whoever works Fridays.

Deliberately **not** corrected by guessing a number. Logged as question **V**, alongside question
**S** on the Sunday-night weight, because both are the same conversation: the whole weight table
needs agreeing with the practice once, visibly.

### What the code does in the meantime

**`Weekend` is still not a type,** and the rule in
[`../../.claude/rules/typescript.md`](../../.claude/rules/typescript.md) still stands. Concrete
counts only — `saturdays`, `sundays`, `fridays` — and any aggregate called "weekend" is composed at
the reporting edge from a named, explicit definition. `fridays` was added on 31 August 2026 precisely
because this answer made Friday burden-relevant.

The answer therefore changes one function and one weight table, not the schema.

---

## Preference vocabulary

"Preference" conflates three genuinely different things, and the rostering literature is emphatic
that products must not lump them together. The taxonomy for v1 — see
[`../domain/constraints.md`](../domain/constraints.md) for solver treatment:

| Term | Semantics | Solver treatment |
|---|---|---|
| **UNAVAILABLE** | Cannot work. Leave, away, hard commitment. | Hard constraint, but **budgeted** — N per person per period |
| **PREFER_NOT** | Would rather not. | Soft penalty |
| **PREFER** | Wants this shift or date. | Soft reward |
| **MUST** | Committed to working this. | Hard constraint |
| **TENTATIVE** | A modifier on any of the above: the request is conditional. | Reduced weight, flagged in the UI |

`TENTATIVE` exists because the diary uses a `±` symbol whose meaning is `[UNKNOWN]`. The
modifier is modelled now because *something* conditional is clearly being expressed; what
exactly it means is a question, not an assumption.

**Preferences are a structured enum. There is no free-text preference field, ever.** A free-text
box reliably collects religious observance — "off for Eid", "no Friday sunset shifts", "Sabbath" —
which is special personal information under POPIA s26. This is a hard product boundary enforced
in validation, not a guideline. See [`../ops/compliance.md`](../ops/compliance.md).

### Budget
The cap on how many `UNAVAILABLE` days one doctor may declare per period. Exists because
unavailability with no cost attached inflates until the model is infeasible — a documented
failure mode. Leave is handled as an **absence**, not a preference, and does not consume budget.

---

## Fairness vocabulary

See [`../domain/fairness.md`](../domain/fairness.md) for the mechanism.

| Term | Meaning |
|---|---|
| **burden weight** | The agreed cost of one shift type. Weekday day 1.0, weekday night 2.5, Saturday 3.0, Sunday 3.5, Christmas night 8.0. Agreed by the group, visibly, once. `[ASSUMED]` — the numbers are illustrative until confirmed |
| **burden credit** | Burden a doctor actually carried in a published month |
| **ledger** | The running per-doctor balance of burden carried, persisted **across** months. The reason the project exists: a paper diary structurally cannot do this |
| **equal / equitable / harmonious** | Equal = everyone identical. Equitable = tailored to FTE, seniority, preferences. Harmonious = equal within groups, equitable between. Use these words precisely in UI copy |

### Normalisation vocabulary — added 31 August 2026

See [`../domain/fairness.md`](../domain/fairness.md#normalisation--the-denominator-problem-and-why-it-is-the-whole-design)
for the mechanism and [ADR-0012](../architecture/decisions/0012-fairness-normalised-by-opportunity.md)
for why.

| Term | Meaning |
|---|---|
| **opportunity set** | The shift slots a doctor could have worked in a period — available, a member, and eligible. Its *burden*, not its count, is what fairness is normalised by |
| **entitlement weight** | One doctor's claim on the total burden. Answers *what should their share have been?* Four bases exist: `equal`, `active-days`, `revealed-opportunity`, `explicit` |
| **fair share** | `totalBurden × entitlement weight ÷ Σ entitlement weights`. The burden a doctor would have carried had the period been perfectly fair |
| **load ratio** | `burden carried ÷ fair share`. 1.00 is exactly fair; above 1 is overloaded. **The only figure the product presents as a fairness verdict** — everything else is an indicator |
| **revealed availability** | Availability inferred from the `day class × shift kind` combinations a doctor was *observed* working, because none was ever recorded. `[INFERRED]`, and it can only understate |
| **low sample** | A doctor observed too little for their load ratio to mean anything — under 20 shifts or under a 60-day span. Their ratio is shown as provisional and excluded from practice-wide figures |
| **indicator vs verdict** | An *indicator* describes (night counts, Gini, Jain). A *verdict* judges (load ratio). Presenting an indicator as a verdict is the main hazard in this area |

### Provenance vocabulary — `[CONFIRMED]` 31 August 2026

Coined to express a distinction the owner described on 31 August 2026 that had no term, and
**confirmed by him the same day** (question R). Still worth raising with the practice principal in
case he has his own words, but these are the terms in use.

**Provenance** is why a doctor ended up working a shift. It is a property of the assignment, not of
the doctor or the shift.

| Term | Meaning | Ledger treatment |
|---|---|---|
| **directed** | The scheduler assigned it. The ordinary case | Counts toward equalisation |
| **requested** | The doctor asked for it — extra income, a favour, a swap they initiated | Reported, **excluded from equalisation**: a doctor who volunteers must not have next month withheld as a consequence |
| **absorbed** | Nobody else was available, so someone had to | Counts in full **and** flags a capacity event |
| **unknown** | Never captured. **Every one of the 1,430 historical assignments.** | Counted as directed; always reported separately so unrecorded is never mistaken for known |

**Do not say "voluntary".** It reads as *unpaid*, which is legally and factually wrong — these
doctors are independent contractors and every shift is paid. `requested` describes who initiated it,
which is the distinction that matters.

**Do not say "overtime".** There is no contracted baseline to be over.
---

## People and structure

### Anchor / Pool
Descriptions, **not roles, and not an enum.** An *anchor* is a doctor who happens to hold one or
more recurring slot assignments; a *pool* doctor holds none and works by request. `[INFERRED]`

Modelling this as a role would be a mistake. When D05 joined in June 2026 and took over two of
D04's and D03's recurring afternoon slots, nothing about either doctor's *role* changed — a
validity interval ended and another began. Emergent property, not a field.

### Recurring slot assignment
A (weekday, shift, validity interval) triple held by a doctor. What makes someone an anchor.

### Membership
A doctor's association with a practice over a validity interval. `Person ↔ Membership ↔
Practice ↔ Site` is a four-entity graph, not a `user.practice_id` column — one doctor may hold
privileges at several hospitals and belong to several practices. `[CONFIRMED]`

### Employment status — handle with care
**South African private hospitals cannot employ doctors.** Under the Health Professions Act and
HPCSA Ethical Rule 8, only the Public Service, universities, mining companies, NPOs and other
registered practitioners may employ practitioners. These thirteen doctors are **independent
contractors billing fee-for-service**, not employees. `[CONFIRMED]`

Consequences for vocabulary: no `employee`, no `payroll`, no `timesheet`, no `clock-in`. The
useful output is a **shift-count report for internal fee-split**, not a timesheet.

### Staff category
A first-class entity, because the practice **may** also roster genuinely employed staff —
practice manager, admin, nurses — to whom BCEA rules would apply. Whether it does is
`[UNKNOWN]` and is a question for the practice principal. Until answered, one category exists:
independent practitioner.

---

## Constraints and rules

| Term | Meaning |
|---|---|
| **hard constraint** | `H-nn`. Violation means the roster is not publishable |
| **soft constraint** | `S-nn`. Penalised in the objective, never blocking |
| **rule mode** | Every rule is **OFF / WARN / BLOCK**, configurable per practice and per staff category. **Default WARN.** A one-click override logs actor, timestamp and reason |
| **rule pack** | A named set of rules as *data*, not code: "practice custom", "BCEA below-threshold", "HPCSA Intern", "EWTD", "ACGME" |
| **point-in-time evaluator** | Checks a single moment or shift pair — "no night followed by a morning" |
| **windowed-aggregate evaluator** | Checks a rolling window with averaging — "80 hours per week averaged over 4 weeks". Both evaluator types are needed; neither can express the other |
| **slack variable** | The named relaxation on an elasticised constraint. Almost nothing is truly hard, so the model always returns a solution and reports violations rather than "infeasible" |
| **penalty registry** | `(constraint_name, entity_refs, slack_var, weight)` recorded as the model is built. Every explanation, cost breakdown and counterfactual derives from it |
| **override** | An admin decision to accept a warned violation. The warning **persists on the grid as a scar**; it does not disappear |
| **churn** | How much a re-solve rearranges the previously published roster. Penalised — a globally better but completely different roster is a product failure |
| **variant month** | A month whose shape departs materially from how the practice usually rosters. **The principal's own word**, given 2026-09-04 in answer to question 41 — *"he would like to call those months Variant."* Use it in the UI. It is measured by `lib/analytics/departure.ts` against a reference band of 33 real months, and it is an **indicator, never a verdict**: a variant month is not thereby a bad month, and a month that matches habit perfectly also reproduces the imbalance the project exists to fix. **Never call this churn** — that is a different measure of a different thing |

---

## Lifecycle

`DRAFT → PUBLISHED → LOCKED → ARCHIVED`. See
[`../domain/commands-events.md`](../domain/commands-events.md).

| State | Meaning |
|---|---|
| **DRAFT** | Invisible to doctors. The generator runs freely |
| **PUBLISHED** | **Publish is an event, not a save.** It notifies, activates calendar feeds, mints the read-only link and snapshots a printable PDF |
| **LOCKED** | Direct editing disabled. Changes flow through swap transactions with an audit trail |
| **ARCHIVED** | Historical. Feeds the ledger, no longer editable |

### Review window
The bounded period after publish in which doctors submit change requests. The roster accommodates
what it can, then locks. `[CONFIRMED]` as a requirement — and better than what the incumbents
ship, which is effectively two states rather than four.

### Swap
A transaction moving an assignment between doctors after lock. Not a silent edit: **an
unannounced change to a live call roster is a patient-safety event.**

---

## Diagnostics vocabulary

Introduced 2026-09-01 with [ADR-0013](../architecture/decisions/0013-first-party-diagnostics.md). See
[`../ops/diagnostics.md`](../ops/diagnostics.md).

| Term | Means | Not |
|---|---|---|
| **command** | An *intent* — something the admin asked for, which may be refused | An event. A command can fail; an event has already happened |
| **event** | A *fact* — something that did happen | A command. There is no state transition between them |
| **command journal** | The append-only, ordered record of every command against a roster version. **Replayable** — the mechanism that reconstructs a fault | A log. It is also the audit trail, and it is not disposable |
| **diagnostic bundle** | The single downloadable file produced by the **"Something looks wrong"** control, which the admin sends by WhatsApp | A crash report. It is user-initiated, works offline, and he sees what it contains before it leaves |
| **appRunId** | One browser lifetime, used to correlate commands and errors | ⚠️ **Never called a "session"** — see below |
| **diagnostic exhaust** | Error records, buffered client diagnostics and solve-run detail. Expires | The command journal, which does not |

### ⚠️ Why `appRunId` and not `sessionId`

**`session` is reserved in this glossary as a rejected synonym for `shift`**, and it is listed there
precisely because `Shift`, `Duty` and `Session` becoming three types modelling one concept is the
failure this document exists to prevent.

Naming a browser lifetime a "session" would hand that reserved word a second, unrelated meaning inside
the same codebase — so the next person reading `sessionId` has to work out which of two domains it
belongs to. `appRunId` costs one unfamiliar identifier and buys back the reservation.

---

## Export vocabulary

| Term | Meaning |
|---|---|
| **the grid** | The month matrix: doctors as rows, days as columns, a doctor code in each cell |
| **artifact of record** | The printable monthly grid. The thing the practice actually distributes and trusts. **The export is the product** |
| **doctor code** | The 2–3 character identifier shown in a grid cell. Colour encodes shift type; **text** encodes the doctor, because 13 categories is far beyond what any categorical palette supports |
