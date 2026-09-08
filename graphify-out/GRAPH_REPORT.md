# Graph Report - Call Roster  (2026-09-03)

## Corpus Check
- 155 files · ~215,615 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1857 nodes · 3290 edges · 128 communities (124 shown, 4 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 86 edges (avg confidence: 0.94)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- scripts
- overview.md
- compilerOptions
- devDependencies
- test_hard.py
- __init__.py
- Glossary — the ubiquitous language
- instance.py
- 2026-08-26 — planning session: A1–A4 plus A6 research
- Constraint catalogue
- parse_request
- Track A, A1–A4 — planning-phase plan
- check-no-real-names.mjs
- Preferences and the request diary
- Open questions — for the practice principal
- Hosting
- Diagnose a solve
- Commands
- check-docs.mjs
- Data model
- Public holidays
- Product requirements
- Solver prototype
- Instance
- add_soft_sequence_constraint
- Fairness
- AGENTS.md
- Compliance
- Documentation index
- Architecture overview
- Request
- Add a constraint
- Shift patterns
- Runbook
- Vision
- check-workflows.mjs
- analyse-seed-data.mjs
- Domain checker
- HANDOFF
- package.json
- CLAUDE.md
- Solver conventions
- Test conventions
- ADR NNNN: <short title of the decision>
- request.ts
- Workforce structure and seasonal capacity
- run-gitleaks.mjs
- Spec reviewer
- TypeScript conventions
- Create an ADR
- ADR 0001: Record architecture decisions as MADR-minimal ADRs
- ADR 0002: Public repository on the personal account, with GitHub Actions permitted
- calendar-layout.ts
- ADR 0004: OR-Tools CP-SAT as the solver engine
- departure.ts
- check-publish-safety.ts
- dependencies
- ADR 0008: Temporal validity intervals, not soft deletes
- ADR 0009: PWA-first, with no native wrapper
- install-hooks.mjs
- call-roster-solver
- Graphify
- Testing strategy
- ADR 0011: Tier testing rigour by blast radius, not uniformly
- Findings from the primary source
- ADR 0010: Productise by building the seams first, the commercial features later
- Worked examples
- validate-seed-data.mjs
- availability.ts
- allowScripts
- validate-seed-data.test.mjs
- metrics.ts
- Analytics
- 2026-08-09-session-log.md
- Call Roster
- ADR 0007: Shared-schema multi-tenancy with `tenant_id` and row-level security
- ADR 0012: Normalise fairness by burden of opportunity, and optimise leximax not dispersion
- Seven failure modes, and the design that avoids each
- 2026-08-31 (evening) — the practice principal answered thirty-one questions
- shifts.ts
- 2026-08-31 — the analytics engine, and normalising fairness across unequal availability
- seed-period.ts
- 2026-08-31 (later) — twelve owner answers, and the one that exposed a real gap
- 2026-09-01 (later) — all nineteen sheets transcribed, and H-02 falsified after all
- Decisions journal
- test_wire.py
- types.ts
- holidays.ts
- Diagnostics
- check-contract.mjs
- ContractError
- analytics-report.ts
- 2026-09-02 — a three-month ledger, the framework recorded, and a pre-push check
- september_2026
- SESSION 2 — THE ANALYTICS ENGINE AND THE FAIRNESS NORMALISATION
- DIAGNOSTICS DESIGNED — 2 SEPTEMBER 2026
- THE PRINCIPAL ANSWERED — 31 AUGUST 2026, EVENING
- The export
- test_properties.py
- ALL NINETEEN SHEETS TRANSCRIBED — 1 SEPTEMBER 2026
- THE REQUEST PARSER — 1 SEPTEMBER 2026, LAST
- 2026-09-02 — S-01 built, and it says the imbalance cannot be fixed in a month
- H-10 IN THE SOLVER — 1 SEPTEMBER 2026, LAST
- Cross-language fixtures
- ADR 0013: First-party diagnostics, no third-party processor for the pilot
- Diagnostics conventions
- build-solve-request.ts
- seed-data/README.md
- 2026-09-02 — S-06 built, and the solver boundary now runs end to end in the gate
- 2026-09-02 — the holiday calendar became executable, and it found four wrong flags
- 2026-09-02 — the pattern resolver, and a `[CONFIRMED]` claim it falsified
- anchors.ts
- PRE-FLIGHT CAPACITY — 1 SEPTEMBER 2026, NIGHT
- weekday.ts
- 2026-09-02 (last) — ✅ S-01 works. The earlier "not demonstrably fairer" was a measurement bug
- ADR 0003: Defer the Graphify knowledge graph until the codebase justifies it
- 2026-09-02 — the solver was building rosters nobody would accept, and nothing said so
- ADR 0005: The solver is a separate Python service behind a Postgres job queue
- e2e/README.md

## God Nodes (most connected - your core abstractions)
1. `parse_request()` - 64 edges
2. `ContractError` - 54 edges
3. `_payload()` - 45 edges
4. `scripts` - 42 edges
5. `IsoDate` - 37 edges
6. `DoctorCode` - 36 edges
7. `build()` - 36 edges
8. `september_2026()` - 28 edges
9. `Decisions journal` - 28 edges
10. `Instance` - 27 edges

## Surprising Connections (you probably didn't know these)
- `main()` --calls--> `inferRecurringSlots()`  [EXTRACTED]
  scripts/build-solve-request.ts → lib/analytics/anchors.ts
- `main()` --calls--> `inferAvailability()`  [EXTRACTED]
  scripts/build-solve-request.ts → lib/analytics/availability.ts
- `main()` --calls--> `forecastCapacity()`  [EXTRACTED]
  scripts/check-workforce-changes.ts → lib/analytics/capacity.ts
- `main()` --calls--> `referenceBand()`  [EXTRACTED]
  scripts/calibrate-departure.ts → lib/analytics/departure.ts
- `main()` --calls--> `ledgerCutoff()`  [EXTRACTED]
  scripts/build-solve-request.ts → lib/analytics/ledger.ts

## Import Cycles
- None detected.

## Communities (128 total, 4 thin omitted)

### Community 0 - "scripts"
Cohesion: 0.05
Nodes (42): scripts, build, check, contract:check, dev, docs:check, format, format:check (+34 more)

### Community 1 - "overview.md"
Cohesion: 0.14
Nodes (10): ADR 0006: A custom CSS Grid for the roster matrix, not a commercial scheduler component, Consequences, Considered alternatives, Context, Decision, ADR 0014: Next.js and React for the web application, not Angular, Consequences, Considered alternatives (+2 more)

### Community 2 - "compilerOptions"
Cohesion: 0.04
Nodes (42): metadata, viewport, nextConfig, coverage, dist, dom, dom.iterable, esnext (+34 more)

### Community 3 - "devDependencies"
Cohesion: 0.05
Nodes (41): @biomejs/biome, eslint, eslint-config-next, fast-check, @fast-check/vitest, jiti, js-yaml, jsdom (+33 more)

### Community 4 - "test_hard.py"
Cohesion: 0.07
Nodes (46): parametrize, FeatureFlags, [INFERRED] and [ASSUMED] constraints live here, DEFAULT OFF. The asymmetry that…, build(), _fair_instance(), _one_day(), Per-constraint tests. Names carry the catalogued ID.…, H-07 is [INFERRED], so it must not be in the model unless explicitly enabled.… (+38 more)

### Community 5 - "__init__.py"
Cohesion: 0.09
Nodes (28): CpSolver, IntEnum, Path, SlackVar, main(), Throwaway CP-SAT prototype for the call roster. See solver/README.md., Parse a request file and solve it. The other half of the wire, exercised for…, Solve one month and print what the model had to break. With no arguments,… (+20 more)

### Community 6 - "Glossary — the ubiquitous language"
Cohesion: 0.06
Nodes (31): Anchor / Pool, Assignment, Budget, Constraints and rules, Core terms, Diagnostics vocabulary, Employment status — handle with care, Export vocabulary (+23 more)

### Community 7 - "instance.py"
Cohesion: 0.09
Nodes (32): AssignmentRef, Preference, PreferenceType, Instance types, and the September 2026 instance built from confirmed domain…, Burden-relevant classification. Times live on the Shift, not here. ⚠️ REALIGNED…, One doctor placed in one slot on one date. The wire shape of both…, ShiftKind, preflight() (+24 more)

### Community 8 - "2026-08-26 — planning session: A1–A4 plus A6 research"
Cohesion: 0.18
Nodes (11): 2026-08-26 — planning session: A1–A4 plus A6 research, A5 — the solver prototype found two real things, A6 research — the top open question is answered, and the answer is No, A8 — Graphify, and a real hole it exposed in the data-boundary check, All fifteen months transcribed — and every behavioural constraint was falsified, B2 arrived, and the summary did not survive contact with the source, The data boundary, and why the check is deliberately conservative, The year-end burden — an owner correction that improved the design (+3 more)

### Community 9 - "Constraint catalogue"
Cohesion: 0.05
Nodes (40): A doctor MAY work an afternoon shift followed by the next morning's shift `[CONFIRMED]`, ⚠️ A verdict must name the span it was computed over, "Anchor" and "pool" are not roles `[CONFIRMED]`, Candidate constraints found in the data, not yet stated by anyone, Constraint catalogue, Explicitly NOT constraints, H-01 Exactly one doctor per shift slot `[CONFIRMED]`, H-02 A doctor works at most one shift per day `[CONFIRMED]` (+32 more)

### Community 10 - "parse_request"
Cohesion: 0.06
Nodes (68): parse_request(), Parse a solve request into an Instance, or raise ContractError. Never partially…, _payload(), Any, Request-parsing tests. Two jobs. The first half parses fixtures/solver-…, The whole point of carrying modes as data: a confirmed answer flips a switch., End to end. A parser that produces an Instance the model rejects has proved…, Not only at the top level. A dropped nested field is just as wrong and harder… (+60 more)

### Community 11 - "Track A, A1–A4 — planning-phase plan"
Cohesion: 0.12
Nodes (16): A1 — Secure the private material ✅ DONE (executed before planning), A2 — Repository scaffold and quality gate (local only, no push), A3 — Documentation skeleton, brief decomposed into it, A4 — ADRs 0001–0009, Context, Hooks and the composite gate, Scaffold, `scripts/check-docs.mjs` — drift, not just links (+8 more)

### Community 12 - "check-no-real-names.mjs"
Cohesion: 0.17
Nodes (11): allowlist, ignoredDirectories, ignoredRelativePaths, mappingFile, root, scannedExtensions, scannedFilenames, selfPath (+3 more)

### Community 13 - "Preferences and the request diary"
Cohesion: 0.14
Nodes (14): Preferences and the request diary, Still open: is `NOT` hard or soft? `[UNKNOWN]`, Structured enum only — no free-text field, ever, The current collection process `[CONFIRMED]`, The diary page — raw input format, The first list: structural weekend availability `[CONFIRMED as to cause, 26 Aug 2026]`, The second list: `NOT` means not working `[CONFIRMED]`, The unavailability budget (+6 more)

### Community 14 - "Open questions — for the practice principal"
Cohesion: 0.05
Nodes (40): 1. The sixteen roster images and the diary photograph (2026-08-26), 29 — the one thing, and it reorders the priorities, Answers that changed the model, ⛔ Blocked — decide before proceeding, Confirmations, ⚠️ First, a correction to my own error, 🌙 For tonight — 1 September 2026, From building the analytics engine (2026-08-31) (+32 more)

### Community 15 - "Hosting"
Cohesion: 0.11
Nodes (19): Calendar feeds, Checkout-local tooling, Deployment shape, Environments and infrastructure, For what remains, skills beat MCP servers, Git hooks, Hosting, Local development (+11 more)

### Community 16 - "Diagnose a solve"
Cohesion: 0.15
Nodes (12): 1. Did pre-flight run?, 2. Read the objective breakdown, not the roster, 3. Check which constraints were actually enabled, 4. Check the unavailability budget is being enforced, 5. Only then read the CP-SAT log, A solve that never started, Diagnose a solve, First: there is no "infeasible" (+4 more)

### Community 17 - "Commands"
Cohesion: 0.15
Nodes (13): Availability, Bounded contexts, Calendar shape, Commands, Commands, events and policies, Distribution, Events, Not modelled, deliberately (+5 more)

### Community 18 - "check-docs.mjs"
Cohesion: 0.15
Nodes (8): adrDir, constraintsFile, docsDir, failures, ignoredDirectories, indexFile, notes, root

### Community 19 - "Data model"
Cohesion: 0.17
Nodes (12): Audit log, Data model, Data the system must never hold, Entity relationships, Fairness, Multi-tenancy, Notes and limitations, Published rosters are immutable snapshots (+4 more)

### Community 20 - "Public holidays"
Cohesion: 0.13
Nodes (15): 1. A public holiday on a Friday drops Pattern B `[CONFIRMED]`, 2. Holiday assignment VARIES the weekday anchor pattern `[CONFIRMED — wording corrected]`, An admin must be able to add an arbitrary date as a public holiday `[CONFIRMED requirement]`, Data model notes, Good Friday and Family Day need a Gregorian Easter computus, Implementation requirements, Implemented, Open questions (+7 more)

### Community 21 - "Product requirements"
Cohesion: 0.17
Nodes (12): C-01 The month grid (editor), C-02 The export — *the most important capability in the product*, C-03 Click-to-assign, C-04 Warn and scar, plus the issues panel, C-05 Publish → review → lock, C-06 History and the fairness ledger, C-07 Preference collection, C-08 Calendar feeds and notifications (+4 more)

### Community 22 - "Solver prototype"
Cohesion: 0.15
Nodes (13): 1. Pre-flight was missing, and the property test proved why, 2. The Sunday-night exclusion list really is derived, not a rule, 3. The regex abstraction holds up, Data boundary, Design rules it demonstrates, Layout, Property-based testing: Hypothesis, not fast-check, Running it (+5 more)

### Community 23 - "Instance"
Cohesion: 0.10
Nodes (24): AvailabilityRule, Day, Instance, One date. The pattern is a property of the DATE, not the weekday. The weekday…, This day's shifts. Explicit if supplied, else the pattern table's default. A…, Monday = 0 .. Sunday = 6., H-10 [CONFIRMED]. A standing fact about where a doctor is, not a declaration.…, Whether this rule forbids the doctor from working the slot. Public holidays are… (+16 more)

### Community 24 - "add_soft_sequence_constraint"
Cohesion: 0.21
Nodes (12): BoolVarT, CpModel, IntVar, add_soft_sequence_constraint(), add_soft_sum_constraint(), burden_key(), negated_bounded_span(), Sequence-constraint primitives, lifted from OR-Tools'… (+4 more)

### Community 25 - "Fairness"
Cohesion: 0.06
Nodes (31): ⚠️ An earlier recommendation in this document was wrong, Burden weights `[ASSUMED — the numbers are illustrative]`, But be honest about what the objective can and cannot do, ⚠️ Correction, 1 September 2026: the December claim above rests on the wrong month, Design consequence, Fairness, H-07 is becoming true rather than being occasionally broken, Normalisation — the denominator problem, and why it is the whole design (+23 more)

### Community 26 - "AGENTS.md"
Cohesion: 0.14
Nodes (13): Architecture, Code quality, ⚠️ `HANDOFF.md` is overwritten, not appended, Hard rules, Keeping context cost down, Machine environment, Mechanisms that cost nothing, Product intent (+5 more)

### Community 27 - "Compliance"
Cohesion: 0.18
Nodes (11): 1. A work roster is NOT special personal information — protect that, 2. BCEA rest rules almost certainly do not bind these doctors, 3. Two evaluator types, or the rule engine gets rewritten, 4. The audit trail is the product's legal spine, Cheap administrative items, worth doing early, Compliance, Data residency, Do not market this as a BCEA compliance product (+3 more)

### Community 28 - "Documentation index"
Cohesion: 0.17
Nodes (12): Architecture, Conventions, Decisions, Documentation index, Domain, History, Operations, Product (+4 more)

### Community 29 - "Architecture overview"
Cohesion: 0.22
Nodes (9): Architecture overview, Deployment shape, Level 1 — System context, Level 2 — Containers, Quality goals, in priority order, Solution strategy, The riskiest boundary, Why the interactive core is client components against a JSON API (+1 more)

### Community 30 - "Request"
Cohesion: 0.13
Nodes (15): ⚠️ A weekday NEVER crosses this boundary as an integer, `availability` is not a preference, and the distinction is the whole point, `burdenLedger.entitlement`, added in 1.2.0, and why it is not optional, Implementation notes, Reading a request: `contract.py`, Request, Response, Semantics (+7 more)

### Community 31 - "Add a constraint"
Cohesion: 0.25
Nodes (7): Add a constraint, Step 1 — Establish the confidence tag first, Step 2 — Catalogue it, Step 3 — Model it, Step 4 — Test it, Step 5 — Make the violation readable, Step 6 — Verify

### Community 32 - "Shift patterns"
Cohesion: 0.20
Nodes (10): Every instance in the data — all fourteen, How much work the default actually saves — measured, Modelling the override, Pattern A — "Standard" `[CONFIRMED]`, Pattern B — "Friday" `[CONFIRMED]`, Pattern C — "Reduced" `[INFERRED — high confidence]`, Precedence, Shift patterns (+2 more)

### Community 33 - "Runbook"
Cohesion: 0.25
Nodes (8): A solve never starts, A solve returns nothing useful, Data-boundary incident, Escalation, Pre-flight should catch most of this, Rollback, Runbook, The one that matters most: a published roster is wrong

### Community 34 - "Vision"
Cohesion: 0.25
Nodes (8): Non-goals, Principles, The constraint that shapes the whole plan, The problem, The users, Vision, What we are building, Where this could go

### Community 35 - "check-workflows.mjs"
Cohesion: 0.25
Nodes (6): dependabotFile, failures, notes, root, workflowDir, workflowFiles

### Community 36 - "analyse-seed-data.mjs"
Cohesion: 0.08
Nodes (24): all, BURDEN, files, found, FRIDAY_BACK_HALF, gaps, h02, h04 (+16 more)

### Community 37 - "Domain checker"
Cohesion: 0.29
Nodes (6): 1. Data-boundary violations — highest severity, 2. Health-data and special-PI creep, 3. Invented terminology, 4. Confidence-tag integrity, Domain checker, How to report

### Community 38 - "HANDOFF"
Cohesion: 0.13
Nodes (15): 1. ⛔ The export renderer — blocked on question G, 2. The database and the API, 3–5. Then, in order, Buildable right now, with no input at all, Decisions locked — do not re-litigate, HANDOFF, Read this first, in this order, The three things most likely to sink this (+7 more)

### Community 39 - "package.json"
Cohesion: 0.20
Nodes (9): description, engines, node, license, name, packageManager, private, type (+1 more)

### Community 40 - "CLAUDE.md"
Cohesion: 0.33
Nodes (5): Read first, The five that will actually bite you, Verifying your own work, Where the real risk is, Working style the owner has asked for explicitly

### Community 41 - "Solver conventions"
Cohesion: 0.29
Nodes (6): Data, Environment, Non-negotiables, Solver conventions, Testing, ⚠️ The wire boundary

### Community 42 - "Test conventions"
Cohesion: 0.33
Nodes (5): Environment, Names carry IDs, Property-based testing is not optional for the solver, Rules, Test conventions

### Community 43 - "ADR NNNN: <short title of the decision>"
Cohesion: 0.33
Nodes (5): ADR NNNN: <short title of the decision>, Consequences, Considered alternatives, Context, Decision

### Community 44 - "request.ts"
Cohesion: 0.10
Nodes (37): ADR-0012, DerivedRecurringSlot, DoctorAvailability, BurdenSchedule, DoctorMetrics, DoctorCode, IsoDate, ShiftId (+29 more)

### Community 45 - "Workforce structure and seasonal capacity"
Cohesion: 0.11
Nodes (18): Consequences for the data model, How this is modelled: availability data, not a constraint, ⚠️ It measures structure, not behaviour — the predictive hypothesis failed, Most doctors here have a primary practice somewhere else `[CONFIRMED]`, Nobody works here full time — the principal included `[CONFIRMED 2026-08-31]`, ⚠️ Pool GPs cannot work weekday daytime shifts — the fact that explains most of the roster, Pre-flight capacity: the constraint headcount hides, Still open (+10 more)

### Community 46 - "run-gitleaks.mjs"
Cohesion: 0.33
Nodes (4): binary, local, result, root

### Community 47 - "Spec reviewer"
Cohesion: 0.40
Nodes (4): How to report, Spec reviewer, What not to report, What to check, in priority order

### Community 48 - "TypeScript conventions"
Cohesion: 0.33
Nodes (5): Naming, Structure, The flag that matters, TypeScript conventions, ⚠️ Weekdays crossing the solver boundary

### Community 49 - "Create an ADR"
Cohesion: 0.40
Nodes (4): Constraints, Create an ADR, Steps, When this applies

### Community 50 - "ADR 0001: Record architecture decisions as MADR-minimal ADRs"
Cohesion: 0.33
Nodes (5): ADR 0001: Record architecture decisions as MADR-minimal ADRs, Consequences, Considered alternatives, Context, Decision

### Community 51 - "ADR 0002: Public repository on the personal account, with GitHub Actions permitted"
Cohesion: 0.33
Nodes (5): ADR 0002: Public repository on the personal account, with GitHub Actions permitted, Consequences, Considered alternatives, Context, Decision

### Community 52 - "calendar-layout.ts"
Cohesion: 0.08
Nodes (36): BrandingImage, buildExportDocument(), DoctorLabelStyle, ExportBranding, ExportDocument, MONTH_NAMES, monthLabel(), SYNTHETIC_BRANDING (+28 more)

### Community 53 - "ADR 0004: OR-Tools CP-SAT as the solver engine"
Cohesion: 0.40
Nodes (5): ADR 0004: OR-Tools CP-SAT as the solver engine, Consequences, Considered alternatives, Context, Decision

### Community 54 - "departure.ts"
Cohesion: 0.10
Nodes (32): anchorAdherence(), AnchorMiss, countBy(), dayIndex(), DEPARTURE_AXES, DepartureAxis, DepartureAxisKey, DepartureBand (+24 more)

### Community 55 - "check-publish-safety.ts"
Cohesion: 0.27
Nodes (9): ALLOWED_SUSPICIOUS, checkGitignoreAgreement(), EXCLUDED_SUBPATHS, GRAPHIFY_ALLOWED, isIgnored(), main(), NEVER_PUBLISHED, SUSPICIOUS_EXTENSIONS (+1 more)

### Community 56 - "dependencies"
Cohesion: 0.29
Nodes (7): next, dependencies, next, react, react-dom, react, react-dom

### Community 57 - "ADR 0008: Temporal validity intervals, not soft deletes"
Cohesion: 0.40
Nodes (5): ADR 0008: Temporal validity intervals, not soft deletes, Consequences, Considered alternatives, Context, Decision

### Community 58 - "ADR 0009: PWA-first, with no native wrapper"
Cohesion: 0.40
Nodes (5): ADR 0009: PWA-first, with no native wrapper, Consequences, Considered alternatives, Context, Decision

### Community 69 - "Graphify"
Cohesion: 0.29
Nodes (7): Graphify, Privacy and cost boundary, Refresh policy, ⚠️ Source verification — read before installing or changing the pin, The incident worth recording, Usage, What is committed, and what is not

### Community 70 - "Testing strategy"
Cohesion: 0.13
Nodes (15): Audit-trail tests, Coverage obligation, Database-level invariant tests, Deliberately not doing, Property-based tests, Rules, Start here: the honest limits, Structural assertions — the durable half (+7 more)

### Community 71 - "ADR 0011: Tier testing rigour by blast radius, not uniformly"
Cohesion: 0.22
Nodes (9): ADR 0011: Tier testing rigour by blast radius, not uniformly, Consequences, Considered alternatives, Context, Decision, Tier 1 — Unrecoverable. Maximum rigour., Tier 2 — Adoption-critical. Visual and structural regression., Tier 3 — Functional. Ordinary rigour. (+1 more)

### Community 72 - "Findings from the primary source"
Cohesion: 0.29
Nodes (7): 1. ⚠️ H-05 has a counterexample. It is not an absolute rule., 2. The Thursday anchor pattern is wrong in the summary, 3. The anchor pattern has routine exceptions — S-05 must stay soft, 4. The export is a CALENDAR, not a doctors × days matrix, 5. The request diary — refinements, Findings from the primary source, What this exercise establishes

### Community 73 - "ADR 0010: Productise by building the seams first, the commercial features later"
Cohesion: 0.40
Nodes (5): ADR 0010: Productise by building the seams first, the commercial features later, Consequences, Considered alternatives, Context, Decision

### Community 74 - "Worked examples"
Cohesion: 0.11
Nodes (19): Cross-cutting findings, Finding 10 — anchor slots rotate more than documented, Finding 11 — departed doctors behave exactly as documented, Finding 1 — ⚠️ H-07 is falsified, Finding 2 — the principal absorbs the year-end burden himself, Finding 3 — Pattern C confirmed, and its trigger is visible, Finding 4 — holidays vary the anchor pattern rather than abandoning it, Finding 5 — H-05's counterexample, in context (+11 more)

### Community 75 - "validate-seed-data.mjs"
Cohesion: 0.40
Nodes (5): daysInMonth(), files, KNOWN_PATTERNS, perDoctor, validateMonth()

### Community 76 - "availability.ts"
Cohesion: 0.11
Nodes (25): AvailabilityRule, canWork(), groupByTier(), restrictedEligibility(), day(), month(), periodOf(), tierOf() (+17 more)

### Community 77 - "allowScripts"
Cohesion: 0.50
Nodes (4): allowScripts, esbuild@0.28.2, lefthook@2.1.10, unrs-resolver@1.12.2

### Community 79 - "metrics.ts"
Cohesion: 0.18
Nodes (21): coefficientOfVariation(), compareLeximax(), computeLoadRatios(), EntitlementBasis, gini(), jainIndex(), leximaxVector(), LoadRatio (+13 more)

### Community 80 - "Analytics"
Cohesion: 0.12
Nodes (17): Access: who may see whose numbers, Analytics, Cross-period analytics, Departure — how far a roster sits from how this practice usually works, Every report carries its own caveats, Friday, Saturday and Sunday are counted separately, deliberately, Fridays are counted, and currently under-priced, Joiners and leavers (+9 more)

### Community 81 - "2026-08-09-session-log.md"
Cohesion: 0.05
Nodes (38): 1. H-10 had no wire representation, 2. ⚠️ A weekday integer means two different days, 3. `fte` cannot be defined here, AUDIT + THE MISSING TRIGGER — 1 SEPTEMBER 2026, LATE, AVAILABILITY DERIVED FROM DATA — 1 SEPTEMBER 2026, LATER STILL, B2 ARRIVED, AND IT CHANGED THE SPEC, CONTRACT 1.1.0 — 1 SEPTEMBER 2026, LATER AGAIN, EXPORT LAYOUT BUILT — 1 SEPTEMBER 2026, EVENING (+30 more)

### Community 82 - "Call Roster"
Cohesion: 0.29
Nodes (6): Call Roster, Data boundary — read this before contributing, Documentation, Getting started, The quality gate, Why the roster is the hard part

### Community 83 - "ADR 0007: Shared-schema multi-tenancy with `tenant_id` and row-level security"
Cohesion: 0.40
Nodes (5): ADR 0007: Shared-schema multi-tenancy with `tenant_id` and row-level security, Consequences, Considered alternatives, Context, Decision

### Community 84 - "ADR 0012: Normalise fairness by burden of opportunity, and optimise leximax not dispersion"
Cohesion: 0.40
Nodes (5): ADR 0012: Normalise fairness by burden of opportunity, and optimise leximax not dispersion, Consequences, Considered alternatives, Context, Decision

### Community 85 - "Seven failure modes, and the design that avoids each"
Cohesion: 0.14
Nodes (14): 1. The draft reopens everything, 2. Doctors plan their lives around the draft, 3. The final is a different roster from the draft, 4. Silence is ambiguous, 5. A change request breaks coverage, 6. Two PDFs in a WhatsApp group, 7. The review window becomes a negotiation, How this maps onto what already exists (+6 more)

### Community 86 - "2026-08-31 (evening) — the practice principal answered thirty-one questions"
Cohesion: 0.33
Nodes (6): 2026-08-31 (evening) — the practice principal answered thirty-one questions, 29 reorders the priorities, I had the principal's own code wrong, The most explanatory fact in the project, and it was verified, The rest, The weight table is agreed, and one thing his answer did not settle

### Community 87 - "shifts.ts"
Cohesion: 0.16
Nodes (17): AGREED_BURDEN_V1, matches(), ResolvedBurden, christmas, holiday, saturday, sunday, weekday (+9 more)

### Community 88 - "2026-08-31 — the analytics engine, and normalising fairness across unequal availability"
Cohesion: 0.25
Nodes (8): 2026-08-31 — the analytics engine, and normalising fairness across unequal availability, A recommendation in `fairness.md` was wrong, and research corrected it, Question M's answer changed the schema, not a penalty weight, Running it over the real months produced two findings and one guard, Sequencing: the engine now, the dashboard later, Smaller, The owner named half the failure mode; the other half is worse, Three property tests failed, and all three were real

### Community 89 - "seed-period.ts"
Cohesion: 0.10
Nodes (33): inferAvailability(), LoadOptions, loadSeedPeriod(), NAMED_SPECIAL_DATES, SeedDay, SeedMonthDocument, splitByMonth(), inclusiveDayCount() (+25 more)

### Community 90 - "2026-08-31 (later) — twelve owner answers, and the one that exposed a real gap"
Cohesion: 0.33
Nodes (6): 19 was a requirement, not an answer — and it was not being met, 2026-08-31 (later) — twelve owner answers, and the one that exposed a real gap, 22 was stronger than what had been recorded, 8 answered the weekend question and immediately exposed a pricing gap, Smaller, T answered in the most useful way available

### Community 91 - "2026-09-01 (later) — all nineteen sheets transcribed, and H-02 falsified after all"
Cohesion: 0.50
Nodes (4): 2026-09-01 (later) — all nineteen sheets transcribed, and H-02 falsified after all, A constraint can be an artefact of headcount, The H-02 sequence is the most instructive thing in this project, The rest

### Community 92 - "Decisions journal"
Cohesion: 0.12
Nodes (17): 2026-09-01 (evening) — the export layout, built from the photographs, 2026-09-01 (last, and the boundary is closed) — history → solver, nothing hand-written in between, 2026-09-01 (last) — H-10 in the solver, and H-06 was modelling an effect as a cause, 2026-09-01 (last) — the request parser, and why the contract had five holes in it, 2026-09-01 (late) — an audit for incoming-information blockers, and the missing trigger, 2026-09-01 (later, again) — contract 1.1.0: a live weekday bug, and a field that cannot exist, 2026-09-01 (later still) — availability derived from data, and two of my own errors caught by it, 2026-09-01 (night) — pre-flight capacity, and a hypothesis that failed (+9 more)

### Community 93 - "test_wire.py"
Cohesion: 0.10
Nodes (31): is_weekday_name(), name_from_weekday(), names_from_weekdays(), Weekday names for the solver contract, and the conversions to and from this…, Whether a string is a valid wire weekday. Use before trusting external input., Wire name to this side's integer, where MONDAY is 0. Raises on an unknown name…, This side's integer to the wire name, where MONDAY is 0. Raises outside 0-6…, Convenience for the shape availability rules actually hold. Sorted, so output… (+23 more)

### Community 94 - "types.ts"
Cohesion: 0.14
Nodes (22): BurdenMatch, BurdenRule, ADR-0008, DoctorLedgerEntry, period, yearPeriod(), DEPARTURE_GAP_DAYS, buildSaturatedPeriod() (+14 more)

### Community 95 - "holidays.ts"
Cohesion: 0.10
Nodes (38): addDays(), DeclaredHoliday, easterSunday(), familyDay(), FIXED_HOLIDAYS, goodFriday(), holidayLookup(), HolidayOrigin (+30 more)

### Community 97 - "Diagnostics"
Cohesion: 0.10
Nodes (20): Checklist before the pilot starts, Client, Correlation, Diagnostics, Field names, L0 — Redaction by construction, L1 — The command journal, L2 — Error records (+12 more)

### Community 98 - "check-contract.mjs"
Cohesion: 0.11
Nodes (11): allowedAnywhere, blocks, examples, fieldSets, notes, problems, requestExample, requestFields (+3 more)

### Community 99 - "ContractError"
Cohesion: 0.22
Nodes (30): AvailabilityRule, _bool(), ContractError, _date(), _hour(), _int(), _obj(), _parse_assignment_refs() (+22 more)

### Community 100 - "analytics-report.ts"
Cohesion: 0.40
Nodes (12): validateBurdenSchedule(), bar(), findSeedDirectory(), fixed(), main(), pad(), padStart(), parseArguments() (+4 more)

### Community 101 - "2026-09-02 — a three-month ledger, the framework recorded, and a pre-push check"
Cohesion: 0.40
Nodes (5): 2026-09-02 — a three-month ledger, the framework recorded, and a pre-push check, ADR-0014: Next.js and React, not Angular, `npm run publish:check` — before the repo exists, not after, ⚠️ S-01 is still not demonstrably fairer than the hand-built roster, and I stopped tuning, The ledger is now bounded, and it is a policy not a constant

### Community 102 - "september_2026"
Cohesion: 0.12
Nodes (16): A (weekday, shift, doctor) triple with a validity interval. Holding one or more…, One real month, built only from [CONFIRMED] facts. September 2026 begins on a…, RecurringSlot, september_2026(), Friday's evening and night shifts exclude the four anchor doctors. [CONFIRMED], A pool GP is not assigned a weekday shift before 17:00. [CONFIRMED] "GPs can't…, Exactly one doctor per shift slot. [CONFIRMED], A doctor works at most one shift per day. [CONFIRMED] (+8 more)

### Community 103 - "SESSION 2 — THE ANALYTICS ENGINE AND THE FAIRNESS NORMALISATION"
Cohesion: 0.20
Nodes (10): ⚠️ A new undocumented pattern — question T, and it may be the best finding yet, New in the gate, Question M is partly answered, and it changed the schema, SESSION 2 — THE ANALYTICS ENGINE AND THE FAIRNESS NORMALISATION, The design, in four sentences, Three property-test failures, all real, Two corrections to earlier work, What the first real run found (+2 more)

### Community 104 - "DIAGNOSTICS DESIGNED — 2 SEPTEMBER 2026"
Cohesion: 0.22
Nodes (9): Also now rules, DIAGNOSTICS DESIGNED — 2 SEPTEMBER 2026, Next without input, ⚠️ Session replay: no, permanently, The bit I think is genuinely important, The decision in one line, The layer that matters most, and it's the cheapest, Three questions for you (+1 more)

### Community 105 - "THE PRINCIPAL ANSWERED — 31 AUGUST 2026, EVENING"
Cohesion: 0.22
Nodes (9): ⚠️ Correction: D01 is the principal, not D02, ⏳ Data promised, not yet on disk, New document: the lifecycle, Next, The finding worth reading in full, THE PRINCIPAL ANSWERED — 31 AUGUST 2026, EVENING, The priority order changed, Two new questions, both from the answers themselves (+1 more)

### Community 106 - "The export"
Cohesion: 0.22
Nodes (9): A date with no assignments still prints, Branding is per-tenant, and nothing about it is committed, The export, The five-row rule, which is the part worth knowing, The gap before the night shift, The geometry, as the practice produces it, What is built, and what is not, What the template will settle (+1 more)

### Community 107 - "test_properties.py"
Cohesion: 0.16
Nodes (17): composite, DrawFn, given, SOLVER_SETTINGS, instances(), Property-based tests. The highest-value tests in the project. One property is…, **The single highest-value test in the project.** For any generated instance,…, No violation may appear without a catalogued ID and a readable message. The… (+9 more)

### Community 108 - "ALL NINETEEN SHEETS TRANSCRIBED — 1 SEPTEMBER 2026"
Cohesion: 0.29
Nodes (7): ALL NINETEEN SHEETS TRANSCRIBED — 1 SEPTEMBER 2026, Data quality, now measurable, ⚠️ H-02 is falsified after all — read this one, Next, Open, and worth a look, The doubles are a headcount artefact — a new kind of finding, What else the 33 months settled

### Community 109 - "THE REQUEST PARSER — 1 SEPTEMBER 2026, LAST"
Cohesion: 0.29
Nodes (7): Five mismatches, ⚠️ I disagree with an instruction I wrote earlier, and changed it, New files, Next without input, `npm run contract:check`, and it is proven, THE REQUEST PARSER — 1 SEPTEMBER 2026, LAST, The root cause: there was no parser

### Community 110 - "2026-09-02 — S-01 built, and it says the imbalance cannot be fixed in a month"
Cohesion: 0.33
Nodes (6): 2026-09-02 — S-01 built, and it says the imbalance cannot be fixed in a month, And what it cannot do, The contract gained `burdenLedger[].entitlement` — 1.1.0 → 1.2.0, Two things ruled out along the way, What is left is a question, not code, What it reports, which is the point

### Community 111 - "H-10 IN THE SOLVER — 1 SEPTEMBER 2026, LAST"
Cohesion: 0.33
Nodes (6): H-06 was modelling an effect as a cause, H-10, and why it is not H-08, H-10 IN THE SOLVER — 1 SEPTEMBER 2026, LAST, ⚠️ My first weighting was wrong and a test caught it, Next without input, Penalty tiers as they now stand

### Community 112 - "Cross-language fixtures"
Cohesion: 0.33
Nodes (5): Changing it, Cross-language fixtures, `solver-request.json`, Who reads it, Why this directory exists

### Community 113 - "ADR 0013: First-party diagnostics, no third-party processor for the pilot"
Cohesion: 0.40
Nodes (5): ADR 0013: First-party diagnostics, no third-party processor for the pilot, Consequences, Considered alternatives, Context, Decision

### Community 114 - "Diagnostics conventions"
Cohesion: 0.40
Nodes (5): Diagnostics conventions, Naming, Structure, Testing, The five that will bite

### Community 115 - "build-solve-request.ts"
Cohesion: 0.16
Nodes (24): windowStart(), resolveBurden(), buildLedger(), cellKey(), emptyDayClassTally(), emptyProvenanceTally(), emptyShiftKindTally(), entitlementWeights() (+16 more)

### Community 116 - "seed-data/README.md"
Cohesion: 0.50
Nodes (3): Seed-data fixtures, What the fixture exercises, Why the real data is not here

### Community 117 - "2026-09-02 — S-06 built, and the solver boundary now runs end to end in the gate"
Cohesion: 0.67
Nodes (3): 2026-09-02 — S-06 built, and the solver boundary now runs end to end in the gate, S-06, the churn penalty, The boundary check

### Community 118 - "2026-09-02 — the holiday calendar became executable, and it found four wrong flags"
Cohesion: 0.67
Nodes (3): 2026-09-02 — the holiday calendar became executable, and it found four wrong flags, Two findings the document did not have, Two test premises were wrong before the code was

### Community 119 - "2026-09-02 — the pattern resolver, and a `[CONFIRMED]` claim it falsified"
Cohesion: 0.40
Nodes (5): 2026-09-02 — the pattern resolver, and a `[CONFIRMED]` claim it falsified, ⚠️ A `[CONFIRMED]` section was wrong, and had been for a week, And the decision not to act on 8-for-8, It also moved question 40 a long way, The measurement nobody had taken

### Community 120 - "anchors.ts"
Cohesion: 0.23
Nodes (12): ANCHOR_DOMINANCE, ANCHOR_WINDOW_MONTHS, anchorHolders(), inferRecurringSlots(), InferRecurringSlotsOptions, slotKey(), period(), REGULAR (+4 more)

### Community 121 - "PRE-FLIGHT CAPACITY — 1 SEPTEMBER 2026, NIGHT"
Cohesion: 0.40
Nodes (5): Next without input, PRE-FLIGHT CAPACITY — 1 SEPTEMBER 2026, NIGHT, ⚠️ The feature I set out to build does not work, What fell out of it is better, and uncomfortable, Why this replaces the December trigger

### Community 122 - "weekday.ts"
Cohesion: 0.33
Nodes (8): Fixture, UNDECOMPOSED, isWeekdayName(), nameFromWeekday(), namesFromWeekdays(), WEEKDAY_NAMES, weekdayFromName(), weekdaysFromNames()

### Community 123 - "2026-09-02 (last) — ✅ S-01 works. The earlier "not demonstrably fairer" was a measurement bug"
Cohesion: 0.50
Nodes (4): 2026-09-02 (last) — ✅ S-01 works. The earlier "not demonstrably fairer" was a measurement bug, Contract 1.3.0 — the two divergences, deleted rather than aligned, The measurement was self-referential, What is still true

### Community 124 - "ADR 0003: Defer the Graphify knowledge graph until the codebase justifies it"
Cohesion: 0.29
Nodes (5): ADR 0003: Defer the Graphify knowledge graph until the codebase justifies it, Consequences, Considered alternatives, Context, Decision

### Community 125 - "2026-09-02 — the solver was building rosters nobody would accept, and nothing said so"
Cohesion: 0.67
Nodes (3): 2026-09-02 — the solver was building rosters nobody would accept, and nothing said so, The design call: departure is an indicator, never a verdict, The finding

### Community 126 - "ADR 0005: The solver is a separate Python service behind a Postgres job queue"
Cohesion: 0.40
Nodes (5): ADR 0005: The solver is a separate Python service behind a Postgres job queue, Consequences, Considered alternatives, Context, Decision

## Knowledge Gaps
- **911 isolated node(s):** `metadata`, `viewport`, `SHIFTS`, `REGULAR`, `ANCHOR_DOMINANCE` (+906 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **4 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Decisions journal` connect `Decisions journal` to `docs/README.md`, `2026-09-02 — a three-month ledger, the framework recorded, and a pre-push check`, `2026-08-26 — planning session: A1–A4 plus A6 research`, `2026-09-02 (last) — ✅ S-01 works. The earlier "not demonstrably fairer" was a measurement bug`, `2026-09-02 — S-01 built, and it says the imbalance cannot be fixed in a month`, `2026-09-02 — the pattern resolver, and a `[CONFIRMED]` claim it falsified`, `2026-09-02 — S-06 built, and the solver boundary now runs end to end in the gate`, `2026-08-31 (evening) — the practice principal answered thirty-one questions`, `2026-09-02 — the holiday calendar became executable, and it found four wrong flags`, `2026-08-31 — the analytics engine, and normalising fairness across unequal availability`, `2026-08-31 (later) — twelve owner answers, and the one that exposed a real gap`, `2026-09-01 (later) — all nineteen sheets transcribed, and H-02 falsified after all`, `2026-09-02 — the solver was building rosters nobody would accept, and nothing said so`?**
  _High betweenness centrality (0.034) - this node is a cross-community bridge._
- **Why does `Fairness` connect `Fairness` to `docs/README.md`?**
  _High betweenness centrality (0.024) - this node is a cross-community bridge._
- **Why does `Glossary — the ubiquitous language` connect `Glossary — the ubiquitous language` to `docs/README.md`?**
  _High betweenness centrality (0.019) - this node is a cross-community bridge._
- **Are the 29 inferred relationships involving `ContractError` (e.g. with `_solve_request_file()` and `test_a_boolean_hour_is_refused()`) actually correct?**
  _`ContractError` has 29 INFERRED edges - model-reasoned connections that need verification._
- **What connects `metadata`, `viewport`, `SHIFTS` to the rest of the system?**
  _911 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `scripts` be split into smaller, more focused modules?**
  _Cohesion score 0.047619047619047616 - nodes in this community are weakly interconnected._
- **Should `overview.md` be split into smaller, more focused modules?**
  _Cohesion score 0.1368421052631579 - nodes in this community are weakly interconnected._