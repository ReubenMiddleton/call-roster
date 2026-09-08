# CLAUDE.md

@AGENTS.md

Everything in [`AGENTS.md`](AGENTS.md) applies. It is imported above, not merely referenced — Claude
Code reads *this* file, not `AGENTS.md`, so that line is the bridge. This file adds only what is
Claude-specific, and stays short on purpose: it loads every session, and a bloated one causes the
real instructions to be ignored.

## Read first

1. [`HANDOFF.md`](HANDOFF.md) — **current state only**, written to orient a cold session in one
   read. It is overwritten each session, not appended; history lives in
   [`docs/DECISIONS.md`](docs/DECISIONS.md). Keep it under 200 lines — it was 1,530 on 2 September
   2026 and cost every session ~21k tokens to read the same history twice.
2. [`docs/README.md`](docs/README.md) — the documentation index. **Use it instead of exploring.**
3. [`docs/NEEDS_YOUR_INPUT.md`](docs/NEEDS_YOUR_INPUT.md) — before assuming anything about the domain.

## The five that will actually bite you

1. **No real doctor name outside `private/`.** This repo is public and thirteen identifiable people's
   movements are in the source material. Use `D01`…`D13`. `npm run names:check` enforces it.
2. **Never commit without being asked.** Staging is fine. Committing is the owner's call, always.
3. **Never promote a confidence tag.** `[ASSUMED]`/`[INFERRED]`/`[UNKNOWN]` → `[CONFIRMED]` needs a
   human source. Log it in `docs/NEEDS_YOUR_INPUT.md` and move on — do not resolve ambiguity by
   picking the plausible reading.
4. **Use only the terms in [`docs/product/glossary.md`](docs/product/glossary.md).** If a domain term
   is missing, stop and ask. Inventing one is how `Shift`, `Duty` and `Session` become three types
   modelling one concept.
5. **Never silence `noUncheckedIndexedAccess` with `!`.** Narrow properly. This is the flag most likely
   to catch a real roster bug and the one most tempting to suppress.

## Working style the owner has asked for explicitly

- **Honest technical opinions, including "no" and "this is a bad idea"** — including disagreement with
  his own suggestions. Agreement is not the goal.
- **Say what you actually checked**, not just the conclusion. "I ran X and it returned Y" beats "X is
  fine".
- **A short concrete "what's next" list** at any natural stopping point, rather than a summary of what
  was just done.
- **Do not stall on a blocked question.** Log it, build up to the blocked point behind a swappable
  interface, and carry on with everything that does not depend on the answer.
- **Do not spawn subagents unless asked.**

## Where the real risk is

This is a domain-heavy project, so the expensive mistakes are not usually compiler errors:

- **A misread constraint.** The catalogue in [`docs/domain/constraints.md`](docs/domain/constraints.md)
  is derived from sixteen months of roster images that are **not yet on disk**. Treat every
  `[INFERRED]` line as a question.
- **A hard constraint that should have been soft.** The practice accepts an 8-hour turnaround. Any
  system that blocks it is unusable. Read the *Explicitly NOT constraints* section before adding a
  rule — it exists to stop things being helpfully re-added.
- **Building the editor before the export.** The printable grid is the artifact of record. This is the
  single most likely way the project fails.

## Verifying your own work

`npm run check` is the gate. Run it before saying anything is done.

Three steps in it are project-specific and worth understanding rather than just satisfying:
`docs:check` fails on documentation drift — a doc missing from the index, a constraint ID with no
definition, a dangling `ADR-nnnn`. `names:check` is the data boundary. `contract:check` compares the
Python parser's accepted fields against the contract document and the shared fixture, and is the only
thing standing between the two sides of the solver boundary and silent drift.

`npm run solver:check` is separate and also required when Python changed.

If either fails, fix the cause. Do not weaken the check.
