-- 0007_violations_and_overrides.sql
--
-- "Warn and scar, never block. Violations are visible, explained and overridable -- and the
-- warning STAYS after an override" (AGENTS.md, product principle 3). An override is therefore a
-- new row alongside a violation, never a mutation or deletion of it.

create table violation (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references practice(id),
  assignment_id  uuid not null references shift_assignment(id),
  constraint_id  text not null, -- 'H-05', 'S-08', ... -- docs/domain/constraints.md
  mode           text not null check (mode in ('WARN', 'BLOCK')),
  message        text not null,
  created_at     timestamptz not null default now()
);

create index violation_assignment_idx on violation (tenant_id, assignment_id);

create table override (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references practice(id),
  violation_id   uuid not null references violation(id),
  actor_id       uuid not null references person(id),
  reason         text,
  overridden_at  timestamptz not null default now()
);

create index override_violation_idx on override (tenant_id, violation_id);

-- ---------------------------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------------------------

alter table violation enable row level security;
alter table violation force row level security;
create policy violation_isolation on violation
  using (tenant_id = app_current_tenant_id())
  with check (tenant_id = app_current_tenant_id());
grant select, insert, update, delete on violation to app_user;

alter table override enable row level security;
alter table override force row level security;
create policy override_isolation on override
  using (tenant_id = app_current_tenant_id())
  with check (tenant_id = app_current_tenant_id());
grant select, insert on override to app_user; -- a scar: never updated or deleted, only added
