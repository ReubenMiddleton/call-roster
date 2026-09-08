# Constraint catalogue

**The most important document in the project.** It is simultaneously the requirements
specification, the test plan, the solver specification and the source of user-facing violation
messages.

Every constraint has a **permanent ID**. That ID appears as a comment in the solver model, in the
test name, and in the UI when it causes a violation — so `implement H-04` and `why is H-04
failing` are unambiguous, and coverage is verifiable by grepping IDs.
[`../../scripts/check-docs.mjs`](../../scripts/check-docs.mjs) fails the gate if an ID is
referenced anywhere without a definition here.

Doctors are referred to by code. The code-to-name mapping exists only in the gitignored
`private/` directory — see [`../../README.md`](../../README.md).

Requirements use **EARS** notation, because an EARS statement is simultaneously a requirement and
a test name.

---

## How to read the confidence tags

| Tag | Meaning | What you may do with it |
|---|---|---|
| `[CONFIRMED]` | Stated directly by the practice principal, or verified across multiple independent roster months | Model it as stated |
| `[INFERRED]` | Derived by analysis of the roster images. Consistent with the data, not confirmed by a human | Model it **behind a feature flag, default off** |
| `[ASSUMED]` | A reasonable guess | Do not model it. Ask first |
| `[UNKNOWN]` | Explicitly not established | Do not fill it in by guessing |

**Never promote a tag without a human source.** An `[ASSUMED]` hard constraint that turns out to
be wrong is the single most likely way this project produces a roster the principal rejects.
Open questions live in [`../NEEDS_YOUR_INPUT.md`](../NEEDS_YOUR_INPUT.md).

---

## ⚠️ Verified against fifteen months of real data, 26 August 2026 — and most "never" rules failed

`scripts/analyse-seed-data.mjs` checks every catalogued constraint against **1,430 real
assignments** across the fifteen months then available. **Superseded by the 33-month
re-verification below.** Run it any
time with `npm run seed:analyse`. The results:

| ID | Claim | Verdict |
|---|---|---|
| **H-01** | Exactly one doctor per shift slot | ✅ **Holds** — every slot, every month |
| **H-02** | At most one shift per doctor per day | ⚠️ **Held on 15 months — FALSIFIED on 33.** 34 counterexamples. See the re-verification below |
| **H-03** | Only assignable while a member | ✅ Holds (enforced structurally) |
| **H-04** | No back-to-back night shifts | ❌ **FALSIFIED — 4 counterexamples** |
| **H-05** | D02 never works a Saturday | ❌ **FALSIFIED — 4 counterexamples** |
| **H-06** | Friday's back half excludes D01–D04 | ❌ **FALSIFIED — 4 counterexamples, all four doctors** |
| **H-07** | D01 never works a Pattern B shift | ❌ **FALSIFIED — 3 counterexamples** |

**Every behavioural "never" in this catalogue is false.** Only the three structural constraints
survive — and those are the ones enforced by the database rather than by the practice's habits.

This is the strongest possible vindication of **warn and scar, never block**. Had H-04 through H-07
shipped as `BLOCK`, the app would have refused **fifteen rosters the principal actually built and
distributed.** Every one of them was tagged `[CONFIRMED]` on the strength of an interview plus an
eyeball pass over the sheets, and every one of them was wrong.

**The general lesson, and it should outlive every specific constraint here:** in this domain, a
statement of the form *"X never happens"* means *"X happens perhaps three times a year and I do not
think of it as a rule I am breaking."* Treat every such statement as a strong preference until a
script says otherwise.

---

---

## ⚠️ Re-verified against 33 months, 1 September 2026 — H-02 is now falsified too

The verdicts above were computed on fifteen months. **The dataset is now 33 continuous months and
3,145 assignments** (December 2023 – August 2026), and one verdict changed:

| ID | On 15 months | On 33 months |
|---|---|---|
| **H-01** exactly one doctor per slot | ✅ Holds | ✅ Holds |
| **H-02** at most one shift per doctor per day | ✅ **Held — zero counterexamples** | ❌ **FALSIFIED — 34 counterexamples** |
| **H-03** only assignable while a member | ✅ Holds | ✅ Holds |
| **H-04** no back-to-back nights | ❌ 4 | ❌ **27** |
| **H-05** D02 never a Saturday | ❌ 4 | ❌ **12** |
| **H-06** Friday's back half excludes D01–D04 | ❌ 4 | ❌ **11** |
| **H-07** D01 never a Pattern B shift | ❌ 3 | ❌ **26** |

**Every behavioural constraint in this catalogue is now falsified, including the one that survived.**
Only H-01 and H-03 remain, and both are enforced by the database rather than by anyone's habits.

### H-02 is the interesting one, because it was falsified in the right order

The principal was asked on 31 August whether "at most one shift per doctor per day" was absolute and
answered: *"it should be absolute but it has happened, and so the app should still allow for it if it
happens."* At that point there were **zero counterexamples in 1,430 assignments** — his answer
contradicted the data, and it was acted on anyway: the solver was elasticised the same day and the
validator gained a declared-anomaly escape.

The next day the older sheets arrived and produced **34 counterexamples.** He was right and the data
was incomplete.

**That sequence is worth keeping.** A system that had trusted 1,430 assignments over the practice
principal would have shipped a hard constraint, and it would have refused roughly one roster a month
for the whole of 2024.

### The 34 doubles are a standing arrangement, not noise

They are not scattered. **D03 held both Tuesday 15:00–23:00 and Tuesday 23:00–07:00** for most of
2024 — every Tuesday in January, May, June and July.

The mechanism is visible in the data: **D04 does not exist before 21 March 2024.** From 2025 onward
D04 holds Tuesday night. So the doubles are the Tuesday-night slot having no other owner, and they
stop in **August 2024**, the month D04 takes it on every Tuesday:

| | Doubles |
|---|---|
| Dec 2023 – Mar 2024 (no D04, then arriving) | 4, 4, 4, 3 |
| Apr – Jul 2024 (D04 present, intermittent) | 3, 4, 5, 5 |
| **Aug 2024 onward (D04 holds Tuesday night)** | **0, and none in any later month** |

So H-02 was routinely broken for eight months and then stopped. It is not a rule the practice breaks
occasionally; it is a rule that became true when the roster gained a doctor. **A constraint can be an
artefact of headcount** — which is an argument for re-verifying the whole catalogue whenever the
workforce changes, not only when someone states a new rule.

### The other counts grew roughly with the data, with one exception

H-04, H-05 and H-06 scale about as expected for a dataset that doubled. **H-07 went from 3 to 26**,
which is far more than proportional.

### ✅ That "worth a look" was looked at — 2 September 2026, and the suspicion was right

The earlier figure **was** measuring a period in which D01 happened to avoid Fridays. Counting
D01 against *Pattern B Fridays specifically*, by quarter:

| | 2023 Q4 | 2024 Q1 | 2024 Q2 | **2024 Q3** | 2024 Q4 | 2025 Q1 → 2026 Q3 |
|---|---|---|---|---|---|---|
| D01 worked | 3/3 | 7/12 | 7/13 | **1/12** | 3/13 | never above 2/12 |
| | 100% | 58% | 54% | **8%** | 23% | 0–20% |

**D01 worked 53% of Pattern B Fridays before August 2024 and 9% after.** It is not a rule, and not
a habit either — it is a **practice that changed**, in one identifiable month.

**And it is the same month, and the same cause, as H-02's change.** The Friday early shift rotated
D01 (14) / D03 (10) / D02 (8) before August 2024; afterwards it rotates D03 (35) / D02 (32) /
**D04 (27)**, with D01 down to 6. D04's overall load goes from **0.09 to 0.47 shifts per day** over
the same boundary. One doctor becoming a full participant displaced D01 from the Friday rotation and
took the Tuesday-night slot that had been covered by D03's double shift.

**H-05 has the same shape.** D02 worked **23% of Saturdays before August 2024 and 4% after** — 8 of
its 12 counterexamples are in the eight months before that boundary. Three constraints, one boundary.

**So one workforce event falsified three constraints**, and the note above about H-02 —
*"a constraint can be an artefact of headcount"* — is the general case rather than an H-02 curiosity.
It is also the strongest argument yet that **a constraint needs a `validFrom`** like everything else
in the temporal model: H-02, H-05 and H-07 are all true statements about the practice *since August
2024* and all false about it before.

⚠️ **Consequence for the flag: leave H-07 OFF even if the principal confirms it.** He may well say
he does not work Fridays, and he would be describing the last two years accurately. The data says the
behaviour followed a colleague's availability, so **if D04 leaves it would likely reverse** — and a
rule encoded from the current era would then fight the roster he wants to build. A soft preference
recomputed from recent history is the right shape here, not a stated rule.

### What the fairness figures look like on 33 months

| | 15 months | 33 months |
|---|---|---|
| Gini, raw burden | 0.341 | **0.375** |
| **Gini, load ratio** | 0.186 | **0.179** |
| Top-four concentration | 50.5% | **52.2%** |

**The headline barely moved**, which is the useful result: the normalisation is stable across a
dataset that doubled and across a workforce that changed composition twice. Raw-burden inequality rose
while normalised inequality fell slightly — exactly what should happen when the extra data contains
more short-tenure doctors, whose raw totals are small but whose opportunity sets are small too.

---

## ⚠️ A verdict must name the span it was computed over

Added 1 September 2026, after **two constraints turned out to be artefacts of headcount** rather than
statements about anyone's habits:

- **H-02** was false for eight months and became true in August 2024, when D04 took the Tuesday-night
  slot D03 had been covering with a double shift.
- **H-07** went from 53% broken to 9% broken, **in August 2024** — the same month, and by the same
  cause, as H-02. *(Corrected 2 September 2026: this line previously said "8.1% to 1.9% across early
  2025, as the roster grew from eleven doctors to thirteen." The step is a year earlier and it is
  D04 entering the Friday rotation, not headcount growth in general. See the quarterly table above.)*

```bash
npm run seed:workforce
```

That reports joins, departures, headcount per month, and **spans of stable composition**. It derives
D04's join date — 21 March 2024 — from the assignments alone, matching what was read off the sheet by
eye.

**It also produces an uncomfortable finding about the verdicts in this document.** The original
15-month window (April 2025 – August 2026) contains **four** workforce changes; the full 33-month
window contains **ten**. Every verdict above is therefore an average across several compositions, and
nothing flagged it.

**So "re-verify when the workforce changes" is not a usable rule** — the workforce here changes roughly
every three months. The usable version:

> **A constraint verdict should state the span it was computed over, and say so when that span crosses
> a composition change.** The longest genuinely stable span in 33 months is eight months
> (May–December 2025).

This is the same argument as question **AA**: constraints may need a `validFrom` like people, weights
and memberships already have. Logged, not built — it is a design decision for the owner.

### ✅ The span rule is now a command — 3 September 2026

```bash
npm run seed:eras
```

Recomputes every evaluable constraint once per era of stable composition, and flags the ones whose
breach rate moved. **It reproduces the finding above from the data**, having been found by hand
twice and got wrong once:

| | occasion | verdict over 33 months | across eras |
|---|---|---|---|
| **H-02** | a doctor-day worked | 1% | ⚠️ **became true** — 5% before Aug 2024, none of the 2,190 since |
| **H-05** | a Saturday | 8% | ⚠️ **era-dependent**, spread 33 points |
| **H-06** | a Friday evening or night slot | 4% | stable, spread 13 points |
| **H-07** | a Pattern B day | 20% | ⚠️ **era-dependent**, spread 75 points |

H-06 is the negative control: a rule breached at a similar overall rate that does **not** move with
the workforce. Without one, "three of four are era-dependent" would just mean the test flags
everything.

⚠️ **Two lessons from building it, both about the denominator.**

**The occasion is the unit, not the assignment.** Counting assignments put ~4 shifts in the
denominator for every real chance to break H-07, diluting its era spread fourfold — the first
version reported it as *stable* at 19 points. On Pattern B **days** it is 75, and the underlying
figures are 53% before August 2024 and 9% after, matching this document exactly. H-05 was worse:
with D02's Saturday assignments as the denominator every occasion is a breach and the rate is a
constant 100%, which is not a measurement.

**A rule can turn on without moving far.** H-02 went from 5% to zero — a total collapse worth five
absolute points, which any spread threshold calls stable. `becameSatisfied` is the second test, and
without it the tool missed one of the three cases it was built for.

**It still decides nothing.** Whether an era-dependent constraint is dropped, softened or given a
validity interval remains the owner's call.

---

## Hard constraints

**"Hard" describes the *publishability* of the result, not the solver encoding.** Every constraint
below is **elasticised in the model** with a named slack variable and a large penalty, so the solver
always returns something and reports what it had to break. A model that answers "infeasible" is a
product failure: the principal needs *"you cannot cover the 16th unless one of these three people
works a night they asked off"*, not a diagnosis.

**Only H-01 and H-03 are genuinely structural.** H-04 to H-07 are retained with their IDs — they are
real tendencies, and the IDs are referenced in tests and messages — but their **mode is WARN and must
never be BLOCK.**

⚠️ **H-02 moved from HARD to WARN on 31 August 2026.** Asked whether "at most one shift per doctor per
day" was absolute, the principal answered: *"it should be absolute but it has happened, and so the app
should still allow for it if it happens."* It held across all 1,430 transcribed assignments, so the
counterexample is presumably in the older data now being recovered. This is consistent with the
standing rule that **only overlapping shifts are refused** — a morning and a night on the same date do
not overlap, so nothing at the database level changes.

**Confirmed verdicts on why H-04 to H-07 get broken** (question M, answered 31 August 2026):
H-04 **forced**, H-05 **mainly requested**, H-06 **requested**, H-07 **a real rule overridden when
short of doctors**. Penalty weights follow from these: forced and rule-overridden keep a high penalty,
requested a low one. Full record in [`../NEEDS_YOUR_INPUT.md`](../NEEDS_YOUR_INPUT.md).

### H-01 Exactly one doctor per shift slot `[CONFIRMED]`

`THE system SHALL assign exactly one doctor to each shift slot.`

There is no double cover anywhere in sixteen months of rosters, and coverage is continuous — the
practice has run 24/7 single cover for roughly a decade.

- Source: sixteen months of roster images; principal interview.
- Penalty tier: 10⁶ (coverage). Shortfall is a slack variable, never an infeasibility.
- Test: `solver/tests/test_hard.py::test_H01_single_cover`

### H-02 A doctor works at most one shift per day `[CONFIRMED]`

`THE system SHALL NOT assign a doctor more than one shift slot on the same date.`

- Source: principal interview — "the vast majority of the time a doctor works only one shift per
  day". Note *vast majority*: this is stated as the normal case, not an absolute. Modelled as
  hard for v1 because no counterexample appears in the data, but see
  [`../NEEDS_YOUR_INPUT.md`](../NEEDS_YOUR_INPUT.md) — the long-day Pattern C days are the place
  to check.
- Test: `solver/tests/test_hard.py::test_H02_one_shift_per_day`

### H-03 A doctor is only assignable while a member of the practice `[CONFIRMED]`

`IF a date falls outside a doctor's practice-membership validity interval, THEN THE system SHALL
NOT assign that doctor any shift slot on that date.`

Doctors join and leave, and when they do they inherit or shed *specific recurring slots* rather
than simply appearing or vanishing. D05 joined in June 2026 and took over two recurring afternoon
slots; D14 left in May 2026; D15 has not appeared since January 2026.

- This is enforced in the **database** as a temporal foreign key, not only in the solver — see
  [`../architecture/data-model.md`](../architecture/data-model.md). The most important invariants
  belong where they cannot be bypassed.
- **The only structural bar in the solver.** Everything else is elasticised so the model always
  returns something; here the assignment variable is simply not created, because a departed doctor
  on the roster is not the lesser of two evils. Coverage stays elastic, so a day nobody is a member
  for reports a shortfall rather than `INFEASIBLE`.
- Tests: `test_H03_departed_doctor_is_never_assigned`,
  `test_H03_partial_membership_allows_only_the_covered_days`,
  `test_H03_everyone_gone_reports_shortfall_rather_than_infeasible`

> ⚠️ **This was not enforced anywhere until 3 September 2026, and this entry said it was tested.**
> `availableFrom`/`availableUntil` crossed the wire and the parser validated them, then returned only
> the codes and discarded the dates. The line above named `test_H03_membership_interval`, **which
> had never been written** — so anyone checking whether H-03 was covered read a citation and
> believed it. `npm run docs:check` now fails on a `Test:` line naming a test that does not exist.

### H-04 Avoid back-to-back night shifts `[CONFIRMED as a rule he applies — FALSIFIED as an absolute]`

`IF a doctor works a night shift on day D, THEN THE system SHOULD NOT assign that doctor the night
shift on day D+1.`

**Four counterexamples in fifteen months** (`npm run seed:analyse`):

| Dates | Doctor |
|---|---|
| 6–7 April 2025 | D02 |
| 21–22 September 2025 | D02 |
| 22–23 March 2026 | D02 |
| 3–4 April 2026 | D13 |

- Source: principal interview — described as **an actual rule he applies**, not a byproduct of fixed
  commitments. That is probably still true *as an intention*; it is simply not an absolute.
- **Three of the four involve D02, who holds Monday night as a standing slot** — so the pattern is
  Sunday night followed by Monday night. Which falsifies something else, below.
- **Mode: WARN.** Rest rules must not block regardless: the practice's own accepted turnaround is
  8 hours, and BCEA almost certainly does not bind these doctors. See
  [`../ops/compliance.md`](../ops/compliance.md).
- Implementation: `add_soft_sequence_constraint` over the night-shift sequence, not a bespoke rule.
  See [Modelling note](#modelling-note-regular-expressions-not-a-rule-zoo).
- Test: `solver/tests/test_hard.py::test_H04_no_back_to_back_nights`

> **⚠️ This also falsifies the Sunday-night reasoning.** The brief argued that avoiding certain
> doctors on Sunday nights was *"H-04 expressing itself"* through whoever holds Monday commitments.
> Three of these four counterexamples are exactly that doctor working Sunday night **and** Monday
> night, back to back. So H-04 does not, in practice, keep the Monday-night anchor off Sunday nights.
>
> `solver/tests/test_domain_insights.py::test_sunday_night_exclusions_are_derived_not_listed` passes
> — but it verifies that **the model** behaves as designed, not that the design matches reality. That
> is a real limitation of that test and it is worth being explicit about: a green test told us
> nothing about the domain here. Only the data did.

### H-05 D02 is not assigned a Saturday shift `[CONFIRMED as a strong preference — NOT absolute]`

`THE system SHALL NOT assign D02 any shift slot falling on a Saturday.`

- **FOUR counterexamples across fifteen months**, found by `npm run seed:analyse`:
  16 August 2025 (afternoon) · 2 May 2026 (afternoon) · 27 June 2026 (**night**) · 22 August 2026
  (afternoon). The brief claimed zero in sixteen months. Roughly three a year is rare, and it is
  not "never".
- **Mode: WARN, never BLOCK.** Had this shipped as a block, the app would have refused a roster the
  principal actually built. This is the exact failure the warn-and-scar principle exists to prevent.
- Source: principal interview, and rare in practice — no other instance in the months checked.
- This is a **per-doctor standing rule**, and it must be stored as configurable data, not
  hard-coded. The principal has asked explicitly that almost everything be configurable, because
  "doctors move on in life and new ones join from time to time".
- Test: `solver/tests/test_hard.py::test_H05_saturday_standing_rule`

### H-06 Friday's last two shifts usually exclude D01–D04 `[FALSIFIED as an absolute]`

`THE system SHALL NOT assign D01, D02, D03 or D04 to the Friday 17:00–23:00 or Friday
23:00–07:00 shift slots.`

Friday's back half goes to pool doctors only. Friday's first two shifts (07:00–12:00 and
12:00–17:00) rotate among D03, D04 and D02.

- **FALSIFIED: four counterexamples, one for each supposedly excluded doctor** — 11 April 2025
  (D04, night) · 15 August 2025 (D02, evening) · 3 October 2025 (D01, evening) · 22 May 2026
  (D03, evening). That every one of the four appears is the strongest possible signal that this is
  a tendency rather than an exclusion list.
- ⚠️ **DEMOTED 1 September 2026, from the LEGAL tier to PREFERENCE.** This was modelling an effect as
  a cause. "Friday's back half excludes D01–D04" was encoded as a list of *banned* doctors priced at
  10⁵. **The anchors are not banned from Friday evening** — 17:00 is simply the first hour the pool
  exists, so the pattern is a consequence of who is *available*.
  [H-10](#h-10-a-doctor-is-not-assigned-a-shift-they-are-structurally-unable-to-work-confirmed) now
  models that cause directly, and H-06 is what is left over: a weak tendency.
- Two independent reasons the old weight was wrong. The principal confirmed H-06's breaches were
  **requested**, and a requested break should be nearly free. And 11 breaches appear across 33 months,
  so at 10⁵ the solver would have fought hard to reproduce a rule the practice does not hold.
- **Mode: WARN.** Never BLOCK.
- Source: principal interview. The *tendency* is real and strong — 11 breaches in roughly 130 Pattern
  B Fridays — it simply is not a rule.
- Note this constraint is **pattern-specific**: it refers to Pattern B shifts, which do not exist
  on a Friday that is a public holiday. See [`holidays.md`](holidays.md).
- Test: `solver/tests/test_hard.py::test_H06_friday_back_half_pool_only`

### H-07 D01 rarely works a Friday `[FALSIFIED as an absolute — a strong tendency only]`

`THE system SHOULD NOT assign D01 to any shift slot belonging to Pattern B.`

**Rewritten twice on 26 August 2026, and falsified both times. Worth reading as a case study.**

**Version 1** — *"D01 is never assigned any Friday shift"*, `[INFERRED]`, on zero counterexamples in
sixteen months. Falsified by **2 January 2026**, where D01 worked the 07:00–17:00 long day, in two
independent sheets.

**Version 2** — I rescoped it to Pattern B, reasoning that 2 January ran Pattern C so the four-shift
Friday split did not exist that day, and that H-06 was already written that way. That reasoning was
sound and the conclusion was still wrong.

**Version 3, from the data.** `npm run seed:analyse` finds **three counterexamples on genuine
Pattern B Fridays**, across three different shifts:

| Date | Shift |
|---|---|
| 3 October 2025 | `fri-evening` |
| 20 March 2026 | `fri-midday` |
| 24 April 2026 | `fri-early` |

Plus 2 January 2026 on a Pattern C Friday. **Four Friday shifts in fifteen months, on four different
shift types.** There is no scoping that rescues this as a rule.

**Two lessons, and the second is the more useful:**

1. A constraint whose real subject is the shift structure must be written against `patternId`, never
   `weekday`. That is still true and H-06 was right to do it.
2. **But rescoping a falsified constraint is not the same as verifying it.** I found one
   counterexample, inferred a tidier rule that explained it, and shipped that — without checking the
   tidier rule against the rest of the data. The script found three more in seconds. **Fit a
   hypothesis to a counterexample and you will usually succeed; that is not evidence.**

- **Mode: WARN, and arguably it should be a soft preference (S-nn) rather than an H-nn at all.**
  Retained as H-07 for now because the ID is referenced in tests and messages; renaming it is a
  separate change. Logged in [`../NEEDS_YOUR_INPUT.md`](../NEEDS_YOUR_INPUT.md).
- **Implementation: behind a feature flag, default OFF.** If it is a habit and we encode it as a
  rule, we silently remove the principal's own flexibility on his own roster. If it is a rule and
  we omit it, he sees it in the draft and tells us. **The second failure is cheap and visible;
  the first is expensive and invisible.** That asymmetry decides the default.
- **Write it against `patternId == 'B'` or the Pattern B shift IDs — never against `weekday == FRIDAY`.**
  A weekday-scoped version is wrong on holidays and on thin-staffing days, which is how this
  constraint came to be wrong in the first place.
- Test: `solver/tests/test_hard.py::test_H07_when_enabled_is_respected`, plus
  `test_H07_does_not_apply_when_friday_drops_pattern_b`

### H-08 A doctor is not assigned a shift they declared unavailable for `[CONFIRMED]`

`IF a doctor has declared UNAVAILABLE for a date, THEN THE system SHALL NOT assign that doctor
any shift slot on that date.`

- Hard, but **budgeted** — N declarations per doctor per period. Without a budget, declaring
  unavailability is free, people mark everything they would mildly rather avoid, and the model
  jams for reasons nobody can see. A documented failure mode, not a hypothetical.
- Leave is an **absence**, handled separately, and does not consume budget.
- Whether the diary's `NOT` list maps here or to **S-03** is the open question in
  [`preferences.md`](preferences.md). Ingested here for now with `sourceToken` recorded, so
  reclassifying is a migration over a labelled set rather than archaeology.
- Test: `solver/tests/test_hard.py::test_model_always_returns_a_solution`

### H-09 A doctor is assigned the shifts they committed to `[CONFIRMED]`

`IF a doctor has declared MUST for a date, THEN THE system SHALL assign that doctor a shift slot
on that date.`

- The mirror of H-08. Elasticised at the same tier: a MUST that cannot be honoured is reported,
  never refused.
- Test: `solver/tests/test_properties.py::test_every_violation_names_a_catalogued_constraint`

---

### H-10 A doctor is not assigned a shift they are structurally unable to work `[CONFIRMED]`

`IF a doctor cannot work shifts starting before a given hour on ordinary weekdays, THEN THE system
SHALL NOT assign that doctor any such shift slot.`

**Distinct from [H-08](#h-08-a-doctor-is-not-assigned-a-shift-they-declared-unavailable-for-confirmed),
and the distinction matters.** H-08 is a *declaration* — a doctor says they are unavailable on a date,
and it is budgeted because unpriced declarations inflate. H-10 is a *standing fact about where the
doctor is*: pool GPs are at their own practices until late afternoon. Nobody declares it, it does not
consume budget, and it does not vary by date.

- **Source:** the practice principal, asked what triggers the reduced 07:00–17:00 pattern —
  *"GPs can't work before 17:00 since they are working at other practices."*
- **Verified at 98.7%**: of 1,086 pool-doctor shifts across 33 months, only 14 start before 17:00 on
  an ordinary weekday. Reproduce with `npm run seed:availability`.
- **Public holidays are exempt, intrinsically.** On a holiday the GPs' own practices are closed, so
  they *are* available — 40 such daytime shifts across 33 months. That asymmetry is what confirmed
  the *mechanism* rather than merely the pattern, and it is built into the rule rather than left to
  the caller.
- **Two doctors carry a weekday exception**: D07 and D09 alternate a Monday 15:00–23:00 fortnightly.
  Modelled as data on the rule, not as a violation. Question **X** asks whether it is a standing
  arrangement.

**Mode: elasticised at the COVERAGE tier, and deliberately *above* a coverage shortfall** — weight 2
against the shortfall's 1.

The first version priced them equally, reasoning that a doctor at another practice and an empty slot
both leave nobody in the building. True, but they are not equally *bad*: **an empty slot is visible
and tells the principal he has a problem, while a phantom doctor produces a roster that looks complete
and is not.** Given the choice the model must leave the gap showing. Pinned by
`test_H10_leaves_the_gap_showing_rather_than_inventing_cover`.

Elasticised rather than hard so the model still always returns a solution rather than reporting
infeasible.

**H-06 was modelling this backwards.** *"Friday's back half excludes D01–D04"* was encoded as a list
of banned doctors at the LEGAL tier. The anchors are not banned from Friday evening — 17:00 is simply
the first hour the pool exists, so the pattern is a consequence of who is *available*, not a rule
about who is *forbidden*. With H-10 modelling the cause, H-06 is demoted to a weak preference: the
tendency is real, and the principal confirmed its breaches were **requested**.

- Availability is derived from history by
  [`lib/analytics/availability.ts`](../../lib/analytics/availability.ts), which reproduces the
  practice's own anchor/pool split from the assignments alone.
- Tests: `test_H10_structural_availability_is_respected`,
  `test_H10_leaves_the_gap_showing_rather_than_inventing_cover`,
  `test_H10_exempts_a_public_holiday`, and `test_H06_is_a_preference_not_a_ban` for the demotion.

### H-11 A doctor is not assigned a shift in a cell they cannot work `[CONFIRMED 2026-09-04]`

`IF a doctor has a standing exclusion for a day-class and shift-kind cell, THEN THE system SHALL NOT
assign that doctor a shift in that cell.`

Given by the practice principal on 4 September 2026, as a list. **Stored as data, never as code** —
these change when people's other commitments change, and six of them share a shape.

| Doctor | Cannot work |
|---|---|
| D04 | Two weekend shifts in the same weekend |
| D06 | Sunday night |
| D07 | Saturday morning |
| D08 | **Any night, weekday or weekend** — and Saturday morning |
| D09 | Saturday morning |
| D10 | Saturday morning |
| D11 | Saturday morning |
| D12 | Saturday morning |
| D13 | **Weekends only** — no weekday shift at all |

⚠️ **Six doctors share "no Saturday morning", and that is almost certainly one rule, not six.**
D07–D12 are the pool GPs, and a GP practice is open on a Saturday morning — which is the same
mechanism as [H-10](#h-10-a-doctor-is-not-assigned-a-shift-they-are-structurally-unable-to-work-confirmed),
where they cannot work a weekday before 17:00 because they are at their own practices. **Modelling
it as a class rule rather than six individual exclusions is the better design**, and it predicts the
right thing when a new pool doctor joins. Not yet done, because the principal gave it as a list and
turning his list into a theory is exactly the move that produced H-06's backwards model. Confirm the
mechanism before generalising: question 46.

**D04's rule is a different shape from the rest** — it constrains a *pair* of shifts across a weekend
rather than a cell, so it is a sequence constraint like H-04 rather than an availability one.

**Mode: elasticised, like H-10.** These are structural facts rather than declarations, but *"warn
and scar, never block"* still applies — and D02's Saturday exclusion (H-05) already has a documented
exception path, which is the precedent.

⚠️ **Record the exclusion, never the reason.** One of these is religiously motivated and the
principal knows which. A reason field would make this special personal information under POPIA s26 —
see [`../ops/compliance.md`](../ops/compliance.md). The cell is the constraint; the why stays with
him, as it always has.

### H-12 A doctor's monthly shift count stays within their agreed range `[CONFIRMED 2026-09-04]`

`WHERE a doctor has an agreed monthly maximum, THE system SHALL prefer not to exceed it; and THE
system SHALL prefer to assign every doctor at least the agreed minimum.`

| Doctor | Max per month | | Minimum, all doctors |
|---|---|---|---|
| D06 | 4 | | **2 shifts** |
| D08 | 4 | | |
| D11 | 5 | | |
| D12 | 4 | | |
| D13 | 4 | | |
| everyone else | none | | |

⚠️ **Explicitly NOT hard**, on the principal's own instruction: *"these numbers shouldn't be treated
as hard constraints though because if the practice is low on doctors for a month then some of the
doctors will need to work more."* **This is the clearest statement of "warn and scar, never block"
anyone has given about this product**, and it arrived unprompted. A system that refuses to exceed
D06's four shifts in a month where three doctors are away is a system he stops using in that month —
which is the month he needs it most.

Maxima include weekday shifts, not just weekend ones.

**Modelled at `Tier.CONTRACT`, four orders of magnitude below coverage**, so if the only way to
cover a slot is to exceed a ceiling, the slot gets covered and the breach gets reported. Floor and
ceiling carry equal weight — nothing he said ranks one above the other, and inventing an asymmetry
would quietly decide whether the model prefers overworking one doctor or under-using another.

⚠️ **The floor is the half that matters, and the September 2026 solve is the proof.** Built without
it, the solver gave **D03 and D08 zero shifts** while D04 got 19 — and reported `OPTIMAL`. S-01
starves whoever is over their cumulative fair share and nothing else stops it. With the floor, both
land on exactly 2, every ceiling holds, no H-12 violation is reported at all, and the objective moves
only 10,636 → 10,662. **A fairness objective with no floor under it does not produce a gentler
roster; it produces an absurd one.**

Building the ceilings without the floor would have been building the half that constrains and not
the half that protects.

Tests: `test_H12_gives_a_starved_doctor_their_floor` with
`test_H12_without_the_floor_the_same_instance_starves_that_doctor` as its control,
`test_H12_yields_to_coverage`, `test_H12_skips_a_doctor_who_is_not_a_member`,
`test_H12_is_absent_without_limits`, `test_H12_registers_a_floor_for_every_doctor`,
`test_H12_registers_a_ceiling_only_where_one_is_agreed`.

### H-13 A locked assignment is honoured exactly `[CONFIRMED by construction]`

`WHERE the scheduler has locked a doctor into a slot, THE system SHALL assign that doctor to that
slot.`

The admin pins a cell before solving — *"I have already told D13 they are on the 25th"* — and the
solver builds the rest of the month around it. Carried on the wire as `lockedAssignments` since the
first contract version, **validated and, until 6 September 2026, never consumed.**

⚠️ **This is the second structurally hard constraint, and the only soft-by-default rule in this
document that is deliberately not elastic.** *Warn and scar, never block* governs **the practice's
rules** — statements about how things usually go, every one of which has been falsified at least once.
A lock is not one of those. It is **the scheduler exercising the override the philosophy exists to
protect**, so there is nothing to warn about and nobody to warn: he did it on purpose, and a tool that
quietly moves a cell he pinned is a tool he cannot use to make a promise.

Enforced by fixing the assignment variable to 1 — the mirror of
[H-03](#h-03-a-doctor-is-only-assignable-while-a-member-of-the-practice-confirmed), which is enforced
by never creating it. There is no roster at any price in which a locked doctor is absent from their
slot.

**Being hard, it can make an instance unsatisfiable, so the two ways it could are refused at the wire
instead — where the error names the field, rather than in the model, where it would surface as an
`ERROR` status with nothing to point at:**

| Refused | Why |
|---|---|
| A lock on a doctor **not a member on that date** | H-03 removes the variable entirely, so there is nothing to fix to 1. H-03 wins, and silently dropping the lock would be the worst option available |
| **Two locks on one slot** | Single cover. The same rule, and the same parser, that already refuses two doctors in one `previousPublished` slot |

**Everything a lock collides with otherwise stays elastic and reported.** Two locks on one doctor in
one day breaches [H-02](#h-02-at-most-one-shift-per-doctor-per-day-confirmed-as-a-rule--falsified-as-an-absolute)
and is allowed, at a cost — the principal confirmed doubles happen and the app must permit them.
A lock that consumes the only doctor free for some other slot produces a **coverage shortfall there**,
priced at 10⁶ and reported, which is the honest outcome: the admin's instruction is kept and its
consequence is shown.

**No weight, no tier, no registry entry.** A constraint that cannot be violated has nothing to
report, and adding a slack variable that is provably always zero would put a permanent no-op in the
penalty registry and in every cost breakdown derived from it.

Tests: `test_H13_a_locked_assignment_is_kept`,
`test_H13_a_lock_survives_a_preference_against_it`,
`test_H13_a_lock_on_a_non_member_is_refused`, `test_H13_two_locks_on_one_slot_are_refused`,
`test_H13_a_lock_may_cause_a_shortfall_elsewhere`,
`test_H13_registers_no_penalty`.


## Soft constraints — penalised in the objective, never blocking

Penalty weights follow an order-of-magnitude hierarchy so that tiers cannot trade against each
other: **10⁶ coverage · 10⁴ legal/rest · 10² contract limits · 10⁰ preferences.** The weights
below are relative within their tier.

| ID | Description | Weight | Confidence |
|---|---|---|---|
| S-01 | Equalise **cumulative** burden across doctors, not this month's counts | 100 | `[CONFIRMED]` as a goal; the weight is `[ASSUMED]` |
| S-02 | Honour `PREFER` requests | 20 | `[CONFIRMED]` |
| S-03 | Penalise `PREFER_NOT` assignments | 30 | `[CONFIRMED]` |
| S-04 | Prefer at least 8h turnaround between consecutive shifts | 40 | `[CONFIRMED]` — **built 2026-09-06.** See *Explicitly NOT constraints*: 8h is ACCEPTABLE |
| S-05 | Prefer the anchor doctor in their own recurring slot | 60 | `[INFERRED]` |
| S-06 | Minimise churn against the previously published roster | 80 | `[ASSUMED]` |
| S-07 | ~~Avoid isolated single working days~~ | — | ❌ **FALSIFIED 2026-09-06 — do not build.** It is the pool doctors' normal working pattern |
| S-08 | Spread public-holiday burden across a **twelve-month** ledger | 100 | ✅ `[CONFIRMED]` as a goal — **built 2026-09-04** |
| S-09 | Hold each doctor near their historical **share** of a rotated slot | 50 | `[INFERRED]` — **built 2026-09-06** |

**S-01 is the feature that justifies the project.** Solving each month independently is
fair-looking and actually unfair: if a doctor took three of four Christmas-week nights last
December, a within-month-fair January is not fair. See [`fairness.md`](fairness.md).

### ⚠️ What S-01 turned out to measure, once it was built

Implemented 2 September 2026, and the first run said something the catalogue had not:

> **D01 is 55% above their fair share cumulatively. D02 is 44% over, D04 16%, D03 15%.**

The four anchor doctors, consistent with the 52.2% top-four concentration already recorded. **That is
S-01 working**, not failing — it is reporting a real, three-year-deep imbalance, per doctor, with a
number.

**It cannot repay the whole of it in one month, and should not try.** Against an unbounded ledger one
month is about 3% of the total, so moving a single shift changes a cumulative ratio by roughly a tenth
of a percentage point — the objective goes nearly flat and the solver chooses arbitrarily among
thousands of near-equal rosters. Sweeping the weights showed exactly that: weekend departure moved
between 0.49 and 0.67 **non-monotonically**.

**That is why the ledger is bounded.** `LEDGER_WINDOW_MONTHS = 3` — the owner's steer on question 43,
`[ASSUMED]` until the principal confirms it. Over three months a month is a quarter of the ledger and
the objective has real traction.

### ✅ With the window and the 1.3.0 contract, S-01 measurably works

`npm run seed:solver-departure`, August 2026, same days and same doctors:

| Over the three-month window | His roster | The solver's |
|---|---|---|
| Worst-loaded doctor | 2.684 | **2.684** — identical; this is carry-in, not a choice available this month |
| **Gini of load ratio** | 0.116 | **0.052** |

**Less than half the inequality.** An earlier run said the opposite, and that was a **measurement**
bug rather than a solver one: `revealed-opportunity` derives entitlement from the cells a doctor was
*observed* working, so scoring a candidate roster with it lets the candidate move its own denominator.
Both rosters are now scored on one entitlement fixed from shared history. **The tell was the number
moving the wrong way when the model got strictly better.**

The rate at which an inherited imbalance should be corrected remains question 43 — including the
possibility that the principal does not regard it as an imbalance at all.

**S-06 matters more than it looks.** A re-solve that returns a globally better but completely
different roster is a product failure — the principal has already told thirteen people what they
are working. Expose the churn weight as a *"how much can it rearrange?"* control rather than
burying it.

### Which tier each soft constraint is actually built at

The weights above are relative *within* a tier, and the implementation does not put them all in the
same one. Recorded here because the table alone does not say, and a weight of 80 means two very
different things at 10⁰ and at 10².

| ID | Tier in `model.py` | Note |
|---|---|---|
| **S-01** | `PREFERENCE` (10⁰) | **Implemented 2026-09-02.** Peak excess above fair share at ×10 per percentage point, plus a per-doctor excess at ×1 as the tie-breaker beneath it. See the note below — the weights matter far less than they look |
| S-02, S-03 | `PREFERENCE` (10⁰) | Doctors' own stated wishes |
| **S-06** | `PREFERENCE` (10⁰) | **Implemented 2026-09-02.** At `CONTRACT` it would outweigh a hundred `PREFER_NOT`s, so a re-solve would preserve the old roster while trampling the preferences that caused the re-solve. Within `PREFERENCE` it sits above S-03 as the table says it should |
| S-05 | `PREFERENCE` (10⁰) | ✅ **Demoted from `CONTRACT` on 2026-09-02.** It had been the only soft constraint above this tier, pricing one anchor miss at 6,000 against a 10% fairness gain at 100 — the reverse of this table's own ordering. **The demotion changed nothing measurable**, so it is a correctness alignment, not a fix |
| **S-08** | `PREFERENCE` (10⁰) | **Built 2026-09-04**, peak 10 + spread 1, matching S-01 rather than derived separately — a doctor should not learn that holiday fairness is worth less than ordinary fairness |
| **S-04** | `PREFERENCE` (10⁰) | **Built 2026-09-06**, weight 40. Narrowed by measurement to a night into the next day's first shift, which is every one of the 27 real cases. Fired **zero** times on September 2026, as 0.25/month predicts |
| ~~S-07~~ | — | ❌ **Falsified, not built.** See below |

### S-08 — the constraint the principal asked for by name

He volunteered it, unprompted, when asked whether he had anything to add:

> *"The fairness scale is very important to him and the practice, and the fact that all the public
> holidays throughout the year are shared by the doctors so that the same small handful of doctors
> don't cover the public holidays every year."*

⚠️ **He is describing something that already works, not reporting a problem.** Measured over
2024–2025:

| | Share of all shifts | Share of public holidays | Ratio |
|---|---|---|---|
| D01–D04, the anchors | 12–18% | 6–11% | **0.52–0.61** |
| D07, D08, D12, D13 | 2–5% | 5–9% | **1.8–2.6** |
| D09 | 2.4% | 7.4% | **3.08** |

**Public holidays run the opposite way round from ordinary work, deliberately**, and the top four
rotates year to year — 2024 was D01/D02/D11/D03, 2025 was D09/D07/D03/D02. **S-08 exists to stop the
solver undoing that.**

**And the solver does undo it.** Asked for a real month with S-08 absent, it put all three of the
holiday's slots on anchors; with S-08 on, two went to pool doctors. On December 2026 without the
constraint it gave **three of nine holiday slots to D01**, who historically takes a tenth of them.

**Why S-01 cannot do this job.** S-01 equalises *total* burden and has no opinion about its
*composition*: a doctor can sit at exactly 1.00 while carrying every holiday in the year. Worse,
[H-10](#h-10-a-doctor-is-not-assigned-a-shift-they-are-structurally-unable-to-work-confirmed) exempts
public holidays — a pool GP's own practice is closed — so on a holiday **everyone** is available and
nothing else in the objective prefers anyone. The slots get distributed arbitrarily.

**Twelve months, not three.** S-01's window is `LEDGER_WINDOW_MONTHS = 3` on the principal's
instruction. S-08 uses `HOLIDAY_LEDGER_WINDOW_MONTHS = 12`, because he said *"throughout the year"*
and there are only about **44 holiday slots in a year** — three months of them is roughly eleven
across thirteen doctors, which is not enough to be fair with. The two windows are separate functions
so they cannot be swapped by accident.

Carried on the wire as `holidayBurden` / `holidayEntitlement` in contract **1.4.0**. ⚠️ **Both or
neither** — a holiday burden over a denominator covering a different span is the dimensional error
that produced a wrong roster on 2 September, and the parser refuses it.

Tests: `test_S08_gives_the_holiday_to_whoever_has_had_fewest`,
`test_S08_is_absent_without_a_holiday_ledger`, `test_S08_is_absent_when_the_month_has_no_holiday`,
`test_S08_is_off_when_flagged_off`, `test_S08_registers_a_peak_and_a_per_doctor_term`,
`test_S08_skips_a_doctor_with_no_holiday_opportunity`.

**S-06's control is on/off, not a dial.** `mode: "OFF"` in the request turns churn off entirely. A
graduated version needs a bounded in-tier weight on the wire; see
[`../architecture/solver-contract.md`](../architecture/solver-contract.md) for why an unbounded
per-request weight is refused.

Tests: `test_S06_keeps_the_published_roster_when_nothing_forces_a_change` (run twice with different
published layouts, so the result cannot be luck), `test_S06_yields_to_a_stated_preference`,
`test_S06_costs_less_than_a_coverage_shortfall`, `test_S06_skips_a_doctor_who_has_left`.

### ❌ S-07 — falsified before it was built, 2026-09-06

*"Avoid isolated single working days"* — a doctor working day D with neither D−1 nor D+1 worked.
Tagged `[ASSUMED]`, weight 10, never built. **Measured before building it, and it is backwards.**

Across 33 months, the share of each doctor's working days that are isolated:

| | Isolated share |
|---|---|
| **D01, D02, D03, D04, D05** — the anchors | **9%, 11%, 18%, 20%, 24%** |
| **D06…D13** — the pool | **63%, 70%, 70%, 79%, 80%, 86%, 89%, 89%** |
| D14, D15, D16 — departed | 100%, 83%, 76% |
| **Overall** | **1,157 of 3,112 = 37% of all working days** |

**For a pool doctor, an isolated single day is not a defect. It is the arrangement.** They run their
own practices, come in for one shift, and go home — which is the same fact H-10 already models from
the other direction. Building S-07 would have attached a penalty to **every shift a pool GP works**,
about a third of the roster, and pushed the solver to bunch their shifts into runs the doctors
themselves have never worked.

It is an **anchor-shaped intuition applied to everyone**: true of D01 at 9%, false of D11 at 89%.
Anchors hold recurring weekday slots that naturally cluster, so their days come in runs; nothing
about that generalises.

**This is the tenth documented claim in this catalogue to be falsified by measurement**, and the
first to be caught *before* the code was written rather than after. ⚠️ **Do not re-add it.** If a
version of this intuition is ever worth having it is per-doctor and learned, not catalogued — which
is [ADR-0016](../architecture/decisions/0016-learn-weights-from-edits-not-rules.md)'s territory, and
even there the rule is that weights attach to constraints and never to people.

### S-09 — the 68% of the roster S-05 cannot see

S-05 pulls a doctor toward a slot only when they hold at least
[`ANCHOR_DOMINANCE`](../../lib/analytics/anchors.ts) = **2/3** of it. Measured over the six months
to September 2026, that describes **7 slots and 183 assignments. The other 18 slots — 393
assignments, 68% of the roster — carry no habit signal at all** and are filled on fairness
arithmetic alone.

They are not noise. They are **rotations**, and the practice runs them consistently:

| Slot | Held by | |
|---|---|---|
| Sat `std-morning` | D01 38% · D04 27% · D03 23% | the principal's own Saturday |
| Tue `std-night` | D04 65% | **misses the bar by 1.7 points** |
| Tue `std-afternoon` | D03 58% | |
| Mon `std-morning` | D03 56% | |

⚠️ **Do not fix this by lowering `ANCHOR_DOMINANCE`.** The threshold is right for what S-05 *is*:
that module's own docstring explains that a slot held 51/49 is a rotation, and calling it an anchor
would make the solver reproduce a coin-flip and every ordinary turn look like a departure. The
error is not the threshold, it is that **the model has only two states — sole holder, or nothing —
where the practice has three.**

**What went wrong without it.** September 2026 solved with D01 on **15 shifts, second busiest in the
practice, and not one of them a weekend.** Twelve of the fifteen were his three S-05 anchors. He was
not being starved of work: he was pinned to his anchors, that spent his load budget, and no term in
the objective had anything to say about Saturday morning. The owner caught it, having said his
father works Saturday mornings — and the *stated* version, *"every Saturday"*, is not what the
sheets record either. **Both the model and the sentence were wrong in the same place**, which is
why this is a share and not a recurring slot.

**The encoding is an interval, not a target.** For each doctor and each rotated slot, `share ×
occurrences in the month` gives a fractional target; the doctor is free anywhere in
`[floor, ceil]` and pays `S09_WEIGHT` per shift outside it. D01's Saturday morning is
`0.38 × 4 = 1.52 → [1, 2]` — one or two, free; zero or three, priced. That reproduces the observed
behaviour without pinning anyone to a date, and it degrades correctly: a 4% share over 4 occasions
is `0.16 → [0, 1]`, which constrains nothing.

**S-09 and S-05 partition the slots — they never both apply.** A slot with a dominant holder gets
S-05 and is excluded from S-09. Two terms pulling on one slot would double-price it, and the
weights are not calibrated for that.

⚠️ **`[INFERRED]`, behind a flag — and the flag defaults *on*, against the usual rule.** Same
exception as S-05, for the same reason: it is soft, at the bottom tier, outvotable by anything that
matters, and inert when no shares are sent. The usual default-off rule exists so an inferred rule
cannot quietly overrule reality; here the *absence* of the term is what overruled reality, and
shipping it off ships the September roster the owner rejected. Question 48 still asks the principal
whether the Saturday rotation is an arrangement or a tendency — a confirmed answer changes the tag,
not the switch.

Tests: `test_S09_pulls_a_doctor_toward_their_historical_share`,
`test_S09_allows_anything_inside_the_interval`,
`test_S09_is_absent_without_slot_shares`, `test_S09_is_off_when_flagged_off`,
`test_S09_ignores_a_share_too_small_to_bind`,
`test_S09_yields_to_coverage`.

---

## Candidate constraints found in the data, not yet stated by anyone

`npm run seed:analyse` flags strong skews that nobody mentioned. **Each is a question, not a
constraint** — passive learning from patterns like these over-fits badly, and the documented failure
mode is inferring *"cannot work Sunday nights"* from *"never did"*, which is wrong and invisible.

| Pattern | Detail | Status |
|---|---|---|
| **D03 almost never works nights** | 3 of 201 shifts (1.5%), against a roster average of 32% | `[UNKNOWN]` — striking enough to be a real standing arrangement. **Ask.** Not modelled |
| **D14 worked only nights, only Fri/Sat** | 16 of 16 shifts were nights; 15 Saturdays and one Friday (a public holiday) | Refines the brief's "only ever Saturday 23:00-07:00" — the exception is a holiday Friday. Doctor has departed, so this matters only for history |

Neither is modelled. Both are logged in [`../NEEDS_YOUR_INPUT.md`](../NEEDS_YOUR_INPUT.md).

## Explicitly NOT constraints

**This section matters as much as the rest.** Recording what is deliberately *not* a rule is what
stops it being helpfully re-added later by someone — human or agent — who assumes it was an
oversight.

### A doctor MAY work an afternoon shift followed by the next morning's shift `[CONFIRMED]`

That is an **8-hour turnaround**, and the principal states it happens regularly and is
acceptable: *"a doctor can work 3-11 one day and be working the 7-3 shift the very next day which
is only an 8 hour time period between the two shifts."*

**Any system that hard-blocks an 8-hour turnaround will be unusable.** This is S-04, a
preference, never a block.

✅ **Built 2026-09-06, and measurement narrowed it a long way.** Over 1,979 consecutive-shift pairs
in 33 months only **56** are under 8h, and **29 of those are two shifts on one day** — H-02's job,
not this one, and pricing them here would charge twice for one event. **All 27 genuine cases are the
same shape: a night into the next day's first shift.** There is no 1h–7h tail; the gap is 8h or it is
zero. The rate also collapsed by era — **3.00/month in Dec 2023, 1.58 in 2024, then 0.25 in both 2025
and 2026** — so on a current month this term should be silent, and it was: **zero S-04 violations on
September 2026.** If it ever fires often, something else has gone wrong.

Tests: `test_S04_prices_a_night_into_the_next_morning`,
`test_S04_leaves_an_eight_hour_turnaround_alone`,
`test_S04_does_not_double_charge_a_same_day_double`, `test_S04_yields_to_coverage`.

Two independent lines of reasoning land on the same answer, which is why this is stated so
firmly. The practice's own accepted minimum is 8 hours; and BCEA rest rules almost certainly do
not bind these doctors at all — they are independent contractors, not employees, and even if one
were held to be an employee the earnings threshold (R269,600.90 p.a. from 1 May 2026) disapplies
ss9–18 entirely. See [`../ops/compliance.md`](../ops/compliance.md).

### There is no fixed list of doctors banned from Sunday nights `[INFERRED]`

The principal originally described avoiding a specific set of five doctors on Sunday nights. That
is best understood as **H-04 expressing itself** through whoever happens to hold Monday
commitments — not as a standing list.

**Model the rule, derive the list.** Hard-coding the five names would break the moment a Monday
anchor slot changes hands, which is exactly what happened in June 2026.

### "Anchor" and "pool" are not roles `[CONFIRMED]`

There is no tier enum. An anchor is a doctor who holds one or more recurring slot assignments
with a validity interval; a pool doctor holds none. See
[`../product/glossary.md`](../product/glossary.md).

### Rest rules are not blocks by default `[CONFIRMED]`

Every rule has three modes — **OFF / WARN / BLOCK** — configurable per practice and per staff
category, **defaulting to WARN**, with a one-click override that logs actor, timestamp and
reason. The override log is the compliance artefact and the single most defensible feature if
anyone ever litigates fatigue.

The one place a hard BLOCK is genuinely defensible is an HPCSA Intern rule pack, which does not
apply to this practice.

### The practice does not close or reduce hours at any point in the year `[CONFIRMED]`

Not on public holidays, not over Christmas. Coverage is continuous. Do not model a closure.

---

## Preferences

The request diary is the input format. See [`preferences.md`](preferences.md) for the diary
decoding and the full taxonomy; the solver-relevant summary:

| Type | Semantics | Solver treatment |
|---|---|---|
| `UNAVAILABLE` | Cannot work | Hard, but **budgeted** — N per doctor per period |
| `PREFER_NOT` | Would rather not | S-03 |
| `PREFER` | Wants this | S-02 |
| `MUST` | Committed to working this | Hard |
| `TENTATIVE` | Modifier: conditional request | Reduced weight, flagged in UI |

**`UNAVAILABLE` is budgeted on purpose.** With no cost to declaring unavailability, people mark
everything they would mildly rather avoid as hard-unavailable and the model goes infeasible. This
is a documented failure mode, not a hypothetical. Leave is handled as an **absence**, not a
preference, and does not consume budget.

---

## Modelling note: regular expressions, not a rule zoo

Do not implement these as fifteen bespoke rules. Curtois & Qu's formulation collapses the
constraint zoo into one idea: **a regular expression over one doctor's roster line, with min and
max match counts.**

"No night followed by a morning", "at most 2 consecutive nights", "no isolated working day" and
"complete weekends" are all the same constraint *type*. One UI affordance, one solver encoding,
one test suite — instead of fifteen of each. This is the single best architectural idea in the
solver research and it should shape the model from the first line.

Lift these three helpers essentially verbatim from OR-Tools' `shift_scheduling_sat.py`:
`negated_bounded_span`, `add_soft_sequence_constraint`, `add_soft_sum_constraint`. They give you
*"night blocks of 2–3 are fine, 1 costs you, 4+ is illegal"* as a single reusable primitive.

**Do not start from the simpler `employee_scheduling` tutorial.** It makes coverage a hard
`AddExactlyOne`, which is the number-one cause of "no solution found" in production.

## Modelling note: the penalty registry

Build it from the first line of the model: `(constraint_name, entity_refs, slack_var, weight)`,
recorded as each constraint is added. Every explanation feature, the cost breakdown, the
counterfactual "what if" mode and the infeasibility narrative fall out of it for free.
Retrofitting it is painful. CP-SAT gives you nothing equivalent, so you build it.

## Modelling note: pre-flight arithmetic

Before invoking the solver at all, check: is total demand ≤ total available doctor-shifts? Is
per-day demand ≤ the number of doctors available that day? These catch most real infeasibilities
instantly and let the product say *"you need one more doctor available on 23 November"* instead
of *"no solution found"*.

## Testing note

The highest-value test in the project is a property, not an example:

> **For any generated set of doctors, shifts and availability, if the solver returns FEASIBLE then
> every hard constraint H-01…H-nn holds on the result.**

That one `fast-check` property is worth more than fifty hand-written tests, because you cannot
imagine the input that breaks it and the generator can — and it will shrink the counterexample to
a two-doctor, three-day case you can read.

Add metamorphic properties too: adding an unavailability can never *improve* the objective;
removing a doctor can never make an infeasible instance feasible.

**Do not snapshot generated rosters.** CP-SAT is not deterministic across versions, worker counts
or machines; a golden-file roster will pass locally and fail in CI. **Snapshot the model** — a
canonical serialisation of the constraints — which catches the regression you actually care about
("I broke the model builder") and is fully deterministic. Assert *properties* of solutions, never
their identity.

---

## Observed tendencies that are deliberately **not** constraints

Patterns strong enough to be worth writing down and **not** strong enough to model. Each is here
precisely so that a future session does not rediscover it and promote it to a rule.

### The weekend split between D01 and D02 `[CONFIRMED as informal, 2026-08-31]`

Across fifteen months:

| | Fridays | Saturdays | Sundays |
|---|---|---|---|
| **D01** | 4 | **30** | 6 |
| **D02** | 45 | 4 | **26** |
| D03 | 43 | 25 | 13 |
| D04 | 33 | 24 | 14 |

D01 has zero Sundays in nine of fifteen months; D02 has zero Saturdays in eleven of fifteen.

Asked whether this was deliberate, the project owner answered:

> *"I think they have an unwritten rule between the two of them but it's not a formal rule that gets
> enforced."*

**So it is not a constraint, and no ID is assigned to it.** An unwritten arrangement between two
colleagues is exactly the kind of thing that becomes a cage once a system enforces it. H-05 records
half of it as one doctor's preference, which is enough.

What the product should do instead: **let it show up in the analytics.** The Saturday and Sunday
columns already make the split visible, so if it stops being what they want, they will see it rather
than be prevented from changing it.

### H-07 is a far stronger tendency than three counterexamples suggested

Adding a Friday count on 31 August 2026 quantified it: **D01 worked 4 Fridays in 230 shifts — 1.7%**
— against D02's 45 in 252 (18%), D03's 43 and D04's 33.

That does not change the mode. H-07 stays **WARN**, because three counterexamples on genuine
Pattern B Fridays plus the 2 January long day are still four occasions when the app must not refuse a
roster he built. But the tendency is real, and 1.7% is a much better description of it than "usually".

> **⚠️ That 1.7% describes one era, not the practice.** On all 33 months there are **26**
> counterexamples, and D01 worked **53% of Pattern B Fridays before August 2024**. The figure above
> was computed over the fifteen months then available, all of them after the change. **A verdict must
> name the span it was computed over** — see the section of that name; this is the case that proves
> it. Full quarterly breakdown above.
