---
paths: ["**/*.test.ts", "**/*.test.tsx", "**/*.test.mjs", "**/*.spec.ts", "solver/tests/**", "e2e/**"]
---

# Test conventions

Loaded only when a test file is touched.

## Names carry IDs

A test for a catalogued constraint is named after it: `test_H04_no_back_to_back_nights`,
`test_S01_cumulative_burden`. That makes "implement AC-H04" and "why is H-04 failing" unambiguous,
and coverage verifiable by grepping IDs. `npm run docs:check` fails on an ID with no definition.

EARS acceptance criteria in `docs/product/prd.md` are written to become test names directly. Reuse
the wording rather than paraphrasing it.

## Environment

Vitest defaults to **`node`** — most tests here are pure logic (constraint evaluation, date
arithmetic, fairness accumulation, contract serialisation) and paying jsdom startup for those is
waste. A component test opts in on line 1:

```ts
// @vitest-environment jsdom
```

`globals: false`, so import `describe`, `it` and `expect` explicitly.

## Property-based testing is not optional for the solver

`fast-check` is exactly built for this shape of problem. One property is worth fifty examples,
because you cannot imagine the input that breaks it and the generator can — and it shrinks the
counterexample to a two-doctor, three-day case you can actually read.

## Rules

- **Do not weaken an assertion or lower a coverage threshold to make a change pass.** Fix the cause.
- **Never snapshot a generated roster.** Snapshot the model; assert properties of solutions.
- Keep tests independent of wall-clock time, locale, execution order, network and unseeded
  randomness. Rostering code is full of dates — inject the clock.
- Every bug fix gets a regression test.
- **Synthetic names in every fixture.** Fixtures reach a public repo and possibly a screenshot. Use
  `D01`…`D15` codes, or invented names that are obviously invented — never a real surname.
- Playwright covers three to five journeys that actually matter, not broad coverage. `test:e2e` is
  deliberately outside `npm run check`: it needs browsers and a dev server.
