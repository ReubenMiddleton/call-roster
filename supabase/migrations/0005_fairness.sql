-- 0005_fairness.sql
--
-- docs/architecture/data-model.md. `weight_used` on burden_credit is denormalised deliberately:
-- when weights change, historical credits must keep the weight in force when they were earned --
-- recalculating history under new weights would silently rewrite who owed what. Weight changes
-- apply forward only.
--
-- ⚠️ This migration originally also created `burden_weight (tenant_id, shift_kind, weight,
-- valid_at)` -- removed here rather than dropped in a later migration, since nothing ever read or
-- wrote it (verified 2026-09-08 before removing it) and there is no real Supabase project yet for
-- the distinction to matter. It could not have expressed a real burden schedule: pricing depends
-- on `dayClass × shiftKind × weekday × fromHour × specialDate` (see `BurdenMatch` in
-- lib/analytics/burden-types.ts -- "Friday from 17:00" and "Christmas night" are not expressible
-- in a `(shift_kind, weight)` pair. See `0013_burden_schedule.sql` for the replacement and
-- docs/DECISIONS.md for the full account of why the first attempt was wrong.

create table burden_credit (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references practice(id),
  doctor_id    uuid not null references person(id),
  roster_id    uuid not null references roster(id),
  shift_kind   text not null,
  weight_used  numeric not null,
  provenance   text not null default 'unknown'
                 check (provenance in ('directed', 'requested', 'absorbed', 'unknown')),
  credited_at  timestamptz not null default now()
);

create index burden_credit_doctor_idx on burden_credit (tenant_id, doctor_id);

-- ---------------------------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------------------------

alter table burden_credit enable row level security;
alter table burden_credit force row level security;
create policy burden_credit_isolation on burden_credit
  using (tenant_id = app_current_tenant_id())
  with check (tenant_id = app_current_tenant_id());
grant select, insert, update, delete on burden_credit to app_user;
