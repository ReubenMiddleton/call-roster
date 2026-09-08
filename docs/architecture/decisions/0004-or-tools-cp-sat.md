# ADR 0004: OR-Tools CP-SAT as the solver engine

- **Status:** accepted
- **Accepted:** 2026-08-31 by the project owner
- **Date:** 2026-08-26
- **Deciders:** project owner (pending — Track B4)

> In the context of **a monthly nurse-rostering problem of roughly 1,600 booleans**, facing **a
> crowded field of solvers with very different licensing and language stories**, we decided for
> **Google OR-Tools CP-SAT**, to achieve **sub-second solves under a permissive licence with no cost
> ceiling**, accepting **a Python dependency in an otherwise TypeScript project**.

## Context

This is the **Nurse Rostering Problem** — one of the most-studied problems in operations research.
Using its standard vocabulary (shift type, coverage requirement, roster line, hard and soft
constraint, penalty weight, cyclical versus acyclical) is worth doing deliberately, because it is
both the literature's vocabulary and the market's.

**NP-hardness is not the risk at this scale.** 13 doctors × 31 days × 3–4 shifts ≈ 1,600 booleans. A
published CP-SAT study on a near-identical problem — 10 nurses, one month, four shift types, rest and
consecutive-day rules — solved in **0.446 seconds**, against 109 seconds for a genetic algorithm that
*"does not consistently produce feasible solutions"*. This is a small problem wearing a frightening
name.

The real risks are elsewhere: licensing that bites when the product succeeds, an engine tied to a
language that cannot be deployed here, and a model that answers "infeasible" to a non-technical user.

## Decision

**Google OR-Tools CP-SAT.** Apache-2.0, no licence cost, mature Python bindings. It took **gold in
every category awarded at the MiniZinc Challenge 2025** — Fixed, Free and Parallel as CP-SAT, and
Local Search as the CP-SAT LS variant. (There were five categories; OPEN was not awarded, as no
portfolio solver entered. An earlier draft of this line said "all four categories", which was right
in substance and imprecise about how.) There is no serious argument for another engine in 2026 at
this problem's shape.

Four engineering rules that come with it and are not negotiable:

1. **Make almost nothing hard.** Elasticise every constraint with a named slack variable and an
   order-of-magnitude penalty hierarchy — 10⁶ coverage, 10⁴ legal/rest, 10² contract limits, 10⁰
   preferences. **The model must always return a solution.** Report violations, never "infeasible".
2. **Build the penalty registry on day one** — `(constraint_name, entity_refs, slack_var, weight)`
   recorded as the model is built. Every explanation, cost breakdown, counterfactual and
   infeasibility narrative derives from it. CP-SAT gives you nothing equivalent, so you build it, and
   retrofitting it is painful.
3. **Always re-solve with a churn penalty** against the previously published roster.
4. **Pre-flight arithmetic before invoking the solver at all** — is total demand ≤ total available
   doctor-shifts, is per-day demand ≤ doctors available that day.

Lift `negated_bounded_span`, `add_soft_sequence_constraint` and `add_soft_sum_constraint` essentially
verbatim from OR-Tools' `shift_scheduling_sat.py`. **Do not start from the simpler
`employee_scheduling` tutorial** — its hard `AddExactlyOne` coverage is the number-one cause of
"no solution found" in production.

Budget a 10–30 second wall clock and return the incumbent.

## Considered alternatives

| Option | Why rejected |
|---|---|
| **Timefold** (the OptaPlanner successor) | Java/Kotlin in practice — the Python bindings were **archived in October 2025**. Multithreaded solving is behind a commercial licence. Its explainable-score feature is genuinely good and is worth imitating via the penalty registry |

**Re-verified 3 September 2026**, after the owner brought an external recommendation naming Timefold
as "the gold standard" with Python support. Both rejection reasons still hold, and one is now
stronger:

- [`TimefoldAI/timefold-solver-python`](https://github.com/TimefoldAI/timefold-solver-python) is
  **archived read-only since 6 October 2025**, with no migration notice pointing anywhere.
- The [commercial-editions page](https://docs.timefold.ai/timefold-solver/latest/commercial-editions/commercial-editions)
  now puts **Score Analysis, the Recommendation API, constraint profiling, nearby selection,
  partitioned search and multithreaded solving** in Enterprise. So the explainability this ADR
  admired is **paywalled**, which turns "worth imitating via the penalty registry" from a nice-to-have
  into the reason the registry exists. Ours is Apache-2.0 and already drives every cost breakdown.
| **OptaPlanner** | End-of-life at Red Hat. Do not start new work on it |
| **Gurobi** | ~$15k/year, and would not beat CP-SAT on a model this logic-heavy anyway. Its `feasRelax` framing is worth copying conceptually — that is what rule 1 above is |
| **Hand-rolled metaheuristics** (genetic algorithm, simulated annealing) | 224× slower than CP-SAT at this scale in the published comparison, and crossover destroys feasibility in hard-constrained rostering. The study's GA did not reliably produce feasible solutions at all |
| **JS/TS-native solvers** — `highs-js`, `glpk.js`, `jsLPSolver`, `logic-solver` | None adequate. `jsLPSolver`'s own published benchmark is 656ms at 1,640 variables — this model's size *before* any soft constraints. Worth keeping one only for an in-browser pre-flight feasibility check |
| **An LLM generating the roster** | Measured 2% feasibility on hard nurse-rostering instances, 0.8% on crew assignment, and entity hallucination — which here means assigning a doctor who does not work at the practice. See ADR-0009's context and `docs/product/vision.md` |
| **A hand-written greedy assigner** | Tempting, and it would work for the anchor pattern. It cannot do cumulative fairness, cannot explain a trade-off, and cannot answer "what if". It would have to be thrown away |

## Consequences

**Good:**

- Apache-2.0, so no licensing exposure when selling to hospital groups.
- Fast enough that performance never becomes the binding constraint.
- The regular-expression constraint abstraction collapses the constraint zoo into one primitive with
  one encoding and one test suite.
- Best-in-class and actively maintained, so this is unlikely to need revisiting.

**Bad, or accepted as a cost:**

- **Python in a TypeScript project.** Forces a separate service and a cross-language contract — see
  [ADR-0005](0005-solver-as-python-service.md) and
  [`../solver-contract.md`](../solver-contract.md). The riskiest boundary in the system.
- **CP-SAT is not deterministic** across versions, `num_workers` settings or machines. So: never
  snapshot a generated roster — it will pass locally and fail in CI. **Snapshot the model instead**,
  and assert *properties* of solutions rather than their identity.
- The elasticised-everything discipline must hold from the first line. One hard constraint added
  carelessly reintroduces "no solution found", which is the failure mode this whole design avoids.

**Revisit when:** the model stops solving inside its time budget at a materially larger scale — say
several practices solved jointly, or coverage requirements beyond single cover. Neither is on the
roadmap.
