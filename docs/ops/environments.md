# Environments and infrastructure

Local setup, the toolchain, and the hosting decisions — including one finding that contradicts the
recommended stack and needs the owner's decision before any migration is written.

---

## Local development

Requires **Node ≥ 22** and npm 11.x. Verified on this machine: Node **24.19.0**, npm **11.17.0**,
Windows 11.

```bash
npm install
```

```bash
npm run check
```

`npm run check` is the canonical gate: `format:check` → `lint` → `typecheck` → `test:coverage` →
`build` → `docs:check` → `names:check`. See the
project README for what each step enforces.

### Checkout-local tooling

Nothing is installed system-wide. Two bootstrap scripts fetch pinned, checksum-verified binaries
into a gitignored `.tools/`:

```bash
npm run setup:gitleaks
```

```bash
npm run setup:uv
```

| Tool | Pinned | Why checkout-local |
|---|---|---|
| **gitleaks** 8.30.1 | `.tools/gitleaks.exe` | Pre-commit secret scan. Identical behaviour on every machine |
| **uv** 0.12.6 | `.tools/uv/uv.exe` | The only viable Python route on this machine |

Both scripts verify the download against the release's own published checksum **before**
expanding it. Re-running is cheap and idempotent.

### Python — read this before touching `solver/`

**There is no system Python on this machine.** `python` resolves to the Microsoft Store stub and
there is no system `pip`. The solver is Python, so this matters more here than it would elsewhere.

Use `uv` for everything: `uv init`, `uv add ortools`, `uv run`. **Never write setup instructions
that assume `pip`.**

Two hard-won details:

- `uv` can fail with *"Missing expected target directory for Python minor version link"*. The fix
  is to pass an explicit interpreter rather than letting `uv` choose.
- A working interpreter already exists on this machine, and it is the one to point at:

  ```
  %APPDATA%\uv\python\cpython-3.12.13-windows-x86_64-none\python.exe
  ```

  Verified 26 August 2026: **Python 3.12.13 with pip 26.1.2**. A 3.14.6 interpreter is also
  present. So the brief's *"no real Python, pip does not exist"* is true of the **system PATH**
  only — this is the fallback if the `uv` bootstrap misbehaves.

### Git hooks

Hooks are lefthook-managed and install automatically on `npm install` — **once a git repository
exists**. Until `git init` has run, the `prepare` script skips with a message rather than failing
the install. After initialising, run:

```bash
npx lefthook install
```

Pre-commit: format, lint, gitleaks, real-name check. Pre-push: typecheck, tests, docs check.
Type-checking is on pre-push deliberately — it cannot meaningfully scope to staged files.

### Telemetry

Next.js collects anonymous usage telemetry by default. Given this project's privacy posture it is
worth turning off; it is a user-level setting rather than a repository one, so it is not committed:

```bash
npx next telemetry disable
```

### `npm` install scripts

npm 11 gates package install scripts. Three are explicitly approved in `package.json` under
`allowScripts`, and each is required for the toolchain to function at all:

| Package | Why it needs a postinstall |
|---|---|
| `esbuild` | Fetches its platform binary — Vitest cannot run without it |
| `lefthook` | Fetches its Go binary — no hooks without it |
| `unrs-resolver` | Native resolver used by the Next.js ESLint config |

Keeping this list explicit in `package.json` is a feature: every executable postinstall in the
dependency tree is visible and reviewable in a diff.

---

## Hosting

### ✅ The Postgres host question — decided, Supabase

**Decided by the project owner, 26 August 2026: Supabase, nearest region.** See
[`supabase-setup.md`](supabase-setup.md) for the concrete steps to create the two projects
(the one piece of this that needs the owner's own account) and the region pick. The trade-off that
led here, researched 26 August 2026:

> **Supabase does not offer a South African region.** South Africa was selectable during
> Supabase's alpha and is no longer available for new projects; `af-south-1` is described as
> requiring special-casing that increases operational burden. The longest-standing community
> request ([discussion #34614](https://github.com/orgs/supabase/discussions/34614), opened April
> 2025) remains **unanswered by Supabase staff** — not rejected, but not committed either.
>
> **Neon does not offer one either.** Its Azure-native regions are US and Germany only.

Meanwhile every major cloud *does* have a South African region: **AWS `af-south-1`** (Cape Town),
**Azure South Africa North** (Johannesburg), **Google Cloud `africa-south1`** (Johannesburg), and
Oracle Johannesburg.

**This is a genuine trade-off, not an oversight**, and it is the owner's to make:

| Option | Gains | Costs |
|---|---|---|
| **Supabase, offshore region** | Auth, RLS tooling, Realtime and the job-queue story all work out of the box. Fastest route to a working product | Data leaves South Africa. **Legally defensible** — POPIA s72(1)(a) is disjunctive, so a properly drafted agreement satisfies adequacy with no SCC regime — but it is a procurement flag in any future hospital security review, where residency is a de facto requirement |
| **Managed Postgres in a South African region** | Residency satisfied outright. Nothing to explain in a security review | Auth, realtime subscriptions and the RLS tooling must be assembled rather than adopted. Materially more work for a solo developer |

**Recommendation:** start on **Supabase in its nearest region** for the pilot, because the pilot has
one practice, no hospital procurement in the loop, and the binding risk is *never shipping*, not
residency. Then treat "move to a South African region" as a known, costed migration triggered by the
first real procurement conversation — and keep the schema portable (plain Postgres, no
Supabase-specific SQL beyond RLS and auth hooks) so that it stays a migration rather than a rewrite.

**Decided**, per the recommendation above — logged in
[`../NEEDS_YOUR_INPUT.md`](../NEEDS_YOUR_INPUT.md) question 8. "Nearest region" is now concrete:
**`eu-central-1` (Frankfurt)**, verified 2026-09-08 — see [`supabase-setup.md`](supabase-setup.md).

### MCP servers — researched 2026-09-02, and the answer is "almost none, for now"

**⚠️ MCP tool definitions are not free, and they are charged every turn.** Roughly **250 tokens per
tool**, loaded into context *before the first message* and again on every subsequent turn. Measured
examples: three servers with 81 tools consumed **20,000+ tokens** before any work started; the GitHub
server alone is reported at **~55,000**. A twenty-turn session with 15k of schema overhead pays 300k
in tool definitions alone.

Since the owner's stated concern is credit usage, **adding servers works directly against the thing we
just spent a session fixing.** The January 2026 MCP Tool Search mechanism mitigates it — a client
defers schema loading past ~10% of the window and the model fetches definitions on demand, reported at
a 95% reduction in startup cost — but deferral is a discount, not a refund.

**So the test for adding one is: does it do something a CLI or an existing tool cannot?**

| Candidate | Verdict |
|---|---|
| **GitHub** | **No.** `gh` 2.98.0 is already installed and does everything needed at **zero** standing context cost. This is the single most-recommended server online and the clearest example of paying ~55k tokens for a CLI we already have |
| **Filesystem** | **No.** Read, Write, Grep and Glob already cover it |
| **Playwright / browser** | **No.** A browser tool is already available in-session |
| **Library-docs servers** (Context7 and similar) | **Not yet.** Genuinely useful for avoiding stale API guesses, but `WebFetch` answers the same question on demand at no standing cost. Reconsider if version-drift bugs become a pattern |
| **Postgres** | **Yes — but only later, and only against the dev database.** See the boundary below. Reported as one of the cheapest schemas, and once a database exists it replaces a whole class of throwaway query scripts |
| **Supabase** | **The one genuine candidate besides Postgres.** Reviewed on utility 2026-09-02 — see below |
| **Chrome DevTools** | **Maybe, when debugging the running app gets hard.** Cheaper per interaction than Playwright MCP, which re-snapshots the whole accessibility tree after every action. A browser tool already exists in-session, so this is a "reach for it if that proves insufficient", not a setup step |
| **Playwright** | **No, and for a specific reason** — see *visual regression* below |
| **Git** | **No.** Bash runs `git` directly, and there is no `.git` yet in any case |
| **Fetch** | **No.** `WebFetch` covers it on demand |
| **Memory / knowledge-graph servers** | **No, and actively unhelpful.** Graphify already indexes this repo, and a file-based memory directory already exists. **A second memory store means two places to look and two chances to be stale** |
| **Sequential Thinking** | **No.** Structured prompting dressed as a tool |

### Supabase — the one worth planning for, with conditions

**32 tools across 8 groups** (database, auth, storage, edge functions, branching, debugging, project
management, docs search), so roughly **8k tokens of standing schema** — an order of magnitude more than
a plain Postgres server. What earns that, specifically for this project:

- **RLS policy inspection.** [ADR-0007](../architecture/decisions/0007-shared-schema-rls.md) puts
  shared-schema RLS at the centre of the tenancy model, and
  [ADR-0011](../architecture/decisions/0011-tiered-testing.md) classes tenant isolation as
  *unrecoverable* — maximum rigour. Being able to read back the live policies and compare them against
  intent addresses the highest-severity risk class in the project.
- **Migrations against a branch**: create, apply, verify, merge. Directly useful given the temporal
  schema and the GiST exclusion constraint. ⚠️ **Branching is a paid-plan feature**, so on the free
  tier this reduces to "run SQL carefully".
- **TypeScript type generation** from the schema — one fewer hand-written boundary.

**Supabase's own guidance matches the conclusion reached here independently: read-only, project-scoped,
manual tool approval, and a development project rather than production.**

**⚠️ Prompt injection is the documented risk**: text in a database row can carry instructions that
hijack the agent. This product's surface is **unusually small**, because it deliberately holds **no
free-text preference fields** — a hard product boundary taken for POPIA s26 reasons, now paying a
security dividend. It is not zero: the audit trail carries a `reason`, and names are free-form. So the
read-only and dev-project rules still apply.

### Visual regression is structurally not an MCP job here

Tempting, and worth writing down so it is not re-proposed. **The export is the artifact of record**, so
its visual regression is Tier 2 in ADR-0011 — and that ADR already requires it to run **only in a
pinned container**, because font rendering differs across machines and screenshot-on-host is the
fastest route to a permanently red suite.

**An MCP browser drives *this* Windows machine.** It therefore cannot satisfy the one visual-testing
requirement the project actually has. Containerised Playwright in CI does. An in-session browser
remains useful for *looking* at the app while building it — which is a different job.

### For what remains, skills beat MCP servers

The next real needs are document-shaped: **the blank Word template and logo** (question **G**), and the
printable PDF that is the product. Both are covered by **skills**, which load their body only when
invoked and cost **nothing** the rest of the time — the mechanism this repo already uses for `adr`,
`new-constraint`, `solver-debug` and `graphify`.

**An always-on server is the wrong shape for an occasional need.** Prefer a skill wherever the work is
episodic, and reserve MCP for a live system that must be queried repeatedly.



### ⚠️ The data boundary applies to MCP servers, and it rules out the obvious setup

**A Postgres MCP pointed at the pilot database would defeat the entire architecture of this
repository.**

The repo contains no real names because `D01`…`D16` codes are used throughout. **The running
application is the opposite: the `doctor` table is exactly where the thirteen real names live**, since
the principal must see them on the roster he prints. A database MCP issuing `SELECT * FROM doctor`
pulls those names into the model's context — a third-party transfer of personal information under
POPIA s72, and precisely the sub-processor leak
[`compliance.md`](compliance.md) and [ADR-0013](../architecture/decisions/0013-first-party-diagnostics.md)
are written to prevent.

**The rule, therefore:**

- A database MCP may connect to a **local development database seeded with synthetic names**. Never to
  the pilot or production database.
- It must be **read-only** regardless.
- The connection string belongs in local settings, never in a committed file — the repo is public.

This is the same reasoning that keeps Graphify's semantic extraction switched off: the documentation it
would index describes thirteen identifiable people's working patterns, so sending it to a third-party
model is an s72 transfer. **The tool being useful has never been the question.**

### PostgreSQL version

Researched 26 August 2026: **PostgreSQL 19 Beta 3 was released 13 August 2026**, with GA targeted
for **September 2026** and acknowledged potential slip into early October.

PG19 adds **`FOR PORTION OF`** — temporal `UPDATE`/`DELETE` that splits rows automatically, which is
exactly the *"this rule changed in March"* operation in a single statement. See
[`../architecture/data-model.md`](../architecture/data-model.md).

Practical position: GA is close, but **managed hosts trail major releases by months**, so PG19 is not
available to build on yet. Design the schema so adopting `FOR PORTION OF` later is a trivial
migration, and hand-roll the interval splits in the meantime. Target **PG18** for the first
migration — it has the temporal primary keys and temporal foreign keys the model depends on.

### Deployment shape

| Component | Target | Note |
|---|---|---|
| Web app | Managed Next.js host | |
| Solver worker | Scale-to-zero container host | Idle 99% of the time, then pegs a CPU for up to 90s |
| Postgres | Supabase, `eu-central-1` | Two projects — see [`supabase-setup.md`](supabase-setup.md) |
| Exports | Object storage, immutable | |

**Two deployments, differing only in configuration** — production on the real practice, and a tester
environment holding **synthetic data only**. That is a POPIA rule rather than a convenience, and it
settles the environment count: see [`tester-programme.md`](tester-programme.md) for the platform
facts (Supabase allows two free projects; Vercel custom environments are Pro-only) and for why
dev-only tools must be enforced server-side rather than gated on `NODE_ENV`.

Estimated infrastructure cost at 15 users: roughly **$30–45/month**, with zero UI component
licensing.

---

## WhatsApp notifications

Researched 26 August 2026. WhatsApp is the channel that will actually get read in South Africa, and
no incumbent product does it.

| Fact | Value |
|---|---|
| **Utility message rate, South Africa** | **$0.0076 per message + 15% VAT ≈ R0.12–0.14** |
| Marketing rate, for contrast | $0.0379 per message — **5× more** |
| Authentication rate | $0.0076 per message |
| **Estimated cost here** | 13 doctors × ~10 notifications/month ≈ **under R20/month** |
| **Business verification lead time** | Typically **2–5 business days**; up to 14 with incomplete documents; **up to 30 days** in some cases |

Three things worth acting on:

1. **Billing changed to per-message, and changes again on 1 October 2026.** From that date Meta
   charges per message for all service messages; utility and authentication messages are currently
   free *inside* the 24-hour customer-service window until then. Roster notifications are sent
   outside that window, so they are already charged either way — but many 2026 write-ups still
   describe the old per-conversation model, so ignore any source that does.
2. **Write templates dryly.** Meta assigns the category at approval time, and a "roster update"
   phrased enthusiastically can be classified as **Marketing** — a 5× price difference for the same
   message.
3. **Go direct to Meta's Cloud API.** Local reseller platforms charge R699+/month in platform fees
   on top, which dwarfs R20 of actual messages.

**Start verification early.** It is days to weeks, it is the long pole, and it costs nothing to have
finished before the feature is needed.

## Calendar feeds

Subscribed feeds refresh every 12–24 hours in Google Calendar with **no manual refresh option**. A
doctor's calendar will be stale, and the UI must say so. Never rely on a calendar feed to
communicate an urgent change — that is what WhatsApp is for.

Feed URLs are bearer credentials: opaque, per-user, revocable.

## Secrets

Nothing secret is committed. `.env*` is gitignored, gitleaks runs pre-commit, and GitHub secret
scanning plus push protection are enabled on the repository as a non-bypassable backstop (both free
on a public repo).

Required variables are documented as they are introduced. None exist yet — there is no application
surface to configure.
