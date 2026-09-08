# Architecture decision records

Formal ADRs for hard-to-reverse choices. MADR-minimal, Y-statement first line, and a mandatory
**Considered alternatives** section — that section is the point, because without it a rejected
option gets re-proposed every session forever.

**ADRs 0001–0012 were accepted by the project owner on 31 August 2026.** 0013–0017 are `proposed`;
a new ADR starts that way, because recording one as accepted before he has read it would
misrepresent its status. Signing them off is question 37 in
[`../../NEEDS_YOUR_INPUT.md`](../../NEEDS_YOUR_INPUT.md).

Split out of [`../../README.md`](../../README.md) on 7 September 2026: the ADR list is the one
section that grows without bound, and it had pushed the index past its 200-line ceiling.
`check-docs.mjs` follows a nested `README.md`, so a document listed here counts as indexed.

## Read before you propose

Four of these exist specifically to stop a rejected option coming back:

| Before proposing | Read |
|---|---|
| A different solver, or a commercial scheduler UI | [0004](0004-or-tools-cp-sat.md), [0006](0006-custom-css-grid.md) |
| A different framework | [0014](0014-next-js-react-not-angular.md) — Angular, Remix, SvelteKit and native are all recorded with why |
| Any change to a fairness metric | [0012](0012-fairness-normalised-by-opportunity.md), then [0015](0015-envy-as-a-fairness-cross-check.md) |
| Any logging, telemetry or error capture | [0013](0013-first-party-diagnostics.md) — **no session replay, ever** |
| Uniform test coverage | [0011](0011-tiered-testing.md) |

## All records

- [Template](template.md) — copy this, or use the `/adr` skill.
- [0001](0001-record-adrs.md) — record decisions as MADR-minimal ADRs.
- [0002](0002-public-repo-actions-permitted.md) — public repo on the personal account, GitHub
  Actions permitted.
- [0003](0003-graphify-deferred.md) — defer Graphify until the codebase justifies it.
- [0004](0004-or-tools-cp-sat.md) — OR-Tools CP-SAT as the solver engine.
- [0005](0005-solver-as-python-service.md) — the solver is a separate Python service behind a
  Postgres queue.
- [0006](0006-custom-css-grid.md) — a custom CSS Grid, not a commercial scheduler component.
- [0007](0007-shared-schema-rls.md) — shared-schema multi-tenancy with row-level security.
- [0008](0008-temporal-validity-intervals.md) — temporal validity intervals, not soft deletes.
- [0009](0009-pwa-first-no-native-wrapper.md) — PWA-first, no native wrapper.
- [0010](0010-productisation-seams-first.md) — productise by building the expensive-to-reverse
  seams first and deferring the commercial features.
- [0011](0011-tiered-testing.md) — tier testing rigour by blast radius rather than uniformly.
- [0012](0012-fairness-normalised-by-opportunity.md) — normalise fairness by burden of opportunity,
  and optimise leximax rather than any dispersion measure.
- [0013](0013-first-party-diagnostics.md) — diagnostics in our own Postgres, no third-party
  processor for the pilot, and **no session replay, ever**.
- [0014](0014-next-js-react-not-angular.md) — Next.js and React, not Angular.
- [0015](0015-envy-as-a-fairness-cross-check.md) — envy as a reported cross-check, and **no second
  fairness measure blended into the objective at any weight**.
- [0016](0016-learn-weights-from-edits-not-rules.md) — learn in-tier weights from the admin's edits.
  **The tier hierarchy, the catalogue and anything doctor-specific are frozen against learning**,
  and the unit of signal is the edit, not the month.
- [0017](0017-no-validity-interval-on-constraints.md) — **no `validFrom` on constraints.**
  Era-dependence raises a question with a measurement attached; a derived date is never written.
