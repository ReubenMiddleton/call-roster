-- 0004_roster_and_assignment.sql
--
-- The two invariants this whole project leans on hardest: no doctor works two overlapping
-- shifts, and a doctor can only be rostered while a member (ADR-0008). Published rosters are
-- immutable snapshots -- editing creates version N+1, it never mutates N.

create table roster (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references practice(id),
  month       text not null, -- IsoMonth 'YYYY-MM', see lib/analytics/types.ts
  status      text not null default 'draft'
                check (status in ('draft', 'published', 'locked', 'archived')),
  created_at  timestamptz not null default now(),
  unique (tenant_id, month)
);

create table roster_version (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references practice(id),
  roster_id       uuid not null references roster(id),
  version_number  integer not null,
  prev_hash       text,
  hash            text not null,
  snapshot        jsonb not null,
  published_by    uuid references person(id),
  published_at    timestamptz not null default now(),
  unique (roster_id, version_number)
);

create table shift_slot (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references practice(id),
  roster_id         uuid not null references roster(id),
  on_date           date not null,
  pattern_shift_id  uuid not null references pattern_shift(id),
  unique (tenant_id, roster_id, on_date, pattern_shift_id)
);

create table shift_assignment (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references practice(id),
  doctor_id      uuid not null references person(id),
  shift_slot_id  uuid not null references shift_slot(id),
  period         tstzrange not null,
  provenance     text not null default 'unknown'
                   check (provenance in ('directed', 'requested', 'absorbed', 'unknown')),
  locked         boolean not null default false,
  created_at     timestamptz not null default now(),
  unique (shift_slot_id),
  -- H-01/H-02: exactly one doctor per slot, and no doctor works two overlapping shifts anywhere
  -- -- the single most important invariant in the system. Verified against the pinned 17.2
  -- binary on 2026-09-07.
  exclude using gist (doctor_id with =, period with &&)
);

create index shift_assignment_doctor_idx on shift_assignment (tenant_id, doctor_id);

-- H-03: a doctor can only be rostered while a member. PostgreSQL 18's native
-- `FOREIGN KEY (doctor_id, PERIOD period) REFERENCES practice_membership (doctor_id, PERIOD
-- valid_at)` is not available on 17 (verified 2026-09-07 -- ADR-0008 addendum), so this is
-- enforced with a trigger instead. An overnight shift belongs to the day it STARTS on
-- (docs/product/glossary.md), so containment is checked against the assignment's start date in
-- the practice's own timezone, not against the full period.
--
-- Strictly weaker than a native constraint -- a trigger can be disabled, a constraint cannot --
-- but it is still enforced in the database rather than in application code, which is the
-- property that matters here (ADR-0008). Swap for the native PERIOD foreign key the day the
-- host offers PostgreSQL 18: the trigger, the function and this comment are the only things to
-- delete.
create or replace function enforce_membership_containment() returns trigger
  language plpgsql
as $$
declare
  shift_start_date date;
begin
  shift_start_date := (lower(new.period) at time zone 'Africa/Johannesburg')::date;
  if not exists (
    select 1
    from practice_membership pm
    where pm.tenant_id = new.tenant_id
      and pm.doctor_id = new.doctor_id
      and pm.valid_at @> shift_start_date
  ) then
    -- `check_violation` (23514) rather than the plpgsql default `P0001`: this is a business-rule
    -- violation the API needs to tell apart from an unrelated internal error, and a named
    -- SQLSTATE is a stable thing to branch on -- see lib/server/api-error.ts. Message text is
    -- not, and never should be.
    raise exception
      'shift_assignment % for doctor % starts % which is outside every practice_membership interval for tenant %',
      new.id, new.doctor_id, shift_start_date, new.tenant_id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger shift_assignment_membership_containment
  before insert or update on shift_assignment
  for each row
  execute function enforce_membership_containment();

-- Recurring structures use the iCal model -- master row plus RRULE plus exceptions -- and are
-- never materialised as rows (AGENTS.md). `exceptions` is a jsonb array of
-- `{date, action: 'skip' | 'override', overrideDoctorId?}` for v1; promote to a dedicated table
-- if that shape stops being enough.
create table recurring_slot (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references practice(id),
  doctor_id         uuid not null references person(id),
  pattern_shift_id  uuid not null references pattern_shift(id),
  rrule             text not null,
  valid_at          daterange not null,
  exceptions        jsonb not null default '[]'::jsonb,
  created_at        timestamptz not null default now()
);

-- ---------------------------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------------------------

alter table roster enable row level security;
alter table roster force row level security;
create policy roster_isolation on roster
  using (tenant_id = app_current_tenant_id())
  with check (tenant_id = app_current_tenant_id());
grant select, insert, update, delete on roster to app_user;

alter table roster_version enable row level security;
alter table roster_version force row level security;
create policy roster_version_isolation on roster_version
  using (tenant_id = app_current_tenant_id())
  with check (tenant_id = app_current_tenant_id());
grant select, insert on roster_version to app_user; -- immutable snapshot: no update, no delete

alter table shift_slot enable row level security;
alter table shift_slot force row level security;
create policy shift_slot_isolation on shift_slot
  using (tenant_id = app_current_tenant_id())
  with check (tenant_id = app_current_tenant_id());
grant select, insert, update, delete on shift_slot to app_user;

alter table shift_assignment enable row level security;
alter table shift_assignment force row level security;
create policy shift_assignment_isolation on shift_assignment
  using (tenant_id = app_current_tenant_id())
  with check (tenant_id = app_current_tenant_id());
grant select, insert, update, delete on shift_assignment to app_user;

alter table recurring_slot enable row level security;
alter table recurring_slot force row level security;
create policy recurring_slot_isolation on recurring_slot
  using (tenant_id = app_current_tenant_id())
  with check (tenant_id = app_current_tenant_id());
grant select, insert, update, delete on recurring_slot to app_user;
