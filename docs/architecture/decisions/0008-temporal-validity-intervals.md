# ADR 0008: Temporal validity intervals, not soft deletes

- **Status:** accepted
- **Accepted:** 2026-08-31 by the project owner
- **Date:** 2026-08-26
- **Deciders:** project owner (pending — Track B4)

> In the context of **doctors joining and leaving, recurring slots changing hands, and rules changing
> mid-year**, facing **the usual reflex of an `is_active` flag or a `deleted_at` column**, we decided
> for **application-time temporal validity intervals with database-enforced containment**, to achieve
> **historically correct answers to "who was on duty then"**, accepting **more complex queries and a
> Postgres 18 floor**.

## Context

The practice principal has stated the requirement plainly: *"doctors move on in life and new ones join
from time to time... we need to build the app with this in mind so that it can handle those cases
seamlessly by having almost everything configurable."*

The sixteen months of roster data show what that actually looks like, and it is not simple
appear-and-vanish:

- **D14 left** around 16 May 2026. In sixteen months D14 appears *only ever* on Saturday 23:00–07:00 —
  a pure weekend-night GP.
- **D15** last appeared 24 January 2026 and is absent since. Probably departed; not confirmed.
- **D05 joined** around 22 June 2026 and **took over the Monday and Tuesday 15:00–23:00 anchor slots**
  that D04 and D03 had held continuously since at least April 2025. **Neither D03 nor D04 left** —
  D04 retained Thursday mornings, Tuesday nights, Fridays and weekend work.

That last case is the one that decides this ADR. **Two specific recurring slots changed hands while
both doctors remained active.** A flag on the doctor cannot express it. A `current_holder` column on
the slot cannot express *when* it changed, which is exactly what the fairness ledger and any
historical question need.

Two questions must both be answerable, forever, and they are different questions:

- *Who is on duty on 14 March next year?*
- *Who **was** on duty at 02:40 on 14 March three years ago?*

The second is a medico-legal question. It must have an unrebuttable answer.

## Decision

**Application-time temporal modelling with validity intervals, enforced in the database.**

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE practice_membership (
  tenant_id  uuid      NOT NULL,
  doctor_id  uuid      NOT NULL,
  valid_at   daterange NOT NULL,
  fte        numeric,
  PRIMARY KEY (doctor_id, valid_at WITHOUT OVERLAPS)
);

CREATE TABLE shift_assignment (
  id         uuid PRIMARY KEY,
  tenant_id  uuid      NOT NULL,
  doctor_id  uuid      NOT NULL,
  period     tstzrange NOT NULL,
  FOREIGN KEY (doctor_id, PERIOD period)
    REFERENCES practice_membership (doctor_id, PERIOD valid_at),
  EXCLUDE USING gist (doctor_id WITH =, period WITH &&)
);
```

Two invariants earned at the database level, where they cannot be bypassed:

- **The temporal foreign key enforces range containment** — precisely *"you can only be rostered while
  you are a member"*, which is constraint **H-03**.
- **The exclusion constraint makes double-booking impossible.** *"No doctor works two overlapping
  shifts"* is the most important invariant in the system.

Applies equally to burden weights, recurring slots, rule configurations and staff categories: each
carries a validity interval rather than a mutable current value.

**Published rosters are immutable snapshots.** Publishing writes a frozen `roster_version` row
alongside the live editable assignments; editing creates version N+1 and never mutates N.

**Do not go full bitemporal.** Transaction time — *when we learned* a fact — is what the append-only
audit log is for. Full bitemporality doubles query complexity and a solo developer will regret it.

## Considered alternatives

| Option | Why rejected |
|---|---|
| **`is_active` boolean** | Cannot answer *when* someone was active, so cannot support the fairness ledger, historical rosters, or the medico-legal question. Also cannot express D05's slot takeover at all |
| **`deleted_at` soft delete** | Records that something ended, not when it started or that it might resume. A GP who works occasionally is not deleted between shifts. And every query needs `WHERE deleted_at IS NULL`, which someone eventually forgets |
| **`valid_from` / `valid_to` as two plain columns** | Workable, but loses the database's help entirely: no `WITHOUT OVERLAPS`, no range containment foreign key, no GiST exclusion. Overlap prevention moves into application code, where it will eventually be wrong |
| **Event sourcing** | Would answer every historical question beautifully. Materially more machinery than one developer should take on, and every read becomes a projection to maintain. The audit log gives most of the benefit at a fraction of the cost |
| **Full bitemporal** (valid time *and* transaction time) | Doubles query complexity for a question the audit log already answers |
| **A separate `*_history` table per entity** | Two schemas per concept to keep in step, and the interesting queries span both. Classic source of "the history table disagrees with the live table" |
| **Wait for PostgreSQL 19** and its `FOR PORTION OF` | GA is targeted for September 2026 and managed hosts trail by months. The PG18 primitives are sufficient; hand-roll the splits meanwhile |

## Consequences

**Good:**

- *"Who was on duty at 02:40 on 14 March"* has an answer the schema guarantees.
- The fairness ledger can be computed over the true history, which is the whole point of the product.
- D05's takeover, D14's departure and D15's ambiguity are all ordinary data rather than special cases.
- **Double-booking is impossible**, enforced by the database.
- A doctor who leaves and returns is two intervals, not a resurrection problem.

**Bad, or accepted as a cost:**

- **Every query touching people or rules needs a temporal predicate.** Easy to forget, and the failure
  is silent — a query that omits it returns rows from every era at once. Mitigation: query helpers
  that take an as-of date, and no raw table access from feature code.
- **Requires PostgreSQL 18+.** Confirm the host supports it before the first migration; see
  [`../../ops/environments.md`](../../ops/environments.md), where the host question is itself open.
- **No `ON DELETE CASCADE` for temporal foreign keys in PG18.** The older `EXCLUDE USING gist` form
  still works and needs `btree_gist`.
- *"This rule changed in March"* means splitting a row by hand until `FOR PORTION OF` is available.
- Harder to reason about, and genuinely harder to explain to a future contributor. Which is what this
  ADR is for.

**Revisit when:** PostgreSQL 19 becomes available on the chosen host — then adopt `FOR PORTION OF` and
delete the hand-rolled split logic. The schema is deliberately designed so that is a trivial change
rather than a migration.

## Addendum, 2026-09-07: the decision above assumed PostgreSQL 18, and the host offers 17

This ADR's own SQL — `PRIMARY KEY (doctor_id, valid_at WITHOUT OVERLAPS)` and `FOREIGN KEY
(doctor_id, PERIOD period) REFERENCES practice_membership (doctor_id, PERIOD valid_at)` — is
SQL:2011 temporal syntax that PostgreSQL only shipped in version **18**. That was verified, not
assumed: run against the pinned `.tools/pgsql` 17.2 binary on 2026-09-07, both statements fail
with a plain `syntax error`.

Nobody caught this at the time because the hosting decision came later. This ADR was accepted
31 August 2026, on the working assumption in `docs/ops/environments.md` that *"target PG18 for
the first migration"* would hold. The Supabase hosting decision was accepted 7 September
(`docs/NEEDS_YOUR_INPUT.md`, question 8) — and Supabase's managed Postgres does not offer
version 18 yet. `scripts/setup-postgres.ps1` already discovered this independently and pins
17.2 *"to match what Supabase runs"*, without anyone updating this ADR to say so. That is now
fixed.

**What actually shipped in the first migration** (`supabase/migrations/0001`–`0004`):

- The **GiST exclusion constraint is unaffected** — `EXCLUDE USING gist (doctor_id WITH =,
  period WITH &&)` is ordinary PostgreSQL, present since long before 17, and is exactly what
  HANDOFF.md already claimed was verified. This is the invariant that matters most (no doctor
  works two overlapping shifts), and it needed no change.
- `practice_membership`'s own overlap prevention — one doctor cannot hold two overlapping
  membership intervals in one tenant — also moved to a GiST exclusion constraint
  (`tenant_id WITH =, doctor_id WITH =, valid_at WITH &&`), which does the same job as a
  `WITHOUT OVERLAPS` primary key for this purpose and needs no PG18 feature either.
- **H-03 (a doctor can only be rostered while a member) is enforced by a `BEFORE INSERT OR
  UPDATE` trigger on `shift_assignment`** instead of a native `PERIOD` foreign key. The trigger
  checks that the assignment's start date (practice-local, `Africa/Johannesburg`) falls inside
  one of that doctor's `practice_membership.valid_at` ranges for the same tenant, and raises if
  not.

**Honestly, this is weaker than what the ADR originally promised**, and that gap should be
named rather than glossed over: a trigger can be disabled by a superuser (`ALTER TABLE ...
DISABLE TRIGGER`); a `PERIOD` foreign key cannot be bypassed at all short of dropping the
constraint. In practice that is a deliberate, auditable, two-step action rather than an
accidental write, and the invariant that actually matters for safety — no double-booking — is
still a real, undroppable-by-accident constraint. But it is not the same guarantee, and it
would be dishonest to record it as one.

This was verified with a real assertion, not read off the SQL: `npm run db:check` starts a
throwaway cluster from `.tools/pgsql`, applies every migration, and inserts a shift assignment
dated outside the doctor's membership interval — the trigger refuses it, and the test fails
loudly if it ever stops doing so.

**Revisit this addendum when:** the hosting target moves to PostgreSQL 18 or later (Supabase
adds it, or the hosting decision changes — see `docs/ops/environments.md`). At that point,
delete the trigger and the `enforce_membership_containment()` function, and replace them with
the native `PERIOD` foreign key this ADR originally specified. Nothing else in the schema
needs to change — `practice_membership.valid_at` and `shift_assignment.period` are already the
right shape for it.
