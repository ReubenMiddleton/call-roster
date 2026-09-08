# Shift patterns

Three named patterns are in regular use. Each divides one date's 24 hours into shifts that sum to
exactly 24 hours, with exactly one doctor on duty throughout.

**The single most important schema consequence in the whole project:**

> **A day's shift structure is a property of the date, not of the weekday.** The weekday supplies
> a *default* pattern; any individual date can override it with a different named pattern, or with
> a fully custom set of shifts.

This must be in the data model from the first migration. Retrofitting it is expensive and you will
need it in the first December you operate. It is also the direct implementation of the principal's
stated requirement that anomalous days be configurable.

An **overnight shift belongs to the day it starts on** and runs into the next calendar day.

---

## Pattern A — "Standard" `[CONFIRMED]`

Used on Sunday, Monday, Tuesday, Wednesday, Thursday and Saturday.

| Shift | Time | Length |
|---|---|---|
| Morning | 07:00–15:00 | 8h |
| Afternoon | 15:00–23:00 | 8h |
| Night | 23:00–07:00 (+1) | 8h |

## Pattern B — "Friday" `[CONFIRMED]`

Fridays only. Four shifts, not three.

| Shift | Time | Length |
|---|---|---|
| Early | 07:00–12:00 | 5h |
| Midday | 12:00–17:00 | 5h |
| Evening | 17:00–23:00 | 6h |
| Night | 23:00–07:00 (+1) | 8h |

The split matters beyond scheduling: **H-06** applies specifically to the Evening and Night shifts
of this pattern, and those two shifts go to pool doctors only. A constraint written against
"Friday" rather than against "Pattern B shifts" will misbehave on a Friday public holiday, which
does not use Pattern B at all.

## Pattern C — "Reduced" `[INFERRED — high confidence]`

Used when there are not enough available doctors to fill a normal pattern, so someone works longer.

| Shift | Time | Length |
|---|---|---|
| Long day | 07:00–17:00 | 10h |
| Evening | 17:00–23:00 | 6h |
| Night | 23:00–07:00 (+1) | 8h |

The *cause* is `[CONFIRMED]` by the principal — *"there weren't enough available doctors to cover
all the shifts so someone had to work longer shifts."* That is what converts Pattern C from an
anomaly into **a recognised, recurring operating mode**, and it is why it is a named pattern rather
than an ad hoc override.

### Every instance in the data — all fourteen

> **⚠️ Corrected 2 September 2026.** This section listed four instances and called the first
> *"Good Friday 2025 (4 Apr)"*. **4 April 2025 was an ordinary Friday**; Good Friday 2025 was the
> 18th and ran Pattern A. The mislabelling came from the project brief, was caught by the seed
> transcription in August 2026, and did not propagate here. Counted by `npm run seed:patterns`.

| Date | Weekday | Date | Weekday |
|---|---|---|---|
| 1 Dec 2023 | Fri | 3 Jul 2024 | Wed |
| 4 Dec 2023 | Mon | 4 Apr 2025 | Fri |
| 21 Dec 2023 | Thu | 2 May 2025 | Fri |
| 28 Dec 2023 | Thu | 12 Jun 2025 | Thu |
| 4 Jan 2024 | Thu | 30 Dec 2025 | Tue |
| 21 Feb 2024 | Wed | 31 Dec 2025 | Wed |
| 20 Mar 2024 | Wed | 2 Jan 2026 | Fri |

Three things the full list shows that four instances could not:

- **Pattern C is the practice's only override.** Of 1,005 transcribed days, 14 depart from the
  weekday default and **every one of them is a switch to Pattern C**. Not one is A→B or B→A.
- **Eight of the fourteen fall in December or January**, which is the year-end capacity collapse in
  [`workforce.md`](workforce.md) showing up in the shift structure rather than in the assignments.
- **Not one falls on a public holiday.** In 33 months Pattern C has never been used on a holiday —
  see the open question in [`holidays.md`](holidays.md), whose premise this reverses.

Open: **how the long-day assignment is decided** — volunteered or assigned? Logged in
[`../NEEDS_YOUR_INPUT.md`](../NEEDS_YOUR_INPUT.md), because it determines whether the solver should
treat the long day as a high-burden slot to distribute fairly or as something only certain people
accept.

Also open: whether other custom patterns exist that are not present in the sixteen months of
rosters available. Logged.

---

## The weekday default pattern

Which pattern applies by default, and who normally holds each slot. **This table is a *default*,
not a constraint** — the constraints are in [`constraints.md`](constraints.md).

> **⚠️ Corrected 2 September 2026.** This paragraph said holidays *"abandon this table entirely."*
> They do not, and [`holidays.md`](holidays.md) corrected the same wording on 26 August 2026 without
> this file following. A holiday **varies** the anchor columns — on Women's Day 2026 two of Monday's
> three anchors were retained — and it removes only the **Pattern** column, and only where the
> pattern is Pattern B. Everything else stands. Resolved in code by
> [`lib/calendar/pattern-precedence.ts`](../../lib/calendar/pattern-precedence.ts); measured by
> `npm run seed:patterns`, which finds the table correct on **97.8% of 1,005 transcribed days**.

| Day | Pattern | Morning 07–15 | Afternoon 15–23 | Night 23–07 |
|---|---|---|---|---|
| **Monday** | A | D03 | D04 → **D05** (from Jun 2026) | D02 |
| **Tuesday** | A | D01 | D03 → **D05** (from Jun 2026) | D04 |
| **Wednesday** | A | D02 | D01 | *pool* |
| **Thursday** | A | D04 | D02 | D01 |
| **Friday** | **B** | Early + Midday rotate among D03 / D04 / D02 | Evening + Night are *pool only* (**H-06**) | |
| **Saturday** | A | D01 by default; else D03, D04/D05, D06, D13 | anyone except D02 (**H-05**) | anyone except D02 (**H-05**) |
| **Sunday** | A | anyone | anyone | anyone, subject to **H-04** |

All `[CONFIRMED]`. **Thursday is the most stable day in the entire dataset** — the same three
doctors, every week, for sixteen months.

### The June 2026 handover

D05 joined around 22 June 2026 and took over the Monday and Tuesday 15:00–23:00 anchor slots that
D04 and D03 had held continuously since at least April 2025. **Neither D03 nor D04 left** — D04
retained Thursday mornings, Tuesday nights, Fridays and weekend work.

This is the canonical example of why recurring slots need **validity intervals** rather than a
`current_holder` column, and why "anchor" is not a role. Two slots changed hands; nothing about
either doctor's status changed. See [`../architecture/data-model.md`](../architecture/data-model.md).

Open: **how the principal decided which slots D05 would take over.** Understanding this predicts
what happens at the next joiner, and joiners are `[CONFIRMED]` to be ongoing and normal. Logged.

---

## Modelling the override

Recurring structures use the **iCal model**, never materialised rows.

> **Do not store individual recurring instances as rows.**

Store a master row with an RRULE (RFC 5545), `dtstart`, a `duration` kept separate from the
recurrence range, and a non-null `recurrence_range` covering the whole series so range queries stay
indexable. Exceptions go in an EXDATE-equivalent table; a single-date override is a standalone row
plus an exception on the master.

**"This and all future" means splitting the series** — truncate the original master, create a new
one from the edit point. That is how Google Calendar works and it is the only approach that stays
correct. The June 2026 handover is exactly this operation.

**Materialise for the solver and the renderer, never for storage.** Expand at solve time and render
time, and cache aggressively.

---

## Precedence

When several things could determine a date's pattern, resolve in this order:

1. An explicit **per-date custom shift set** (admin-defined, fully arbitrary).
2. An explicit **per-date named pattern** override.
3. **Public-holiday** behaviour — see [`holidays.md`](holidays.md). Note that a public holiday
   *removes* Pattern B from a Friday but does not by itself determine what replaces it.
4. The **weekday default** from the table above.

The admin can override at any level. That is a `[CONFIRMED]` requirement: *"so that if things
change drastically in any way he can compensate."*

**Implemented** in [`lib/calendar/pattern-precedence.ts`](../../lib/calendar/pattern-precedence.ts),
with the levels in this order and the weekday defaults as per-tenant data rather than code. Level 3
returns *"undetermined, ask"* rather than substituting — see [`holidays.md`](holidays.md).

### How much work the default actually saves — measured

`npm run seed:patterns` runs the resolver over all 33 transcribed months. Over **1,005 days**:

| | Days | Share |
|---|---|---|
| The weekday default was correct | 983 | **97.8%** |
| A human had to decide (a holiday dropping Pattern B) | 8 | 0.8% |
| The practice chose something else | 14 | 1.4% |

Two things follow, and both are product decisions rather than trivia:

1. **"Set up next month" is nearly free.** It arrives 97.8% correct and asks about roughly one date
   every four months. It does not need to be a wizard.
2. **Every single one of the 14 deviations is a switch to Pattern C.** Not one is A→B or B→A. So the
   override affordance the editor needs is *"this day is short-staffed, run the reduced day"* — one
   control, not a general pattern picker. `[INFERRED]` from 33 months, and cheap to widen later.
