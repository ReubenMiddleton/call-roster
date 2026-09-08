-- 0003_shift_structure.sql
--
-- A shift pattern is a property of the DATE, not the weekday -- the weekday supplies a default,
-- any date can override it (docs/domain/shift-patterns.md, AGENTS.md).

create table shift_pattern (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references practice(id),
  name        text not null,
  created_at  timestamptz not null default now(),
  unique (tenant_id, name)
);

create table pattern_shift (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references practice(id),
  pattern_id  uuid not null references shift_pattern(id),
  shift_key   text not null,
  start_hour  smallint not null check (start_hour between 0 and 23),
  hours       numeric not null check (hours > 0),
  kind        text not null check (kind in ('morning','afternoon','evening','night','long-day')),
  unique (pattern_id, shift_key)
);

-- A date with no row uses its weekday's default pattern. A date with a row overrides it.
create table date_pattern (
  tenant_id   uuid not null references practice(id),
  on_date     date not null,
  pattern_id  uuid not null references shift_pattern(id),
  reason      text, -- 'holiday', 'thin staffing', admin note
  primary key (tenant_id, on_date)
);

-- ---------------------------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------------------------

alter table shift_pattern enable row level security;
alter table shift_pattern force row level security;
create policy shift_pattern_isolation on shift_pattern
  using (tenant_id = app_current_tenant_id())
  with check (tenant_id = app_current_tenant_id());
grant select, insert, update, delete on shift_pattern to app_user;

alter table pattern_shift enable row level security;
alter table pattern_shift force row level security;
create policy pattern_shift_isolation on pattern_shift
  using (tenant_id = app_current_tenant_id())
  with check (tenant_id = app_current_tenant_id());
grant select, insert, update, delete on pattern_shift to app_user;

alter table date_pattern enable row level security;
alter table date_pattern force row level security;
create policy date_pattern_isolation on date_pattern
  using (tenant_id = app_current_tenant_id())
  with check (tenant_id = app_current_tenant_id());
grant select, insert, update, delete on date_pattern to app_user;
