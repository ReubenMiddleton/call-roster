# ADR 0015: Cross-check fairness with envy, and do not blend a second measure into the objective

- **Status:** accepted
- **Date:** 2026-09-03
- **Deciders:** project owner, 7 September 2026

> In the context of **a fairness verdict whose denominator is fitted to one practice's own 33 months
> of history, and an owner's concern that this will overfit**, facing **the question of whether a
> second fairness scale should be mixed into the objective at partial weight**, we decided for
> **keeping the leximax objective and its `revealed-opportunity` denominator exactly as they are, and
> adding envy-freeness-up-to-one-shift as a reported cross-check that has no denominator at all**, to
> achieve **a second, independently-derived opinion on every roster without reintroducing the
> non-monotonicity ADR-0012 rejected**, accepting **that the cross-check diagnoses rather than
> prescribes, and that the deepest version of the overfitting concern cannot be settled by any
> analysis of roster sheets and needs declared availability instead.**

## Context

On 3 September 2026 the owner raised a concern and proposed a fix:

> *"Basing the entire fairness solver purely on what happened in my dad's practice might cause us to
> overfit at some point… look into other fairness scales that we might be able to use in conjunction
> with the solver we have already set up, we can even weight it to a smaller degree, like 30% or
> something."*

**The concern is correct and the proposed fix is aimed at the wrong component.** Separating the two
is most of this ADR.

### Where the history-fitting actually is

| Component | Fitted to this practice? |
|---|---|
| The leximax objective form | **No.** A principle from fair division; nothing about it was fitted |
| Burden weights | No — `[ASSUMED]`, question 35. A different risk: they are guesses, not fits |
| **The `revealed-opportunity` denominator** | **Yes. This is the whole exposure** |
| The departure reference band | Yes — but it is an indicator nothing optimises, so nothing overfits to it |

`revealed-opportunity` says a doctor's fair share is proportional to the burden of the slots they
have been *observed* working. ADR-0012 already names the hazard — *"revealed availability can only
understate"* — without quantifying it. The consequence is a feedback loop: a doctor who was
historically under-offered has a small denominator, so they look fully loaded on little work, so
the objective sees no reason to offer them more. **The measure ratifies the status quo by
construction.** This is the documented failure mode of using historical allocations as a fairness
baseline, and it is the concern the owner reached for.

### What was measured

`npm run seed:entitlement` walk-forwards over all 33 months: fit on everything before a window,
evaluate on the window. 27 one-month, 25 three-month and 16 twelve-month windows.

| | 1 month | 3 months | 12 months |
|---|---|---|---|
| Novelty — shifts in a cell that doctor had never worked | 3.1% | 3.6% | 7.6% |
| In-sample bias — load-ratio points | 2.11 | **0.83** | 0.58 |
| Worst-loaded doctor flipped between the two fittings | 12 of 27 | 5 of 25 | 3 of 16 |
| ρ against an equal split | 0.44 | 0.59 | 0.62 |
| ρ against active days | 0.64 | 0.57 | 0.58 |

Three findings, in order of how much they change the plan.

**1. The denominator generalises well. The overfitting-to-noise worry is not supported.** Novelty is
~3% a month and shows no trend over 27 months. A denominator fitted on the past predicts the
settled one to within 0.024–0.118 load-ratio points.

**2. A shrinkage blend — the owner's "30%" done in the right place — was swept and does not pay.**
Pulling the denominator toward an equal split by λ, against two targets:

| λ | vs settled (3mo) | vs revealed (3mo) |
|---|---|---|
| 0.0 | **0.053** | 0.218 |
| 0.1 | 0.136 | **0.212** |
| 0.3 | 0.215 | 0.273 |
| 1.0 | 0.399 | 0.396 |

Against the settled opportunity set λ=0 wins outright and error rises monotonically. Against the
sparse, noisy revealed set there is a genuine bias–variance trade-off — but it bottoms out at
**λ=0.1, not 0.3**, buys a 3% error reduction at three months, and vanishes entirely at twelve.
**That gain is far smaller than the uncertainty in the burden weights it multiplies**, which are
still `[ASSUMED]`. Tuning λ now would be fitting a parameter to a precision the inputs do not
support.

**3. The finding that matters: the choice of denominator is most of the fairness verdict, and it is
unfalsifiable.** ρ ≈ 0.6 against bases not fitted to this practice — the fitted denominator and the
unfitted ones substantially disagree about who is overloaded. That disagreement is *by design*:
ADR-0012 chose `revealed-opportunity` precisely because an equal split is wrong for a practice with
anchors and weekends-only doctors. But it means the number doing the work is the one nothing can
check. **And no walk-forward can check it**, because every target available is itself revealed
availability: if a doctor is never offered Tuesday nights, the past-fitted, settled and revealed
sets will all agree they were unavailable. The test validates *stability*, not *correctness*.

Research read: [Matl, Hartl and Vidal on workload equity](https://arxiv.org/abs/1605.08565), already
cited by ADR-0012; the [fair division survey for goods and chores](https://arxiv.org/pdf/2307.10985)
and [Aziz and Lu](https://arxiv.org/html/2511.04891v1) for EF1 existence and round-robin computation
for chores; [Caragiannis et al. on maximum Nash welfare](https://www.cs.toronto.edu/~nisarg/papers/mnw.ec16.pdf);
[ordered weighted averaging](https://en.wikipedia.org/wiki/Ordered_weighted_averaging) for the
utilitarian-to-maximin family; and [temporal fairness](https://arxiv.org/pdf/2408.13208), whose
"forgetting rate" is the concept `LEDGER_WINDOW_MONTHS` implements.

## Decision

**1. The objective does not change.** Leximax over load ratios, `revealed-opportunity` denominator,
λ = 0. No second measure is blended in at any weight.

**2. Envy-freeness up to one shift becomes a reported cross-check.** `lib/analytics/envy.ts`.
D07 envies D03 if D07 carried more burden and could have worked D03's shifts; EF1 forgives the gap
if removing D07's single heaviest shift closes it. **No denominator, no entitlement, no fitted
weights** — two burdens and a feasibility test.

**3. It reports, and is never optimised.** Same rule as the dispersion measures and for the same
reason: what the product shows must not be exactly what the objective minimises, or it grades its
own homework.

**4. `EntitlementOptions.cells` and `EnvyInputOptions.cells` are the seam.** Opportunity cells can be
fitted on history and applied to a period they did not come from. Required for scoring candidate
rosters on one fixed scale, and it is the shape declared availability will arrive in.

**5. Declared availability is promoted from a feature to the thing that makes the fairness claim
checkable.** It is the only exogenous signal that can break the entrenchment loop. Recorded as
question 44.

## Consequences

**Good.**

- **It produced a finding immediately, and an uncomfortable one. EF1 fails in all 68 windows**, with
  a median worst violation of 27 burden units in a single month — roughly eight Sundays — against a
  healthy median of 36 comparable pairs, so this is not an absence of evidence. The load ratio calls
  the practice moderately unequal after normalisation; envy says flatly that it is nowhere near
  fair. **The two disagree because the load ratio forgives inequality that availability explains and
  envy only forgives inequality that no feasible swap could fix.** Both are true, and the principal
  should see both.
- The owner's instinct is vindicated in substance while the specific mechanism is declined on
  evidence: the exposure is real, it is in the denominator, and it is now measured rather than
  argued about.
- Nothing about the solver changed, so no re-validation of S-01 was needed.

**Bad, and accepted.**

- **Envy diagnoses; it does not prescribe.** Containment runs envied ⊆ envious, because envy means
  "I would rather have your position". Fixing the gap needs the *reverse* containment, and at this
  practice the two rarely coincide — the anchors can hold the pool doctors' months, not the other
  way round. A 27-unit violation is **not** 27 units of movable work, and quoting it as though it
  were would misrepresent an availability problem as a scheduling failure.
- **Partial independence only.** The feasibility filter reads the same revealed cells the load ratio
  divides by. It is a filter on which comparisons are meaningful, never a divisor, so the
  self-referential failure of 2 September 2026 cannot recur — but "independent" would overstate it.
- **`isEf1` is meaningless without `comparablePairs`.** A practice with disjoint availability passes
  vacuously. Enforced by a test, not a comment.
- The real question — is `revealed-opportunity` *right* — remains open and stays open until declared
  availability exists.

## Considered alternatives

**Blend a dispersion measure into the objective at 30%.** Rejected on principle before it was
measured. Gini, Jain, CV, MAD and range are non-monotonic — each improves when the *least*-loaded
doctor is given more work. **30% of a non-monotonic term is still non-monotonic**; it only needs a
slightly larger perverse case to bite. ADR-0012's rejection is enforced by a property test.

**Blend a second entitlement basis at 30% (shrinkage).** The owner's idea, relocated to the
component that is actually fitted, and the strongest alternative here — it is monotone-safe, it is
directionally right for a denominator known to understate, and it is explainable. **Rejected on the
measurement, not the principle:** the optimum is λ≈0.1 on one criterion and 0 on the other, worth 3%
error at the horizon the product uses and nothing at all at twelve months. `shrinkToEqual` in the
measurement script is kept so the sweep can be re-run when the burden weights are confirmed.

**Maximum Nash welfare** (maximise the product of utilities). Genuinely attractive: scale-free,
satisfies the Pigou–Dalton transfer principle, guarantees EF1 with Pareto-optimality for goods, and
sits between utilitarian and egalitarian without a tuning parameter. Rejected for now on three
counts: the chore analogue is substantially harder than the goods case and EF1+PO for chores is an
open problem; a product of utilities is not expressible in CP-SAT without piecewise-linear
approximation of a logarithm, which is real work; and **it still needs a utility per doctor, which
means it still needs the denominator** — so it does not address the concern that prompted it.

**Expose an OWA inequality-aversion knob.** Worth recording that **this knob already exists and is
undocumented**: S-01 costs `10 × (worst ratio − 1)⁺ + 1 × Σ(ratio − 1)⁺`, which is an ordered
weighted average with weights (11, 1, 1, …, 1) — utilitarian at one extreme, leximax at the other,
and the ratio between `S01_PEAK_WEIGHT` and `S01_SPREAD_WEIGHT` is the dial. Generalising it to a
geometric weight vector is a clean future change and is the *correct* reading of "weight it to a
smaller degree". Deferred: it changes solver behaviour, and there is no confirmed answer yet on how
aggressively the practice wants imbalance corrected — question 43.

**Do nothing and note the concern.** Rejected. The concern was specific and testable, and the test
found something the fitted measure cannot see.
