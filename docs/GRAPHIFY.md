# Graphify

A local, queryable knowledge graph of the codebase. Deterministic AST parsing, no API key, no
network, nothing leaves the machine.

Its purpose is to reduce the cost of answering "where does X happen" without reading half the
repository. See [ADR-0003](architecture/decisions/0003-graphify-deferred.md) for why it was set up
*after* the code existed rather than before.

## ⚠️ Source verification — read before installing or changing the pin

There are **two namesquatting vectors** on this project, so only three sources are legitimate:

| | Legitimate | Impostor / unaffiliated |
|---|---|---|
| Site | **graphify.com** | `graphify.net` — a known impostor domain |
| PyPI | **`graphifyy`** (double "y") | other `graphify*` packages, per the project's own README |
| GitHub | **`Graphify-Labs/graphify`** | |

**Verified 26 August 2026:** PyPI `graphifyy` 0.9.50 declares its Homepage and Repository as
`github.com/Graphify-Labs/graphify`, which is Apache-2.0 and actively maintained. The two
corroborate each other — a package claiming a repository it does not belong to is the thing this
check catches.

**Never install from a search result that does not match those three.**

## Usage

```bash
npm run graph:setup
```

Installs the pinned version into a gitignored `.tools/`. Requires `npm run setup:uv` first.

```bash
npm run graph:update
```

Re-extracts and rewrites the graph. **Run this in the same change as any code edit**, so the
committed graph never disagrees with the committed code.

```bash
npm run graph:query -- "where are constraints evaluated"
```

Also available through the wrapper: `path "A" "B"` for the shortest path between two nodes, and
`explain "X"` for a plain-language description of a node and its neighbours.

Current graph: **780 nodes, 987 edges, 69 communities.**

## Privacy and cost boundary

This is the section that matters, and it is not boilerplate — this repository holds personal
information about thirteen identifiable people.

**What runs locally, always:**

- `graph:update` uses **deterministic local tree-sitter AST parsing**. No API key, no network
  call, no code or documentation leaves the machine. The CLI confirms this: *"re-extract code files
  and update the graph (no LLM needed)"*.

**What is deliberately not enabled:**

- **Semantic extraction.** Graphify can index documentation, PDFs and images, but that path needs
  an LLM API key and costs money per run. It is **not** used here, for two reasons. It would spend
  credits to save credits at a moment when the codebase is small enough to read directly; and more
  importantly, **that documentation describes thirteen identifiable people's working patterns**, so
  sending it to a third-party model is a cross-border transfer of personal information under POPIA
  s72. The prompt Graphify prints on each run — *"set GEMINI_API_KEY … to use Gemini for semantic
  extraction"* — should be declined. If it is ever wanted, it needs a sub-processor entry and a
  deliberate decision, not an environment variable.
- **`PreToolUse` hooks.** Graphify can install hooks that push an agent toward graph queries before
  reading raw files. On a codebase this size that is *counterproductive* — reading the actual file
  is cheaper and more accurate than querying a graph derived from it. Revisit at roughly 30–50k
  lines, or when `/context` shows exploration eating a large share of the window.

**Cost: zero, ongoing.** If a Graphify command ever asks for a key or reports a cost, stop and find
out why before proceeding.

## What is committed, and what is not

Committed:

| File | Why |
|---|---|
| `graphify-out/graph.json` | The graph itself. Reviewable in a diff, and what queries read |
| `graphify-out/GRAPH_REPORT.md` | Human-readable architecture summary |
| `graphify-out/manifest.json` | Extraction provenance — what was indexed, at what version |

**Not** committed — `.gitignore` allows only the three files above:

| Excluded | Why |
|---|---|
| `graphify-out/cache/` | Machine-local AST cache. Large, regenerable, meaningless in a diff |
| `graphify-out/graph.html` | ~600KB of **vendored visualisation JavaScript**. Regenerable, bloats every diff, and see the incident below |
| `.graphify_labels.json`, `.graphify_root`, dated backup folders | Machine-local sidecars |

`graph.json` and `manifest.json` are marked `linguist-generated` in `.gitattributes`, so they
collapse in diffs rather than burying a review.

## The incident worth recording

The first extraction produced a **real-name check failure** in `graphify-out/graph.html`.

It turned out to be a **false positive**: the string was *"Andrew's monotone chain"* — the convex
hull algorithm — inside Graphify's own bundled visualisation JavaScript. No practice data leaked,
and the graph never indexed `private/`.

**But it exposed a genuine hole.** `scripts/check-no-real-names.mjs` had `graphify-out` in its
ignored-directories list, added early when the directory did not exist yet. That was wrong:
`graph.json`, `GRAPH_REPORT.md` and `manifest.json` are **committed**, so excluding the whole
directory meant the data-boundary check was blind to three files that go to a public repository.

Three fixes, all in place:

1. `graphify-out` is scanned again. Only `graphify-out/cache` is excluded, and by **relative path**
   rather than by directory name — so a legitimately named `cache` directory elsewhere is still
   scanned. Verified both ways: a planted name in the committed area fails the gate; the same name
   in the cache does not.
2. *"Andrew's monotone chain"* is an allowlist entry in `private/doctor-codes.md`, which is the
   right fix for an innocent match. Loosening the matching would have been the wrong one.
3. `graph.html` is no longer committed. Vendored third-party code in a public repository, in a file
   that regenerates on every run, is a standing source of exactly this class of false positive —
   and a check that cries wolf gets switched off.

**The general lesson, worth carrying:** an exclusion added to a checker "because that directory is
generated" needs re-examining the moment anything in that directory becomes committed. The check is
only as good as its scope.

## Refresh policy

- Run `npm run graph:update` **in the same change** as any code edit. A stale graph is worse than
  no graph, because it is trusted.
- Treat the graph as **scoped navigation evidence, not truth.** Verify behaviour in the source files
  and tests the graph points at before editing. Graphify's own confidence tagging
  (`EXTRACTED` / `INFERRED` / `AMBIGUOUS`) is the same discipline this project's documentation uses
  for domain facts, and deserves the same scepticism.
- Dirty `graphify-out/` files after a run are expected and are not a reason to skip the update.
- `npm run graph:benchmark` reports graph quality if the extraction ever looks wrong.
