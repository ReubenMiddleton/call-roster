# Analytics

What the product measures, what it shows, and what it deliberately refuses to show.

Requested by the project owner on 31 August 2026: *"an extremely comprehensive analytics section of
this app that provides visual analytics of any useful metrics the user might want to see."*

The engine is built: [`lib/analytics/`](../../lib/analytics/), validated against **3,145 real
assignments across 33 continuous months** (December 2023 – August 2026). Run it with `npm run seed:report`. **No dashboard exists yet, on purpose** — see
the sequencing note below.

---

## Read this first: analytics must not jump the queue

[`vision.md`](vision.md) is explicit that **the export is the product** and that building the editor
before the export is the most likely way this project fails. A dashboard is further from the export
than the editor is. So:

**What was built now, and why it is not premature:** the *metrics engine*. Three separate things
need exactly the same arithmetic — the solver's fairness objective, the doctor-facing ledger, and
the export footer — and there are 33 months of real rosters to validate it against **today**.
Building it now is cheaper than building it three times later, and the validation is only available
now.

**What was not built, and why:** charts. A chart cannot be validated against anything. It can be
built in an afternoon once the numbers are agreed, and rebuilt in an afternoon when they change.

**The ordering that follows:** export → editor → analytics UI. Bringing the analytics UI forward
means shipping a screen full of `[ASSUMED]` numbers to thirteen colleagues, which is the single
fastest way to lose their trust in the tool.

---

## The one number that is a verdict

Everything below is either an **indicator** or a **verdict**, and conflating the two is the main
risk in this whole area.

**Load ratio is the verdict.** `carried / fair share`, where the fair share is normalised by what
each doctor was actually available for. 1.00 is exactly fair. It is the only figure here that
survives the objection *"but she only works weekends"*. Full derivation in
[`../domain/fairness.md`](../domain/fairness.md#normalisation--the-denominator-problem-and-why-it-is-the-whole-design).

Everything else is an indicator: real, worth showing, and **not a judgement about fairness.**

---

## Per-doctor metrics

Implemented in `DoctorMetrics`. Every one of these is computed from published rosters only.

| Metric | What it is | Visual form |
|---|---|---|
| **Load ratio** | Burden carried over fair share. The verdict | Horizontal bar, 1.00 marked, deviation shaded |
| Burden | Weighted total. Weights are `[ASSUMED]` | Number, with the weight table one click away |
| Realised share | Share of all burden in the period. Needs no denominator, so it is the safest descriptive figure | Stacked bar across the practice |
| Shifts | Raw count. Nearly useless alone; shown because people ask for it | Number |
| Nights, night share | Count and percentage of own shifts | Number + sparkline over months |
| Friday shifts | Count. Friday is weekend work but is priced as a weekday — question V | Number, flagged |
| Saturday shifts | Count | Number |
| Sunday shifts | Count | Number |
| Public-holiday shifts | Count | Number |
| Requested / absorbed shifts | Provenance split — see below | Two numbers, never merged |
| Active days, burden per active day | Membership-scoped intensity | Number |
| First seen, last seen | Inferred membership window | Date range |
| Ratio confidence | `ok` or `low-sample` | Provisional styling, never hidden |
| Membership | `active` or `inferred-departed` | A quiet chip, never a reason to hide the row |
| Presence share | Fraction of the period the doctor was active | Percentage, shown when under 100% |

**Not implemented, and not to be added without asking:** anything derived from an *absence*. D03 has
worked three nights out of 201 against a 32% practice average. That is almost certainly a standing
arrangement — and inferring the rule from the gap is precisely the over-fitting that produced two
wrong versions of H-07. It is question N, not a metric.

### Friday, Saturday and Sunday are counted separately, deliberately

There is no `weekendShifts` metric and there still must not be one. Friday is **confirmed** part of
the weekend (2026-08-31), but the boundary *within* Friday is not — 07:00 or 17:00 — and about 120
shifts move between burden bands depending on the answer. Count `fridays`, `saturdays` and `sundays`;
compose any "weekend" aggregate at the reporting edge from a named, explicit definition. See the
Weekend entry in [`glossary.md`](glossary.md).

---

## Practice-wide metrics

Implemented in `PracticeMetrics`.

| Metric | Reading |
|---|---|
| **Gini on load ratio** | The headline. Inequality after normalising for availability |
| Gini on raw burden | Inequality before normalising. Showing both makes visible how much of the gap is explained by availability |
| Jain's index | More sensitive to a single outlier than Gini. This practice has outliers |
| Coefficient of variation | Dimensionless, so burden and night-count spread are comparable |
| Mean absolute deviation | Report only |
| Leximax vector | Burdens worst-first. What the solver minimises |
| Top-four concentration | Share of burden carried by the four heaviest |
| Uncovered slots | Should always be 0. Non-zero means an H-01 violation in history |
| Shifts by provenance | Directed / requested / absorbed / unknown |

**Every dispersion measure here is non-monotonic and none may ever be optimised.** Each can be
"improved" by giving the least-loaded doctor more work. They are diagnostics; leximax is the
objective. The reasoning and the executable proof are in
[`../domain/fairness.md`](../domain/fairness.md#the-objective-function--corrected-31-august-2026).

### The first real run, 31 August 2026

Fifteen months, 1,430 assignments, `illustrative-v1` weights, `revealed-opportunity` basis:

| | Value |
|---|---|
| Gini, raw burden | 0.341 |
| Doctors in the headline | 12 of 15 — two inferred departed, one a recent joiner |
| **Gini, load ratio** | **0.186** |
| Jain's index | 0.726 |
| Top-four concentration | 50.5% of all burden |

**Roughly half the apparent inequality is explained by availability differences — and half is
not.** The four anchors sit at load ratios of 1.34 to 1.49 *after* normalising, so they genuinely
carry around 40% more than their share of what they were available for. That is the finding the
normalisation was built to be able to state honestly, and it survived it.

---

## Cross-period analytics

`splitByMonth` plus `buildPeriodReport` gives every metric above per month, per quarter, per year.

| View | Question it answers |
|---|---|
| Burden per month | Where the spikes are. December 2025 is the highest of the fifteen at 225.5 |
| Load ratio per doctor per month, as a heatmap | Who is drifting, and when |
| Cumulative ledger | *"Over the last three Decembers you absorbed 12, 14 and 11 shifts while the group average was 4"* — a paper diary structurally cannot produce this |
| Capacity forecast vs demand | The year-end shortfall, named in October rather than on 20 December |
| Violations per rule per month | Whether warnings are being overridden systematically |

### On comparing rostering strategies across years

The owner raised this: *"this could be a cool feature to see if one shift strategy is more
fair (optimal if you will) than another."*

It is a good idea and it is **not yet buildable**, for a reason worth recording rather than
discovering later: comparing two strategies requires knowing where one stopped and the other
started, and **the fifteen months on disk are all one strategy.** Nothing in them changes.

What makes it buildable, in order:

1. **More history.** Ten years exists; two months of the current window are missing (question P).
2. **A named period concept** — a labelled span with a description of what was being tried.
   Without it "strategy" is inferred from a date range, which is exactly how a plausible-but-wrong
   conclusion gets published.
3. **Confidence intervals, or at minimum a sample-size warning.** Two Decembers do not distinguish
   a strategy from a bad December, and a comparison presented without that caveat is worse than no
   comparison.

The metrics engine already supports the arithmetic. What is missing is the domain concept and the
data — and inventing the domain concept unilaterally is precisely what
[`../../AGENTS.md`](../../AGENTS.md) forbids.

---

## Provenance: three numbers that must never be merged

The reason a shift happened changes what it means. See
[`../domain/fairness.md`](../domain/fairness.md#provenance--why-a-shift-happened-and-why-it-changes-the-arithmetic).

- **`requested` burden is excluded from equalisation.** A doctor who asks for extra shifts must not
  have next month's work withheld as a consequence.
- **`absorbed` burden counts in full and flags a capacity event.**
- **`unknown` is every historical assignment**, and reports say so on their face.

A report that shows one merged burden total per doctor is not a simplification of this — it is a
different and wrong claim.

---

## Every report carries its own caveats

`PracticeMetrics.caveats` is a required field, not decoration. It exists because a fairness number
that has lost its provenance will be quoted in a conversation between thirteen colleagues, and by
then nobody remembers that the weights were never agreed.

Current caveats, emitted automatically:

- burden weights are `[ASSUMED]`, naming the schedule version
- fair shares come from **revealed** availability, which can only understate
- what percentage of shifts have no recorded provenance — today, 100%
- which doctors are low-sample and therefore excluded from the practice figure
- any uncovered slot, as an H-01 violation

**Render them. Do not filter them.** A UI that drops the caveats to fit a card is a UI that
misrepresents the data.

---

## Access: who may see whose numbers

**Not a feature flag — a social decision, and it is not reversible once shown.** Publishing thirteen
doctors' cumulative night, Saturday, Sunday and holiday counts to each other changes the practice.

Build for three modes and **default to the most private**:

1. **Admin only.** The default. The principal sees everything.
2. **Own row only.** Each doctor sees their own figures and the practice aggregate, not colleagues'.
3. **Fully open.** Everyone sees everyone.

This is the practice principal's call and is logged in
[`../NEEDS_YOUR_INPUT.md`](../NEEDS_YOUR_INPUT.md). Note also that the practice holds **no patient
or health data** and analytics must not become the place that changes — no diagnosis mix, no
acuity, no patient volumes. See [`../ops/compliance.md`](../ops/compliance.md).

---

## Departure — how far a roster sits from how this practice usually works

**An indicator, never a verdict.** Added 2 September 2026 from the owner's request for a way to see
*"definitively if the solver is being valuable"*.
[`lib/analytics/departure.ts`](../../lib/analytics/departure.ts) compares a candidate roster against
history on four axes, each a **total variation distance** — the share of shifts that would have to
change hands to match habit.

| Axis | Question it answers |
|---|---|
| Share of shifts | Is anyone doing markedly more or less of the month than usual? |
| Nights | Are the nights landing on the usual people? |
| Weekends | Same, for Saturdays and Sundays |
| Anchor slots | Did the regular weekday slots go to their usual doctor? |

### The three rules it is built to obey

1. **Never blended into one number.** *"A single fairness score"* is on the not-measured list below,
   for the reason that applies here too: it compresses a verdict and several indicators into
   something nobody can argue with. *"Nights unusual, everything else typical"* is more honest and
   more actionable than *"87%"*.
2. **Never presented as quality.** A roster that matches habit perfectly also reproduces the
   imbalance this project exists to fix. Low departure is a cost avoided, not a goal met.
3. **Never called a confidence interval.** A CI is a range estimate for a population parameter. What
   makes a departure readable is an **empirical reference band** — every real month scored against
   its own preceding history, so a candidate can be placed against how much this practice's months
   actually vary.

```bash
npm run seed:departure          # the reference band, from 33 real months
npm run seed:solver-departure   # the solver against the principal's own roster, same month
```

The band, measured over 27 months (the first six are warm-up): share `0.12–0.16`, nights `0.19–0.26`,
weekends `0.15–0.20`, anchor slots `0.12–0.23`. The outliers are the months the domain documents
already call unusual — December 2025 tops the anchor axis at 0.50.

**It earned its place immediately.** The first run showed the solver producing rosters further from
the practice's habits on every axis than any real month in three years, because `recurringSlots` was
never being sent and S-05 was therefore inert. See [`../DECISIONS.md`](../DECISIONS.md),
2 September 2026.

---

## What is deliberately not measured

| Not measured | Why |
|---|---|
| Anything patient- or health-related | Hard product boundary. POPIA, and it is not this product's job |
| Speed, productivity, per-doctor performance | A rostering tool that grades doctors will not be used by them |
| Free-text sentiment or preference reasons | A free-text box reliably collects religious observance — POPIA s26 special personal information. Enforced in validation |
| A rule inferred from a doctor never doing something | Over-fitting. It is a question, not a finding |
| A single "fairness score" per doctor | Compresses a verdict and five indicators into one number nobody can argue with. The load ratio plus the counts is more honest and no harder to read |

---

## Joiners and leavers

A requirement, not a nice-to-have. From the project owner, 31 August 2026:

> *"New doctors are constantly joining and others are leaving on a year to year basis, so the system
> we build should be able to elegantly handle this sort of thing without having doctors that have
> left skew the analytics or fairness scale."*

**This was not met when he asked, and the gap was found by running the report rather than reasoning
about it.** Two separate failures:

1. **A departed doctor sat in the current fairness average.** The two known departures were excluded
   only by luck — they trip the 20-shift bar, but both clear the 60-day window comfortably. A
   departed doctor with 25 shifts would have been included, permanently.
2. **A recent joiner was being judged.** One doctor joined ten weeks before the period ended, cleared
   *both* absolute thresholds, and was reported as carrying 30% more than his share on ten weeks of
   evidence.

Two fields now handle it:

| Field | Meaning |
|---|---|
| `membership` | `active` or `inferred-departed`, from a 90-day trailing gap. `[INFERRED]` — a roster records who worked, never who left |
| `presenceShare` | Fraction of the reporting period the doctor was active. Under 50% is low-sample regardless of shift count |

**Neither group is hidden.** Both keep their rows, correctly scoped to the time they were present —
the ledger has to be able to answer *"what did they carry while they were here"*. What they are
excluded from is the practice-wide headline, which is a claim about the doctors being rostered **now**.
`activeDoctorCount` and `departedDoctorCount` are reported so the headline's population is never
implicit.

The 90-day threshold independently reproduces the two departures already known from `private/`, which
is the only validation available and is not evidence that 90 is right for another practice.

## Fridays are counted, and currently under-priced

The owner confirmed on 31 August 2026 that **Friday is part of the weekend** at this practice, which
is also why Pattern B exists. The burden schedule, however, classifies Friday as `weekday` — so a
Friday night prices at 2.5 and a Friday evening at 1.0, the same as a Tuesday.

A `fridays` count was added the same day so the gap is visible rather than silent. It matters *who*:
**D02 worked 45 Fridays, D03 43, D04 33 — and D01 only 4.** Under-pricing Friday under-credits exactly
the three doctors already showing as most overloaded, so the real figures are worse than reported, not
better.

Not corrected by guessing a weight. Question **V**.
