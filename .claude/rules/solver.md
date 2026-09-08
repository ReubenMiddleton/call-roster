---
paths: ["solver/**/*.py", "solver/**/*.pyi"]
---

# Solver conventions

Loaded only when Python solver code is touched. Full spec:
`docs/architecture/solver-contract.md` and `docs/domain/constraints.md`.

## Environment

**There is no system Python.** `python` is the Microsoft Store stub and there is no system `pip`.
Use the checkout-local `uv`:

```
.tools/uv/uv.exe run pytest
```

Install it with `npm run setup:uv`. If `uv` reports *"Missing expected target directory for Python
minor version link"*, pass an explicit interpreter:
`%APPDATA%\uv\python\cpython-3.12.13-windows-x86_64-none\python.exe` (3.12.13, pip 26.1.2).

**Never write instructions that assume `pip`.** Ruff is the linter and formatter.

## Non-negotiables

1. **Make almost nothing hard.** Every constraint gets a named slack variable and a penalty from the
   order-of-magnitude hierarchy: 10⁶ coverage, 10⁴ legal/rest, 10² contract, 10⁰ preferences. **The
   model must always return a solution.** There is no `INFEASIBLE` status in the contract.
2. **Append to the penalty registry as you build** — `(constraint_name, entity_refs, slack_var,
   weight)`. The response's `violations` array is a projection of it. Retrofitting this is painful,
   so it goes in before the constraints do.
3. **Use the sequence primitives, not bespoke rules.** `negated_bounded_span`,
   `add_soft_sequence_constraint`, `add_soft_sum_constraint`, lifted from OR-Tools'
   `shift_scheduling_sat.py`. "At most 2 consecutive nights", "no night then morning" and "no
   isolated working day" are all the same constraint *type*.
4. **Never `AddExactlyOne` for coverage.** That is the number-one cause of "no solution found" in
   production, and it is why the simpler `employee_scheduling` tutorial is the wrong starting point.
5. **`[ASSUMED]` and `[INFERRED]` constraints go behind a flag, default off.** H-07 is the live
   example — the contract carries its mode so a confirmed answer flips a switch, not a rewrite.
6. **Pre-flight arithmetic before solving.** If a solve fails for a reason pre-flight could have
   named, fix pre-flight.

## Testing

The highest-value test is a property, not an example:

> For any generated instance, if the solver returns FEASIBLE then every hard constraint holds.

Add metamorphic properties too: adding an unavailability can never improve the objective; removing a
doctor can never make an infeasible instance feasible.

**Do not snapshot generated rosters.** CP-SAT is not deterministic across versions, `num_workers` or
machines — a golden file passes locally and fails in CI. **Snapshot the model** — a canonical
serialisation of the constraints — which catches "I broke the model builder" and is deterministic.

Test names carry the constraint ID: `test_H04_no_back_to_back_nights`.

## ⚠️ The wire boundary

**A weekday NEVER arrives as an integer.** `date.weekday()` makes Monday 0 here; `Date.getUTCDay()`
makes Monday 1 in TypeScript. Both are correct and neither can change, so an integer on the wire
silently means the wrong day and nothing raises an error. Convert with `wire.py`, which rejects an
unknown name rather than defaulting and rejects an out-of-range integer — Python's `-1` would
otherwise return `SUNDAY` without complaint. `test_wire.py` pins `MONDAY == 0` on purpose; do not
"fix" it to match the other side.

**`parse_request` in `contract.py` is the only way a real request becomes an `Instance`.**
`september_2026()` is a fixture. Four rules the parser holds to:

1. **Unknown fields are rejected at every level.** A field the sender believes is honoured and the
   receiver drops is the worst failure available here.
2. **Shifts come from the payload**, never from the global `PATTERNS` table. `Day.explicit_shifts` is
   always populated. The table is a fixture convenience and its docstring says so — reading it in a
   production path is a single-tenant leak.
3. **No silent default for anything semantic.** `tentative` and `endsNextDay` default; a missing
   required field raises.
4. **Errors carry the JSON path.** `availability[0].rules[0].kind`, not "invalid request".

`npm run contract:check` compares the parser's `_*_FIELDS` sets against the contract document and
`fixtures/solver-request.json`. It is in the main gate. If you add a field to the parser, the document
and the fixture both have to know.

## Data

**Doctor codes only — `D01`…`D15`.** Never a real name, including in fixtures, docstrings and test
data. `npm run names:check` covers `.py` files and `fixtures/`.
