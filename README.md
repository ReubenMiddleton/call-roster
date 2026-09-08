# Call Roster

Call-roster scheduling for a private emergency-medicine practice running **24/7 single cover** —
one doctor on duty at all times, thirteen doctors, every day of the year.

The practice currently collects shift requests over WhatsApp, transcribes them by hand into a
page-per-month paper diary, and hand-builds next month's grid in a Word table around the 20th.
This project replaces that: collect preferences digitally, help build the roster, produce an
artifact at least as good as the Word table, and remember who has carried what burden over
time — the one thing a paper diary structurally cannot do.

> **Status: planning phase.** There is no shippable application yet. The deliverable right now is
> the documentation set under [`docs/`](docs/README.md) and a throwaway solver prototype. Nothing
> in this README describes shipped behaviour unless it says so.

## Why the roster is the hard part

It is a [Nurse Rostering Problem](https://www.schedulingbenchmarks.org/nrp/) at small scale:
13 doctors × 31 days × 3–4 shifts ≈ 1,600 booleans. Small enough that a modern CP-SAT solver
handles it in under a second, and large enough that solving it by hand once a month, under time
pressure, while trying to keep thirteen people happy, is genuinely unpleasant.

Three design commitments follow from the research, and they are deliberately counterintuitive:

1. **The export is the product.** The printable monthly grid is the artifact of record. A system
   that does not reproduce a WhatsApp-shareable grid on day one gets run in parallel forever, or
   abandoned. Every hour on the export is worth ten on the editor.
2. **The solver ships last, not first.** You cannot model constraints nobody has stated yet, and
   a manual tool people actually use beats a solver nobody trusts.
3. **No LLM generates the roster.** Measured feasibility on hard nurse-rostering benchmarks is
   about 2%, with a documented tendency to invent people who do not exist. LLMs belong at the
   edges — turning a WhatsApp message into a structured preference, and narrating what the solver
   decided. See [`docs/README.md`](docs/README.md).

## Getting started

Requires **Node ≥ 22** and npm 11.x.

```bash
npm install
```

```bash
npm run dev
```

The solver is Python and is managed entirely through `uv`, installed into a gitignored
`.tools/` directory rather than system-wide:

```bash
npm run setup:uv
```

The pre-commit secret scan needs gitleaks, installed the same way:

```bash
npm run setup:gitleaks
```

Both scripts pin a version and verify the download against the release's published checksum
before use.

## The quality gate

One composite command runs everything, and it is the gate that has to be green before any change
is considered done:

```bash
npm run check
```

That is `format:check` → `lint` → `typecheck` → `test:coverage` → `build` → `docs:check` →
`names:check`. Formatting is Biome; linting is ESLint with type-aware `typescript-eslint` rules
and the Next.js plugin set. Git hooks are managed by lefthook: fast file-scoped checks on
pre-commit, type-check and tests on pre-push.

Two of those steps are project-specific and worth explaining:

- **`docs:check`** ([`scripts/check-docs.mjs`](scripts/check-docs.mjs)) fails on broken local
  links, on a document that exists under `docs/` but is missing from the index, on a constraint
  ID referenced anywhere without a definition in the catalogue, and on a dangling ADR reference.
  It is what makes "documentation is part of the feature" enforceable rather than aspirational.
- **`names:check`** ([`scripts/check-no-real-names.mjs`](scripts/check-no-real-names.mjs)) is the
  data boundary described below.

## Data boundary — read this before contributing

This repository is public. The practice's source material identifies **thirteen real doctors** and
shows, day by day, where each of them was for over a year. Under
[POPIA](https://popia.co.za/) that is personal information about identifiable living people who
have not consented to its publication.

So:

- **Real names never enter this repository.** Everything committed — documentation, code, tests,
  fixtures, commit messages — refers to doctors as stable anonymous codes, `D01`…`D13`.
- The source material, the code-to-name mapping, and anything derived from them that still
  carries a real name live in a gitignored `private/` directory, which is the first line of
  [`.gitignore`](.gitignore).
- `npm run names:check` fails the gate if a real surname appears anywhere outside `private/`. It
  reads the name list from `private/` at runtime, so the names are never hard-coded into a
  committed script, and it skips cleanly on a clone that has no `private/` directory.
- **Fixtures and worked examples use synthetic names.** They end up in a public repo and quite
  possibly in a screenshot.

The application holds **no patient data, no health data, and no free-text preference fields**.
That last one is not an oversight: a free-text preference box reliably collects religious
observance ("off for Eid", "no Friday sunset shifts"), which is special personal information under
POPIA s26 and drags the whole system into a prior-authorisation regime. Preferences are a
structured enum, enforced in validation. This is a hard product boundary, not a guideline.

## Documentation

[`docs/README.md`](docs/README.md) is the index — one line per document saying what it covers and
when to read it. Start there rather than here.

Architectural decisions live in [`docs/architecture/decisions/`](docs/architecture/decisions/) as
ADRs, each recording the alternatives that were rejected and why. That section is the point: a
decision without its rejected alternatives gets re-proposed forever.
