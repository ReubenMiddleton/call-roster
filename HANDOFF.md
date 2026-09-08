# HANDOFF

**Last updated:** 8 September 2026. **The engine and the renderer are done; the application is not.**
The full loop runs — history → solve → printable PDF, verified against the practice's own sheet.

⭐ **THE NEXT MILESTONE IS THE OCTOBER 2026 PILOT**, confirmed by the principal on 7 September: the
first real month the solver is tested on. ⚠️ **It must not depend on the app existing.** The
existing pipeline already produces exactly what he needs, and September proved it end to end —
treating October as an app deadline is how a six-week runway becomes a failure.

⭐ **Measured blind against the practice's real hand-built September:** anchored slots **88.6%,
stable**; overall **54–63%, a RANGE** — the model is under-determined, so one solve is a sample, not
a measurement. Target: `private/actual-2026-09.json`.

**Written for:** the next session, human or Claude, picking this up cold weeks later.

> **Current state only.** Overwritten, never appended — history lives in
> [`docs/DECISIONS.md`](docs/DECISIONS.md), newest first. **Ceiling 200 lines**; if it breaches,
> archive, do not shave prose. `AGENTS.md` has what it cost when this was 1,530 lines.

## Read this first, in this order

1. **This file**, then **[`docs/README.md`](docs/README.md)** — the index. **Use it, don't explore.**
2. **[`docs/NEEDS_YOUR_INPUT.md`](docs/NEEDS_YOUR_INPUT.md)** — the blocked queue. Read before
   assuming anything about the domain.
3. **[`CLAUDE.md`](CLAUDE.md)** → imports [`AGENTS.md`](AGENTS.md) — the standing working rules.
4. `private/PROJECT-BRIEF.md` — **only** for provenance on a claim; re-reading it whole is the
   biggest avoidable token cost here.

## What this project is, in four lines

A call-roster scheduling app for a private emergency-medicine practice at a hospital in Limpopo,
South Africa — 13 doctors, 24/7 single cover, one doctor on duty at all times. The principal,
**D01**, collects requests over WhatsApp, transcribes them into a paper diary, and hand-builds next
month's grid in a Word table around the 20th. We are replacing that.

## Verify the state

```bash
npm run check && npm run solver:check && npm run db:check && npm run api:check
```

Four independent gates — `solver:check` needs `uv`, the last two need
`npm run setup:postgres`. **All green, 8 September 2026.**

⚠️ **None of the four proves the app runs on Supabase** — they connect as a cluster-owning
superuser that can `SET ROLE` and ignores default grants. 8 Sept: all 16 migrations applied to prod
and **every route would still have 500'd** (`0017`). Also run **`db:prod:verify`** and
`db:tester:verify`. Migrations are **append-only** — `.claude/rules/migrations.md`.

✅ **Public repo live, CI green on `main`**: [ReubenMiddleton/call-roster](https://github.com/ReubenMiddleton/call-roster).
`publish:check` and git now agree **exactly** — 258 files, nothing under `private/`, no images.
Committing is still **the owner's call, every time.** Hooks installed: names + gitleaks on commit.

---

## ⚠️ There is no application yet

**"Close to an MVP" would be badly wrong** — the documentation volume flatters the state.

| Exists and is tested | Does not exist |
|---|---|
| `lib/analytics/` — burden, load ratios, leximax, membership, capacity, workforce timeline | **The schema is live on both Supabase projects** (`db:prod:verify` / `db:tester:verify`, 7/7) — **nothing writes to them yet** |
| `lib/calendar/` — SA public holidays, the pattern-precedence resolver, and a month's days built from the calendar alone | **The API covers the full roster lifecycle, swaps, notifications (recorded), ICS feeds (working), a tenant-scoped burden schedule and auto-recalculating ledger** (`npm run api:check`) — **no WhatsApp delivery** |
| `lib/export/render-html.ts` — the printable sheet, measured from the `.docx`. `npm run export:render`, or `render-export.ts --request … --solved …`. Detail in [`export.md`](docs/product/export.md) | **The editor UI** |
| `solver/` — CP-SAT, elasticised, **20 of 21 constraints**, contract 1.7.0, 152 tests | **The editor UI.** `app/` is three scaffold files |
| `lib/export/calendar-layout.ts` — geometry, verified against 1,023 real cells | **Auth**, and anything multi-user |
| `lib/analytics/departure.ts` — how far a **"variant"** month sits from habit, on 33 months | **The declared-availability poll.** Agreed, not sent — question 44 |
| `lib/analytics/constraint-history.ts` — every constraint verdict recomputed per era (`seed:eras`) | **The learning loop** — ADR-0016. The L1 journal it needed now exists; still needs real usage to learn from |

**Three ways a solve lies, all seen for real:**

- **An empty `burdenLedger`.** `--future` far past the data lands the window after the history ends,
  so S-01 and S-08 silently do not run. **Solve the month right after the data.**
- **`OPTIMAL, objective 0`** is an empty objective, not a good result. Run `seed:solver-departure`.
- **A single solve's score.** The model has many optimal rosters. Average, or use
  `solve(deterministic=True)`.

**The command that is the pilot:** `build-solve-request.ts --future 2026-10` builds a month that
**has never existed** and solves it. On a holiday that drops the weekday pattern it refuses and
names the date; answer with `--pattern 2027-03-26=A`. **That loop is October.**

---

## WHAT TO DO NEXT

### 1. The database and the API

✅ **Schema live on both Supabase projects** (RLS from line one, GiST exclusion, H-03 as a trigger
not a native PG18 FK — host is PG17.6, [addendum](docs/architecture/decisions/0008-temporal-validity-intervals.md)).
✅ **The API covers roster lifecycle, swaps, notifications, ICS feeds and the ledger** —
[`docs/architecture/api.md`](docs/architecture/api.md): `DRAFT→PUBLISHED→LOCKED→ARCHIVED`,
`RequestSwap`/`ApproveSwap`/`RejectSwap`, a real RFC 5545 feed per doctor (`GET /api/ics/:token`,
via a `SECURITY DEFINER` function solving a real RLS chicken-and-egg problem), and
`.../ledger/recalculate` reusing `lib/analytics/{ledger,burden,equity}.ts` as-is. ✅ **The ledger
reads each tenant's own burden schedule** (409 across a schedule-version change) and
**recalculates automatically** on `PublishRoster`/`ApproveSwap`, never blocking. Notifications
recorded, not sent (Track B6). `npm run api:check`, 60 assertions. **Next: the Supabase keep-alive ping
(both projects pause after 7 days idle), or L4/L6 below.**

### 2–4. Then, in order

- ✅ **Diagnostics L0/L1/L2/L3/L5** ([ADR-0013](docs/architecture/decisions/0013-first-party-diagnostics.md)):
  `command_journal` (L1); `error_record` (L2); `solve_run` carries every L3 field, proven by
  `solver:e2e` — **no `GenerateDraft` pipeline to call it**; `.../diagnostic-bundle` (L5). ⚠️ No
  UI, error boundary, L4 or L6 — `docs/architecture/api.md`.
- ✅ **`provenance` is no longer inert** — `ApproveSwap` uses the request's own; a `requested` assignment grows `burden`, not `equalisableBurden`.
- **The editor UI, last.** Client components against the JSON API.

## Buildable right now, with no input at all

✅ **Nothing is.** The last three shipped 7 September — `tentative` (a sign flip, not a discount),
`validFrom` (ADR-0017: **no**), `lockedAssignments` (**H-13**). **20 of 21 built**; S-07 is falsified.

⭐ **The next feature is decided and mostly designed: LOCK-AND-REGENERATE.** Generate, lock the cells
that are right, regenerate the rest, repeat. The owner's idea, 7 September. **The solver side already
exists** — H-13 shipped the day before — so this is UI and a journal, not solver work. Two
failure modes, both in [`NEEDS_YOUR_INPUT.md`](docs/NEEDS_YOUR_INPUT.md): locking can paint into
a corner (**run pre-flight on the locked set before regenerating**), and "show me another" runs
out (**say so, never silently repeat**). Keep every candidate of a session, not three.

⚠️ **The model is under-determined** — many rosters share the optimal objective, so *"generate"
pressed twice shows two different rosters*. That is the raw material for "show me another", and it
also means **`solve(deterministic=True)` for any measurement** (`interleave_search` + fixed seed,
~4s vs ~0.4s; never in production).

## ⚠️ Trust the measurements over the prose

**Ten documented claims have been falsified.** The worst: **the catalogue cited a test for H-03 that
had never been written, for a constraint the model never enforced.** `docs:check` now fails on a
cited test that does not exist, and caught a second on its first run. **When a script and a document
disagree, re-run the script — and check the citation is real.** ⚠️ **The tenth, S-07, was caught
*before* the code was written** by measuring the `[ASSUMED]` claim first — the cheapest one yet.

**Check the measurement itself is not rigged**, and **check what its inputs are worth.** Five
conclusions have been reversed by re-examining one: a candidate roster moving its own denominator; a
shrinkage sweep whose target was 97% its own training set; an era spread counting assignments where
the occasion was the day; **a "correction" I published that was itself wrong**; and **a blind score
quoted as a point when the model has many optimal answers**. Also: **"validated" is not "used"** —
H-03's dates were parsed then discarded, which `contract:check` cannot see.

⚠️ **And the data itself is sheets, not hours.** All 33 months are transcriptions of what was
*published*. At least one sheet is now known to be wrong about what actually happened (7 September,
D05). Nothing here can detect that — only the principal can.

---

## TRACK B — needs the project owner, ~45 minutes

| # | Task | Note |
|---|---|---|
| **B1** | Create the public repo, `git init`, first commit, push | ✅ **DONE 8 Sept** — [ReubenMiddleton/call-roster](https://github.com/ReubenMiddleton/call-roster), public, CI green on `main`. Dependabot: #4/#6 merged; **#3/#5 closed — vitest 5 is blocked upstream** (`@fast-check/vitest` peers `vitest@^4`, no release supports 5); #1/#2 rebasing |
| **B3** | Claude GitHub App, `CLAUDE_CODE_OAUTH_TOKEN` secret, CodeQL default setup, secret scanning, push protection | ✅ **DONE 8 Sept.** App installed, secret set, **verified by running it** — `claude-ci-watch` reached `success`/`num_turns: 2` and stayed silent on a green `main`; `claude-review` reached `clean: true` on PR #8. CodeQL (5 languages), secret scanning, push protection all on. ⚠️ **Review skips Dependabot on purpose** — those runs get no Actions secrets, so it can never work there |
| **B5** | Skim the `docs/` tree and confirm the domain transcription | A misread constraint is far cheaper to catch here than after the solver ships |
| **B6** | Start Meta WhatsApp business verification | ⏸️ Deferred until after a pilot month. 2–5 days typical, up to 30 |
| **B7** | Create **two Supabase projects** — prod, and a synthetic-data tester environment | ✅ **DONE 8 Sept.** Both live on PG **17.6**, `eu-west-1`, migrated to `0017`, **7/7 green** on each — `npm run db:prod:verify` / `db:tester:verify`, **no default target on purpose**. Credentials in `.env.local` + `private/` only. ⚠️ **Still needed: the keep-alive ping** — both pause after 7 days idle and this is used monthly. See [`supabase-setup.md`](docs/ops/supabase-setup.md) |
| **B8** | Confirm the D01–D16 mapping in `private/doctor-codes.md` | Five seconds; everything downstream depends on it. Codes are permanent once confirmed. Question 32 |

**All ADRs accepted** (0013–0017 on 7 September). ✅ **B1 is no longer gated** — the other twelve
doctors know, which was the only reason the irreversibility mattered.

## TRACK C — needs the practice principal

**Eighteen answered 4 September, sixteen more on 7 September** — tables at the top of
[`docs/NEEDS_YOUR_INPUT.md`](docs/NEEDS_YOUR_INPUT.md). What is still open:

- **44 — the poll itself.** ✅ *Agreed*: change the monthly ask from *want* to **can**, plus a
  cannot-work list. ⚠️ **Not yet sent, and one design point must survive the trip** — renaming the
  first list to "can" makes it *exhaustive*, so an unlisted date silently becomes unavailable. Send
  **three states with the default printed on the poll** ("everything else: available"). Tick boxes
  and dates only, **never a reason** — POPIA s26.
- **47** is with his brother: a freely distributable font pair, during the refresh, next few weeks.
- ⚠️ **The diary goes stale.** Two doctors changed their minds *after* it was written in September.
  The poll needs a stated cut-off and a way to record a late change, or the diary and the roster
  drift apart silently.

**Nothing else is open.** 38 (90 days), 42 (lock-and-regenerate), 45 (no company until 2027) and the
pilot month were all answered on 7 September.

---

## Decisions locked — do not re-litigate

**All seventeen ADRs are accepted.** Read
[`docs/architecture/decisions/`](docs/architecture/decisions/) before proposing an architectural
change — **rejected alternatives are recorded there so they are not re-proposed**, and ADR-0004
carries a dated re-verification against Timefold, Gurobi and the commercial UI components. If you
disagree with one, say so explicitly and record it. Do not silently do something else.

## The three things most likely to sink this

1. ⭐ **Treating the October pilot as an app deadline.** ✅ *"Build the export before the editor"* —
   the old number one — is **done**, and this replaced it on 7 September. The pilot tests **the
   roster**, not the product: the existing pipeline already generates and renders one, and September
   proved it. Racing a half-built editor into October risks the only thing that matters, which is
   his opinion of the roster itself.
2. **Building the solver as a product feature too early.** The prototype is research; the *shipped*
   solver is last in the build order on purpose.
3. **Letting an LLM generate the roster.** 2% feasibility on hard nurse-rostering benchmarks, and it
   invents people who do not exist.
