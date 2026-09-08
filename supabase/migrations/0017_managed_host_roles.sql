-- 0017_managed_host_roles.sql
--
-- Two corrections that only a managed host reveals. Both were measured against the real
-- `call-roster-prod` on 2026-09-08, after all sixteen previous migrations applied cleanly --
-- which is the point: a clean migration is not evidence the application can run.
--
-- Neither is reachable from the local gates. `db:check` and `api:check` connect as a cluster-
-- owning superuser, which can become any role and is subject to no default grants; Supabase's
-- `postgres` is neither. See docs/ops/supabase-setup.md.

-- ---------------------------------------------------------------------------------------------
-- 1. The login role must be able to `SET ROLE app_user`
-- ---------------------------------------------------------------------------------------------
--
-- ⚠️ Without this NOTHING works: every transaction in `lib/server/db.ts` opens with
-- `set local role app_user`, and on Supabase that failed with *"permission denied to set role
-- app_user"* -- at request time, not migration time, so the first symptom would have been every
-- route 500ing against a database that looked perfectly healthy.
--
-- The cause is a PostgreSQL 16+ rule, not a Supabase quirk. `app_user` is created in migration
-- 0001 by the connecting role; a non-superuser with CREATEROLE that creates a role is granted
-- ADMIN on it (so it may hand the role to others) but NOT SET (so it may not become it). Locally
-- the connecting role is a superuser, which can always `SET ROLE`, so the gap is invisible.
--
-- This is not a privilege escalation. The login role already owns every table here; membership in
-- `app_user` grants it strictly less than it has. The entire purpose of `SET ROLE app_user` is to
-- DROP privileges for the duration of a transaction so RLS binds (ADR-0007).
--
-- `WITH SET TRUE` is the operative clause -- a plain re-grant would not necessarily add SET to an
-- existing admin-only membership. Idempotent: re-granting an existing membership is a no-op.
grant app_user to current_user with set true;

-- ---------------------------------------------------------------------------------------------
-- 2. Remove the PostgREST roles from `public`
-- ---------------------------------------------------------------------------------------------
--
-- Supabase grants its Data API roles default privileges in `public`, so every table created there
-- is picked up automatically. Measured on the real project: `anon` and `authenticated` each held
-- grants on all 28 tables.
--
-- **Nothing in this product uses PostgREST.** `lib/server/db.ts` is a direct `pg` pool; there is
-- no `supabase-js` anywhere. RLS would still deny every row -- `app.tenant_id` is never set on
-- such a request and every policy fails closed -- but this schema will hold thirteen identifiable
-- people's day-by-day movements, and "one policy mistake away from readable over the internet" is
-- not a posture to keep for a surface we do not use. Defence in depth is the whole argument for
-- RLS here; it applies to the grants too.
--
-- `service_role` is deliberately left alone: it is reachable only with a secret key that never
-- leaves the dashboard, and Supabase's own tooling may rely on it. `anon` and `authenticated` are
-- the two an anonymous internet request can present.
--
-- Guarded by role existence because these roles are a Supabase construct and do not exist on the
-- local `.tools/pgsql` cluster, where this migration must also run without error.
--
-- ⚠️ Reversing this is a NEW migration, never an edit to this one -- if Supabase Auth is ever
-- adopted (migration 0001 is written so `app_current_tenant_id()` can switch to `auth.jwt()`),
-- the grants come back deliberately and visibly.
do $$
declare
  postgrest_role text;
begin
  foreach postgrest_role in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = postgrest_role) then
      execute format('revoke all on all tables in schema public from %I', postgrest_role);
      execute format('revoke all on all sequences in schema public from %I', postgrest_role);
      execute format('revoke all on all functions in schema public from %I', postgrest_role);
      execute format('revoke all on schema public from %I', postgrest_role);
      -- Stops the NEXT table inheriting the grant this migration just removed. Applies to
      -- defaults set by the role running this migration, which is the role that creates them.
      execute format(
        'alter default privileges in schema public revoke all on tables from %I', postgrest_role
      );
      execute format(
        'alter default privileges in schema public revoke all on sequences from %I', postgrest_role
      );
      execute format(
        'alter default privileges in schema public revoke all on functions from %I', postgrest_role
      );
    end if;
  end loop;
end
$$;
