# ADR 0011: Tier testing rigour by blast radius, not uniformly

- **Status:** accepted
- **Accepted:** 2026-08-31 by the project owner
- **Date:** 2026-08-26
- **Deciders:** project owner

> In the context of **one developer building a system where some failures are unrecoverable and most
> are cosmetic**, facing **the choice between uniform high coverage everywhere and rigour
> concentrated where it matters**, we decided for **four explicit tiers keyed to blast radius**, to
> achieve **strong guarantees where a bug cannot be undone without slowing every ordinary change**,
> accepting **that cosmetic surfaces are deliberately less covered and that this must be defended
> rather than quietly corrected**.

## Context

The stated goal is commercial-grade robustness: *"tests I could run once and know that everything
will always work."*

**That guarantee does not exist**, and the honest thing is to say so before designing around it. What
is achievable is a set of layers where each catches a distinct, named class of defect, and where the
strongest layers sit under the failures that cannot be walked back.

The failures in this system are wildly unequal:

- **A wrong published roster means nobody is in the emergency centre.** Unrecoverable, and
  patient-safety adjacent.
- **A cross-tenant data leak** exposes thirteen identifiable people's movements. Irreversible under
  POPIA — forks, caches and mirrors persist.
- **A broken audit trail** destroys the evidential weight that ECTA s15 confers, which is the
  system's legal spine.
- **A malformed export** gets the product abandoned, because he rebuilds it in Word.
- **A misaligned button** is noticed and fixed on Tuesday.

Uniform coverage treats the last two as equals. They are not.

There is also a counter-risk that has already materialised twice on this project: **a check that
cries wolf gets switched off.** The real-name check nearly acquired that problem, and visual
regression is notoriously prone to it — font rendering differs across operating systems and browser
versions, so naive screenshot tests fail for reasons unrelated to the code. A flaky suite is worse
than a smaller trustworthy one, because it destroys the signal everywhere.

And the sharpest limit, worth stating plainly: **tests verify the specification, not its
correctness.** Four documented `[CONFIRMED]` facts turned out to be wrong on first contact with the
source material. A perfect suite would have faithfully enforced all four. Testing does not address
the dominant risk on this project; the worked examples and the monthly trial do.

## Decision

**Four tiers. Each states what it catches, what it cannot, and its coverage obligation.**

### Tier 1 — Unrecoverable. Maximum rigour.

Solver correctness · tenant isolation · the audit trail and published-version immutability · the
data boundary.

- **Property-based tests are mandatory**, not optional. The load-bearing one already exists: *for any
  generated instance, if the solver returns a solution then every hard constraint holds, and every
  elastic violation carries a registry entry explaining it.* Plus metamorphic properties — adding an
  unavailability can never reduce the objective.
- **Database-level invariant tests**: RLS actually prevents tenant A reading tenant B; the GiST
  exclusion constraint actually refuses a double-booking. These test guarantees that **cannot** be
  bypassed by application code, which is why they belong here rather than in the app tests.
- **Every new table must have an isolation test.** A table without an RLS policy is a release blocker.
- Coverage obligation: **100% branch coverage on the constraint evaluators and the penalty registry.**
- What this tier cannot catch: a constraint that is correctly implemented and wrong. Only the worked
  examples catch that.

### Tier 2 — Adoption-critical. Visual and structural regression.

The printable export — A4 landscape, A3, PDF, and the 2048px WhatsApp image.

- **Visual regression, run only in a pinned container.** Not on the host, ever. Font rendering
  differs across machines and a suite that fails for that reason will be disabled within a fortnight.
- Assert the **structural** properties too, because they survive a font update: column count, that a
  full month fits one page, greyscale legibility, that every cell carries a doctor code, that the
  period and version and generated-at timestamp are present.
- A deliberate tolerance threshold, tuned once and then defended.
- What this tier cannot catch: whether the export *looks right to him*. That is the monthly trial.

### Tier 3 — Functional. Ordinary rigour.

Assignment, preferences, the publish lifecycle, swaps, notifications.

- Unit tests on logic; integration tests across the API; Playwright on **three to five journeys that
  actually matter** — build a month, export it, publish it, submit a preference, override a warning.
- Real browsers, plus mobile viewport emulation for the four mobile jobs.
- Accessibility assertions on the interactive surface, because WCAG 2.2 SC 2.5.7 is a stated
  requirement rather than an aspiration.
- Coverage obligation: meaningful but not absolute. **No E2E test for every flow** — E2E is the most
  expensive and most brittle layer, and using it broadly is how suites become slow enough to skip.

### Tier 4 — Cosmetic. Deliberately light.

Marketing pages, settings screens, empty states, minor copy.

- Smoke tests: it renders, it does not throw, it is reachable.
- **No visual regression. No E2E. Low coverage thresholds, on purpose.**

> **This tier is a decision, not an oversight.** Do not raise its thresholds "for consistency". If a
> future session or an automated reviewer proposes uniform coverage, this ADR is the answer.

## Considered alternatives

| Option | Why rejected |
|---|---|
| **Uniform commercial-grade coverage everywhere** — high thresholds, visual regression on every screen, E2E per flow, mutation testing | The strongest net on paper. But it materially slows every change for a solo developer, and a slow or flaky suite gets bypassed — which loses the guarantees in Tier 1 as collateral damage. It also spends the most effort where failures are cheapest |
| **Mutation testing across the codebase** | Genuinely valuable *specifically* on the constraint evaluators, and it may be worth adding there later. Across the whole codebase it is slow enough to become a nightly job nobody reads |
| **Snapshot the generated rosters** | Already rejected in [ADR-0004](0004-or-tools-cp-sat.md) and worth restating because it will be re-proposed: CP-SAT is not deterministic across versions, worker counts or machines. A golden-file roster passes locally and fails in CI. **Snapshot the model instead** |
| **Visual regression on the host machine**, no container | The fastest way to a permanently red suite. Font rendering alone will do it |
| **Rely on manual testing for the UI** | The explicit thing this is meant to replace — one person cannot adequately test a 24/7 rostering system, and that was the stated reason for the whole request |
| **Test-after rather than test-alongside** | Retrofitted tests cost several times more and reliably codify the bug rather than the requirement |

## Consequences

**Good:**

- The failures that cannot be undone have the strongest guarantees available, including guarantees
  enforced by the database rather than by test discipline.
- Ordinary changes stay fast, so the suite keeps being run and keeps being trusted.
- Visual regression is confined to the one place pixel-exactness genuinely earns its cost, and
  containerised so it stays trustworthy.
- Each tier's limits are written down, so nobody mistakes a green suite for a correct product.

**Bad, or accepted as a cost:**

- **Cosmetic bugs will reach the user.** That is the trade, made deliberately.
- The tiers need judgement at the boundaries, and something will occasionally be filed in the wrong
  one.
- Containerised visual regression is real infrastructure — slower locally and more setup than
  screenshot-on-host.
- Tier 1's obligations are strict enough to be genuinely inconvenient at times. That is the point;
  weakening them to make a change pass is forbidden by `AGENTS.md`.

**Revisit when:** a second engineer joins (uniform standards get cheaper when review is shared), or a
customer's security review demands specific evidence. Note that a Tier 4 bug reaching production is
**not** a trigger — that is this ADR working as designed, not failing.

Full layer-by-layer detail in [`../../ops/testing-strategy.md`](../../ops/testing-strategy.md).
