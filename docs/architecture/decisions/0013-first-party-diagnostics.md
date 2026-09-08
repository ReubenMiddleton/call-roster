# ADR 0013: First-party diagnostics, no third-party processor for the pilot

- **Status:** accepted
- **Date:** 2026-09-01
- **Deciders:** project owner, 7 September 2026

> In the context of a **one-to-two month pilot whose only user is a non-technical practice principal
> working alone at month-end**, facing **the need to diagnose failures without asking him what
> happened**, we decided for a **first-party diagnostic journal in our own Postgres, written behind a
> swappable sink, with no third-party processor** to achieve **reproducible diagnosis at zero new
> cross-border transfer**, accepting that **we resolve stack traces by hand and build our own
> aggregation.**

## Context

The pilot's whole purpose is to find out what breaks. The owner's framing is exactly right: *"if
anything breaks while my dad is using it we should collect data so that it will be easier to fix
without having to ask my dad how it broke."*

Six forces, all specific to this project.

**1. "What did you click?" is not an available question.** The principal is not technical, is the
sole scheduler, and will be doing this at month-end under time pressure. Any scheme that depends on
him reproducing a fault, reading a console, or describing a sequence has already failed. It also
wastes the one thing the pilot is buying — his goodwill.

**2. The bugs will mostly not be crashes.** This is a roster editor. The realistic failure modes are
*a warning that fires when it should not*, *an export that comes out wrong*, *a cell that refuses an
assignment for no visible reason*, *a fairness figure he does not believe*. **A stack trace answers
none of those**, because nothing threw. What answers them is the sequence of intents that produced
the state — which means the diagnostic primitive here is a **command journal**, not an exception
tracker.

**3. The running application renders thirteen real names.** The repository's data boundary keeps names
out of committed material; it does nothing about a live app's telemetry.
[`../../ops/compliance.md`](../../ops/compliance.md) already named this precisely, before any of this
research:

> **Where the leak actually is. Not the database — the sub-processors.** Error tracking with names in
> the payload, SMS gateways, email providers, log aggregation, support tooling, offshore support
> access. **Each of those is the s72 transfer.**

This ADR is the concrete implementation of a position the project already holds.

**4. The database is already offshore, and that is already decided.** Re-verified 1 September 2026
against the finding recorded on 26 August: **Supabase does not offer a South African region**, and
`af-south-1` remains an unanswered community request. [`../../ops/environments.md`](../../ops/environments.md)
records the recommendation — start on the nearest region, keep the schema portable, treat a South
African move as a costed migration.

The consequence for *this* decision is the load-bearing one: **the roster data already crosses the
border under one operator agreement, so logging into that same database adds no new transfer, no
second agreement and no second sub-processor register entry.** A third-party error tracker adds all
three, for a two-month pilot with one user.

**5. No accounts.** A standing instruction from the owner. Every hosted option requires one.

**6. Cost, and one developer.** Researched 1 September 2026: **self-hosted Sentry needs 4 CPU cores,
16 GB RAM, 16 GB swap and 20+ containers** — Kafka, ClickHouse, Snuba, Relay, Symbolicator and
dozens of consumer workers. That is a second production system to operate, monitor and upgrade, in
order to monitor the first. Postgres is already paid for and already backed up.

## Decision

Six layers. The full design is [`../../ops/diagnostics.md`](../../ops/diagnostics.md); this records
what was chosen and why it is hard to reverse.

| Layer | What |
|---|---|
| **L0** | **Redaction by construction.** The diagnostic API cannot express a name — identity fields are typed as doctor references, and free text is refused outright, exactly as it is for preferences |
| **L1** | **The command journal.** Every user intent, append-only, correlated to a roster version. Deterministically replayable. **This is what replaces session replay** |
| **L2** | **Error records.** Server through Next.js `instrumentation.ts` / `onRequestError`; client through an error boundary plus `window.onerror` and `unhandledrejection`. OpenTelemetry exception field names |
| **L3** | **Solver run diagnostics.** A failed solve must be reproducible from its `solve_run` row alone — request, model snapshot, pre-flight result, CP-SAT version **and worker count** |
| **L4** | **A client-side buffer** in IndexedDB, flushed with backoff. Survives offline and survives a dead server. Bounded, and **records its own drops** |
| **L5** | **The diagnostic bundle.** A "Something looks wrong" button producing one downloadable file he sends by WhatsApp. **The only layer that works when the network and the database are both dead** |
| **L6** | **Retention.** Diagnostics expire; the command journal does not, because it is also the audit trail |

Two cross-cutting choices:

- **Instrumentation is written against a `DiagnosticSink` interface**, not against a vendor. The
  pilot ships `PostgresSink`; `NullSink` for tests, `FileSink` for development. Adding an exporter
  later is a configuration change, not a re-instrumentation.
- **OpenTelemetry semantic conventions for field names.** All three OTel signals reached stable
  across major SDKs in 2026 and the exception conventions are stable. Adopting the *names* costs
  nothing today and makes any future exporter a mapping rather than a rewrite. We adopt the
  vocabulary, not the SDK.

## Considered alternatives

| Option | Why rejected |
|---|---|
| **Sentry SaaS, EU (Frankfurt) region** | The strongest contender, and genuinely good. Rejected for the pilot on proportionality: it is a **second offshore processor and a second s72 agreement** for one user over two months, it requires an account the owner has ruled out, and its highest-value features — grouping, alerting, release health — solve problems a single-user pilot does not have. **Not rejected forever**: L2 is deliberately shaped so switching it on is a DSN in config |
| **Sentry self-hosted** | **4 CPU / 16 GB RAM / 16 GB swap / 20+ containers**, heavily disk-I/O bound, and you must monitor the monitoring server. For a pilot generating a few thousand rows a month this is not a trade-off, it is a category error |
| **GlitchTip self-hosted** | Much more reasonable — same Sentry SDKs, same DSN format, four containers, runs in 512 MB. **Kept explicitly as the escape hatch** rather than adopted: it still needs a VPS, a domain, TLS and upkeep, to hold data we can already hold. Because it speaks the Sentry DSN format, choosing it later remains a config change |
| **⚠️ Session replay** — Sentry Replay, PostHog, LogRocket, Microsoft Clarity | **Hard no, and it is the most tempting option, which is why it is written down.** The app's main screen is a grid of thirteen identifiable doctors' movements — the single most sensitive artifact the product renders. Masking is **opt-in per element**, defaults do not mask everything, and vendor documentation is explicit that failure to identify an element means the content leaves the browser. One unmasked table cell uploads exactly what the entire repository architecture exists to prevent. **The command journal gives better diagnosis than a video anyway**, because it is replayable rather than watchable |
| **Product analytics** — PostHog, Mixpanel, Amplitude | Answers "how do people use this", a question with one user and no product-market-fit uncertainty. Adds a processor for an answer we can get by asking him over dinner |
| **Log aggregation SaaS** — Datadog, Better Stack, Axiom, Grafana Cloud | Same s72 objection, plus cost that scales with volume for a volume that is trivial. Genuinely right at multi-tenant scale; wrong at one tenant |
| **A full OpenTelemetry Collector plus Grafana/Loki/Tempo stack, self-hosted** | The "do it properly" option. Rejected as the same category error as self-hosted Sentry: three more services to run, for data that fits comfortably in tables we already have. We take OTel's *vocabulary* now and can stand up the pipeline the day there is volume to justify it |
| **`console.log` and read the host's log drain** | Looks like the zero-cost option and is not. **A host's log drain IS third-party log aggregation — an unregistered sub-processor** — and it invites unstructured, unredacted strings, which is precisely how a name ends up offshore. It is also unqueryable, unretained and lost on redeploy. **`console.log` is therefore banned from production paths**, not merely discouraged |
| **Nothing structured — fix bugs as he reports them** | The status quo, and the thing the owner explicitly asked to avoid. It spends his patience instead of our disk |
| **Client-side only, no server storage** | Tempting for privacy. Rejected because a client-only record dies with the browser profile, and the failures we most need — a bad solve, a wrong export — happen server-side |
| **Send diagnostics to the owner by email automatically** | An email provider is a sub-processor, and unattended outbound mail from a pilot app is how you discover you are a spam source. L5's manual bundle over WhatsApp uses a channel he already trusts and keeps him in control of what leaves |

## Consequences

**Good:**

- **Zero new cross-border transfers, zero new sub-processors, zero new agreements.** The compliance
  story stays one paragraph long.
- **Nothing to ask him.** A bug report is a bundle, or a row already in the database.
- **The right primitive for this domain.** Logic bugs are diagnosable, which a stack-trace-only
  approach would not have made them.
- **One mechanism, two purposes.** The command journal *is* the append-only audit trail that
  `compliance.md` requires for ECTA s15 evidential weight. Building two would have been waste.
- **Costs nothing.** No new service, no subscription, no account.
- **L5 works when everything else is down**, which is the case we are actually afraid of.
- **Reversible cheaply.** The sink interface plus the Sentry-compatible DSN format means "we changed
  our mind" is configuration.

**Bad, or accepted as a cost:**

- **We build the aggregation.** No grouping, no alerting, no dashboards for free. Accepted: with one
  user, `SELECT` is the dashboard.
- **Stack traces are resolved by hand**, offline, against build source maps kept out of the
  repository. Tractable for one build and one user; **it stops being tractable the moment there is a
  second tenant**, and that is the trigger below.
- **No release health, no performance monitoring, no alerting.** We find out when he tells us, or
  when we look. Acceptable for a pilot; not for production.
- **Diagnostics live in the production database.** Bounded rows, retention job, and they must never
  be able to block a user action — a diagnostics failure must cost nothing.
- **`appRunId`, not "session".** The glossary reserves `session` as a shift synonym, so the
  browser-lifetime identifier gets a different name. Mildly unusual, and deliberate.

**Revisit when** any one of these is true — each is a real trigger, not a hedge:

1. **The pilot ends and a second tenant exists.** Hand-resolving traces and reading SQL does not
   survive multi-tenancy. That is the moment to switch on L2's exporter.
2. **The first hospital procurement conversation.** It will ask for the sub-processor register, and
   the answer "there are none" is worth more then than any dashboard is now.
3. **Crash volume exceeds what one person can triage from a query** — roughly, more than a handful a
   week.
4. **We need alerting** — i.e. the cost of finding out late becomes real.
