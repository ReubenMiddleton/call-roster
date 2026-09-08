# Solver prototype

**This is throwaway research code, not the product.** Its purpose is to discover which constraints
are mis-modelled, while the answers to most domain questions are still outstanding. The shipped
solver is deliberately **last** in the build order — see
[`../docs/product/vision.md`](../docs/product/vision.md).

It has already earned its keep: see *What this prototype found* below.

## Running it

There is no system Python on this machine (`python` is the Microsoft Store stub, no system `pip`).
Everything goes through the checkout-local `uv`, installed by `npm run setup:uv` from the repo root.

```bash
npm run solver:run
```

```bash
npm run solver:test
```

```bash
npm run solver:check
```

`solver:check` is lint + format-check + tests + the end-to-end boundary check, and is the gate for
anything under `solver/`.

### Solving a real request file

`npm run solver:run` solves the hand-written `september_2026()` fixture, so it proves the **model**
works and says nothing about the wire. To exercise the wire, point the CLI at a request file:

```bash
npm run seed:request
```

```bash
.tools/uv/uv.exe run --project solver call-roster-solver --request private/solve-request.json
```

`--json` switches to machine-readable output and `--time-budget <seconds>` bounds the solve. A
`ContractError` exits `1` with the offending JSON path and no traceback, because the caller is
usually a build step.

`npm run solver:e2e` is that path wired up as a check: TypeScript builds a request from
`fixtures/seed-data`, Python parses and solves it, and the result is asserted. It closes a gap
`contract:check` cannot — that one compares field *names*, and the shared fixture is hand-written, so
neither notices when the request `buildSolveRequest` actually emits stops parsing.

If `uv` reports *"Missing expected target directory for Python minor version link"*, pass an
explicit interpreter: `%APPDATA%\uv\python\cpython-3.12.13-windows-x86_64-none\python.exe`
(3.12.13, pip 26.1.2 — verified 26 August 2026).

## What it does

Models **one real month** — September 2026 — using only `[CONFIRMED]` constraints from
[`../docs/domain/constraints.md`](../docs/domain/constraints.md). 13 doctors, 30 days, 94 shift
slots, 1,222 assignment booleans, 928 penalty-registry entries.

Solves in about **0.2–0.5 seconds**, which lines up closely with the 0.446s a published CP-SAT
study reported for a near-identical problem. Performance is not a risk at this scale and never
will be.

## Layout

| File | Role |
|---|---|
| `helpers.py` | The three sequence primitives, lifted essentially verbatim from OR-Tools' `shift_scheduling_sat.py`. **Do not rewrite them** |
| `registry.py` | The penalty registry. Built before any constraint, because everything explainable derives from it |
| `instance.py` | Instance types and the September 2026 fixture, traceable line by line to the domain docs |
| `preflight.py` | Arithmetic feasibility, run **before** the solver. See below |
| `model.py` | The CP-SAT model builder and the solve wrapper |

## Design rules it demonstrates

- **Make almost nothing hard.** Every constraint carries a named slack variable and a penalty from
  the tier hierarchy — 10⁶ coverage, 10⁴ legal/rest, 10² contract, 10⁰ preference. The model
  **always** returns a solution and reports what it broke. There is no `INFEASIBLE` status.
- **`H-01` is elasticised, not `AddExactlyOne`.** That single choice is the number-one cause of
  "no solution found" in production, and it is what the simpler OR-Tools tutorial gets wrong.
- **`[INFERRED]` constraints are behind a flag, default off.** `H-07` is the live example, and
  `test_H07_is_off_by_default` exists specifically to stop someone "tidying up" that default.
- **The objective is built from the registry and nothing else**, so every violation is attributable
  to a catalogued ID, a doctor and a date, with a message a doctor can read.
- **The model is snapshotted; the roster never is.** CP-SAT is not deterministic across versions,
  worker counts or machines.

## What this prototype found

### 1. Pre-flight was missing, and the property test proved why

`test_feasible_implies_hard_constraints_hold` generated a **2-doctor, 3-day** instance. Three days
of Pattern A is 9 shift slots, but H-02 caps each doctor at one shift per day, so 2 doctors supply
at most 6 doctor-shifts. **Three slots were structurally uncoverable.**

The solver behaved correctly — it filled six slots and reported a coverage shortfall of three. But
that is a useless answer for a non-technical admin: it looks like the software failed. What he needs
is *"you cannot cover 1–3 January: 9 shifts need filling but only 2 doctors are available, which
covers at most 6."*

That is arithmetic, available in microseconds, needing no solver at all. `preflight.py` now does it,
and `tests/test_preflight.py` keeps the exact counterexample as a regression test.

**The general rule this establishes: if a solve fails for a reason pre-flight could have named, the
fix belongs in pre-flight.**

### 2. The Sunday-night exclusion list really is derived, not a rule

`test_sunday_night_exclusions_are_derived_not_listed` confirms the brief's `[INFERRED]` reading. The
principal described avoiding five specific doctors on Sunday nights; the brief argued that is not a
standing list but **H-04 expressing itself** through whoever holds Monday commitments.

The model reproduces the behaviour with no such list encoded. **Hard-coding those five names would
have been wrong**, and would have broken the moment a Monday anchor slot changed hands — which is
exactly what happened in June 2026.

### 3. The regex abstraction holds up

H-04 is implemented with `add_soft_sequence_constraint`, not bespoke logic — "at most one
consecutive night" is the same constraint *type* as "no isolated working day". No new machinery was
needed, which is the strongest available evidence that the abstraction is the right one.

## What it deliberately does not do

- **No fairness ledger.** It needs sixteen months of history, which is blocked on the roster images
  reaching `private/source-artifacts/`.
- **No lexicographic multi-phase solve.** Single-objective for now; the phases matter once the
  ledger is real.
- **No churn penalty.** There is no previously-published roster to diverge from yet.
- **No real preferences.** The diary photograph is not on disk. The stress test in
  `tests/test_domain_insights.py` uses **synthetic** preferences shaped like the diary's documented
  structure, and says so.

## Property-based testing: Hypothesis, not fast-check

The plan named `fast-check`. That is right for the TypeScript side, but the solver is Python, so its
property tests use Hypothesis — fast-check's direct equivalent. Driving the Python solver from a
JavaScript test runner to honour the letter of the plan would add a process boundary to the most
valuable test in the suite for no benefit. Recorded in
[`../docs/DECISIONS.md`](../docs/DECISIONS.md).

The properties, in rough order of value:

1. **FEASIBLE ⇒ every hard constraint holds**, and every elastic violation has a registry entry
   explaining it. A violation with no explanation is the real bug.
2. Every violation names a catalogued constraint and carries a doctor-readable message.
3. **Metamorphic:** adding an unavailability can never *reduce* the objective.
4. Coverage is never traded for preferences — the tier separation guarantees it.
5. Model construction is deterministic, even though solving is not.

## Data boundary

**Doctor codes only, `D01`…`D15`.** Never a real name, including in fixtures, docstrings and test
data. `npm run names:check` from the repo root covers `.py` files.
