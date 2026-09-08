-- 0014_error_record.sql
--
-- L2, "error records" (docs/ops/diagnostics.md) -- for the failures that ARE exceptions, as
-- opposed to L1's command journal, which covers the far more common case of a warning that
-- fires when it shouldn't or an export that comes out wrong (nothing throws for either). OTel
-- exception semantic conventions for field names (`exception.type`, `.message`, `.stacktrace`) --
-- "the vocabulary, not the SDK", so a future exporter is a field mapping, not a re-instrumentation
-- (ADR-0013).
--
-- ⚠️ `tenant_id` is nullable here, unlike every other table in this schema -- the one deliberate
-- exception. An error can happen before tenant context exists at all (malformed input to
-- `POST /api/practices`, a genuinely framework-level failure `instrumentation.ts`'s
-- `onRequestError` catches). The RLS policy below still isolates by tenant when one is known; a
-- null-tenant row is invisible to every `app_user` tenant context by construction (`tenant_id =
-- app_current_tenant_id()` is never true when `tenant_id` is null), reachable only by direct,
-- ops-level database access -- the same posture `practice`'s own pre-tenant insert policy
-- established first (ADR-0010).

create table error_record (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid references practice(id),
  -- Correlation fields the design calls for -- "every error carries the appRunId and, where one
  -- exists, the commandId that was in flight." Both null today: no real browser client exists to
  -- send an appRunId (same honest gap as command_journal's), and command correlation would need
  -- the in-flight command_journal row's id at the point of failure, which the exceptional path
  -- that reaches this table does not have -- real, separate work, not simulated here.
  app_run_id            uuid,
  command_id            uuid references command_journal(id),
  -- ⚠️ Genuinely free text, deliberately outside L0's "no free text in a diagnostic record"
  -- guarantee -- that rule works by construction for command_journal because its payload shape
  -- is entity references the application controls. A stack trace and an exception message are
  -- whatever the thrown error happened to say; V8 stack frames are file/line/function references
  -- (not variable dumps), and no throw site in this codebase interpolates a display name into a
  -- message today (`badRequest`/`conflict`/`notFound` messages all reference ids and status
  -- values, never `person.full_name`) -- but that is an ongoing code-review discipline, not a
  -- structural guarantee the way command_journal's shape is. Named here rather than glossed over.
  exception_type        text not null,
  exception_message     text not null,
  exception_stacktrace  text,
  source                text not null check (source in ('server', 'client')),
  -- Not an OTel field, but cheap and genuinely useful for "what was being asked when this broke"
  -- -- the request path, not full URL (never query params, which could carry anything).
  route                 text,
  app_version           text,
  schema_version        text,
  occurred_at           timestamptz not null default now() -- server time, never a client clock
);

create index error_record_tenant_time_idx on error_record (tenant_id, occurred_at);

-- No-update only, deliberately narrower than command_journal's no-update-no-delete: an error
-- record is evidence of what broke while it's live, and mutating it after the fact defeats the
-- point, but unlike the command journal it is diagnostic exhaust, not the audit trail -- L6's
-- (not yet built) 90-day retention job must be able to delete rows outright. `app_user` is not
-- granted DELETE below regardless (the retention job needs its own role, not the app's own
-- tenant-scoped one), so this trigger's job is narrowly "no tampering," not "no deletion, ever."
create or replace function forbid_error_record_update() returns trigger
  language plpgsql
as $$
begin
  raise exception 'error_record rows are immutable: % is not permitted on them', TG_OP;
end;
$$;

create trigger error_record_no_update
  before update on error_record
  for each row execute function forbid_error_record_update();

-- ---------------------------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------------------------

alter table error_record enable row level security;
alter table error_record force row level security;
create policy error_record_isolation on error_record
  using (tenant_id = app_current_tenant_id())
  with check (true); -- insertable with no tenant context yet, like `practice` itself (ADR-0010)
grant select, insert on error_record to app_user; -- no update, no delete -- see the trigger above
