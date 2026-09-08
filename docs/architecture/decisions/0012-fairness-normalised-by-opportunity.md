# ADR 0012: Normalise fairness by burden of opportunity, and optimise leximax not dispersion

- **Status:** accepted
- **Accepted:** 2026-08-31 by the project owner
- **Date:** 2026-08-31
- **Deciders:** project owner

> In the context of **thirteen doctors whose availability differs so much that raw shift counts are
> meaningless — anchors on standing weekday slots, pool doctors who work weekends around a job at
> another practice, and one doctor who has worked three nights in 201 shifts**, facing **the need
> for a single fairness figure that neither punishes a weekends-only doctor for expensive shifts nor
> lets an under-committed one hide behind cheap ones**, we decided for **a dimensionless load ratio
> whose denominator is the burden of the slots each doctor could actually have worked, optimised by
> leximax rather than by any dispersion measure**, to achieve **a number that survives the objection
> "but she only works weekends" and cannot be improved by loading up whoever is doing least**,
> accepting **that the denominator is `[INFERRED]` from observed history until the product captures
> real availability, and that the burden weights it multiplies are still `[ASSUMED]`**.

## Context

Two requests from the practice owner on 31 August 2026 turn out to be one problem.

The first was analytics: *"an extremely comprehensive analytics section."* The second was the
constraint that makes it hard:

> *"We just need to come up with a way to normalize the data for the doctors that only work weekends
> or only work weekdays or only work at my dad's practice sometimes, because obviously they have
> other work they are also doing and that shouldn't force them to work more at my dad's practice
> just because the analytics says they are slacking."*

The data confirms the concern is real rather than hypothetical. Across fifteen transcribed months:
burden per doctor spans 417.0 down to 41.5; night share spans 100% to 1%; one doctor worked only
Saturday and Friday nights; two departed mid-window.

**The failure mode is worse than the one he named.** He described a lightly-committed doctor being
pushed to work more. The mirror image is more damaging: a weekends-only doctor works nothing but
high-burden shifts, so *any* per-head or per-FTE divisor makes them look chronically overloaded, a
fairness objective responds by taking weekends away, and weekends are all they can work. The system
concludes "give this person less work" about someone who may want more. Burden-weighting and
availability-normalisation interact, and fixing either alone is not enough.

A separate question surfaced the same day. Asked whether the fifteen constraint counterexamples were
deliberate or forced, the owner answered that **most were doctors asking to work more**, with the
December 2025 cases forced by absence. That means the same shift carries two different meanings, and
neither the assignment nor the roster sheet records which.

Research read for this decision: Matl, Hartl and Vidal, *Workload Equity in Vehicle Routing
Problems: A Survey and Analysis* ([arXiv:1605.08565](https://arxiv.org/abs/1605.08565)); the
equality-versus-equity framing in Turhan and Bilgen's nurse-rostering fatigue work
([PMC10011308](https://pmc.ncbi.nlm.nih.gov/articles/PMC10011308/)), which asks directly whether an
equal count of night shifts is fairness or merely a proxy for equity in fatigue.

**"Normalise by opportunity" is not a named approach in the literature.** Searching for it returns
FTE-proportional contract models and fair-share CPU schedulers, neither of which prices the
*composition* of the opportunity. This is therefore a design, not an adoption, and is recorded as
one.

## Decision

**1. Load ratio is the fairness verdict.**

```
expected_i   =  totalBurden × weight_i / Σ weight_j
loadRatio_i  =  carried_i / expected_i
```

Dimensionless, so comparable across doctors and across periods of different length. 1.00 is exactly
fair.

**2. The default entitlement weight is the burden of the doctor's opportunity set**, scoped to their
membership window. A weekend-heavy numerator over a weekend-heavy denominator cancels exactly. Three
other bases (`equal`, `active-days`, `explicit`) are implemented and selectable, because the choice
is a domain question and hard-coding one answer would hide it.

**3. Leximax is the objective. No dispersion measure ever is.** Gini, Jain, coefficient of
variation, mean absolute deviation, standard deviation and range are all non-monotonic: each can be
improved by giving the least-loaded doctor more work. They are reported as indicators.

**4. Provenance is recorded on every assignment**, and `requested` burden is excluded from
equalisation while `absorbed` is included in full.

**5. Every report carries machine-generated caveats** naming its own `[ASSUMED]` and `[INFERRED]`
inputs, and a low-sample guard suppresses ratios from doctors observed too little to support one.

**6. Joiners and leavers are excluded from the current headline, never from their own row.**
Membership is inferred from a 90-day trailing gap, and a doctor present for under half the reporting
period is low-sample regardless of how many shifts they worked. Added 31 August 2026 on the owner’s
requirement that *"doctors that have left"* must not *"skew the analytics or fairness scale"* — see
Consequences.

## Consequences

**Good.**

- The weekends-only failure mode is provably gone. In a synthetic period where five doctors with
  mutually exclusive availability each work every slot open to them, `revealed-opportunity` returns
  a ratio of exactly 1.00 for all five and a Gini of 0.00 — the only defensible answer, and one the
  `equal` and `active-days` bases both get wrong.
- The engine is one implementation shared by the solver objective, the ledger and the export footer.
- It produced a finding immediately: **half the practice's apparent inequality is explained by
  availability and half is not.** Gini falls from 0.341 on raw burden to 0.186 on load ratio, and
  the four anchors still sit at 1.34–1.49. That is a claim the practice can act on, and neither the
  naive nor the cynical reading of the raw data supports it.
- `requested` burden being free removes a perverse incentive that would otherwise have shipped
  invisibly.

**Bad, and accepted.**

- **The denominator is inferred.** Revealed availability can only understate: a doctor willing to
  work Tuesday nights who was never offered one looks unavailable and therefore over-loaded. It also
  over-generalises — one Sunday night ever worked implies availability for all of them.
- **The weights it multiplies are `[ASSUMED]`.** Load ratio inherits every uncertainty in the burden
  schedule. Both are surfaced as caveats rather than resolved.
- **Provenance cannot be backfilled.** All 1,430 historical assignments are `unknown`, so the
  provenance split is inert until the product starts capturing it.
- **Leximax needs a multi-phase CP-SAT solve** rather than one weighted objective. At n=13 that is a
  few seconds, so the cost is real but small.
- **Membership is inferred, and inference is all there is.** A roster records who worked, never who
  left. The 90-day threshold reproduces the two departures already known from `private/`, which is
  the only validation available and is not proof that 90 is right for another practice.

**Confirmed after acceptance.** The owner confirmed `directed` / `requested` / `absorbed` as the
vocabulary on 31 August 2026, so those terms are no longer `[PROPOSED]`. He also confirmed that
**no doctor at this practice works there full time, the principal included** — every one of them also
works elsewhere. That removes any full-time baseline from which an FTE could be derived, and makes
the opportunity-based denominator the only one with a defensible definition rather than merely the
best of four.

## Considered alternatives

**Raw shift count.** Rejected: it prices a Sunday night the same as a Tuesday morning. The
transcribed history makes the absurdity concrete — one doctor carries more burden off 36 shifts than
another does off 60.

**Burden with no normalisation.** Rejected: it is the raw signal, and it is reported. As a verdict it
says the Sunday-only doctor is the hardest-working person in the practice, which is not a claim about
fairness.

**Burden ÷ FTE.** This was the previous recommendation in `fairness.md` and it is **the trap, not the
fix.** FTE captures how *much* a doctor works and says nothing about the *mix*, so it leaves the
weekends-only doctor looking overloaded by construction. Retained as the `explicit` basis for when a
contracted FTE actually exists, but not as the default.

**Burden ÷ active days.** Rejected as a default: corrects for joiners and leavers only. Kept as a
basis because it is the right minimum bar and needs no availability data at all.

**Minimise Gini or mean absolute deviation.** Rejected on the monotonicity finding, and the rejection
is enforced by a property test rather than a comment. Both remain as reported indicators.

**Plain min-max.** Rejected as insufficient rather than wrong: it is monotonic, but indifferent
between any two solutions sharing a maximum, so gross unfairness among everyone who is not the single
worst-off person is invisible to it. Leximax is the same idea carried through.

**Ask the practice for real availability first and build nothing until it arrives.** Rejected: it
stalls on a Track C answer, which AGENTS.md forbids. The interface is the seam — `revealed-opportunity`
is one basis among four, and real availability becomes a fifth without touching anything downstream.

**Merge `requested` into ordinary burden and handle the cases by hand.** Rejected: the whole point of
the ledger is that a paper diary cannot remember. "Handled by hand" means remembered by the principal,
which is the problem the product exists to solve.
