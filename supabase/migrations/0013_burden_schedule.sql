-- 0013_burden_schedule.sql
--
-- The real replacement for the `burden_weight` table removed from 0005_fairness.sql. A burden
-- schedule is an ORDERED, most-specific-first rule list, matching `BurdenSchedule`/`BurdenRule`/
-- `BurdenMatch` in lib/analytics/burden-types.ts exactly -- not a lookup table, because the
-- practice's actual pricing depends on combinations a flat `(shift_kind, weight)` pair cannot
-- express: "Friday from 17:00" (weekday + hour), "Christmas night" (a named date + shift kind),
-- "weekday from 15:00" (day class + hour). See docs/domain/fairness.md and
-- lib/analytics/burden.ts's `AGREED_BURDEN_V2` for what a real schedule looks like.
--
-- Versioned with a validity interval, per ADR-0008 and the fairness ledger's own stated rule:
-- "historical credits keep the weight in force when they were earned. Recalculating history under
-- new weights silently rewrites who owed what." A new schedule supersedes the previous one going
-- forward; it never edits it.
create table burden_schedule (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references practice(id),
  version     text not null,
  valid_from  date not null,
  valid_to    date,
  -- How much the tenant has actually agreed to these numbers -- lib/analytics/burden-types.ts's
  -- own confidence tag, carried through so a report built on an unconfirmed schedule can say so
  -- on its face (docs/product/glossary.md's confidence-tag convention).
  confidence  text not null check (confidence in ('CONFIRMED', 'INFERRED', 'ASSUMED')),
  created_at  timestamptz not null default now(),
  -- Two schedules for one tenant can never be simultaneously valid -- `[)` bounds (Postgres's
  -- `daterange` default) so a new schedule can start exactly where the previous one's `valid_to`
  -- ends without the ranges being read as overlapping.
  exclude using gist (tenant_id with =, daterange(valid_from, valid_to) with &&)
);

-- One row per `BurdenRule`. `position` is the resolution order -- `resolveBurden`
-- (lib/analytics/burden.ts) returns the FIRST rule whose `match` fires, so order is meaningful
-- data, not incidental row order a `SELECT` could silently reshuffle.
--
-- Every `match` column is nullable, and null means "not part of this rule's match" -- the same
-- meaning `BurdenMatch`'s optional TypeScript fields carry. A rule with every column null is the
-- catch-all `{}` match that `validateBurdenSchedule` requires to exist and be last.
create table burden_rule (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references practice(id),
  schedule_id   uuid not null references burden_schedule(id),
  position      integer not null,
  label         text not null,
  day_class     text check (day_class in ('weekday', 'saturday', 'sunday', 'public-holiday')),
  shift_kind    text check (shift_kind in ('morning', 'afternoon', 'evening', 'night', 'long-day')),
  pattern_id    uuid references shift_pattern(id),
  special_date  text,
  weekday       smallint check (weekday between 0 and 6),
  from_hour     smallint check (from_hour between 0 and 23),
  weight        numeric not null check (weight >= 0),
  unique (schedule_id, position)
);

create index burden_rule_schedule_idx on burden_rule (tenant_id, schedule_id);

-- ---------------------------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------------------------

alter table burden_schedule enable row level security;
alter table burden_schedule force row level security;
create policy burden_schedule_isolation on burden_schedule
  using (tenant_id = app_current_tenant_id())
  with check (tenant_id = app_current_tenant_id());
-- UPDATE is needed for exactly one thing: closing the previously-open schedule's `valid_to` when
-- a new one is created (lib/server/burden-schedule.ts) -- a schedule's own rules are still never
-- edited in place, and there is no DELETE, ever: a superseded version stays, the same way
-- `roster_version` and `override` are never removed.
grant select, insert, update on burden_schedule to app_user;

alter table burden_rule enable row level security;
alter table burden_rule force row level security;
create policy burden_rule_isolation on burden_rule
  using (tenant_id = app_current_tenant_id())
  with check (tenant_id = app_current_tenant_id());
grant select, insert on burden_rule to app_user;
