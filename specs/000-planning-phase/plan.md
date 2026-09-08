# Track A, A1–A4 — planning-phase plan

**Session scope:** Track A only (A1–A8). Track B needs Reuben present; Track C needs the
practice principal, who is working. Neither is attempted here.

**On approval, action zero:** write this file to `specs/000-planning-phase/plan.md` as
requested, so it survives compaction and is readable from the repo.

---

## Context

The repo is greenfield: `HANDOFF.md`, `PROJECT-BRIEF.md` (~12,000 words) and six research
reports, no code, no git. The brief is the only written record of how this practice rosters —
derived from 16 months of roster images and an owner interview that exist nowhere else.

Three things drive everything below:

1. **The brief names thirteen real doctors and the repo is going public.** A1 fixes that, and
   a committed check has to keep it fixed once nobody is thinking about it any more.
2. **A 12,000-word brief re-read every session is the project's biggest recurring token cost.**
   A3 decomposes it into small, indexed, path-scoped documents. That is the actual point of A3,
   not tidiness.
3. **`[ASSUMED]`/`[INFERRED]` tags are the risk register.** They carry across into `docs/`
   intact. Nothing gets promoted this session; every one becomes a logged question.

---

## A1 — Secure the private material ✅ DONE (executed before planning)

Done first and outside plan mode because it is a data-exposure fix, the instruction was
explicit, and there is no `.git` yet so nothing had leaked and no history needed rewriting.

| Step | Result |
|---|---|
| `.gitignore` with `private/` first | ✅ First non-comment line is `private/`, with a comment explaining why. Plus `.tools/`, `graphify-out/cache/`, `node_modules/`, `.env*`, `dist/`, `coverage/` |
| Move brief + research | ✅ `private/PROJECT-BRIEF.md`, `private/research/` (6 reports) |
| `private/doctor-codes.md` | ✅ D01–D13 active + D14/D15 departed, tier and recurring-slot notes, constraint translation table, parseable surname block, allowlist |
| `private/source-artifacts/.gitkeep` | ✅ Ready for B2 |

**Finding the brief's own §6.7 warning missed: `HANDOFF.md` was also in breach.** It is a
committed root file and carried one surname ×7 and another ×1. Sanitised to `D01`/`D15` with
seven minimal substitutions; original preserved at `private/HANDOFF.md.pre-A1.bak`. Verified:
`grep -rE "<all 15 surnames>" . --exclude-dir=private` → **no matches**.

**Not fixed, because it is not mine to decide:** `HANDOFF.md` still says *the hospital by name*
and described the principal as a close family member of the owner. Neither is a doctor's name, so both are inside my stated
boundary — but together, on a public repo tied to a named personal account, they arguably
identify D01 by inference. That is brief §10 Q25 (Track C). **B1 pushes tonight and a push is
irreversible.** Logged as the top NEEDS_YOUR_INPUT item; not silently edited, and not answered
by inference.

---

## A2 — Repository scaffold and quality gate (local only, no push)

### Version pins — corrected against the live registry, not the brief

The brief specifies "ESLint 9" and the sibling repo runs TypeScript 5.9. The registry has moved
past both. Checked with `npm view` this session:

| Package | Pin | Why |
|---|---|---|
| `next` / `react` | 16.3.3 / 19.2.8 | Matches brief §4.7 |
| **`typescript`** | **5.9.3 — deliberately not 7.x** | **`typescript-eslint` peers `typescript: >=4.8.4 <6.1.0`.** TS 7.0.2 is latest, but adopting it silently drops the type-aware linting the brief mandates. Forced choice, evidence-based |
| `eslint` | 10.9.1 | `typescript-eslint` peers `^8.57 \|\| ^9 \|\| ^10`; `eslint-config-next` peers `>=9`. Both fine. Brief's "ESLint 9" was a floor, not a ceiling |
| `typescript-eslint` | 8.68.0 | Type-aware config |
| `eslint-config-next` | 16.3.3 | Version-locked to `next` |
| `@tsconfig/strictest` | 2.0.8 | Base, with the brief's relaxations |
| `vitest` / `@fast-check/vitest` / `fast-check` | 4.1.11 / 0.4.1 / 4.9.0 | Adapter peers `vitest ^4.1.0` ✓ |
| `@biomejs/biome` | 2.5.10 | **Formatter only** |
| `lefthook` | 2.1.10 | Over husky |
| `@playwright/test` | 1.62.1 | Installed; journeys come later |

TS 5.9 vs 7 goes in `docs/DECISIONS.md`, **not** an ADR — it reverses the moment
`typescript-eslint` ships TS 7 support, and the brief reserves ADRs for hard-to-reverse choices.

### tsconfig

`@tsconfig/strictest` base; relax `checkJs: false` and
`noPropertyAccessFromIndexSignature: false`; add `erasableSyntaxOnly: true` and
`verbatimModuleSyntax: true`. `noUncheckedIndexedAccess` stays on — a roster engine is arrays
indexed by day and by doctor. `CLAUDE.md` gets the paired rule: *never silence it with `!`,
narrow properly.*

### Scaffold

`create-next-app` (App Router, TS), then **delete the boilerplate page** and replace it with one
honest minimal route. `npm install` runs so the gate is real rather than aspirational.

### `scripts/check-no-real-names.mjs` — the check that matters

Follows `Wallpaper/scripts/check-docs.mjs` exactly in idiom (`node:fs/promises`, ignored-dir set,
`process.exitCode = 1`), so it reads like the family it belongs to.

- Parses surnames from the `<!-- SURNAMES:BEGIN -->` block in `private/doctor-codes.md`, so no
  real name is ever hard-coded into a committed script.
- **Case-sensitive, word-boundary, capitalised-only.** Deliberate: seven of the fifteen surnames
  are ordinary English or Afrikaans words, or appear in sources the brief cites. A check
  that fires on the word "winter" gets switched off, and then it protects nothing. That failure
  mode is the real risk, not a missed match.
- Honours the `<!-- ALLOW:BEGIN -->` allowlist for known-safe collisions.
- Skips `private/`, `.git/`, `node_modules/`, `.tools/`, `graphify-out/`, `dist/`, `coverage/`
  and its own source.
- **Degrades loudly:** if `private/doctor-codes.md` is absent (fresh clone by anyone but the
  owner) it prints a clear skip notice and exits 0 — it must not become a hard blocker for a
  contributor who legitimately cannot have the mapping.

### `scripts/check-docs.mjs` — drift, not just links

Copies Wallpaper's broken-local-link walk, then adds the three checks that actually catch drift:

1. Every doc in `docs/` is listed in `docs/README.md` **and** every entry in the index resolves —
   catches a doc added without an index line, which is how an index rots.
2. Every `H-nn`/`S-nn` referenced anywhere resolves to a definition in `docs/domain/constraints.md`.
3. Reports `[NEEDS CLARIFICATION: ...]` markers as a **non-failing** count (brief §7 wants them
   greppable, not forbidden).

### Hooks and the composite gate

- **lefthook pre-commit:** `lint-staged` (Biome format + ESLint), `gitleaks protect --staged`,
  `check-no-real-names`.
- **lefthook pre-push:** `tsc --noEmit`, `vitest run`. Not pre-commit — type-checking cannot
  meaningfully scope to staged files.
- `npm run check` = `format:check && lint && typecheck && test:coverage && build && docs:check && names:check`.
- **A hook whose tool is missing must fail, not silently pass.** If `gitleaks` is absent the hook
  exits non-zero pointing at `npm run setup:gitleaks`. A security hook that no-ops is worse than
  no hook, because it is believed.

### `.tools/` bootstrap (per your answer: both, checksum-verified)

Neither tool is on this machine. `gh` **is** (2.98.0, `C:\Program Files\GitHub CLI`) — the
brief's "`gh` is not installed system-wide" is now stale, and that goes in `DECISIONS.md`.

- `scripts/setup-gitleaks.ps1` → pinned release into `.tools/`, verified against the published
  `checksums.txt` before use. Mirrors what Wallpaper already does for `gh`.
- `scripts/setup-uv.ps1` → pinned `uv.exe` into `.tools/uv/`. Checkout-local, no PATH change.
- Both exposed as npm scripts. `.tools/` is already gitignored.
- **Recorded for A5:** a real Python already exists at
  `%APPDATA%\uv\python\cpython-3.12.13-windows-x86_64-none\python.exe` with **pip 26.1.2**. The
  brief's "no real Python, pip does not exist" is true of the *system PATH* only. This is the
  explicit `--python` argument for uv's known *"Missing expected target directory for Python
  minor version link"* failure, and a fallback if bootstrap misbehaves.

---

## A3 — Documentation skeleton, brief decomposed into it

Tree per brief §7.1. **Everything sanitised to codes.** Tags carried across verbatim; not one
promoted. In priority order:

1. `docs/README.md` — the index, grouped like Orbitarium's, one line per doc saying *when to read it*.
2. `AGENTS.md` (~120 lines, topic-sectioned like Wallpaper's) and `CLAUDE.md` (~40 lines:
   `@AGENTS.md` import + Claude-specific direction). Under 200 lines, hard.
3. `docs/DECISIONS.md` (dated journal) and `docs/NEEDS_YOUR_INPUT.md` (Granify's
   **Blocked / Resolved**, newest-first, each with a *To resolve* line), seeded with **every**
   Track B item, all 25 Track C questions, and the practice-naming question above.
4. `docs/product/glossary.md` — **before anything else that names things.** Pins "on call"
   (resident vs at-home — legally load-bearing per §4.6), shift/duty/session, roster vs rota vs
   schedule, and **"weekend"**, which fairness counting depends on. Weekend stays `[UNKNOWN]`
   with both candidate definitions written out — it is a question, not a gap to fill.
5. `docs/domain/constraints.md` (H-01…H-07, S-01…S-06, **and the "Explicitly NOT constraints"
   section** — the 8-hour turnaround being *acceptable* is the finding most likely to be
   helpfully re-broken), `shift-patterns.md` (A/B/C + per-date override), `holidays.md`
   (computus, Sunday→Monday, ad hoc declarations, s2(2) substitution), `fairness.md`
   (burden weights, ledger, lexicographic objective).
6. `docs/domain/commands-events.md` — event-storming pass: commands, events, policies.
7. `docs/architecture/overview.md` (C4 L1+L2 as Mermaid `flowchart`, **never `C4Context`**),
   `data-model.md` (`erDiagram` + temporal model + invariants), `solver-contract.md`
   (request/response JSON schemas, `sequenceDiagram`, timeout and infeasibility semantics).
8. `.claude/rules/{typescript,solver,tests}.md` with `paths:` frontmatter — loads only on a
   matching file. The real context-saving mechanism, and it is free.
9. `.claude/skills/{adr,new-constraint,solver-debug}/SKILL.md`;
   `.claude/agents/{spec-reviewer,domain-checker}.md`, both read-only.

Also `docs/product/vision.md`, `prd.md` (EARS + explicit out-of-scope), `docs/ops/compliance.md`,
`environments.md`, `runbook.md`.

**Two brief-internal contradictions resolved, both recorded in `DECISIONS.md`:**

- §0 says archive the brief to `docs/archive/2026-08-project-brief.md`; §6.7 says it never leaves
  `private/`. **§6.7 wins** — it stays private, `docs/README.md` carries a pointer.
- §7.1 puts the six research reports in `docs/research/`; they name doctors throughout. **They
  stay in `private/research/`.**

`docs/domain/worked-examples.md` is created as a **stub explaining why it is empty**: it needs the
16 roster images (B2). Writing it from the brief's summaries would be inventing evidence.

---

## A4 — ADRs 0001–0009

`docs/architecture/decisions/`, MADR-minimal, **Y-statement first line**, and a
**Considered alternatives** section carrying the brief's rejected options *with their reasons* —
that section is the whole point; without it these get re-proposed every session forever.

This is a deliberate upgrade on the sibling repos, whose ADRs
(`Wallpaper/docs/decisions/0002-…`) are Nygard-flavoured Context/Decision/Consequences with no
rejected-alternatives section.

`0001` record ADRs · `0002` public repo on personal account, Actions permitted · `0003` Graphify
deferred · `0004` OR-Tools CP-SAT · `0005` solver as separate Python service behind a Postgres
queue · `0006` custom CSS Grid over a commercial scheduler · `0007` shared-schema RLS
multi-tenancy · `0008` temporal validity intervals over soft deletes · `0009` PWA-first, no
native wrapper.

Every one is marked **`proposed`, not `accepted`** — B4 is your sign-off. Recording them as
accepted before you have read them would misrepresent their status, which brief §11 rule 11
forbids.

---

## What this plan will not do

No `git push`, no GitHub repo, no publishing. No accounts. **No `git init` or commit without
asking** — I will not stage either, so `git status` stays yours to run first at B1. No real
doctor name outside `private/`. No tag promoted. No `/init`. No Track B or C work, and no Track C
question answered by inference. No application code beyond the stripped scaffold route.

## Verification

1. `npm run check` green end to end.
2. `node scripts/check-no-real-names.mjs` → clean; then **deliberately plant a real surname in a
   scratch doc and confirm it fails**, and confirm an allowlisted string does not. An unproven
   check is not a check.
3. `node scripts/check-docs.mjs` → all links resolve, index complete, every H-/S- ID defined.
4. `grep -rE "<15 surnames>" . --exclude-dir=private` → no matches.
5. `.gitignore` line 1 (non-comment) is `private/`.
6. Both hooks fire on a scratch commit attempt in a throwaway clone, not this tree.

## Then A5–A8

A5 solver prototype (`[CONFIRMED]` constraints only; `[ASSUMED]` behind flags defaulting off;
penalty registry from the first line; the fast-check FEASIBLE⇒hard-constraints-hold invariant;
snapshot the *model*, never a roster). A6 unblocked research — **Supabase SA region is the top
open question and gates the first migration**. A7 CI YAML authored not enabled, including the
`github_token`-as-input trap. A8 Graphify last, once there is code to index.

Open items land in `docs/NEEDS_YOUR_INPUT.md` as I hit them; a "what's next" list at each natural
stopping point.
