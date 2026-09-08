-- 0001_extensions_and_tenant_context.sql
--
-- Foundational extension and the row-level-security tenant-context mechanism every later
-- migration builds on. RLS ships from this first migration and is never retrofitted --
-- ADR-0007 (docs/architecture/decisions/0007-shared-schema-rls.md).

create extension if not exists btree_gist;

-- The tenant context for the current session/transaction. The application sets it once per
-- request with `select set_config('app.tenant_id', '<uuid>', true)` (or `SET LOCAL
-- app.tenant_id = '<uuid>'`) before running any query. Unset means no tenant scope, and every
-- RLS policy built on this function therefore denies all rows rather than allowing them --
-- fail closed.
--
-- This is a plain-Postgres mechanism deliberately, not a Supabase `auth.jwt()` claim: no
-- Supabase project exists yet (Track B7 in docs/NEEDS_YOUR_INPUT.md), and this schema has to
-- run locally against the pinned `.tools/pgsql` 17.2 binary. When the Supabase project exists,
-- redefine this one function to read the tenant claim out of `auth.jwt()` instead -- every
-- policy in this schema calls the function, never the session variable directly, so that stays
-- a one-function change rather than a schema migration.
create or replace function app_current_tenant_id() returns uuid
  language sql
  stable
as $$
  select nullif(current_setting('app.tenant_id', true), '')::uuid
$$;

-- The role application code runs as (directly, or via `SET ROLE app_user` from a login role).
-- Never a superuser and never BYPASSRLS -- RLS is the enforcement boundary, application care is
-- not (ADR-0007). Table-level GRANTs are added alongside each table as it is created; RLS
-- policies are what actually restrict which rows those grants can touch.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_user') then
    create role app_user nologin;
  end if;
end
$$;

grant usage on schema public to app_user;
