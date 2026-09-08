# Workforce structure and seasonal capacity

Why the roster looks the way it does. **This document explains more of the observed data than any
other single fact in the project**, and it arrived from the owner on 26 August 2026 rather than from
the roster images — the images show the *effect*, not the cause.

---

## Most doctors here have a primary practice somewhere else `[CONFIRMED]`

The practice principal (**D01**) founded the practice and recruited most of the doctors on it. **Most
of them are members of other practices**, and cover shifts at this emergency centre for additional
income — **mainly over weekends.**

That single fact explains a remarkable amount:

| Observation | Explanation |
|---|---|
| The **anchor / pool** split exists at all | Anchors are the doctors for whom this *is* the primary practice. Pool doctors have a primary practice elsewhere |
| Pool doctors work **weekends, Friday's back half, Wednesday nights and holiday cover** | Those are the times they are free of their primary commitment. Their weekdays belong to someone else |
| The request diary's **first list is mostly weekends** | It is not a preference for weekends. It is a statement of **when they are structurally available** |
| **H-06** — Friday's evening and night go to pool doctors only | Friday evening is where the week stops belonging to the primary practice |
| The **year-end collapse** in available staff | See below |

**This reframes the preference model.** The `[INFERRED]` reading of the diary's first list as "weekend
availability" was right about the *shape* and wrong about the *nature*: it is closer to a hard
structural constraint than a soft wish. A pool doctor offering 4–6, 11–13 and 18–20 is not saying
*"I would like those weekends"* — they are saying *"those are the weekends my other practice leaves
me free."*

See [`preferences.md`](preferences.md), which is updated accordingly.

### Consequences for the data model

The four-entity graph `Person ↔ Membership ↔ Practice ↔ Site` was justified in
[`../architecture/data-model.md`](../architecture/data-model.md) as *"one doctor may hold privileges
at several hospitals and belong to several practices"* — recorded at the time as a real property of
South African private practice rather than future-proofing.

**It is now confirmed as the actual structure of this practice's workforce, not a hypothetical.**
That raises its priority: a doctor's availability here is partly determined by commitments the system
cannot see, and the model must at minimum be able to record *that a doctor has an external primary
commitment* even if it never knows the detail.

Open question: does the system need to know *which* practice, or merely *that there is one*? Knowing
which opens the door to the multi-practice aggregation in the go-to-market sequence — but it is also
data the practice may not be entitled to hold. Logged.

---

## The seasonal capacity problem `[CONFIRMED]`

**What happens:** around the main holiday months most doctors either go away or cash in leave. Since
most of them have a primary practice elsewhere, their commitment here is the one that gives. D01 is
left with too few doctors to cover a 24/7 single-cover emergency centre — **and because it is his
practice and at least one doctor must be present at all times, he works those shifts himself.**

**When:** every year at year end, with varying severity. **Also in the main South African school
holidays, particularly the long June/July break.**

**What it looks like in the data** — December 2025, the month worked by hand in
[`worked-examples.md`](worked-examples.md):

- D01 worked **14 shifts**, including **Christmas night** and **three of the four year-end long days**
  (30 December, 31 December, 2 January).
- Three days ran **Pattern C**, the reduced three-shift structure used when there are not enough
  doctors to fill a normal day.
- Across 30 December – 2 January the entire roster draws on **five doctors**.

### ⚠️ This is a capacity problem that presents as a fairness problem

**The owner's position, and it corrects an earlier recommendation of mine:**

> *"This should affect the fairness objective because it shouldn't work that way, and if we build in
> a solution it might reduce the effect it has. Treat this as if it shouldn't happen ideally."*

I had recommended the opposite — excluding D01's year-end burden from the equalisation objective, on
the reasoning that it was a deliberate act of leadership that an optimiser should not "correct".
**That was wrong, and the correction matters.** It is not generosity to be preserved; it is a
**recurring operational failure that the practice absorbs through its principal**, and a system that
hides it removes the evidence needed to fix it.

So: **the burden is credited to the ledger and included in the objective.** It should show up, look
bad, and stay visible year over year.

**But the objective alone cannot fix it, and it is important not to pretend otherwise.** A solver
cannot create doctors. If twelve of thirteen are unavailable, no amount of fairness weighting changes
who covers Christmas. What the system can actually do:

1. **Forecast the shortfall early.** The pre-flight arithmetic already exists — see
   `solver/src/call_roster_solver/preflight.py`. Run it against declared availability **in October,
   not on the 20th of December**, and say *"you are 14 doctor-shifts short between 23 December and
   3 January."* That is the single most useful thing the product can do about this, and it needs no
   solver at all.
2. **Budget simultaneous unavailability.** The unavailability budget was planned to stop preference
   inflation. It has a second, larger purpose here: **capping how many doctors can be away at once**
   over a defined period. That is a policy lever the practice does not currently have.
3. **Make the pattern undeniable.** *"Over the last three Decembers you absorbed 12, 14 and 11 shifts
   while the group average was 4"* is a sentence that can start a conversation with thirteen people.
   A paper diary cannot produce it. **This is the fairness ledger's single most valuable output.**
4. **Surface it during the review window**, not after publishing, so there is time to negotiate.

**The design rule that follows:** treat the year-end and June/July periods as a **named, recurring,
expected capacity event** — not as an anomaly to be handled ad hoc each year. Pattern C exists
because of it. The pre-flight forecast should be schedulable, and the historical comparison should be
a first-class report rather than something derived on request.

### Still open

The practice principal has not yet been asked about this directly — the account above is the owner's.
Worth confirming: whether he sees it as a problem to fix or simply the cost of ownership, whether
leave over these periods is negotiated or first-come, and whether there is any existing rule about
how many people may be away at once. Logged in
[`../NEEDS_YOUR_INPUT.md`](../NEEDS_YOUR_INPUT.md).

---

## The two tiers, restated

Not roles, and not an enum — see [`../product/glossary.md`](../product/glossary.md). But the *reason*
for the split is now clear, which makes the emergent modelling more obviously correct:

**Anchors** hold recurring weekday slots because this is their primary practice. **Pool doctors** hold
none because their weekdays belong elsewhere. Neither is a status; both are consequences of where a
doctor's primary commitment sits.

**Which is why a doctor can move between them without anything special happening.** When D05 joined in
June 2026 and took over two recurring afternoon slots, that is what "this became a primary commitment"
looks like in data — a validity interval opening, nothing more. See
[ADR-0008](../architecture/decisions/0008-temporal-validity-intervals.md).

**And it is why the tiers must never be hard-coded.** A pool doctor whose external practice winds down
becomes an anchor. An anchor who takes on outside work becomes pool. The data model already handles
both; a tier enum would not.

---

## Nobody works here full time — the principal included `[CONFIRMED 2026-08-31]`

Confirmed by the project owner, and it is stronger than what was previously recorded:

> *"There are no doctors on this roster, including the principal, that work full time at this
> practice. All the doctors put in a few shifts every week or every month at a different practice as
> well."*

The earlier note said most pool doctors had a primary practice elsewhere. In fact **every doctor
does**, and so does the man who owns the place.

### Why this is more than a detail

**There is no full-time baseline anywhere in this practice**, which means:

- **FTE is not derivable.** An FTE is a fraction of a full-time commitment, and no such commitment
  exists here. That is not a data-collection gap to be filled later — the quantity is undefined.
  It is the strongest argument yet for the opportunity-based denominator in
  [ADR-0012](../architecture/decisions/0012-fairness-normalised-by-opportunity.md): not the best of
  four options, but the only one with a defensible definition.
- **"Overtime" has no meaning here**, which is one of the two words deliberately rejected when
  naming assignment provenance. See [`../product/glossary.md`](../product/glossary.md).
- **The anchor/pool split is about standing slots, not about hours.** An anchor is a doctor who holds
  a recurring weekday slot; it does not make them full time or even close to it. Any UI copy implying
  otherwise is wrong.
- **Every doctor has an external constraint on their availability**, not just the pool. The
  seasonal capacity collapse described above is therefore structural rather than a pool-doctor
  problem, and the principal has no more slack than anyone else when it happens.
- **Question 23 becomes more pointed, not less.** If nobody is full time and everyone is an
  independent contractor, the BCEA position is cleaner — but only if there are genuinely no employed
  staff on the roster. Still unanswered.

---

## ⚠️ Pool GPs cannot work weekday daytime shifts — the fact that explains most of the roster

`[CONFIRMED 2026-08-31]` by the practice principal, and **verified against 1,430 assignments.**

Asked what makes a day use the reduced 07:00–17:00 pattern, he answered:

> *"It is usually when there is a shortage of doctors (which happens to happen more often on
> holidays and public holidays) but it will usually always happen on a weekday because **GPs can't
> work before 17:00 since they are working at other practices**."*

This is the most explanatory single fact found in the project so far. It was never stated as a rule
because it is not one — it is a fact about where these doctors are during the day.

### Verified, and the mechanism verified with it

`scripts/check-gp-availability.mjs` was written to test the claim rather than accept it. Across the
33 transcribed months, of **1,086 pool-doctor shifts, only 14 start before 17:00 on a weekday —
1.3%.** Eight of the eleven pool doctors have **zero**. The figure improved as the dataset doubled,
which is the opposite of what a coincidence does.

**The stronger evidence is what happens on public holidays.** On a public holiday the pool doctors
*do* work daytime shifts — D08 five times, D11 four, D09 three. Their own practices are closed, so
they are free. The constraint holds on weekdays and dissolves on holidays, which is precisely what
the stated cause predicts. That is confirmation of the *mechanism*, not merely of the pattern, and it
is much harder to get by coincidence.

### What it explains

| Previously an oddity | Now explained |
|---|---|
| **H-06** — Friday's 17:00–23:00 and 23:00–07:00 go to pool doctors | 17:00 is the first hour pool doctors are free. The "exclusion" of D01–D04 is a side effect of who is *available*, not a rule about who is *banned* |
| **Pattern C** (07:00–17:00 long day) | When short-staffed you cannot fill 07:00–15:00 *and* 15:00–23:00 from the pool. One anchor covers 07:00–17:00 and a GP takes 17:00–23:00. The pattern is a workaround for this exact constraint |
| The request diary's **Friday–Sunday triples** | Friday 17:00 to Monday 07:00 is the window in which pool doctors exist. Their availability list is Friday-to-Sunday because that is all there is to offer |
| Why the **weekend starts Friday 17:00** | Not an arbitrary boundary. It is the moment the workforce changes shape |
| The **seasonal capacity collapse** | Anchors carry every weekday daytime slot all year. When they take leave there is nobody structurally able to replace them before 17:00 |

### The two systematic exceptions are a recurring slot, not violations

All 13 breaches belong to just two doctors, and they are not scattered:

| Doctor | Shifts | Dates |
|---|---|---|
| **D07** | 6 | Mondays 2 and 16 Feb, 2 and 16 Mar 2026 — all `std-afternoon` (15:00–23:00) |
| **D09** | 7 | Mondays 19 and 26 Jan, 9 and 23 Feb 2026 — all `std-afternoon` |

**Every one is a Monday afternoon, fortnightly, alternating between the two of them.** That is the
signature of an arrangement, not an exception. Logged as question **X** — it looks like an
undocumented recurring slot of the same kind as the Wednesday-night group.

### How this is modelled: availability data, not a constraint

**No constraint ID is assigned to it**, deliberately. It is not a rule the practice applies — it is a
fact about where thirteen people are on a Tuesday afternoon. Modelling it as a constraint would put
it in the penalty registry, where it would show up as a "violation" every time it was respected.

The right home is **per-doctor default availability**: a pool doctor's default excludes weekday slots
starting before 17:00, and D07 and D09 carry an exception for Monday afternoons. That makes it data
the principal can edit when someone's other job changes — which will happen — rather than a rule that
needs a code change.

**Until availability capture exists**, the `revealed-opportunity` fairness denominator already
reproduces this correctly and by accident: a pool doctor has never been observed working a weekday
morning, so no weekday-morning opportunity is attributed to them, and they are not penalised for
"failing" to work slots they could never have taken. That is the proxy working as designed.

---

## Pre-flight capacity: the constraint headcount hides

`[MEASURED 1 September 2026]` — `lib/analytics/capacity.ts`, reported by `npm run seed:workforce`.

The seasonal finding said the calendar is the wrong trigger for a capacity forecast. This is the right
one, and it comes straight out of the confirmed GP-availability fact.

### The two pools are not interchangeable

A month's slots divide in two, and **the halves cannot substitute for each other**:

| | Who can work it | Share of a typical month |
|---|---|---|
| **Restricted** — weekday, before 17:00, not a public holiday | **Anchors only** | ~42 of ~95 slots |
| **Open** — everything else | Anyone | ~53 of ~95 slots |

Across 33 months, pool doctors covered **14 of 1,356 restricted slots — 1.0%.**

### The measured consequence

Restricted slots consume **74% of an anchor's entire monthly capacity**, before a single night,
weekend or holiday shift is counted. Using the principal's own figure of 14–15 shifts a month:

| Month | Restricted | Anchors | Pressure | Absences tolerated |
|---|---|---|---|---|
| **January 2024** | 43 | 3 | **0.96** | **0** |
| May 2024 | 42 | 3 | 0.93 | 0 |
| May 2025 | 41 | 3 | 0.91 | 0 |
| August 2026 | 40 | 5 | 0.53 | 2 |

**Six of 33 months could not have tolerated a single anchor absence.** Two ran with no slack at all:
January and February 2024, both at 0.94 with three anchors.

⚠️ **Corrected 1 September 2026.** Those figures were first published as *ten* and *four*, computed
with a binary anchor/pool split. Replacing it with graded eligibility credited the Monday-afternoon
coverage D07, D09 and D16 genuinely provide, and the picture is slightly less dire than first
reported. The correction is in the less alarming direction, which is exactly the direction worth
double-checking.

**This is why adding pool doctors does not help**, and it is the thing a naive headcount forecast gets
wrong. Recruiting five more GPs changes nothing about the bottleneck, because none of them can work a
Tuesday morning. Asserted as a test.

### ⚠️ It measures structure, not behaviour — the predictive hypothesis failed

It was built expecting anchor pressure to **predict** constraint breaches, specifically the 34 H-02
doubles. **It does not**, and the module says so in its own caveats:

- Correlation across 33 months: **0.611**. Real, not decisive.
- **May 2025 ran at 0.91 pressure with zero doubles.**
- **March 2024 ran at 0.64 with three.**
- Every month from August 2024 has zero regardless of pressure, including several above 0.75.

What separates the two eras is **August 2024**, when D04 took the Tuesday-night slot — a composition
change, not a load change. Shipping pressure as a breach forecast would have been exactly the
plausible-but-unsupported claim this project keeps catching, so it ships as a structural measurement
with the failed hypothesis recorded next to it.

**What it is genuinely good for:** when an anchor becomes unavailable, it says how much of the month
has no possible substitute — in October rather than on 20 December. That is the pre-flight arithmetic
[`fairness.md`](fairness.md) argued was worth more than the objective, and it needs no solver.
