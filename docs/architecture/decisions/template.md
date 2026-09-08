# ADR NNNN: <short title of the decision>

- **Status:** proposed | accepted | superseded by ADR-NNNN | deprecated
- **Date:** YYYY-MM-DD
- **Deciders:** <who signed off>

> In the context of **\<use case\>**, facing **\<concern\>**, we decided for **\<option\>** to
> achieve **\<quality\>**, accepting **\<downside\>**.

That first line is a **Y-statement** and it is not optional. If you cannot write it in one sentence,
the decision is not yet clear enough to record.

## Context

What forces are at play? What makes this hard to reverse? Include the constraints that are real —
one developer, a public repository containing third-party personal data, one live trial per month,
no Mac — rather than generic ones.

## Decision

What was chosen, stated plainly and specifically enough to be checkable later.

## Considered alternatives

**This is the most important section.** Without it, an agent re-proposes the thing that was already
rejected, every session, forever — and the reasoning has to be reconstructed from memory each time.

| Option | Why rejected |
|---|---|
| | |

Record options that were seriously considered *and* the plausible-sounding ones that will keep coming
up. "Nobody suggested it but somebody will" is a good reason to include a row.

## Consequences

Both directions, honestly.

**Good:**

**Bad, or accepted as a cost:**

**Revisit when:** the specific condition that should reopen this. A decision with no trigger for
revisiting is either genuinely permanent or under-examined; say which.

---

Filename: `NNNN-kebab-case-title.md`, sequential, never renumbered. Referenced elsewhere as
`ADR-NNNN`, which [`../../../scripts/check-docs.mjs`](../../../scripts/check-docs.mjs) verifies
resolves to a real file.
