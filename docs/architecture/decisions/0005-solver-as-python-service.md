# ADR 0005: The solver is a separate Python service behind a Postgres job queue

- **Status:** accepted
- **Accepted:** 2026-08-31 by the project owner
- **Date:** 2026-08-26
- **Deciders:** project owner (pending — Track B4)

> In the context of **a Python solver inside a TypeScript application**, facing **a workload that is
> idle 99% of the time and then pegs a CPU for up to 90 seconds**, we decided for **a separate
> scale-to-zero Python service claiming work from a Postgres queue**, to achieve **near-zero idle
> cost and a solve that can never block a request**, accepting **a cross-language contract that can
> drift silently**.

## Context

[ADR-0004](0004-or-tools-cp-sat.md) commits to OR-Tools CP-SAT, which means Python. Three properties
of the workload then determine the shape:

- **It is bursty in the extreme.** The roster is built around the 20th. For most of the month nothing
  solves at all; then a handful of solves each run for tens of seconds at full CPU.
- **It is long relative to a web request.** A 10–30 second budget with a hard ceiling around 90.
- **It needs progress reporting.** CP-SAT improves its incumbent solution over time, and a
  non-technical user staring at a spinner for 30 seconds assumes it has hung.

There is also an organisational reason. The solver is the *last* feature in the build order, on
purpose — you cannot model constraints nobody has stated. So the architecture must let the whole
application exist, and be useful, with no solver deployed at all.

## Decision

**A separate Python service (FastAPI + OR-Tools) on a scale-to-zero container host, claiming work
from a `solve_run` table in Postgres.**

The cycle is **submit → subscribe → result**, never a synchronous request:

1. The API runs the **pre-flight arithmetic check** first. If demand exceeds availability it returns
   the specific failing dates immediately and never enqueues.
2. Otherwise it inserts a `solve_run` row and returns `202 { solveRunId }`.
3. The worker claims the row with `SELECT ... FOR UPDATE SKIP LOCKED`.
4. CP-SAT runs with `max_time_in_seconds` set, and a solution callback writes the intermediate best
   objective back to the row.
5. The client subscribes to the row and renders real progress.

The request and response shapes are defined once in
[`../solver-contract.md`](../solver-contract.md), and **types are generated from it on both sides** —
Zod for TypeScript, Pydantic for Python. Neither side hand-writes them, and both **reject unknown
fields** rather than ignoring them.

**Postgres is the queue.** `FOR UPDATE SKIP LOCKED` is a correct, race-free work-claiming pattern,
and it is already there.

## Considered alternatives

| Option | Why rejected |
|---|---|
| **Solve synchronously inside an API request** | A 30-second request. Times out behind most proxies, gives no progress, and one solve blocks a worker. The user sees a spinner and assumes a hang |
| **Rewrite the solver in TypeScript** to keep one language | No adequate TS/CP solver exists at this shape — see ADR-0004. `jsLPSolver` benchmarks at 656ms for this model's variable count *before* soft constraints |
| **Run Python in-process via a bridge** (Pyodide, a child process, WASM) | Pyodide cannot run OR-Tools' native extension. A child process on the web host reintroduces the CPU-contention and scaling problems the separate service exists to avoid |
| **Redis / BullMQ** | Another stateful service to operate, for a queue Postgres already handles correctly at this volume. BullMQ is TypeScript-first and would not run the Python task anyway |
| **Inngest or Trigger.dev** | Both TypeScript-first, both would not execute the Python task natively, and both add a vendor to a system whose whole queue requirement is "a few rows a month" |
| **Serverless functions** (Lambda, Cloud Functions) | Execution-time limits sit uncomfortably close to the 90-second ceiling, cold starts are worse for a large native dependency, and OR-Tools makes for a heavy deployment package |
| **A persistent always-on solver instance** | Paying for a CPU that is idle 99% of the time, for a workload that is genuinely bursty. Scale-to-zero is the correct shape here |
| **A shared schema-less job payload** (`jsonb`, no contract) | This is the highest-risk boundary in the system precisely because neither side would fail to compile. An informal payload guarantees the drift |

## Consequences

**Good:**

- Idle cost near zero, which matters for a project with one design-partner practice.
- A solve can never block a web request or exhaust the web host's CPU.
- Real progress reporting comes free from the solution callback writing to the row.
- The solver can be deployed, redeployed or entirely absent without affecting the application. Since
  the solver ships last, that is not a hypothetical.
- The queue is transactional with the rest of the data. No dual-write problem between a queue and the
  database.

**Bad, or accepted as a cost:**

- **The cross-language contract is the riskiest interface in the system.** Two languages, and either
  side can drift without a compile error anywhere. Mitigated by one source of truth, generated types
  on both sides, a validated `contractVersion`, and rejecting unknown fields. A worker receiving a
  major version it does not know **fails with `ERROR`** rather than guessing — a solver quietly
  ignoring a constraint it did not understand is precisely the disaster this guards against.
- Two deployment targets, two dependency ecosystems, two CI paths.
- Cold starts add seconds to the first solve after idle. Acceptable: the user has just clicked
  "generate a draft" and expects to wait.
- A worker that dies mid-solve leaves a claimed row. Needs a reaper, and it is currently **untested**
  — see [`../../ops/runbook.md`](../../ops/runbook.md).

**Revisit when:** solve volume rises to the point where claim contention or queue latency is
measurable — realistically, many practices solving concurrently. At that point the queue is the thing
to reconsider, not the separate service.
