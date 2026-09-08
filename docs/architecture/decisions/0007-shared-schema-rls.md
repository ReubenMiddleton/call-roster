# ADR 0007: Shared-schema multi-tenancy with `tenant_id` and row-level security

- **Status:** accepted
- **Accepted:** 2026-08-31 by the project owner
- **Date:** 2026-08-26
- **Deciders:** project owner (pending — Track B4)

> In the context of **one design-partner practice today and an intended thousand-odd practices
> eventually**, facing **the choice between shared schema, schema-per-tenant and
> database-per-tenant**, we decided for **a shared schema with `tenant_id` and row-level security**,
> to achieve **one migration path a solo developer can actually operate**, accepting **that a missing
> RLS policy is a cross-tenant data leak**.

## Context

The product starts with one practice and is intended to reach order 1,000–1,500 practices at 10–20
doctors each. Every tenant is small; there will never be a single practice large enough to justify
isolating it.

The operator is **one person**. That is the dominant constraint, and it rules out anything whose
migration story requires attention proportional to tenant count.

There is a second, less obvious force. **The tenancy model is not a simple tree.** South African
private hospitals cannot employ doctors, so the practice owns the roster and the hospital merely
consumes it — and one doctor may hold privileges at several hospitals and belong to several
practices. The model is `Person ↔ Membership ↔ Practice ↔ Site`, a four-entity graph, not
`user.practice_id`. Whatever isolation strategy is chosen has to accommodate a person legitimately
existing in more than one tenant.

## Decision

**Shared schema. Every tenant-scoped table carries `tenant_id`. Isolation is enforced by
PostgreSQL row-level security policies.**

- `tenant_id` **leads every composite index**, so tenant-scoped queries stay selective.
- RLS policies are the enforcement boundary, not application `WHERE` clauses. Application filtering is
  defence in depth, never the primary control.
- **`Person` is deliberately not tenant-scoped.** Memberships are. A doctor belonging to two practices
  is one person with two memberships — not two duplicate people, which would break the fairness ledger
  and the audit trail.
- Cross-tenant queries exist for exactly one purpose — the eventual hospital-level *"who is on call
  across this building"* aggregation — and they run through an explicit, separately-authorised path
  rather than by relaxing RLS.

RLS policies are tested, not assumed. A test that asserts tenant A cannot read tenant B's rows is
worth more than any amount of care in query construction, because it fails loudly when someone adds a
table and forgets the policy.

## Considered alternatives

| Option | Why rejected |
|---|---|
| **Schema-per-tenant** | Turns every migration into a **partial-failure loop**: migrate 400 schemas, three fail, and the system is now in a mixed state that no code path expects. Unmanageable for one person, and connection-pool overhead grows with tenant count |
| **Database-per-tenant** | The strongest isolation and genuinely **unoperable solo** — per-tenant backups, per-tenant upgrades, per-tenant connection management. Appropriate for a handful of enterprise customers, not a thousand small practices |
| **Application-level filtering only**, no RLS | One forgotten `WHERE tenant_id = ?` is a cross-tenant leak of thirteen doctors' movements. The database can enforce this unconditionally; a developer under time pressure cannot |
| **A separate table per practice** | Not multi-tenancy, just a naming convention with none of the guarantees and none of the ergonomics |
| **`user.practice_id` on the user record** | Cannot express a doctor belonging to two practices, which is a real property of South African private practice rather than future-proofing. Would require a data-modelling emergency at the second such doctor |
| **Defer tenancy entirely — one practice, no `tenant_id`** | Tempting, since there is exactly one practice today. But retrofitting `tenant_id` onto every table, index and query later is precisely the expensive migration this decision exists to avoid, and it costs almost nothing to include now |

## Consequences

**Good:**

- **One migration, applied once.** The only version of this a solo developer can sustain.
- Isolation enforced in the database, where it cannot be bypassed by a code path.
- Efficient at the actual shape of the data: many small tenants sharing indexes.
- Accommodates a person belonging to several practices without duplication.
- The 2026 consensus default, so the tooling, documentation and hosted-Postgres feature sets all
  assume it.

**Bad, or accepted as a cost:**

- **A missing RLS policy on a new table is a cross-tenant data leak**, and the data in question is
  thirteen identifiable people's movements. This is the single largest security risk in the
  architecture. Mitigations: RLS enabled by default on new tables, a test asserting isolation, and
  treating "added a table without a policy" as a release blocker.
- A single Postgres instance is a shared blast radius for availability.
- Noisy-neighbour effects are possible in principle. At 13-doctor tenants solving once a month, not in
  practice.
- Per-tenant data export for offboarding needs deliberate work rather than "hand over the database".

**Revisit when:** a single tenant is large enough that its query patterns affect others, or a customer
contractually requires physical isolation. A hospital group might; a practice will not. The likely
answer then is a hybrid — shared schema by default, dedicated database for the one customer who pays
for it — rather than changing the default.
