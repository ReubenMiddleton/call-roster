# Cross-language fixtures

Fixtures that **both** the TypeScript and the Python side read. Nothing else belongs here — a
fixture used by one language lives next to its tests.

## Why this directory exists

`docs/architecture/solver-contract.md` opens by calling the TypeScript ↔ Python boundary the
highest-risk interface in the system, because *"either side can drift from the other without a
compile error anywhere."* That is not hypothetical: on 1 September 2026, writing the Python request
parser found five live mismatches between the document and the code, one of which — a weekday integer
meaning Monday on one side and Sunday on the other — would have surfaced as a wrong roster months
later, in another language from its cause.

Type generation from a single schema is the eventual fix, and is not built yet. **A shared fixture is
the cheap version of the same guarantee:** one payload, parsed by both sides, asserted against in both
test suites. If either side changes its shapes, one of the two suites fails.

**And the fixture has a blind spot, which `npm run solver:e2e` covers.** This payload is
hand-written, so it proves the parser reads what somebody typed — not that it reads what
`buildSolveRequest` *emits*. The end-to-end check closes that: TypeScript builds a request from
`seed-data/` and Python parses and solves it, in one command. Added 2 September 2026, and verified by
injecting a field into the emitted request and watching it fail with the JSON path.

## `solver-request.json`

A complete, valid solve request at `contractVersion` **1.1.0**. Deliberately small — four days, five
doctors — but it exercises every branch that has caused a problem:

| In the fixture | Why it is there |
|---|---|
| All three shift patterns, A, B and C | Pattern B has four shifts, not three. Anything that assumes three breaks here |
| A `night` shift with `endsNextDay: true` | 23:00–07:00 parses as *minus sixteen hours* without it |
| Explicit `kind` on every shift | Not derivable from the times. `Shift.is_night` drives H-04 |
| `2026-09-24`, a public holiday | H-10 is **exempt** on holidays — pool doctors' own practices are closed. The counter-intuitive branch, so the one that breaks |
| `availability` for D06 **and** D07 | D07 carries `exceptWeekdays: ["MONDAY"]` — the real fortnightly-Monday arrangement, and the case a binary anchor/pool split got wrong |
| Weekdays as **names**, never integers | `MONDAY` is `0` in Python and `1` in TypeScript. Both correct. See `lib/contract/weekday.ts` |
| `H-07` with `mode: "OFF"` | It is `[INFERRED]`. The mode is data so a confirmed answer flips a switch, not a rewrite |
| A `tentative: true` preference | The diary's `±` modifier |
| `burdenLedger`, `lockedAssignments`, `previousPublished` | **Validated but not yet consumed.** Present so the shape is already proven the day the model reads them |

**Doctor codes only, and they are codes rather than names** — `D01`…`D07`, per the data boundary in
`AGENTS.md`. The UUIDs are obviously synthetic (`0000…0001`). `npm run names:check` covers this
directory.

### Who reads it

- `solver/tests/test_contract.py` — parses it and asserts the resulting `Instance`.
- `lib/contract/fixture.test.ts` — asserts the field sets, so a field added on one side and not the
  other fails a build.
- `npm run contract:check` — validates it against the examples in the contract document itself, and
  is part of `npm run check`.

### Changing it

A change here is a contract change. Bump `contractVersion`, update
`docs/architecture/solver-contract.md`, and expect both test suites to have opinions. That friction
is the feature.
