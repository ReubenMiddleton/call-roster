---
name: adr
description: Create a new architecture decision record from the project template. Use when a hard-to-reverse architectural or technology choice has been made and needs recording, or when the user types /adr.
---

# Create an ADR

## When this applies

Only for choices that are **expensive to reverse**: a technology, a data-model shape, a boundary
between services, a licensing commitment, a hosting decision.

**Reversible choices go in `docs/DECISIONS.md` instead** — the dated journal. Pinning a dependency
version, choosing a formatter setting, or skipping Tailwind are journal entries, not ADRs. If you are
unsure, ask whether changing it in six months would mean a migration. If not, it is a journal entry.

## Steps

1. **Find the next number.** `ls docs/architecture/decisions/` — take the highest and add one. Never
   renumber, never reuse.
2. **Copy `docs/architecture/decisions/template.md`** to
   `docs/architecture/decisions/NNNN-kebab-case-title.md`.
3. **Write the Y-statement first**, before anything else:

   > In the context of \<use case\>, facing \<concern\>, we decided for \<option\> to achieve
   > \<quality\>, accepting \<downside\>.

   If you cannot write that in one sentence, the decision is not clear enough to record yet. Stop and
   clarify it rather than padding the Context section.
4. **Fill in Context** with the *real* forces — one developer, a public repo containing third-party
   personal data, one live trial per month, no Mac — not generic ones.
5. **Fill in Considered alternatives. This is the section that matters.** Every option gets a row and
   a reason. Include the plausible-sounding options nobody actually proposed, because somebody will
   propose them later — "nobody suggested it but somebody will" is a good reason for a row.

   Check `private/PROJECT-BRIEF.md` §4 first: a page of options was already evaluated and rejected
   with reasons, and that reasoning should not be re-derived from scratch.
6. **Fill in Consequences** honestly, both directions, and give a **Revisit when** trigger. A decision
   with no trigger is either genuinely permanent or under-examined — say which.
7. **Set `Status: proposed`**, not `accepted`. It becomes accepted when the owner signs off.
   Recording a proposal as a decision misrepresents it.
8. **Add it to `docs/README.md`** under Decisions. `npm run docs:check` fails if you forget.
9. **Run `npm run docs:check`.**

## Constraints

- No real doctor names. Use `D01`…`D15`.
- If the ADR supersedes an earlier one, set the old one's status to
  `superseded by ADR-NNNN`, pointing at the new file — do not delete or edit it. Its reasoning is
  still why the new decision was needed.
