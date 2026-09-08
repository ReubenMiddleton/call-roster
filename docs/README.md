# Documentation index

**Start here.** One line per document saying what it covers and when to read it — five lines here
saves fifty file reads, which is the whole reason this file exists. These documents are the durable
source of truth; anything stated only in a chat session does not exist. Accepted design documents
state target behaviour even where nothing is built yet, and **roadmap concepts are never presented
as shipped features.**

## Read it when

| File | Read it when |
|---|---|
| [product/glossary.md](product/glossary.md) | **ALWAYS, before naming anything** |
| [domain/constraints.md](domain/constraints.md) | Touching the solver or any scheduling rule |
| [domain/shift-patterns.md](domain/shift-patterns.md) | Anything involving times, days or holidays |
| [architecture/solver-contract.md](architecture/solver-contract.md) | Changing anything that crosses the TypeScript ↔ Python boundary |
| [architecture/api.md](architecture/api.md) | Adding or changing a route handler under `app/api/` |
| [architecture/decisions/](architecture/decisions/) | Before proposing an architectural change |
| [ops/runbook.md](ops/runbook.md) | A solve failed, timed out, or a published roster is wrong |
| [NEEDS_YOUR_INPUT.md](NEEDS_YOUR_INPUT.md) | Before guessing at anything about the domain |
| [domain/workforce.md](domain/workforce.md) | Before reasoning about availability, tiers or capacity |
| [ops/diagnostics.md](ops/diagnostics.md) | Before adding **any** logging, telemetry or error capture |
| [history/](history/) | **Almost never.** Archived session log, superseded by `DECISIONS.md` |

---

## Product

- [Vision](product/vision.md) — the problem, the users, the principles, the non-goals, the
  month-by-month rollout. Read this first if you are new to the project.
- [Requirements](product/prd.md) — capabilities in build order with EARS acceptance criteria, and
  the explicit out-of-scope list.
- [**Glossary**](product/glossary.md) — the ubiquitous language. Pins "on call", "shift", "roster"
  and "weekend". **If you need a domain term that is not here, stop and ask — do not invent one.**
- [**Export**](product/export.md) — the printable grid: the five-row rule, wrapping, spill days,
  and why a sixth row is the difference between a usable export and Word. **The artifact of record.**
- [Lifecycle](product/lifecycle.md) — draft by the 20th, review window, final before month end. The
  principal's own proposal, with the seven failure modes it has to be designed against. **Read before
  touching the publish flow.**
- [Analytics](product/analytics.md) — the metric catalogue, which single number is a fairness
  verdict and which are only indicators, and what is deliberately not measured. Read before
  building any chart.

## Domain

- [**Workforce and seasonal capacity**](domain/workforce.md) — why the roster looks the way it does:
  most doctors have a primary practice elsewhere and cover weekends here. **Explains more of the
  observed data than any other single fact**, including the anchor/pool split and the year-end
  capacity collapse.
- [**Constraints**](domain/constraints.md) — the `H-nn` / `S-nn` catalogue. Simultaneously the
  requirements spec, the test plan and the solver specification. Includes the
  *Explicitly NOT constraints* section, which matters as much as the rest.
- [Shift patterns](domain/shift-patterns.md) — the three patterns, and why a day's structure is a
  property of the **date**, not the weekday.
- [Preferences and the request diary](domain/preferences.md) — what the raw input actually looks
  like, what `NOT` means, and the preference taxonomy.
- [Public holidays](domain/holidays.md) — the statutory rules, Easter computus, ad hoc declarations,
  and per-person substitution.
- [Fairness](domain/fairness.md) — burden weights, the cross-month ledger, and the objective
  formulation. **The feature that justifies the project.**
- [Commands and events](domain/commands-events.md) — every command, event and policy, plus the
  roster lifecycle and the bounded contexts.
- [**Source-artifact findings**](domain/source-artifact-findings.md) — what the roster images and
  diary actually show versus what the brief summarised. **Read before trusting a `[CONFIRMED]` tag**:
  two were wrong and one structural assumption about the export does not match the artifact.
- [**Worked examples**](domain/worked-examples.md) — three real months reasoned through by hand.
  **Read before building the solver or the seeding importer.** It falsified H-07, found a new
  fairness requirement, found two sheets disagreeing about the same date, and found an error in the
  historical data.

## Architecture

- [Overview](architecture/overview.md) — C4 Level 1 and 2 as Mermaid flowcharts, quality goals in
  priority order, and the solution strategy.
- [Data model](architecture/data-model.md) — entity relationships, the temporal model, the audit
  log, and the invariants that live in the database rather than in code.
- [**Solver contract**](architecture/solver-contract.md) — the request/response schemas and
  semantics for the TypeScript ↔ Python boundary. **The highest-risk interface in the system**, and
  the only one that can break with no compile error anywhere.
- [**JSON API**](architecture/api.md) — the route handler conventions, the endpoint list, the
  temporary pre-auth tenant header, and the two verification gates (`db:check`, `api:check`).

### Decisions

- [**Architecture decision records**](architecture/decisions/README.md) — all seventeen, with a
  *read-before-you-propose* table. **0001–0012 accepted 31 August 2026; 0013–0017 are `proposed`.**
  ADRs exist so a rejected option is not re-proposed every session; four of them are there
  specifically to stop that — the solver engine, the framework, the fairness metric, and
  **no session replay, ever.**

## Operations

- [Environments](ops/environments.md) — local setup, the toolchain, the Python situation, and the
  hosting findings. Postgres host is decided: Supabase, nearest region — see
  [`supabase-setup.md`](ops/supabase-setup.md) for the concrete steps.
- [**Supabase setup**](ops/supabase-setup.md) — Track B7's one owner-only step: creating the two
  projects, then `npm run db:prod:migrate && npm run db:prod:verify`. Region, the free-tier
  pause facts, **which of the three connection strings to copy and why it is not the direct one**,
  and what `verify` checks that no local gate structurally can.
- [Compliance](ops/compliance.md) — POPIA, BCEA, ECTA, data residency, and the four findings that
  change what gets built.
- [Testing strategy](ops/testing-strategy.md) — the four tiers, what each catches and what it
  **cannot**, and what runs where. Read before adding a test layer.
- [Diagnostics](ops/diagnostics.md) — six layers, what is deliberately **not** collected, and why the
  intent stream beats a stack trace. **Read before adding logging, telemetry or error capture.**
- [Tester programme](ops/tester-programme.md) — the dev/prod split, and testing with people who are
  not the users. **The tester environment holds synthetic data only** — a POPIA rule, not a
  convenience — and the case against building a testing product for two testers.
- [Runbook](ops/runbook.md) — what to do when a solve fails or a published roster is wrong.
  Forward-looking; untested procedures are marked as such.

## History

- [Session log, Aug–Sep 2026](history/2026-08-09-session-log.md) — closed archive. **Do not read it
  and do not add to it**; every entry duplicates a [`DECISIONS.md`](DECISIONS.md) entry.

## Tooling

- [Graphify](GRAPHIFY.md) — the local code knowledge graph: source verification, the privacy and cost
  boundary, what is committed, the refresh policy. **Read the source-verification section before
  installing or bumping it** — there is a known impostor domain and namesquatting on PyPI.

## Running logs

- [Decisions journal](DECISIONS.md) — a dated narrative of decisions and hurdles as they happen,
  **including the things that turned out to be wrong.** The ADRs are formal and one per decision;
  this is the log.
- [Needs your input](NEEDS_YOUR_INPUT.md) — things genuinely blocked on the owner or the practice
  principal, each with enough context to resume instantly.

---

## Conventions

**Confidence tags.** Every domain statement carries one, and they are the project's risk register:

| Tag | Meaning |
|---|---|
| `[CONFIRMED]` | Stated directly by the practice principal, or verified across multiple independent roster months |
| `[INFERRED]` | Derived from the roster images. Consistent with the data, not confirmed by a human |
| `[ASSUMED]` | A reasonable guess. **Must be confirmed before it becomes code** |
| `[UNKNOWN]` | Explicitly not established. **Do not fill in by guessing** |

**Never promote a tag without a human source.** An `[ASSUMED]` hard constraint that turns out to be
wrong is the single most likely way this project produces a roster the principal rejects.

`[NEEDS CLARIFICATION: ...]` is a greppable marker for "I made this up, confirm it". `npm run
docs:check` counts them without failing.

**Stable IDs.** `H-04`, `S-06`, `ADR-0007`. Greppable, self-documenting, and they survive refactors.
`docs:check` fails on a constraint ID with no definition or an ADR reference with no file.

**Diagrams: Mermaid only.** `flowchart` for C4 Levels 1 and 2 — **never `C4Context`**, which has been
experimental for years and renders poorly. `erDiagram` for the data model, `sequenceDiagram` for the
solve cycle, `stateDiagram-v2` for the lifecycle. **Never draw C4 Level 3** — component diagrams go
stale within a week and the code is the better source.

**Maintenance rule.** When a change affects a documented contract, update that document **in the same
change**. Add an ADR for anything expensive to reverse. Documentation is part of the feature, not
cleanup after it.

## Provenance

Everything here was decomposed from a single ~12,000-word project brief, prepared 26 August 2026 from
sixteen months of the practice's real rosters, a photograph of the request diary, an interview with
the practice principal, and six commissioned research streams.

**That brief stays in the gitignored `private/` directory** and is not archived into `docs/`, because
it names thirteen real doctors throughout. The six research reports stay in `private/research/` for
the same reason. See [ops/compliance.md](ops/compliance.md) for the data boundary and
[DECISIONS.md](DECISIONS.md) for why this overrides the brief's own instruction to archive itself
here.
