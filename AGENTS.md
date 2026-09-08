# AGENTS.md

Durable project instructions for whoever is doing the work — human or agent. Amend this file when
the maintainer states a recurring preference or working rule. Do not record one-time exceptions.

## Task protocol

- Begin every task by reading this file and [`docs/README.md`](docs/README.md), then the focused
  documents relevant to the requested work. The index exists so you do not have to read everything.
- **Repo state is ground truth.** Verify anything remembered from outside it against the repository
  rather than trusting it.
- Read a multi-part request **fully** before acting on any part of it.
- **Precise scope adherence, especially on correction.** When scope narrows mid-task, stop the
  now-out-of-scope work immediately.
- End every task with a **documentation-impact review**. Update the affected durable documents in the
  **same change** whenever requirements, decisions, behaviour, setup, tests or status changed.
  Documentation is part of the feature, not cleanup after it.
- **A summary given only in chat does not count as done.** Write it down.
- At any natural stopping point, a short concrete **"what's next"** list is more useful than a summary
  of what was just done.
- Update [`HANDOFF.md`](HANDOFF.md) at the end of any session that changed enough to matter.

## Hard rules

- **Never commit to git without being explicitly asked.** Staging is fine; committing is the owner's
  call. This is deliberate, not an oversight.
- **No real doctor name in any file outside `private/`.** See the data boundary below.
- **Never silently promote a confidence tag.** `[ASSUMED]` → `[CONFIRMED]` requires a human source.
- **Log anything genuinely needing the owner's decision** in
  [`docs/NEEDS_YOUR_INPUT.md`](docs/NEEDS_YOUR_INPUT.md) with enough context to resume instantly —
  then build up to the blocked point behind a swappable interface and carry on. **Do not stall.**
- **Use only the terms in [`docs/product/glossary.md`](docs/product/glossary.md).** If you need a
  domain term that is not there, stop and ask. Do not invent one.
- **Give honest technical opinions, including "no" and "this is a bad idea."** This has been asked for
  explicitly, more than once. It includes disagreeing with the owner's own suggestions.
- **Ground non-trivial claims in something checked** — a doc, a real error, a source file — and say
  what was actually checked, not just the conclusion.
- **Never present roadmap concepts as shipped features.** Distinguish accepted decisions, proposals,
  experiments and implemented behaviour.
- Keep the repository clean and professional. **It is public from day one** — no machine-specific
  paths, no placeholder text, no stray files, no secrets.

## The data boundary — read this before writing anything

This repository is public, and the practice's source material identifies **thirteen real doctors**,
showing day by day where each of them was for over a year. Under POPIA that is personal information
about identifiable living people who have not consented to its publication.

- **Real names live only in `private/`**, which is the first line of `.gitignore`.
- Everything committed uses stable codes **`D01`…`D13`** (plus `D14`/`D15` for departed doctors).
- **Fixtures, test data and worked examples use synthetic names.** They end up in a public repo and
  quite possibly in a screenshot.
- `npm run names:check` fails the gate if a real surname appears outside `private/`. It reads the name
  list from `private/` at runtime, so the names are never hard-coded into a committed script.
- `npm run publish:check` answers the other half: **which files would be published at all.** It walks
  the tree, applies the ignore rules without needing a `.git` directory, and fails on anything under
  `private/` or any image or document. That is the leak the text checks cannot see — a roster JPEG
  contains no matchable surname and no secret pattern.
- The check is **case-sensitive and word-boundary anchored, with an allowlist**, because several
  surnames are ordinary words. If it fires on innocent prose, add the exact literal to the allowlist
  in `private/doctor-codes.md` — **do not loosen the check.**

The product itself holds **no patient data, no health data, and no free-text preference fields.** That
last one is not an oversight: a free-text box reliably collects religious observance, which is special
personal information under POPIA s26. Enforced in validation. This is a hard product boundary.

## Product intent

A call-roster scheduling app for a private emergency-medicine practice running **24/7 single cover** —
one doctor on duty at all times, thirteen doctors, every day of the year. The practice principal is
the admin, the sole scheduler, a rostering doctor himself, and **not technical**.

Four things outrank feature count:

1. **The export is the product.** The printable monthly grid is the artifact of record. The failure
   mode is precise: he builds the roster in the app, exports it, rebuilds it in Word because it does
   not look right, does double work, and quits. **Every hour on the export is worth ten on the
   editor.**
2. **He must be able to abandon the app mid-month with zero loss.** Every screen needs an export.
3. **Warn and scar, never block.** Violations are visible, explained and overridable — and the warning
   **stays** after an override. Only overlapping shifts are refused.
4. **The solver ships last.** You cannot model constraints nobody has stated, and a manual tool people
   use beats a solver nobody trusts.

## Architecture

- Next.js App Router, React, TypeScript. Postgres. Python solver as a **separate service** behind a
  Postgres job queue — never a synchronous request.
- **The interactive core is client components against a JSON API**, not Server Components with Server
  Actions. This keeps a future Capacitor lift viable without a rewrite. RSC is for the marketing site,
  auth, settings and PDF endpoints.
- **A day's shift structure is a property of the date, not the weekday.** The weekday supplies a
  default; any date can override it. This is in the schema from the first migration.
- **Temporal validity intervals, not soft deletes.** No `is_active`, no `deleted_at` on anything
  people-shaped.
- **Recurring structures use the iCal model** — master row plus RRULE plus exceptions. Never
  materialise recurring instances as rows. Expand at solve and render time.
- **Published rosters are immutable snapshots.** Editing creates version N+1; it never mutates N.
- The most important invariants live in the **database**: temporal foreign keys for membership
  containment, and a GiST exclusion constraint making double-booking impossible.
- **The solver boundary is hand-written on both sides and that is a known gap.** `npm run
  contract:check` compares the Python parser's accepted fields against the contract document and
  `fixtures/solver-request.json`, which is the cheap version of the same guarantee. Generation
  remains the intent — from a single machine-readable schema, not from the prose spec.
- **A weekday never crosses that boundary as an integer.** Monday is `0` in Python and `1` in
  TypeScript; both are correct, so an integer silently means the wrong day. Names only, converted by
  `lib/contract/weekday.ts` and `solver/src/call_roster_solver/wire.py`.
- Read [`docs/architecture/decisions/`](docs/architecture/decisions/) before proposing an
  architectural change. The rejected alternatives are recorded there specifically so they are not
  re-proposed.

## Solver rules

- **Make almost nothing hard.** Elasticise every constraint with a named slack variable and an
  order-of-magnitude penalty hierarchy: 10⁶ coverage, 10⁴ legal/rest, 10² contract, 10⁰ preferences.
- **Never optimise a dispersion measure.** Gini, Jain, standard deviation, mean absolute deviation,
  sum of squares and range are all non-monotonic — each improves when the *least*-loaded doctor is
  given more work. **Leximax over per-doctor load ratios is the fairness objective**; the rest are
  reported indicators only. See [ADR-0012](docs/architecture/decisions/0012-fairness-normalised-by-opportunity.md),
  and note this reverses an earlier recommendation.
- **Fairness is normalised by the burden of a doctor's opportunity set**, never by headcount or FTE.
  A weekends-only doctor works nothing but expensive shifts, so any per-head divisor reports them as
  overloaded and the objective responds by taking away the only work they can do.
  **The model must always return a solution.** Report violations, never "infeasible".
- **Build the penalty registry from the first line** — `(constraint_name, entity_refs, slack_var,
  weight)`. Every explanation and cost breakdown derives from it, and retrofitting it is painful.
- **Model on the regular-expression abstraction**, not an enumerated rule list. One primitive, one
  encoding, one test suite.
- **Pre-flight arithmetic before invoking the solver.** If a solve fails for a reason pre-flight could
  have named, the fix belongs in pre-flight.
- Always re-solve with a **churn penalty** against the previously published roster.
- `[ASSUMED]` and `[INFERRED]` constraints go **behind a feature flag, default off**, so a confirmed
  answer flips a switch rather than triggering a rewrite.

## Code quality

- Run `npm run check` before declaring work complete. It is the canonical, required gate, fourteen
  steps: `format:check` → `lint` → `typecheck` → `test:coverage` → `build` → `docs:check` →
  `contract:check` → `names:check` → `diagnostics:check` → `publish:check` → `seed:check` →
  `seed:layout` → `seed:holidays` → `workflows:check`.
  `npm run solver:check` is separate — Python, and it needs `uv`. Its fourth step, `solver:e2e`, has
  TypeScript build a request that Python parses and solves.
- **Do not weaken assertions, coverage thresholds, strict compiler flags or lint rules to make a change
  pass.**
- **`noUncheckedIndexedAccess` is on, and never silence it with a non-null assertion `!`.** Narrow
  properly. A roster engine is arrays indexed by day and by doctor; this flag will find real bugs, and
  `!` throws away exactly the safety it provides.
- Formatting is Biome; linting is ESLint with type-aware rules plus the Next.js set. **Biome's linter
  stays off** — two linters disagreeing about one file is worse than a slow one.
- Vitest defaults to the `node` environment. Component tests opt in per file with
  `// @vitest-environment jsdom`.
- **Property-based tests are not optional for the solver.** The highest-value one: *for any generated
  instance, if the solver returns FEASIBLE then every hard constraint holds.* Worth more than fifty
  hand-written tests.
- **Do not snapshot generated rosters.** CP-SAT is not deterministic across versions, worker counts or
  machines — a golden-file roster passes locally and fails in CI. **Snapshot the model instead** and
  assert properties of solutions, not their identity.
- Every bug fix gets a regression test.
- Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `chore:`) — for the compact `git log` more
  than the changelog.

## Machine environment

Verified facts. Do not rediscover them.

- **Python 3.12.10 + pip 26.2.1 IS installed** at
  `%LOCALAPPDATA%\Programs\Python\Python312\python.exe`, ahead of the Store stub. ⚠️ This line said
  *"there is no system Python"* until 7 September 2026 — true when written, quietly false later.
  **Still use `uv`**: it owns the solver's venv and lockfile.
- Also at `%APPDATA%\uv\python\cpython-3.12.13-windows-x86_64-none\python.exe` — pass it as an
  explicit `--python` if `uv` reports *"Missing expected target directory for Python minor version"*.
- **`gh` IS installed** at `C:\Program Files\GitHub CLI\gh.exe` (2.98.0). Earlier notes saying
  otherwise are stale.
- `gitleaks`, `uv`, **PostgreSQL 17.2 and Supabase CLI 2.117.0** are pinned into a gitignored
  `.tools/` by `setup:gitleaks`, `setup:uv` and `setup:postgres`, checksum-verified. Nothing depends
  on machine `PATH`. **No Docker, and none needed** — the Postgres binaries run a cluster from a
  folder with no installer, no service and no admin rights.
- Node 24.19.0, npm 11.17.0, Windows 11. No Mac — hence PWA-first.
- npm 11 gates install scripts; three are explicitly approved in `package.json` under `allowScripts`.
- **Bash heredocs mangle `\\` here.** Write any file containing regex escapes with an editor tool, not
  a heredoc — every escape in a `.mjs` written that way broke.

## Keeping context cost down

The owner's stated concern is credit usage, and it is the reason for several rules above. Measured on
2 September 2026 rather than guessed at — the per-session floor was **1,970 lines / 113 KB ≈ 28k
tokens before any work started**, and `HANDOFF.md` was 1,530 of those lines.

### The per-session floor, and the ceiling that keeps it there

| Loaded every session | Ceiling |
|---|---|
| `CLAUDE.md` | **80 lines.** It loads every session and a bloated one causes the real instructions to be ignored |
| `AGENTS.md` | **220 lines** |
| `HANDOFF.md` | **200 lines** |
| `docs/README.md` | **200 lines** |

**If a ceiling is breached, split or archive — do not shave prose.** After the archive it was 827
lines / 51 KB, a 55% cut.

### ⚠️ `HANDOFF.md` is overwritten, not appended

It reached 22 top-level sections, 19 of them history, **each duplicating a `DECISIONS.md` entry
written in the same session.** Two hand-maintained journals describing the same work — the waste was
in the writing as much as the reading.

- **`docs/DECISIONS.md` is the one dated journal.** Append there. It is read on demand, so its length
  costs nothing per session.
- **`HANDOFF.md` is current state only.** Replace it. A ten-line "last session" pointer to
  `DECISIONS.md` is the whole history section.
- `docs/history/` is closed. Do not add to it.

### Mechanisms that cost nothing

- **Many small documents beat one big one.** A 400-line file costs 400 lines of context to answer one
  question; four 100-line files cost 100.
- **[`docs/README.md`](docs/README.md) is the index.** Use it instead of exploring.
- **`.claude/rules/*.md` load only when a matching file is touched.** The real context-saving
  mechanism — prefer a path-scoped rule over another paragraph in `AGENTS.md`.
- **Skills load their body only when invoked**, so long reference material costs nothing until needed.
- **`.ignore` keeps build output and the Hypothesis cache out of search results.** This repo has no
  `.git` yet, and ripgrep only honours `.gitignore` inside a git repository — so every search was
  walking `.next/`, `coverage/` and `.hypothesis/`. One Hypothesis constants file is a single array
  of every string literal in the solver and matched almost any domain search. Keep `.ignore` in sync
  with `.gitignore`.
- Write plans to files in plan mode; they survive compaction where conversation history does not.
- Delegate broad exploration to subagents so their output stays out of the main window — **but only
  when asked.**

### Working habits that cost nothing and save a lot

- **Run gates with output discarded; inspect only on failure.**
  `npm run check > /dev/null 2>&1; echo $?` — the full pass prints hundreds of lines of seed
  reports, and on a green run every one of them is waste.
- **Read ranges, not whole files.** `sed -n '40,80p'` over a 600-line document, or `Read` with
  `offset`/`limit`.
- **Never re-read a file to verify an edit.** `Edit` and `Write` fail loudly; a successful one needs
  no confirmation, and re-reading pays twice.
- **Cap search output** — `head_limit`, `-o` for just the match, `files_with_matches` when the paths
  are the answer.
- **Batch independent shell work into one call.** Each round trip re-sends context.
- **Prefer editing a file in place over rewriting it**, so unchanged content is not re-emitted.
