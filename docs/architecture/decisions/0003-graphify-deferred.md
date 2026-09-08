# ADR 0003: Defer the Graphify knowledge graph until the codebase justifies it

- **Status:** accepted
- **Accepted:** 2026-08-31 by the project owner
- **Date:** 2026-08-26
- **Deciders:** project owner (pending — Track B4)

> In the context of **wanting to reduce ongoing AI credit usage**, facing **a knowledge-graph tool
> that indexes source code only**, we decided for **deferring the Graphify setup until real code
> exists**, to achieve **actual token savings rather than the appearance of them**, accepting **that
> the tool the owner asked for first is now late in the order**.

## Context

The owner specifically asked that Graphify be carried into this project, and asked for it **first**,
on the reasoning that it would reduce credit usage. Both sibling repositories use it. That request is
reasonable and the tool is the right long-term investment — the reasoning below is about *timing*
only, and the owner agreed to the deferral once it was laid out.

Two facts decide it.

**Graphify's `--code-only` mode indexes source code and explicitly skips documentation, PDFs and
images.** On day one this repository's code is a Next.js scaffold, two check scripts and a test.
An index of that is an index of nothing, and an empty graph saves nothing.

**The actual token cost during the planning phase is documentation.** The project brief is ~12,000
words and the six research reports total roughly 400KB. `--code-only` does not touch any of it.
Indexing documentation requires Graphify's semantic-extraction path, which needs an LLM API key and
costs money per run — which is exactly why the sibling repositories deliberately run `--code-only`
and accept that their documentation is absent from the graph.

There is also an active harm, not merely a neutral cost: the `PreToolUse` hooks that push an agent
toward graph queries before reading raw files are **counterproductive on a small codebase**, where
reading the actual file is both cheaper and more accurate than querying a graph derived from it.

## Decision

**Set Graphify up after the repository scaffold, the documentation set and the solver prototype
exist** — task A8, last in the autonomous track — then do the whole thing in one pass, following the
Orbitarium pattern:

- Install into a gitignored `.tools/` via `uv`, **pinned versions**, without touching machine `PATH`.
- Checkout-local wrapper scripts exposed as npm scripts: `graph:setup`, `graph:update`,
  `graph:query`, `graph:benchmark`.
- `--code-only`: deterministic local tree-sitter parsing, **no API key, no network, nothing leaves
  the machine**.
- Commit `graph.json`, `GRAPH_REPORT.md` and `manifest.json`; gitignore the AST cache, interpreter
  paths, dated backups and cost log.
- Document it in `docs/GRAPHIFY.md` including an explicit privacy and cost boundary.

**Verify the source before installing anything.** There are exactly three legitimate sources —
the official site **graphify.com**, the PyPI package **`graphifyy`** (note the double "y"), and the
GitHub repository **`Graphify-Labs/graphify`**. There is a known impostor domain `graphify.net`, and
the project's own README warns that other `graphify*` PyPI packages are unaffiliated. Two
namesquatting vectors, so never install from a search result that does not match those three.

**Do not wire in `PreToolUse` hooks yet.** Revisit at roughly 30–50k lines, or when `/context` shows
exploration eating a large share of the window.

## Considered alternatives

| Option | Why rejected |
|---|---|
| **Set it up first, as originally asked** | Indexes an empty repository. The graph would be empty, the savings zero, and the hooks actively harmful at this size |
| **Set it up first with semantic extraction**, so documentation is indexed too | Needs an LLM API key and costs money per run — spending credits to save credits, at the exact moment the codebase is small enough to read directly. Also sends the documentation off-machine, and that documentation describes thirteen identifiable people's working patterns |
| **Skip Graphify entirely** | It is genuinely valuable at scale, both sibling repos benefit, and the owner asked for it. This is a deferral with a trigger, not a rejection |
| **Install globally rather than into `.tools/`** | Machine `PATH` dependence breaks reproducibility, and the sibling repos already prove the checkout-local pattern works. The only copy of `uv` on this machine currently lives inside a sibling checkout, which is that pattern working as intended |

## Consequences

**Good:**

- No credits spent on indexing an empty repository.
- The measures that *actually* reduce token cost during planning get built instead, and they are
  free: many small documents rather than one large one; `docs/README.md` as an index; `.claude/rules`
  with `paths:` frontmatter that load only on a matching file; skills whose bodies cost nothing until
  invoked; a `CLAUDE.md` kept short.
- When Graphify does arrive there is a real codebase to index, so its first report is useful.

**Bad, or accepted as a cost:**

- The owner's explicitly requested tool is late in the order. Mitigated by having the reasoning
  written down here rather than re-argued.
- Some near-term exploration is done by reading files directly. At this size that is the cheaper
  option anyway.

**One idea worth stealing from Graphify immediately, for free:** its `EXTRACTED` / `INFERRED` /
`AMBIGUOUS` edge-confidence tagging. That generalises directly to the
`[CONFIRMED]` / `[INFERRED]` / `[ASSUMED]` / `[UNKNOWN]` scheme this project's documentation already
uses — and for a rostering spec it is the single most useful thing the documents can carry, because
**the assumed constraints are the ones that turn out to be wrong.**

**Revisit when:** A2, A3 and A5 have produced a real codebase — that is the trigger for the setup
itself. Then again at ~30–50k lines for the `PreToolUse` hooks.
