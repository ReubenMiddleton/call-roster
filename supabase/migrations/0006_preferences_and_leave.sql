-- 0006_preferences_and_leave.sql
--
-- No free-text field anywhere in this file, ever. A free-text box reliably collects religious
-- observance or health information, which is special personal information under POPIA s26 --
-- a hard product boundary, enforced here structurally rather than by convention
-- (docs/product/glossary.md, docs/ops/compliance.md).

create table preference (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references practice(id),
  doctor_id   uuid not null references person(id),
  kind        text not null check (kind in ('UNAVAILABLE', 'PREFER_NOT', 'PREFER', 'MUST')),
  tentative   boolean not null default false,
  date_range  daterange not null,
  created_at  timestamptz not null default now()
);

create index preference_doctor_idx on preference (tenant_id, doctor_id);

-- Leave is an absence, not a preference, and does not consume the UNAVAILABLE budget
-- (docs/product/glossary.md). Deliberately no reason column.
create table leave (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references practice(id),
  doctor_id   uuid not null references person(id),
  date_range  daterange not null,
  created_at  timestamptz not null default now()
);

create index leave_doctor_idx on leave (tenant_id, doctor_id);

-- ---------------------------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------------------------

alter table preference enable row level security;
alter table preference force row level security;
create policy preference_isolation on preference
  using (tenant_id = app_current_tenant_id())
  with check (tenant_id = app_current_tenant_id());
grant select, insert, update, delete on preference to app_user;

alter table leave enable row level security;
alter table leave force row level security;
create policy leave_isolation on leave
  using (tenant_id = app_current_tenant_id())
  with check (tenant_id = app_current_tenant_id());
grant select, insert, update, delete on leave to app_user;
