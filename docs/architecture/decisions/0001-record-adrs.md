# ADR 0001: Record architecture decisions as MADR-minimal ADRs

- **Status:** accepted
- **Accepted:** 2026-08-31 by the project owner
- **Date:** 2026-08-26
- **Deciders:** project owner (pending — Track B4)

> In the context of **a solo developer working largely through AI agents across many short
> sessions**, facing **the same rejected options being re-proposed every session**, we decided for
> **MADR-minimal ADRs with a mandatory rejected-alternatives section**, to achieve **decisions that
> survive a context window**, accepting **the small overhead of writing one per hard-to-reverse
> choice**.

## Context

This project will be built across a large number of sessions, most of them starting cold. Anything
not written in the repository does not exist — conversation history is not durable and a summary
given only in chat has no effect on the next session.

The specific failure this addresses is narrow and observable: an agent, reasoning from first
principles in a fresh context, proposes a technology that was carefully evaluated and rejected weeks
earlier. Without the reasoning on disk, each rediscovery costs the same argument again, and the
developer either re-litigates it or gives in.

The planning research produced roughly a page of rejected options with reasons — solver engines, UI
component libraries, spec-driven frameworks, hosting choices. That material is the single most
reusable artifact of the whole research effort, and it currently lives in a private document that
will not be read every session.

## Decision

Record every hard-to-reverse decision as a numbered ADR in `docs/architecture/decisions/`, using
**MADR-minimal**: a **Y-statement** first line, then Context, Decision, **Considered alternatives**,
Consequences.

- The **Considered alternatives** table is mandatory and lists the reason for each rejection.
- Sequential numbering, never renumbered. Referenced as `ADR-NNNN`.
- `npm run docs:check` fails if an `ADR-NNNN` reference has no corresponding file.
- Status is honest: `proposed` until the owner signs off. A proposal presented as a decision is a
  documentation bug.
- Reversible choices go in [`../../DECISIONS.md`](../../DECISIONS.md) — the dated journal — not here.

The `/adr` skill scaffolds a new one from `template.md`.

## Considered alternatives

| Option | Why rejected |
|---|---|
| **Nygard-style ADRs** (Context / Decision / Consequences) | Records what was chosen but **not what was rejected**, which is exactly the half that stops re-proposal. The sibling Orbitarium repository uses this form, and this is a deliberate departure from it |
| **Full MADR** with all optional sections | More ceremony than a solo developer sustains. The sections that get skipped when busy are the ones nobody misses |
| **`adr-tools` or `log4brains`** | Less capable than a template file plus a slash command, and adds a dependency and a toolchain to maintain. Neither generates the rejected-alternatives thinking, which is the actual work |
| **A single long `ARCHITECTURE.md`** | A 400-line file costs 400 lines of context to answer one question. One file per decision loads only what is relevant |
| **Only the dated journal, no ADRs** | The journal is chronological, so finding "why did we choose the solver engine" means reading all of it. Both are needed and they do different jobs |
| **No formal record; rely on code comments** | Code records what is, never what was considered and rejected. And a rejected option leaves no trace in code at all |

## Consequences

**Good:**

- A rejected option stays rejected without needing the developer to remember why.
- Each ADR is small enough to load individually, which matters when context is the scarce resource.
- The rejected-alternatives sections double as an onboarding document for the problem space.
- `docs:check` makes a dangling `ADR-NNNN` reference a gate failure rather than rot.

**Bad, or accepted as a cost:**

- Writing them takes time, and the temptation under pressure is to skip the alternatives table —
  which is the one section that must not be skipped.
- Judging what counts as "hard to reverse" is a judgement call. Erring toward writing one is cheaper
  than erring away.
- Nine ADRs written in one sitting before any code exists are necessarily somewhat theoretical. Some
  will need revising once the code disagrees with them, and that is expected rather than a failure.

**Revisit when:** never, realistically. If ADRs stop being written, that is a discipline problem
rather than a signal that the format is wrong.
