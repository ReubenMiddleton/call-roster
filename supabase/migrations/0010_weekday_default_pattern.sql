-- 0010_weekday_default_pattern.sql
--
-- Level 4 of the precedence order in docs/domain/shift-patterns.md: "which pattern applies by
-- default" is per-tenant DATA, never hard-coded into the resolver (ADR-0010) --
-- lib/calendar/pattern-precedence.ts's own docblock says so explicitly, and
-- `PILOT_WEEKDAY_DEFAULTS_V1` in that file is a fixture for the one practice that exists today,
-- not a schema. This table is where a second tenant's answer would actually live.
--
-- Weekday as a name, not an integer, on purpose: this project has already been bitten once by a
-- weekday crossing a boundary as an integer and silently meaning the wrong day (Sunday is 0 in
-- TypeScript, Monday is 0 in Python -- lib/contract/weekday.ts). This table isn't near that
-- boundary, but a name is unambiguous everywhere a number invites a re-derivation, including a
-- future migration.
create table weekday_default_pattern (
  tenant_id   uuid not null references practice(id),
  weekday     text not null
                check (weekday in ('sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday')),
  pattern_id  uuid not null references shift_pattern(id),
  primary key (tenant_id, weekday)
);

alter table weekday_default_pattern enable row level security;
alter table weekday_default_pattern force row level security;
create policy weekday_default_pattern_isolation on weekday_default_pattern
  using (tenant_id = app_current_tenant_id())
  with check (tenant_id = app_current_tenant_id());
grant select, insert, update, delete on weekday_default_pattern to app_user;
