# Testing strategy

The operational detail behind [ADR-0011](../architecture/decisions/0011-tiered-testing.md): what
each layer is, what it catches, **what it cannot catch**, and how to keep it trustworthy.

## Start here: the honest limits

The goal was *"tests I could run once and know that everything will always work."* That guarantee
does not exist, and designing around the belief that it does produces a suite people trust more than
it deserves. Three limits, stated up front:

1. **Tests verify the specification, not its correctness.** Four documented `[CONFIRMED]` domain
   facts turned out to be wrong on first contact with the source material — see
   [`../domain/source-artifact-findings.md`](../domain/source-artifact-findings.md). A perfect suite
   would have enforced all four faithfully. **The dominant risk on this project is building the wrong
   thing correctly**, and the cure is [`../domain/worked-examples.md`](../domain/worked-examples.md)
   plus the monthly trial, not coverage.
2. **A flaky suite is worse than a small one.** It destroys signal everywhere, not just where it
   fails. Every layer below has a named flakiness risk and a named mitigation. Where one cannot be
   made stable, it does not get added.
3. **UI tests catch regressions, not design errors.** Playwright verifies the interface does what it
   was scripted to do. It cannot tell you the roster is right, or that the export looks acceptable to
   the person who has to distribute it.

What the suite *can* do: make every known class of defect fail loudly and quickly, and make the
unrecoverable classes near-impossible.

---

## Tier 1 — Unrecoverable. Maximum rigour.

Solver correctness · tenant isolation · audit trail · the data boundary.

### Property-based tests

The highest-value tests in the project, and already in place —
`solver/tests/test_properties.py`, using Hypothesis.

> For any generated instance, if the solver returns a solution, then every hard constraint holds and
> every elastic violation carries a penalty-registry entry explaining it.

One property beats fifty examples here because you cannot imagine the input that breaks a constraint
solver and a generator can. **It has already earned this:** it produced a 2-doctor, 3-day instance
proving the pre-flight check was missing, and shrank it to something readable.

Also in place: metamorphic properties (adding an unavailability can never *reduce* the objective;
coverage is never traded for preferences) and a determinism property on model construction.

*Catches:* constraint encodings that are wrong on inputs nobody thought of.
*Cannot catch:* a constraint that is correctly implemented and factually wrong.
*Flakiness risk:* Hypothesis explores different inputs per run, so a CI failure may not reproduce
locally. **This is correct behaviour, not a flake** — copy the seed from the log.

### Database-level invariant tests

These test guarantees the application **cannot** bypass, which is why they matter more than any
equivalent app-level test:

- Tenant A cannot read, write or count tenant B's rows, for every tenant-scoped table.
- The GiST exclusion constraint refuses a double-booking even when inserted directly by SQL.
- The temporal foreign key refuses an assignment outside a membership interval (**H-03**).
- A published `roster_version` cannot be mutated.

**Every new table gets an isolation test. A table without an RLS policy is a release blocker** — the
single largest security risk in the architecture, per
[ADR-0007](../architecture/decisions/0007-shared-schema-rls.md).

### Audit-trail tests

Every mutation appends an entry with actor, server timestamp, before, after and reason. Server-side
time only — a test that passes with a client clock is testing the wrong thing. The version hash chain
detects tampering.

### Coverage obligation

**100% branch coverage on the constraint evaluators and the penalty registry.** Not negotiable, and
not to be weakened to make a change pass.

---

## Tier 2 — Adoption-critical. The export.

The export **is** the product. This is the only place pixel-level regression earns its cost.

### Visual regression — containerised, never on the host

> Run visual regression **only inside a pinned container**. Never on the development machine.

Font rendering and text metrics differ across operating systems and browser versions, so
screenshot-on-host produces failures unrelated to the code. That is the fastest possible route to a
permanently red suite, and a red suite gets disabled — the same failure mode the real-name check
nearly acquired.

Targets: A4 landscape print, A3, the PDF, and the 2048px WhatsApp image. A tolerance threshold tuned
once, then defended rather than nudged.

### Structural assertions — the durable half

Pixel comparison breaks on a legitimate font update. These do not, so they carry the real weight:

- Column count matches the days in the month, plus leading and trailing spill cells.
- A full month fits on one page at the target size, with no clipping.
- Every filled cell carries a doctor code and a time.
- Greyscale luminance separation between shift types stays above threshold.
- Period, version number, generated-at timestamp and short link are all present.
- Draft exports are watermarked; published ones are not.
- Per-tenant branding renders — practice name and logo — since the source artifacts carry both.

*Catches:* silent layout breakage, a missing shift, an unbranded or unversioned export.
*Cannot catch:* whether it looks right *to him*. Only the monthly trial does that.

---

## Tier 3 — Functional. Ordinary rigour.

Assignment, preferences, publish lifecycle, swaps, notifications.

- **Unit tests** on logic — date and shift-pattern arithmetic, fairness accumulation, contract
  serialisation. Vitest, `node` environment by default.
- **Integration tests** across the JSON API against a real Postgres, not a mock. The invariants live
  in the database, so a mocked database tests nothing that matters.
- **E2E: three to five journeys, not every flow.** Build a month · export it · publish and verify
  read-only access without an account · submit a preference · override a warning and confirm the scar
  persists. E2E is the most expensive and most brittle layer; breadth here is how suites become slow
  enough to skip.
- **Mobile viewport emulation** for the four mobile jobs only. Month construction is explicitly not
  built on mobile, so it is not tested there.
- **Accessibility assertions** on the interactive surface. WCAG 2.2 SC 2.5.7 — every drag operation
  achievable by single pointer without dragging — is a requirement, not an aspiration, and keyboard
  support does **not** satisfy it.
- **Contract tests** on the TypeScript ↔ Python boundary: types generated from
  [`../architecture/solver-contract.md`](../architecture/solver-contract.md) on both sides, both
  sides rejecting unknown fields, and a version-mismatch test proving a worker fails loudly rather
  than guessing.

*Flakiness risks:* time-dependent tests (inject the clock — rostering code is nothing but dates),
and E2E waiting on network. Fixed clock, seeded data, explicit waits on state rather than timeouts.

---

## Tier 4 — Cosmetic. Deliberately light.

Marketing pages, settings, empty states, copy.

Smoke tests only: renders, does not throw, reachable. **No visual regression, no E2E, low coverage
thresholds.**

> **This is a decision, not an oversight.** Do not raise these thresholds "for consistency" — see
> ADR-0011's Considered alternatives.

---

## What runs where

| | Local `npm run check` | Pre-push | CI on PR | Nightly |
|---|---|---|---|---|
| Lint, format, typecheck | ✅ | ✅ | ✅ | |
| Unit + property tests | ✅ | ✅ | ✅ | |
| Solver property tests | via `solver:check` | | ✅ | extended run |
| **Solver boundary, end to end** | via `solver:check` | | ✅ | |
| Holiday calendar vs transcription | ✅ `seed:holidays` | ✅ | ✅ | |
| DB invariant tests | | | ✅ | |
| Visual regression (container) | on demand | | ✅ | |
| E2E journeys | on demand | | ✅ | |
| Docs, names, workflow checks | ✅ | ✅ | ✅ | |

`npm run check` stays fast enough to run constantly. The slow, infrastructure-dependent layers live
in CI. Nightly runs the property tests with a much higher example count, which is where rare
counterexamples surface.

## Rules

- **Do not weaken an assertion, coverage threshold, strict compiler flag or lint rule to make a
  change pass.** Fix the cause. (`AGENTS.md`)
- **Never snapshot a generated roster.** Snapshot the model. CP-SAT is not deterministic across
  versions, worker counts or machines.
- **Every bug fix gets a regression test**, at the tier of the thing that broke.
- **Synthetic names in every fixture.** Fixtures reach a public repo and possibly a screenshot.
- Tests independent of wall-clock time, locale, execution order, network and unseeded randomness.
- A test that has been flaky twice is either fixed or deleted. It is not left to erode trust.

## Deliberately not doing

**Mutation testing across the codebase** — slow enough to become a nightly nobody reads. Worth
revisiting *narrowly*, on the constraint evaluators only.

**100% coverage as a global target** — it drives tests written for the metric rather than the risk,
and the last few percent are invariably error handling that would be better deleted.

**Testing the solver's output quality automatically.** Whether a roster is *good* is the principal's
judgement. The automated question is whether it is *valid*; the acceptance test is *"given last
March's inputs, does it produce something you rate as good as what you built by hand?"* — and that
needs a human and the historical data.
