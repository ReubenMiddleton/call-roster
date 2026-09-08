---
paths: ["**/*.ts", "**/*.tsx", "**/*.mts"]
---

# TypeScript conventions

Loaded only when a TypeScript file is touched.

## The flag that matters

`noUncheckedIndexedAccess` is **on**, and a roster engine is arrays indexed by day and by doctor —
so it will find real bugs. **Never silence it with a non-null assertion `!`.** Narrow properly:

```ts
const row = grid[dayIndex];
if (row === undefined) throw new Error(`No row for day ${String(dayIndex)}`);
```

`@typescript-eslint/no-non-null-assertion` is an error, so this is enforced rather than advisory.

`noPropertyAccessFromIndexSignature` is deliberately relaxed, and `checkJs` is off. Everything else
from `@tsconfig/strictest` stands. `erasableSyntaxOnly` and `verbatimModuleSyntax` are on — use
`import type` for type-only imports.

`allowImportingTsExtensions` is on, so **relative imports inside `lib/` carry an explicit `.ts`
extension**. That is not a style choice: Node's ESM resolver requires it, and Node 24 runs these
modules directly so `scripts/analytics-report.ts` can share types with the engine instead of
reimplementing the arithmetic in a second `.mjs`. Safe under `noEmit`.

`@typescript-eslint/restrict-template-expressions` is an error, so **a number in a template literal
needs `String(...)`** — `` `${String(count)} shifts` ``, not `` `${count} shifts` ``.

**TypeScript is pinned to 5.9.x on purpose.** `typescript-eslint` peers `typescript <6.1.0`, so
bumping to 6 or 7 silently drops type-aware linting. See `docs/DECISIONS.md`.

## Naming

Use exactly the terms in `docs/product/glossary.md`. The ones most often got wrong:

- **`roster`**, never `rota` or `schedule`.
- **`doctor`**, never `provider`, `resource`, `staff` or — especially — `employee`. These doctors are
  independent contractors; "employee" is legally wrong and carries real consequences.
- **`shift`**, never `duty` or `session`.
- **`assignment`** for a doctor placed in a slot; **`preference`** for a stated wish. They are never
  the same object and there is no state transition between them.
- **`weekend` is now defined**: Friday 17:00 to Monday 07:00, `[CONFIRMED]` 2026-08-31. Use
  `isWeekendShift(day, shift)` from `lib/analytics/shifts.ts` rather than reimplementing it. It is
  still **not** a burden concept, even though question W was answered on 2026-09-04 and a Friday
  from 17:00 now prices at 3.0 like a Saturday. **They agree on the back half and disagree on the
  front half by design** — `fri-early` (07:00) is neither weekend nor repriced — so never wire the
  two together. Concrete `saturdays` / `sundays` / `fridays` counts stay.

## ⚠️ Weekdays crossing the solver boundary

Internally this side uses `Date.getUTCDay()`, so **Sunday is 0 and Monday is 1**. Python uses
`date.weekday()`, so **Monday is 0**. Both are correct, neither can change, and an integer sent over
the contract therefore means a different day on arrival — with no error anywhere.

**So a weekday crosses as a name.** Convert with `lib/contract/weekday.ts` and nowhere else. It
throws on an unknown name and on an out-of-range integer rather than defaulting, because a silent
fallback puts a doctor on the wrong day. `weekday.test.ts` asserts `MONDAY === 1` deliberately —
`solver/tests/test_wire.py` asserts `MONDAY == 0`, and making the two agree is the bug, not the fix.

`npm run contract:check` fails the gate on an integer weekday in either the fixture or the contract
document.

## Structure

- The interactive core is **client components against a JSON API**, not Server Components with Server
  Actions. This keeps a Capacitor lift viable. RSC for marketing, auth, settings and PDF endpoints.
- Constraint IDs (`H-04`, `S-01`) appear in code as comments and in test names. `npm run docs:check`
  fails if an ID has no definition in `docs/domain/constraints.md`.
- Types crossing the Python boundary are **hand-written on both sides today, and that is a known
  gap** — `npm run contract:check` is the stopgap. Generation is still the intent, but from a single
  machine-readable schema, **not** from the prose document: a spec is the wrong source for a
  generator. See `docs/DECISIONS.md`. **Reject unknown fields rather than ignoring them** — the
  Python parser already does, at every level.
- Dates are practice-local; timestamps on the wire are UTC. An overnight shift belongs to the day it
  **starts** on.
