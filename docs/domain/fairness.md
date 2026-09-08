# Fairness

**This is the feature that justifies the whole project.** Everything else the product does — the
grid, the export, the lifecycle — is a better version of something the principal already does on
paper. The fairness ledger is the one thing a paper diary **structurally cannot** do.

It is also simple arithmetic. No machine learning, no solver required to compute it, and it is
correct on day one if the historical data is seeded.

---

## The problem it solves

**Solving each month independently is fair-looking and actually unfair.**

If a doctor took three of four Christmas-week nights last December, a January that is perfectly
fair *within January* is not fair. Solving each period independently can perpetually disadvantage
particular people even when every individual month is optimal.

A paper diary cannot fix this because it holds one month per page and no running total. The
principal is doing this from memory, thirteen people deep, once a month, under time pressure.

---

## The mechanism: a burden-weighted ledger

`[RECOMMENDED — high confidence]`

1. Each shift type carries a **burden weight**, agreed by the group, visibly, once.
2. After each month is published, credit each doctor the burden they actually carried.
3. Carry the running balance forward across months, indefinitely.
4. The solver's objective pulls **cumulative** balances together — not this month's counts.

### Burden weights ✅ `[CONFIRMED 2026-09-04]` — question 35 answered

**The principal's own numbers.** `AGREED_BURDEN_V2` in `lib/analytics/burden.ts`.

| Shift | Weight | Changed from the placeholders |
|---|---|---|
| Weekday 07:00–15:00 | 1.0 | — |
| **Weekday from 15:00** | **1.75** | ⬆ was 1.0, folded in with the morning |
| Weekday night (23:00–07:00) | 2.5 | — |
| **Friday from 17:00** | **3.0** | ⬆ new — was priced as a weekday |
| Saturday (any) | 3.0 | — |
| **Sunday (any)** | **3.0** | ⬇ was 3.5 |
| **Public holiday (any)** | **4.0** | ⬇ was 5.0 |
| **Christmas night, New Year's Eve night** | **6.0** | ⬇ was 8.0 |
| Long day (07:00–17:00) | 1.5 | — |

Three things worth keeping from how he answered:

- **The 15:00–23:00 is harder than the 07:00–15:00**, and the placeholders priced them identically.
  That was the single biggest error in the old table — it is 60 shifts a month at the wrong weight.
- **Sunday came down to meet Saturday**, rather than Saturday going up. He levelled them.
- ⚠️ **The practice already pays public holidays at a higher rate.** *"Publics are actually higher
  paid shifts so they already work with some sort of fairness scale."* **There is a monetary
  fairness mechanism running alongside this one**, and burden is not the only currency in the room.
  Worth knowing before presenting the ledger to the group as *the* measure of fairness.

**The effect on the headline was small: Gini 0.179 → 0.183.** The ordering within the four anchors
moved, but the practice-level verdict did not — which is a useful robustness result, and a warning
that a load-ratio *ranking* is more fragile than the number it comes from.

⚠️ **Pattern B's front half is still unpriced.** `fri-early` (07:00–12:00) and `fri-midday`
(12:00–17:00) fall to the 1.0 floor. He priced the 15:00–23:00 shift; a 12:00–17:00 is not that
shift, so it was not extrapolated. Small — Pattern B runs about four days a month.

Weights are **data, versioned with a validity interval** — never constants in code. When they
change, historical credits stay at the weight in force when they were earned; recalculating history
under new weights would silently rewrite who owed what.

### Two properties make this the right design

**It degrades gracefully.** A month where someone must take three nights is *recorded*, not hidden,
and the imbalance self-corrects over the following months. Compare a within-month fairness
objective, which has no memory and so cannot correct anything.

**It is explainable.** *"You're +4.5 credits, the group average is +0.2, so you got two fewer
weekends"* is a sentence a doctor will accept. That property matters more than the mathematics —
and it is why the ledger, not the solver, is the centrepiece.

---

## The objective function — corrected 31 August 2026

**Do not use a plain sum of penalties.** It hides gross disparity: one person carrying an enormous
load and twelve carrying none can score the same as thirteen people carrying an equal share.

Use a **multi-phase lexicographic solve**, each phase freezing the previous objective as a
constraint with a small ε tolerance, warm-started with `add_hint`:

```
Phase 1: minimise coverage shortfall          → constrain shortfall ≤ result
Phase 2: minimise preference penalties        → constrain prefs ≤ result + ε
Phase 3: leximax over per-doctor load ratios  (see Normalisation, below)
```

Four sequential CP-SAT calls at n=13 is a few seconds in total. This is not a performance concern
at this scale.

### ⚠️ An earlier recommendation in this document was wrong

This section previously said *"mean absolute deviation also outperforms a weighted sum;
sum-of-squares is cheap at n=13 and effective"*. **Do not use either as the objective.**

Matl, Hartl and Vidal's survey of workload-equity functions
([arXiv:1605.08565](https://arxiv.org/abs/1605.08565)) sets out axiomatic properties an equity
measure should satisfy and concludes that **monotonic equity functions are the appropriate ones**,
because non-monotonic measures admit Pareto-optimal solutions that are *workload inconsistent* —
solutions where every workload is equal to or worse than in some other equally "optimal" solution.

Mean absolute deviation, sum of squares, standard deviation, Gini, Jain and range are **all
non-monotonic**. Each can be "improved" by giving the *least*-loaded person more work when nobody
needed the help. Range is merely the most obvious case, not a special one.

This is asserted as an executable property, not a citation:
[`equity.test.ts`](../../lib/analytics/equity.test.ts) proves leximax monotonic and Gini
non-monotonic over generated distributions. If those two tests ever agree, this recommendation is
wrong.

**One honest qualification.** In vehicle routing total workload is elastic — tours can be
lengthened. In rostering, coverage is hard, so **total burden is fixed**: burden cannot be added to
one doctor without removing it from another. That defuses the survey's sharpest pathology and is
why the dispersion measures are perfectly safe as *reported indicators*. It does not make them safe
as *objectives*, because the solver can still shuffle burden between people to chase a dispersion
number rather than to help the worst-off.

| Measure | Monotonic | Use |
|---|---|---|
| **Leximax over load ratios** | ✅ | **The objective.** Minimise the worst-off, then the second-worst, and so on |
| Min-max (the maximum alone) | ✅ | Weaker than leximax: indifferent between solutions sharing a maximum, so unfairness hides behind the single worst-off person |
| Gini | ❌ | Report — the headline inequality number |
| Jain's index | ❌ | Report — far more sensitive to a single outlier, which is this practice's actual shape |
| Coefficient of variation | ❌ | Report — dimensionless, so burden and night-count distributions are comparable |
| Mean absolute deviation | ❌ | Report only |
| Standard deviation | ❌ | Avoid entirely: non-monotonic *and* nonlinear to encode in CP-SAT |
| Range (max − min) | ❌ | Never. It improves when the least-loaded doctor is given more work |

---

## Normalisation — the denominator problem, and why it is the whole design

`[DESIGNED 31 August 2026]` — implemented in [`lib/analytics/`](../../lib/analytics/), and not yet
reviewed by the practice.

### The failure this avoids

The practice owner stated the problem precisely:

> *"We just need to come up with a way to normalize the data for the doctors that only work
> weekends or only work weekdays or only work at my dad's practice sometimes, because obviously
> they have other work they are also doing and that shouldn't force them to work more at my dad's
> practice just because the analytics says they are slacking."*

That is one half of it. The other half is worse, and it is why a naive fix makes things actively
harmful.

Take a doctor available only at weekends. Every shift they can possibly work carries a high burden
weight, so **dividing burden by headcount or by FTE makes them look chronically overloaded.** A
fairness objective then responds by taking weekends away from them — and weekends are the only
thing they can work. The system's conclusion is "give this person less work", when the person may
well want more.

So burden-weighting and availability-normalisation interact, and getting either one right on its
own is not enough.

### The fix: normalise by the burden of the opportunity, not by a count

For each doctor *i* over a period:

```
expected_i   =  totalBurden × weight_i / Σ weight_j
loadRatio_i  =  carried_i / expected_i
```

`loadRatio = 1.0` means *carried exactly a fair share*; above 1 is overloaded. It is dimensionless,
so it is comparable across doctors **and** across periods of different length, which raw burden
totals are not.

Everything then rests on `weight_i`, the **entitlement weight** — the answer to *what should this
doctor's share have been?* Four bases are implemented:

| Basis | `weight_i` | Verdict |
|---|---|---|
| `equal` | 1 | Honest only where everyone is interchangeable. This practice's anchors and pool doctors are not. **Reports restricted doctors as overloaded** |
| `active-days` | days of active membership | Corrects for joiners and leavers, and nothing else. The right minimum bar; still wrong for a weekends-only doctor |
| **`revealed-opportunity`** | **total burden of the slots the doctor could have worked** | **The default.** A weekend-heavy numerator over a weekend-heavy denominator cancels exactly |
| `explicit` | supplied by the caller | For a contracted FTE or an agreed target, once one exists |

### Why the exact cancellation matters

[`normalisation.test.ts`](../../lib/analytics/normalisation.test.ts) builds a period where five
doctors have mutually exclusive availability and **each works every slot available to them.**
Nobody could have worked more or less, so the only defensible verdict is that all five are exactly
fair — and unlike real history, the right answer is known before any code runs.

| Basis | Result |
|---|---|
| raw burden | the Sunday doctor carries more than the weekday doctor off **60% of the shifts** |
| `equal` | Sunday doctor 1.25, night doctor 1.49, morning doctor 0.60 — Gini 0.19 |
| `active-days` | identical; all five span the same window |
| `revealed-opportunity` | **every ratio exactly 1.00, Gini 0.00** |

The normalisation does not launder the facts: raw-burden inequality is still reported, because it is
real. What changes is which number is the *fairness verdict*.

### What revealed availability cannot see, stated plainly

The practice has never recorded availability, so for historical data the opportunity set is
inferred from the `dayClass × shiftKind` combinations each doctor was *observed* working. That is a
proxy, and it is `[INFERRED]`:

- **It can only understate.** A doctor willing to work Tuesday nights who was never offered one
  looks unavailable, so their denominator is too small and they look *more* overloaded than they
  are.
- **It over-generalises from single instances.** One Sunday night ever worked marks a doctor
  available for every Sunday night in the period.
- **It cannot see a declined offer, a holiday, or a month spent at another practice.**

It is still strictly better than assuming everyone was available for everything, and it is replaced
rather than refined once the product captures real availability. The interface is the seam.

**A low-sample guard exists because the first real run needed one.** A departed doctor with sixteen
shifts scored 2.16 — higher than any anchor — purely because sixteen observations make a tiny,
unstable denominator. Doctors below 20 shifts or a 60-day span have their ratio marked provisional
and are excluded from the practice-wide figure.

### ⚠️ The denominator is the one number nothing can check — measured 3 September 2026

The owner asked whether fitting fairness to this practice's own history would overfit. It was
measured rather than argued about: `npm run seed:entitlement` walk-forwards over all 33 months,
fitting the opportunity set on everything before a window and evaluating on the window.

| | 1 month | 3 months | 12 months |
|---|---|---|---|
| Novelty — shifts in a cell that doctor had never worked | 3.1% | 3.6% | 7.6% |
| In-sample bias — load-ratio points | 2.11 | **0.83** | 0.58 |
| Worst-loaded doctor flipped between fittings | 12 of 27 | 5 of 25 | 3 of 16 |
| ρ against an equal split | 0.44 | 0.59 | 0.62 |

**The denominator generalises.** Novelty sits at ~3% a month with no downward trend over 27 months,
and a past-fitted denominator predicts the settled one to within 0.02–0.12 load-ratio points. There
is no overfitting-to-noise problem to fix.

**The real exposure is different, and worse.** ρ ≈ 0.6 against bases *not* fitted to this practice
means the choice of denominator is most of the fairness verdict. That is by design — an equal split
is wrong for a practice with anchors and weekends-only doctors — but it means the load-bearing
number is the one nothing can validate. **And no walk-forward ever will**, because every available
target is itself revealed availability: a doctor never offered Tuesday nights looks unavailable in
the past-fitted set, the settled set and the revealed set alike. The test proves *stability*, not
*correctness*.

That is why declared availability is not a nice-to-have. It is the only exogenous signal that can
break the loop where whoever was historically under-offered keeps a small denominator, looks fully
loaded on little work, and is therefore never offered more. **Question 44.**

**The in-sample bias number is why candidate rosters are scored on a fixed denominator.** Fitting
the cells on the roster being judged moves its own fair share; at the three-month horizon the
product actually uses, that is worth 0.83 load-ratio points and flips the worst-loaded doctor in one
window in five. `EntitlementOptions.cells` exists to prevent it.

---

## Envy — the fairness check with no denominator

`[PROPOSED — ADR-0015, awaiting sign-off]` `lib/analytics/envy.ts`

Because the load ratio's denominator cannot be validated, a second opinion is worth having, and the
useful kind is one that does not share the weakness. Envy compares doctors to each other directly:

> **D07 envies D03 if D07 carried more burden than D03, and D07 could have worked D03's shifts.**

No entitlement, no fair share, no fitted weights — two burdens and a feasibility test. The bar is
**envy-freeness up to one shift (EF1)**: envy is forgiven when removing the envious doctor's single
heaviest shift closes the gap. Exact envy-freeness is impossible with indivisible shifts — someone
takes the last Sunday night — but EF1 is achievable in principle for chores, so it is a bar that can
be met rather than an ideal to fall short of.

Read aloud it is a sentence a rostering doctor recognises: *"nobody would rather have had a
colleague's month, bar a single shift."*

### What it says about this practice

**EF1 fails in all 68 windows measured.** Median worst violation 27 burden units in a single month —
about eight Sundays — against a healthy median of 36 comparable pairs, so this is not an absence of
evidence.

**The load ratio and envy disagree, and both are right.** After normalisation the load ratio calls
the practice moderately unequal. Envy says it is nowhere near fair. The gap between them is exactly
the inequality that *availability explains*: the load ratio forgives it, envy only forgives what no
feasible swap could fix. The principal should see both numbers, because "we are as fair as our
availability allows" and "we are not fair" are both true and lead to different conversations.

### ⚠️ A diagnosis, not a prescription

Containment runs **envied ⊆ envious**, because envy means *"I would rather have your position"* and
that is only coherent if the envious doctor could have held it. Fixing the gap needs the **reverse**
containment — the under-loaded doctor being able to work the over-loaded one's shifts — and at this
practice the two rarely coincide. The anchors can hold the pool doctors' months; a doctor available
four days a month cannot absorb eight Sundays.

So a 27-unit violation means *"the anchors would rather have had the pool doctors' months, by 27
units"*. It does **not** mean 27 units could have been reassigned. Quoting it as though it did would
present an availability problem as a scheduling failure, and the principal would rightly stop
trusting the number.

**Reported, never optimised** — the same rule as the dispersion measures, for the same reason.

---

## Provenance — why a shift happened, and why it changes the arithmetic

`[CONFIRMED]` 31 August 2026 — the vocabulary below, confirmed by the project owner the same day
it was coined (question R). See [`product/glossary.md`](../product/glossary.md#provenance-vocabulary--confirmed-31-august-2026),
the canonical source for these terms; this section was left saying `[PROPOSED]` after that
confirmation landed elsewhere, which this fixes. Still worth raising with the practice principal in
case he has his own words, but these are the terms in use.

The practice owner's answer to question M forced this. Asked whether the fifteen constraint
counterexamples were deliberate or forced:

> *"Most of the breaks were deliberate, as in the doctor explicitly asked to work more on that
> occasion for whatever reason, but some of them, especially the December 2025 instances, were
> forced because there was no one else to work at that time. […] There will be occasions and there
> will be doctors that ask for more work because they need the money or some other reason."*

The important part is not "deliberate" or "forced". It is that **the same shift means two different
things**, and the ledger cannot tell them apart from the assignment alone. So the reason has to be
recorded on the assignment:

| Provenance | Meaning | Ledger treatment |
|---|---|---|
| `directed` | The scheduler assigned it | Counts toward equalisation. The default |
| `requested` | The doctor asked for it — income, a favour, a swap they initiated | Recorded and reported, **excluded from equalisation** |
| `absorbed` | Nobody else was available | Counts in full **and** flags a capacity event |
| `unknown` | Never captured. **Every historical assignment.** Counted as directed, reported separately |

**Excluding `requested` is the consequential line.** Crediting requested burden to the equalisation
term means a doctor who asks for extra shifts gets less work next month as a direct result — the
system punishing someone for volunteering, and doing it invisibly. That is not a rounding error in
the fairness model; it inverts it.

**Including `absorbed` is deliberate** and follows the owner's earlier decision about the year-end
burden: burden taken on because nobody else was available is a recurring operational failure, and a
system that hides it destroys the evidence needed to argue for fixing it.

Two safeguards, because "requested burden is free" invites gaming:

1. Requested shifts still appear in every **report**, so a doctor cherry-picking easy shifts stays
   visible even though the objective ignores them.
2. The practice is chronically short of cover. A doctor asking for more work is helping; the
   incentive points the right way here in a way it would not in an over-staffed unit.

**Nothing historical can use this.** All 1,430 transcribed assignments are `unknown`, and the report
says so on its face rather than presenting them as scheduler-directed.

---

## ⚠️ The seasonal capacity problem — decided, and it stays in the objective

**Found while working December 2025 by hand** ([`worked-examples.md`](worked-examples.md)),
**explained by the owner**, and **decided 26 August 2026.**

In December 2025 the practice principal worked **14 shifts**, including **Christmas night** and three
of the four year-end long days. Four of the five hardest slots in the year, taken by the man who
builds the roster.

**The cause is structural, not personal.** Most doctors on this roster have a primary practice
elsewhere and cover shifts here for additional income, mainly at weekends. Around the holidays they
go away or cash in leave, their commitment here is the one that gives, and D01 is left short on a
24/7 single-cover emergency centre where at least one doctor must be present. So he works it himself.
It recurs every year, and in the long June/July school holiday too. Full account in
[`workforce.md`](workforce.md).

### The decision, which reverses an earlier recommendation of mine

I first recommended marking this burden **voluntarily absorbed** and excluding it from equalisation,
on the reasoning that an optimiser should not "correct" a deliberate act of leadership.

**The owner's position is the opposite, and it is better reasoning:**

> *"This should affect the fairness objective because it shouldn't work that way, and if we build in a
> solution it might reduce the effect it has. Treat this as if it shouldn't happen ideally."*

That is right. It is not generosity to be preserved — it is a **recurring operational failure the
practice absorbs through its principal**, and a system that hides it destroys the evidence needed to
fix it. So:

> **Credit it to the ledger. Include it in the objective. Let it look bad, visibly, year over year.**

No "voluntarily absorbed" exclusion. No special-casing.

### But be honest about what the objective can and cannot do

**A solver cannot create doctors.** If twelve of thirteen are away, no fairness weighting changes who
covers Christmas. Pretending the objective solves this would be the wrong kind of confidence.

What actually moves the needle, in descending order of value:

1. **Forecast the shortfall in October, not on the 20th of December.** The pre-flight arithmetic
   already exists and needs no solver: *"you are 14 doctor-shifts short between 23 December and
   3 January."* This is the single most useful thing the product can do about the problem.
2. **Budget simultaneous unavailability.** The unavailability budget was designed to stop preference
   inflation; its larger purpose here is **capping how many doctors may be away at once** over a
   defined period. That is a policy lever the practice does not currently have.
3. **Make the pattern undeniable.** *"Over the last three Decembers you absorbed 12, 14 and 11 shifts
   while the group average was 4"* is a sentence that can start a conversation with thirteen people —
   and a paper diary structurally cannot produce it. **This is the ledger's single most valuable
   output, and it is the strongest argument for seeding the full history.**
4. **Surface it during the review window**, while there is still time to negotiate.

### Design consequence

Treat year end and the June/July school holiday as a **named, recurring, expected capacity event** —
not an anomaly re-handled each year. Pattern C exists because of it. The pre-flight forecast should be
schedulable, and the year-over-year comparison should be a first-class report rather than something
derived on request.

Still to confirm with the practice principal directly: whether he regards it as a problem to fix or
the cost of ownership, whether holiday leave is negotiated or first-come, and whether any rule already
exists about how many may be away at once. Logged in
[`../NEEDS_YOUR_INPUT.md`](../NEEDS_YOUR_INPUT.md).

---

## ⚠️ Correction, 1 September 2026: the December claim above rests on the wrong month

**Seven more months of history falsified the framing, though not the decision.**

The section above was built on December 2025 — *"he worked 14 shifts, including Christmas night and
three of the four year-end long days"* — and read that as evidence of a recurring structural failure
absorbed by the principal.

With three Decembers now transcribed and D01's own 22-month baseline available, that reading does not
survive:

| | Shifts | Burden | Against D01's own 22-month mean |
|---|---|---|---|
| **December 2023** | 20 | 42.0 | **+51%** |
| **December 2024** | 14 | 22.5 | −19% |
| **December 2025** | 14 | 27.5 | **−1%** |
| D01's mean | 15.7 | 27.8 | — |

**December 2025 was an ordinary month for him.** Fourteen shifts is below his mean of 15.7, and 27.5
burden is within one percent of his average. December 2024 was well below. Only December 2023 was
genuinely heavy, and by then the practice was three doctors short of its 2025 roster — D04 had not
joined and D16 was still covering.

Across the three years, December averages **+10%** on his mean. Real, but modest, and driven almost
entirely by one year.

### What made it look worse than it was

Two things, and both are worth naming because they are how a plausible-but-wrong finding gets into a
document:

1. **A single month was read as a pattern.** There was one December in the data. The claim needed at
   least three and could not have been tested when it was written — which is an argument for writing
   claims so they *can* be tested later, not for not writing them.
2. **Composition was mistaken for volume.** Christmas night and three year-end long days are
   *visible* and emotionally weighted. The burden model prices them, and priced correctly they do not
   add up to an exceptional month.

### What survives, and what does not

**Does not survive:** that the principal absorbs an exceptional December every year. He does not. The
December load is a mild elevation on a heavy baseline, not a spike.

**Survives, and is now better supported:** the **annual rotation** the principal described at question
18 is real and visible. Christmas night went to **D08 (2023) → D11 (2024) → D01 (2025)** — three
different doctors in three consecutive years, and D01 worked no Christmas shift at all in 2024. The
hardest single slot in the year is genuinely shared.

**Survives untouched:** the owner's *decision* that absorbed burden counts toward the objective and
stays visible. That was a policy judgement about how the system should behave, not an inference from
December 2025, and it is if anything easier to defend now: the seasonal effect is small enough that a
fairness objective can absorb it without distorting the rest of the year.

**Now testable and not yet tested:** whether the *practice-wide* year-end shortfall is real, as
distinct from the principal's share of it. The mechanism he described — most doctors away or cashing
in leave — would show up as fewer distinct doctors available in December rather than as more shifts
for him. That is a different measurement and it has not been run.

### The general lesson, which is the same one as before

The constraint catalogue already carries it: *in this domain, a statement of the form "X always
happens" needs a script pointed at it before it goes in a document.* This is the same failure applied
to my own writing rather than to the practice's rules — a single vivid month, generalised. The fix is
the same: **write the claim so a script can refute it, then run the script when more data arrives.**
That is what happened here, which is the system working rather than failing.

---

---

## The seasonal claim fails its second test as well, 1 September 2026

The correction above showed that **D01's December burden is not exceptional.** The remaining
possibility was that the shortfall is real at the *practice* level rather than his — that people go
away and the roster runs on fewer bodies. That is a different measurement and it has now been run.

**It does not hold either.** Distinct doctors working, per month:

| | Distinct doctors |
|---|---|
| Non-December mean, 30 months | **12.9** |
| December 2023 | **11** |
| December 2024 | 12 |
| December 2025 | **14** |

December 2025 had **more** doctors working than an average month. December 2024 was one below. Only
**December 2023** shows the effect, and that was the month with the fewest doctors in the entire
dataset — the same month D01 worked 20 shifts at +51% of his mean.

### The most likely reading, and it is better than the original

The owner described the year-end shortage as *"an anomaly but one that repeats itself every year with
varying results."* Over the three Decembers available, it repeats **once**.

The plausible mechanism is that **the effect faded as the roster grew**: 11 doctors in December 2023,
12 in 2024, 14 in 2025. A practice with 11 doctors has no slack when three are away; a practice with
14 absorbs it. That is a more useful theory than "it happens every year", because it predicts
something — the shortfall should reappear if headcount falls back — and it is testable against older
history.

### What this changes

**Nothing about the owner's decision**, which was that absorbed burden counts toward the objective and
stays visible. That is policy and it stands.

**It does change what the product should build.** The pre-flight capacity forecast was justified as
protection against a recurring annual event. On this evidence the real risk is not the calendar, it is
**headcount falling below the point where the roster has slack.** A forecast keyed to December would
have fired uselessly in 2024 and 2025 and missed the actual mechanism.

So the forecast should watch **available-doctor count against coverage demand, continuously**, and
raise a flag whenever slack goes negative — in any month. December is where that has happened, not
what causes it.

**Still unknown, and a genuine question for the practice:** whether doctors *were* away in December
2024 and 2025 and the roster simply absorbed it, or whether the going-away pattern has itself changed.
The rosters record who worked, never who asked to be away — so this cannot be settled from the data,
only from the request diaries. Logged as **Z**.

---

## H-07 is becoming true rather than being occasionally broken

The 33-month re-verification flagged that H-07 jumped from 3 counterexamples to 26, far more than the
dataset's doubling would explain. It is not a measurement artefact — it is a **change in behaviour**:

| Period | D01 on Pattern B slots | Rate |
|---|---|---|
| Dec 2023 – Mar 2025 | 21 of 260 | **8.1%** |
| Apr 2025 – Aug 2026 | 5 of 268 | **1.9%** |

D01 worked Fridays fairly regularly through 2024 and largely stopped from 2025 onward — a four-fold
drop, across a boundary that coincides with D04 becoming established and the practice growing from 11
doctors to 13.

### Why this matters for how the constraint is written

**H-07 as stated is a rule about the present, applied to the past.** Weighted over the whole history
it looks like a rule broken twice a month; weighted over the last eighteen months it looks like a
strong preference broken twice a year. Those are different penalties.

Two consequences:

1. **The fairness ledger and the solver must not share one weighting for H-07 across the whole
   history.** The ledger reports what happened; the solver should be tuned on recent behaviour, because
   that is what the principal will recognise as correct.
2. **This is the same lesson as H-02 in a different guise.** H-02 became true when the roster gained a
   doctor. H-07 became *more* true over the same period. **Constraints in this practice have a validity
   interval like everything else** — which the temporal model already supports for people and weights,
   and does not yet support for constraints. Worth considering: a constraint with `validFrom`.

The principal's own answer (question 12) is consistent with the recent period and not with 2024:
*"a rule that is broken occasionally, but for the most part a rule that tries to be kept."* At 8.1%
it was not being kept; at 1.9% it is.

---

## Report indicators that are not in your objective

If the numbers shown to doctors are exactly the terms being minimised, the product is grading its
own homework. Report at least some fairness indicators that the solver is **not** optimising —
weekend counts, night counts, holiday counts, requests granted versus denied — so a real imbalance
can still show up in the reporting even when the objective looks satisfied.

Vocabulary to use precisely in UI copy:

| Term | Meaning |
|---|---|
| **equal** | Everyone gets an identical share |
| **equitable** | Tailored to FTE, seniority and stated preferences |
| **harmonious** | Equal within groups, equitable between groups |

This practice wants **equitable**, given the anchor/pool split. Saying "fair" without qualification
invites everyone to assume "equal" and then feel cheated.

---

## Publish the ledger

**Transparency is doing more work here than any algorithm.** A competitor's own framing is the
sharpest statement of the problem: *"Even a fair schedule can feel unfair if the logic behind it is
invisible."*

But this is **the principal's call, and it is not reversible once shown.** Publishing thirteen
doctors' cumulative weekend, night and holiday counts to each other is a social decision, not a
feature flag. It is logged as a question in [`../NEEDS_YOUR_INPUT.md`](../NEEDS_YOUR_INPUT.md).

Build it so the ledger can be admin-only, per-doctor-own-row-only, or fully public — and default to
admin-only until he chooses.

---

## Set expectations honestly on preference satisfaction

Published data shows **manually-built schedules already satisfy 57–63% of preferences**;
optimisation takes that to **66–73%**.

That is a real gain and it should be stated as one. But if the product implies 95%, it will be
judged against a gap that is **structurally infeasible rather than algorithmically hard** — thirteen
people asking for the same weekend cannot all get it, no matter what solver runs.

The honest pitch, and the one to use:

> **The same or better preference satisfaction, in thirty seconds instead of six hours, with the
> trade-offs made visible.**

The third clause is the differentiator. The first two are what the incumbents already claim.

---

## Seeding history

The ledger is worth little until it has history behind it, and it is worth a great deal the moment
it does. Sixteen months of roster images exist; extracting them is roughly **half a day** of work
and buys three things:

1. A fairness ledger that is **real on day one** rather than accumulating from zero.
2. A solver acceptance test: *given last March's constraints, does it produce something the
   principal rates as good as what he built by hand?*
3. The most persuasive demo available — *"here's your last sixteen months: D03 did eleven weekends,
   D09 did four."*

Extraction is a vision-LLM table-reading task at roughly 90% accuracy, and **the residual error is
silent** — models hallucinate extra rows. Mitigate structurally rather than by trusting the output:

- **Constrain the output schema to the enum of thirteen real doctor codes.** A name outside the enum
  is rejected, not recorded.
- Extract in batches, then **validate arithmetically**: every day has exactly one doctor per slot;
  no doctor appears twice in one slot; row and column counts match the calendar.
- Human-verify side by side afterwards.

Most hallucinations break one of those checks automatically. This work is blocked on the roster
images reaching `private/source-artifacts/`.

---

## What not to do

**Do not let doctors self-assign shifts.** The best-documented cautionary tale is a 70-nurse
self-scheduling rollout that ran for a year and was **abandoned**: nurses treated assigned shifts as
*entitlements* rather than collaborative agreements, overfilled slots, signed up for incompatible
consecutive shifts, and ignored staffing constraints — forcing the manager into constant
restructuring.

Let doctors state *preferences*; the principal or the solver assigns.

One encouraging detail from that same study: its authors identified **scale** as the first barrier,
and the successes in the literature were small units. **n=13 is in the success band** — which is
worth telling the principal, because it means the collaborative parts of this can work here even
though they failed there.

**Do not blend a second fairness measure into the objective at partial weight.** Asked for directly
on 3 September 2026 and declined on evidence — [ADR-0015](../architecture/decisions/0015-envy-as-a-fairness-cross-check.md).
Two reasons, and they are separate:

- **A dispersion measure at 30% is still non-monotonic.** Gini, Jain, CV, MAD and range each improve
  when the *least*-loaded doctor is given more work. Partial weight only means a slightly larger
  perverse case is needed before it bites.
- **A blend of two entitlement bases is a third basis nobody chose.** *"Your fair share is 70% of
  what your history says plus 30% of an even split"* is not a sentence that survives being said to a
  doctor at 2am, and "warn and scar, never block" requires the principal be able to explain every
  number he overrides. Swept anyway, because the idea was sound and aimed at the right component:
  the optimum is λ≈0.1, worth 3% error at the horizon used, and nothing at twelve months.

Add a second scale as a **reported cross-check**, as envy is. Never as a term in the objective.
