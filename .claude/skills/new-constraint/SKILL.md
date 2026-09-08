---
name: new-constraint
description: Add a rostering constraint end to end - catalogue entry, solver model, test, and user-facing message. Use when a new scheduling rule needs implementing, or when the user types /new-constraint.
---

# Add a constraint

A constraint is not done when the solver enforces it. It is done when it has an ID, a catalogue entry,
a model encoding, a test named after it, and a message a doctor can read.

## Step 1 — Establish the confidence tag first

**This determines everything downstream, so do it before writing any code.**

| Tag | Source | What you may do |
|---|---|---|
| `[CONFIRMED]` | Stated by the practice principal, or verified across multiple roster months | Model as stated, mode `BLOCK` or `WARN` |
| `[INFERRED]` | Derived from the roster images; consistent with the data, unconfirmed | **Behind a flag, default OFF** |
| `[ASSUMED]` | A reasonable guess | **Do not model it.** Log the question and stop |
| `[UNKNOWN]` | Not established | **Do not model it.** Log the question and stop |

**Never promote a tag without a human source.** If you are inferring the rule from data rather than
being told it, it is `[INFERRED]` — no matter how many counterexamples are absent.

Default OFF for `[INFERRED]` is a deliberate asymmetry. If the rule is really a habit and we encode it,
we silently remove the principal's own flexibility, invisibly. If it is real and we omit it, he sees it
in the draft and tells us. **The second failure is cheap and visible; the first is expensive and
invisible.**

## Step 2 — Catalogue it

In `docs/domain/constraints.md`, using the next free `H-nn` (hard) or `S-nn` (soft).

- Write it in **EARS** notation — the statement doubles as the test name.
- Record the **source**: which interview, which roster months, how many counterexamples.
- Hard constraints get a `###` heading; soft constraints get a table row. `docs:check` parses both
  forms to know an ID is defined.
- Use `D01`…`D15`, never a real name.

**Before adding it, read the *Explicitly NOT constraints* section.** That section exists precisely
because things get helpfully re-added. If your new rule contradicts an entry there, you have found a
question for the principal, not a constraint to implement.

## Step 3 — Model it

In `solver/` — see `.claude/rules/solver.md`.

- **Named slack variable and a penalty from the tier hierarchy.** Not a hard constraint unless it is
  structurally impossible to violate — only H-01 and H-02 qualify.
- **Append to the penalty registry**: `(constraint_name, entity_refs, slack_var, weight)`.
- **Reach for the sequence primitives first.** Most "new" constraints are an existing regex pattern
  with different parameters — `add_soft_sequence_constraint`, `add_soft_sum_constraint`,
  `negated_bounded_span`. If you are writing bespoke logic, check first that it is genuinely a new
  shape rather than a familiar one in disguise.
- Reference the ID in a comment.

## Step 4 — Test it

Two tests, not one:

1. **Named for the ID** — `test_H04_no_back_to_back_nights` — asserting the specific behaviour.
2. **Confirm it is covered by the FEASIBLE-implies-hard-constraints-hold property**, so any generated
   counterexample surfaces it automatically.

Never snapshot a roster. Snapshot the model.

## Step 5 — Make the violation readable

The message goes to a non-technical doctor. Not *"S-03 violated for D09 on 2026-09-14"* but
*"D09 asked not to work 14 September but is assigned the night shift."*

## Step 6 — Verify

`npm run check`. `docs:check` fails if the ID is referenced but undefined, or if a new document is
missing from the index.
