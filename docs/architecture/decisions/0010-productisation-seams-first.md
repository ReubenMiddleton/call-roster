# ADR 0010: Productise by building the seams first, the commercial features later

- **Status:** accepted
- **Accepted:** 2026-08-31 by the project owner
- **Date:** 2026-08-26
- **Deciders:** project owner

> In the context of **building a multi-tenant SaaS product whose first customer is also its design
> partner**, facing **the choice between finishing the product before anyone uses it and generalising
> after**, we decided for **building every expensive-to-reverse seam from line one while deferring
> the commercial features**, to achieve **a commercial-grade foundation without losing the monthly
> feedback loop**, accepting **that the pilot will run on a product with no billing, no self-serve
> onboarding and no tenant admin console**.

## Context

The intent is a product sold to many practices, not a bespoke tool for one. That was always the
ambition, and much of the architecture already reflects it:
[ADR-0007](0007-shared-schema-rls.md) commits to shared-schema multi-tenancy with row-level
security, the data model is a `Person ↔ Membership ↔ Practice ↔ Site` graph precisely because one
doctor may belong to several practices, rule modes are configurable per tenant *and* per staff
category, and the practice's own standing rules are stored as instance data rather than constants.

So the question is not *whether* to productise. It is **what to build before the first real user
touches it.**

Three forces pull against each other:

**The feedback loop is slow and irreplaceable.** The principal builds the roster around the 20th of
each month, so there is roughly **one real trial per month.** There is no way to iterate faster on
the thing that actually matters.

**Being early is how the incumbents lose.** The market research found the entire incumbent field
criticised for setup time — implementations running 12 weeks to 9 months — and identified "speed to
first useful roster" as one of three table-stakes features that are actually differentiators here.
Spending six months on billing and onboarding before anyone uses the product reproduces exactly the
weakness we intend to exploit.

**Some things genuinely cannot be retrofitted.** Multi-tenancy and tenant isolation are the clearest:
row-level security added late is how cross-tenant data leaks happen, and the data here is thirteen
identifiable people's movements. Temporal validity intervals are similar
([ADR-0008](0008-temporal-validity-intervals.md)).

And a fourth force, discovered on first reading the source material: **the specification was wrong in
four places.** Two `[CONFIRMED]` constraints did not survive contact with the primary source, and the
export's shape does not match what the plan assumed — see
[`../../domain/source-artifact-findings.md`](../../domain/source-artifact-findings.md). No amount of
engineering rigour would have caught those; only a user would. That is an argument for shortening the
path to a user, not lengthening it.

## Decision

**Build every expensive-to-reverse seam correctly from the first line. Defer everything cheap to add
later until the design partner has published a real month from the app.**

The test for which side a thing falls on is exactly one question: **would adding this later require a
migration, or just a feature?**

**Build now — migration to retrofit:**

| Seam | Why now |
|---|---|
| Multi-tenancy: `tenant_id` on every scoped table, RLS policies, `tenant_id` leading every composite index | Retrofitting is a full-schema migration, and a missing policy is a cross-tenant leak of personal information |
| No hardcoded practice data — standing rules, burden weights, shift patterns and rule packs all as tenant-scoped data | Already true. Keeping it true is free; undoing it is not |
| Locale and calendar seams — a `HolidayProvider` interface behind the South African implementation, explicit time zones, currency as data | The holiday engine is jurisdiction-specific. The *interface* costs nothing now; changing every call site later is real work |
| Per-tenant export branding — practice name and logo on the printable grid | The source artifacts already carry a practice logo and name in a banner. The export **is** the product, so this is not cosmetic |
| The full test harness at the tiers set out in [ADR-0011](0011-tiered-testing.md) | Tests written alongside code cost a fraction of tests retrofitted |
| Audit trail, immutable published snapshots, hash-chained versions | The legal spine. Cannot be reconstructed after the fact |

**Defer — a feature, not a migration:**

Billing and subscription management · self-serve tenant provisioning · a tenant admin console ·
white-label theming beyond the export · SSO · a public marketing site · usage analytics · anything
priced per seat.

During the pilot, tenant provisioning is a SQL insert and the "billing plan" is a column. Both are
honest placeholders, not technical debt, because neither constrains the schema.

## Considered alternatives

| Option | Why rejected |
|---|---|
| **Full productisation before the pilot** — billing, onboarding, admin console, then hand the principal a production account like any other customer | Cleanest story and no throwaway work, but realistically months before he touches it. It forfeits the design-partner feedback loop at exactly the moment that loop is most valuable — and the four specification errors found on first contact with the source material are evidence that the spec is not yet trustworthy enough to build six months of product on. It also reproduces the incumbents' documented weakness |
| **Pilot first, productise afterwards** — build the single-practice tool, then generalise | Fastest to feedback, and tempting. Rejected because the two things that most need to be right are the two least retrofittable: RLS and the temporal model. "We will add multi-tenancy later" is how single-tenant assumptions leak into a hundred query sites, and how the first cross-tenant bug happens |
| **Two codebases** — a quick pilot tool, then a rewrite as the real product | The rewrite never gets the same care, the pilot tool becomes load-bearing, and the practice ends up migrated between two systems by one developer. A predictable way to lose the design partner |
| **Build for one tenant but "keep it clean"** without RLS | Discipline is not an enforcement mechanism. The database can guarantee isolation unconditionally; a developer under time pressure cannot |
| **Defer the export branding with the other commercial features** | The export is the artifact of record and the source artifacts carry the practice's own logo. An unbranded export is a *worse* export, and a worse export is the documented route to abandonment |

## Consequences

**Good:**

- The pilot runs on the real architecture, so the pilot's data is the product's data — no migration
  between systems, and the fairness ledger's history stays intact.
- Multi-tenancy is exercised by a real tenant from the start, which is when isolation bugs are cheap.
- The feedback loop stays short, so specification errors surface while they are still cheap.
- The commercial features that get deferred are the ones most likely to change shape once there is a
  second customer to learn from. Building them now would mean guessing twice.

**Bad, or accepted as a cost:**

- The product is genuinely not sellable to a second customer on day one. Onboarding customer two
  requires the deferred work, and that is a real gap, not a hidden one.
- "Seam, not implementation" requires judgement, and the temptation will be to build the
  implementation because it is more satisfying. A `HolidayProvider` with one implementation is the
  correct amount of abstraction here; two implementations before a second jurisdiction exists is
  speculative generality.
- Some deferred work will be harder than it looks — billing especially, once tax and multi-currency
  arrive.

**Revisit when:** a second practice is ready to onboard. That is the trigger for the deferred list,
and it should be treated as a planned phase rather than an interruption.
