-- 0002_practice_and_people.sql
--
-- The Person <-> Membership <-> Practice <-> Site graph -- ADR-0007
-- (docs/architecture/decisions/0007-shared-schema-rls.md). `person` is deliberately NOT
-- tenant-scoped: a doctor belonging to two practices is one person with two memberships, never
-- two duplicate rows -- that duplication would break the fairness ledger and the audit trail.

create table practice (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_at  timestamptz not null default now()
);

-- The hospital whose emergency centre a practice staffs. NOT tenant-scoped: one hospital may
-- host several practices, and a hospital is a consumer of rosters, never their owner
-- (docs/architecture/data-model.md). Carries no personal information, so it is shared reference
-- data rather than isolated per tenant.
create table site (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_at  timestamptz not null default now()
);

create table practice_site (
  tenant_id   uuid not null references practice(id),
  site_id     uuid not null references site(id),
  created_at  timestamptz not null default now(),
  primary key (tenant_id, site_id)
);

-- First-class because the practice MAY also roster genuinely employed staff -- practice
-- manager, admin, nurses -- to whom BCEA rules apply while they do not apply to the doctors.
-- Whether it ever does is [UNKNOWN] (docs/NEEDS_YOUR_INPUT.md #23). Until answered, exactly one
-- category exists per tenant: independent practitioner.
create table staff_category (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references practice(id),
  name        text not null,
  created_at  timestamptz not null default now(),
  unique (tenant_id, name)
);

-- ⚠️ This is exactly where the thirteen real doctor names live once the app runs
-- (docs/ops/environments.md). Never seed this table, a fixture, or a test with a real surname --
-- `npm run names:check` cannot see inside a running database, only inside the repository.
create table person (
  id          uuid primary key default gen_random_uuid(),
  full_name   text not null,
  created_at  timestamptz not null default now()
);

-- Application-time temporal validity, enforced in the database -- ADR-0008
-- (docs/architecture/decisions/0008-temporal-validity-intervals.md). No `fte` column: dropped
-- 2026-09-07 on the owner's answer to question 36, before this migration was ever written --
-- see docs/architecture/data-model.md.
--
-- No native `PRIMARY KEY (doctor_id, valid_at WITHOUT OVERLAPS)`: that is PostgreSQL 18
-- SQL:2011 temporal syntax, verified against the pinned `.tools/pgsql` 17.2 binary on
-- 2026-09-07 to fail with a syntax error, and Supabase's managed Postgres does not offer 18 yet
-- either (docs/ops/environments.md). This schema targets 17 and gets the equivalent
-- overlap-prevention guarantee from a GiST exclusion constraint instead. See the addendum to
-- ADR-0008.
create table practice_membership (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references practice(id),
  doctor_id          uuid not null references person(id),
  staff_category_id  uuid references staff_category(id),
  valid_at           daterange not null,
  created_at         timestamptz not null default now(),
  exclude using gist (tenant_id with =, doctor_id with =, valid_at with &&)
);

create index practice_membership_doctor_idx on practice_membership (tenant_id, doctor_id);

-- ---------------------------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------------------------

alter table practice enable row level security;
alter table practice force row level security;

-- A tenant can only see, change or remove its own practice row. Creation has no tenant context
-- yet (the id being inserted IS the new tenant id), so insert is unrestricted here -- tenant
-- provisioning is a privileged operation, not an app_user-scoped one (ADR-0010: "during the
-- pilot, tenant provisioning is a SQL insert").
create policy practice_read_own on practice
  for select using (id = app_current_tenant_id());
create policy practice_write_own on practice
  for update using (id = app_current_tenant_id()) with check (id = app_current_tenant_id());
create policy practice_delete_own on practice
  for delete using (id = app_current_tenant_id());
create policy practice_insert_open on practice
  for insert with check (true);
grant select, insert, update, delete on practice to app_user;

alter table site enable row level security;
alter table site force row level security;
create policy site_shared_reference_data on site
  using (true) with check (true);
grant select, insert, update, delete on site to app_user;

alter table practice_site enable row level security;
alter table practice_site force row level security;
create policy practice_site_isolation on practice_site
  using (tenant_id = app_current_tenant_id())
  with check (tenant_id = app_current_tenant_id());
grant select, insert, update, delete on practice_site to app_user;

alter table staff_category enable row level security;
alter table staff_category force row level security;
create policy staff_category_isolation on staff_category
  using (tenant_id = app_current_tenant_id())
  with check (tenant_id = app_current_tenant_id());
grant select, insert, update, delete on staff_category to app_user;

alter table person enable row level security;
alter table person force row level security;
-- `person` carries no tenant_id (it is deliberately not tenant-scoped), so it cannot use the
-- plain isolation policy above. Visibility instead follows practice_membership: a tenant may
-- see or change a person's row only once that person holds a membership in it. Insert is
-- unrestricted because a person is normally created in the same transaction as their first
-- membership, before that membership row exists to check against.
create policy person_select_via_membership on person
  for select using (
    exists (
      select 1 from practice_membership pm
      where pm.doctor_id = person.id and pm.tenant_id = app_current_tenant_id()
    )
  );
create policy person_update_via_membership on person
  for update using (
    exists (
      select 1 from practice_membership pm
      where pm.doctor_id = person.id and pm.tenant_id = app_current_tenant_id()
    )
  ) with check (
    exists (
      select 1 from practice_membership pm
      where pm.doctor_id = person.id and pm.tenant_id = app_current_tenant_id()
    )
  );
create policy person_insert_open on person
  for insert with check (true);
grant select, insert, update, delete on person to app_user;

alter table practice_membership enable row level security;
alter table practice_membership force row level security;
create policy practice_membership_isolation on practice_membership
  using (tenant_id = app_current_tenant_id())
  with check (tenant_id = app_current_tenant_id());
grant select, insert, update, delete on practice_membership to app_user;
