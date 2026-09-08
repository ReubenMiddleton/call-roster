---
name: solver-debug
description: Diagnose a solver run that returned a poor roster, timed out, never started, or produced unexpected assignments. Use when investigating CP-SAT behaviour or an unexpected roster, or when the user types /solver-debug.
---

# Diagnose a solve

## First: there is no "infeasible"

The model is elasticised throughout — almost every constraint carries a named slack variable and a
penalty from the tier hierarchy — so the contract has no `INFEASIBLE` status. If you are looking at
one, that is a bug in the model, not a property of the instance.

`ERROR` means the solver itself failed: malformed request, contract version mismatch, or a crash. It
never means "no solution".

## Triage in this order

### 1. Did pre-flight run?

Is total demand ≤ total available doctor-shifts? Is per-day demand ≤ doctors available that day? These
catch most real infeasibilities instantly.

**If the solve failed for a reason pre-flight could have named, the fix belongs in pre-flight, not in
the solver.** That is the whole point of having it — the product should say *"you need one more doctor
available on 23 November"*, not produce a roster full of unexplained gaps.

### 2. Read the objective breakdown, not the roster

`objective.byTier` localises the problem immediately:

| Dominant tier | Means |
|---|---|
| `coverage` non-zero | Genuinely not enough available doctors. A pre-flight gap |
| `legal` non-zero | A rest or sequence constraint is fighting the coverage requirement |
| `contract` high | FTE targets or recurring-slot preferences are over-constrained |
| `preference` high | Often **normal**. Manual schedules satisfy 57–63% of preferences; optimisation reaches 66–73%. A high preference penalty is frequently the correct answer, not a bug |

### 3. Check which constraints were actually enabled

The single most common cause of a suddenly-bad roster: an `[INFERRED]` constraint switched from `OFF`
to `BLOCK`. `H-07` is the live example. Inspect `constraints[]` in the **request**, not the source
code — rules are data.

### 4. Check the unavailability budget is being enforced

Without it, declaring unavailability is free, people mark everything they would mildly rather avoid,
and the model jams for reasons nobody can see. This is a documented failure mode, not a hypothetical.

### 5. Only then read the CP-SAT log

Look for a large gap between best bound and best solution, and for when the first feasible solution
appeared. A late first solution usually means over-constrained rather than slow.

## Timeouts

`TIMED_OUT` **with a usable roster is normal and correct** — the budget expired and the incumbent was
returned. Report the objective alongside it so the quality is visible.

`TIMED_OUT` with a poor roster: raise `timeBudgetSeconds`, then go back to step 3. At roughly 1,600
booleans this problem solves in well under a second in published comparisons, so a genuine timeout
means the model is wrong, not that the budget is tight.

## A solve that never started

1. Is there a `solve_run` row at all? If not, the API never enqueued it.
2. `status = queued` with `claimed_at` null → the worker is not running. Scale-to-zero means a cold
   start; allow for it before assuming failure.
3. `status = running` with a stale `claimed_at` → the worker died mid-solve. The reaper for this is
   currently **untested** — see `docs/ops/runbook.md`.

## Non-determinism will mislead you

**CP-SAT is not deterministic across versions, `num_workers` settings or machines.** Two runs on
identical input can return different rosters of equal objective value. That is expected, and it is not
the bug you are looking for.

Consequence: never compare rosters between runs. Compare **objectives** and **violations**.

## What not to do

- **Do not weaken a hard constraint to make a solve pass.** Report the violation and let the principal
  decide. That is the design, not a limitation.
- Do not tune penalty weights to fix a coverage problem — coverage shortfall is a fact about
  availability, not about weights.
- Do not add a constraint to "help" the solver. See `/new-constraint`, and read the
  *Explicitly NOT constraints* section first.
