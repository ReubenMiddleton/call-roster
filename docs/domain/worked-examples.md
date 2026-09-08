# Worked examples

**Three real months, reasoned through by hand from the primary source.** Written 26 August 2026 from
the roster exports in `private/source-artifacts/`.

This is the document the brief called *"how you find the constraints you did not know existed"*, and
it has done exactly that: **it falsified a second constraint, found an error in the historical data,
found two adjacent sheets disagreeing about the same date, and turned up a fairness behaviour that a
naive objective function would actively fight.**

Doctors are referred to by code throughout. Read alongside
[`source-artifact-findings.md`](source-artifact-findings.md), which records the corrections found on
first reading; this document is the deeper pass.

**Method:** transcribe the month, check it against the catalogued constraints in
[`constraints.md`](constraints.md), and reason about what the solver would have produced. Where the
month and the catalogue disagree, **the month wins** — it is what actually happened.

---

## Month 1 — July 2025. The ordinary baseline.

31 days, no public holidays, full roster of 15 including both since-departed doctors. Nothing
unusual, which is what makes it the reference.

**The weekday pattern, as actually worked:**

| Day | Morning | Afternoon | Night |
|---|---|---|---|
| Monday | D03 ×5 | D04 ×5 | D02 ×5 |
| Tuesday | D01 ×5 | D03 ×5 | D04 ×4, D10 ×1 |
| Wednesday | D02 ×5 | D01 ×5 | pool ×5 |
| Thursday | **D03 ×5** | D02 ×5 | D01 ×5 |
| Friday (Pattern B) | D04/D03/D02 rotating | D02/D03/D04 rotating | pool only |
| Saturday | D01 ×2, D03 ×2 | pool/anchors | pool |
| Sunday | pool + anchors | pool + anchors | pool |

**Findings:**

**Thursday morning is D03, not D04.** Five weeks out of five. The catalogue names D04 as the
Thursday-morning anchor. This is the discrepancy first spotted in
[`source-artifact-findings.md`](source-artifact-findings.md), and July 2025 is unanimous on it.

**H-06 holds perfectly.** Every Friday's 17:00–23:00 and 23:00–07:00 went to a pool doctor. Four
Fridays, eight shifts, zero exceptions.

**H-05 holds in this month.** No D02 on any of four Saturdays.

**H-07 holds in this month.** No D01 on any Friday shift.

**One anchor exception:** Tuesday 8 July's night went to a pool doctor rather than D04. So even in
the cleanest month, an anchor slot has an exception — which is the case for S-05 being soft.

**What the solver would produce:** with the anchor pattern as S-05 soft preferences and no
preferences loaded, essentially this month, modulo which pool doctor lands where. There is nothing in
July 2025 the model cannot express. It is a good acceptance-test candidate precisely because it is
boring.

---

## Month 2 — December 2025. The month that matters.

**This is the most informative month in the entire dataset.** Three public holidays
(16th Reconciliation, 25th Christmas, 26th Day of Goodwill), thin staffing at year end, and two
Pattern C days.

### Transcription of the interesting fortnight

| Date | Day | Pattern | Morning / Long day | Afternoon / Evening | Night |
|---|---|---|---|---|---|
| 16 Dec | Tue | A | D02 | D13 | D06 |
| 24 Dec | Wed | A | D04 | **D01** | D07 |
| 25 Dec | Thu | A | D03 | D09 | **D01** |
| 26 Dec | Fri | **A** | D10 | D08 | D09 |
| 27 Dec | Sat | A | D03 | D04 | D11 |
| 28 Dec | Sun | A | D04 | D08 | D12 |
| 29 Dec | Mon | A | D04 | **D01** | D11 |
| 30 Dec | Tue | **C** | **D01** 07–17 | D10 17–23 | D06 |
| 31 Dec | Wed | **C** | **D01** 07–17 | D15 17–23 | D10 |
| 2 Jan | Fri | **C** | **D01** 07–17 | D08 17–23 | D10 |

### Finding 1 — ⚠️ H-07 is falsified

**On Friday 2 January 2026, D01 worked the 07:00–17:00 long day.**

H-07 says *"D01 is never assigned any Friday shift"*, `[INFERRED]`, on the basis of *"zero
counterexamples in sixteen months, on any of the four Friday shifts."* Here is a counterexample.

**And it is corroborated across two independent artifacts** — 2 January appears as a spill cell on
the December sheet *and* in its own right on the January sheet, and both show D01 on the long day.
This is not a transcription slip.

**But look at *why* it is not a contradiction of the underlying rule.** 2 January used **Pattern C**,
not Pattern B. The four-shift Friday split did not exist that day. Same on 26 December, a Friday that
used Pattern A — the Friday-specific shifts simply were not there.

So the correct statement is not about Fridays at all:

> **D01 does not work Pattern B Friday shifts.** When a Friday drops Pattern B — for a holiday, or
> for thin staffing — D01 works it like any other day, including the long day.

That is structurally identical to **H-06**, which the catalogue already writes against Pattern B's
shift IDs rather than against the weekday, precisely so it behaves correctly on a Friday that is not
a Pattern B day. H-07 should have been written the same way and was not.

**This is a much better constraint than the one it replaces**, and it would have been impossible to
find without the primary source: the "sixteen months, zero counterexamples" claim was measuring the
wrong thing, because Pattern B Fridays are the overwhelming majority and the exceptions are exactly
the days the pattern changes.

### Finding 2 — the principal absorbs the year-end burden himself

Count D01's December: **14 shifts**, including **Christmas night**, the **30 December long day**, the
**31 December (New Year's Eve) long day**, and then the **2 January long day**. Four of the five
hardest slots in the year, taken by the person who builds the roster.

**This has a direct and non-obvious consequence for the fairness ledger.** A burden-weighted ledger
would see D01 enormously over-credited at year end — Christmas night alone is weighted 8.0 in the
illustrative table — and a cumulative-fairness objective would then spend January trying to
compensate by giving him the easiest shifts available.

**That would be wrong, and he would notice.** He is not a victim of an unfair distribution; he is
choosing to absorb the worst of the year. An objective that "corrects" a deliberate choice is
actively worse than one that ignores it.

**Recommendation:** the ledger needs a way to mark burden as **voluntarily absorbed** — credited for
transparency, excluded from the equalisation objective. Whether that is a per-assignment flag, a
per-doctor opt-out, or simply the principal's ability to lock cells and have the solver treat them
as fixed, is a design question. But *some* mechanism is needed, and it was not in the plan.

Logged in [`../NEEDS_YOUR_INPUT.md`](../NEEDS_YOUR_INPUT.md) — it is also possible he would rather
the system pushed back on him, which is his call and not ours.

### Finding 3 — Pattern C confirmed, and its trigger is visible

Three Pattern C days: 30 Dec, 31 Dec, 2 Jan. All in the year-end window, all `07:00–17:00 /
17:00–23:00 / 23:00–07:00`, all summing to 24 hours across three doctors instead of the usual three
or four.

The staffing context confirms the stated cause. Across those three days the roster draws on D01, D06,
D08, D10 and D15 only — a handful of people covering the period when most of the practice is away.
**Pattern C is what a thin roster looks like**, exactly as the principal described.

Note also that 1 January used **Pattern A**, not C, with three different doctors. So the choice is
made day by day on who is actually available, not applied to the whole period.

### Finding 4 — holidays vary the anchor pattern rather than abandoning it

- **16 December** (Reconciliation, a Tuesday): morning went to D02 instead of the usual D01, but the
  day still ran Pattern A with three shifts.
- **25 December** (Christmas, a Thursday): D01 kept the Thursday night slot he holds every week. The
  morning and afternoon changed hands.
- **26 December** (Day of Goodwill, a Friday): Pattern A instead of Pattern B — the four-shift split
  dropped, as the catalogue predicts — and filled entirely from the pool.

So the catalogue's *"assignment on holidays abandons the weekday anchor pattern"* is too strong for
the third time. **Some anchors persist through holidays, some do not.** The mechanism is not "ignore
the pattern"; it is "the pattern is a preference and availability wins".

---

## Month 3 — August 2026. The current shape.

The most recent month, and the one whose rules are live.

### Finding 5 — H-05's counterexample, in context

**Saturday 22 August 2026: D02 worked 15:00–23:00.** Already recorded in
[`source-artifact-findings.md`](source-artifact-findings.md), but the surrounding context matters:
that Saturday's morning was D03 and its night was D07, so this was not a thin-staffing emergency of
the December kind. It looks like an ordinary Saturday where D02 simply worked.

No other D02 Saturday appears in July 2025, December 2025, January 2026, February 2026 or July 2026.
So: **rare, and real.** WARN, never BLOCK.

### Finding 6 — the D05 handover is visible and clean

D05 holds Monday and Tuesday 15:00–23:00 throughout August 2026. D03 and D04 remain active on other
slots. This is the temporal-interval model working exactly as
[ADR-0008](../architecture/decisions/0008-temporal-validity-intervals.md) describes, and it is the
clearest justification in the data for validity intervals over a `current_holder` column.

### Finding 7 — the holiday marking

10 August 2026 (Women's Day observed, since the 9th was a Sunday) is the only date in the month with
its number **outlined in red**. The statutory Sunday→Monday shift is visible in the artifact itself,
which is a nice confirmation that the rule needs hard-coding rather than configuring.

Two of the three Monday anchor slots were retained on that holiday.

---

## Cross-cutting findings

### ⚠️ Finding 8 — two adjacent sheets disagree about the same date

The December 2025 sheet shows 1 January 2026 in a trailing spill cell. The January 2026 sheet shows
the same date in its own right. **They disagree on the night shift** — the December sheet names one
pool doctor, the January sheet names another.

The other two overlapping dates (2 and 3 January) agree exactly.

**This is a real data-integrity problem for history seeding**, and it needs a stated rule rather than
a discovery mid-import:

> **The sheet whose own month owns the date is authoritative.** A spill cell is a courtesy preview
> printed before the following month was built; the owning month's sheet is later and more
> maintained.

It is also **concrete evidence that published rosters change after publication** — which is open
question 26 ("how often does a published roster change mid-month, and what causes it?"). Here is one
instance, discoverable only by comparing two artifacts. Worth showing him: it is exactly the class of
change the publish → review → lock lifecycle and the "what changed since you last looked" diff exist
to make visible.

### ⚠️ Finding 9 — the historical data contains errors

**Wednesday 28 January 2026 reads `07:00–15:00`, `17:00–23:00`, `23:00–07:00`.** That leaves
**15:00–17:00 uncovered** and the day sums to 22 hours, not 24.

Every other Wednesday that month runs `7–15 / 15–23 / 23–7`. This is almost certainly a typing slip
in the Word table rather than a two-hour gap in emergency cover.

Two consequences:

1. **The app would have caught this**, and that is a genuinely persuasive demo: a coverage-gap check
   on a real historical month finds a real error in thirty seconds.
2. **Seeding must validate arithmetically and flag anomalies for human review, never trust the
   images.** [`fairness.md`](fairness.md) already says this for hallucination reasons; this is the
   same requirement arriving from a completely different direction — the source itself is imperfect.

### Finding 10 — anchor slots rotate more than documented

Thursday morning across five months: unanimous D03 in July 2025; D04 in January 2026; mixed in
December 2025, February 2026, July 2026 and August 2026.

Monday morning: D03 in July 2025 and December 2025; **D04** in January and February 2026; D03 again
in July and August 2026.

Monday afternoon: D04 in July and December 2025; **pool** in January and February 2026; D05 from
June 2026.

**Conclusion:** an "anchor slot" is a strong tendency over a period, not a fixed assignment, and the
holder changes without ceremony. The temporal model handles this — but it means the *seeded* history
must record what actually happened per date rather than deriving assignments from a recurring-slot
rule. Expanding a recurrence to reconstruct history would produce a plausible fiction.

### Finding 11 — departed doctors behave exactly as documented

D14 appears on 6 December 2025, 14 February 2026 and 3 January 2026 — **every single appearance a
Saturday 23:00–07:00.** The brief's striking observation holds across every month checked.

D15's last appearance is 24 January 2026, matching the brief exactly. D15 appears on 14 and 31
December, 1 and 9 and 24 January — occasional, scattered, consistent with an infrequent pool GP
rather than a departure mid-pattern.

---

## What this changes

| # | Finding | Action |
|---|---|---|
| 1 | **H-07 falsified as written** | Restate against Pattern B shift IDs, not the weekday. Keep the flag, default off |
| 2 | **The principal absorbs year-end burden deliberately** | The ledger needs a "voluntarily absorbed" concept, or it will fight him. **New design requirement** |
| 3 | Pattern C confirmed, day-by-day choice | No change; the per-date pattern model already handles it |
| 4 | Holidays vary rather than abandon the anchor pattern | Soften the wording in [`holidays.md`](holidays.md) |
| 5 | H-05 rare but real | Already WARN. No further change |
| 8 | **Adjacent sheets can disagree** | Seeding rule: the owning month wins. Record in the import routine |
| 9 | **Historical data has coverage-gap errors** | Seeding must validate arithmetically and flag, not trust |
| 10 | Anchor slots rotate | Seed per-date facts, never expand a recurrence to reconstruct history |

## Still to do

- **Transcribe all 17 months** for the fairness ledger. This document reasons through three; seeding
  needs every one, with the arithmetic validation from Finding 9 applied to each.
- **Build the solver acceptance test from July 2025** — the boring month is the right one to start
  with, because any disagreement is a model problem rather than a domain subtlety.
- Then re-run it against December 2025, which is where a naive model will fail.
