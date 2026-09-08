-- 0008_solve_run.sql
--
-- The solver is a separate Python service behind a Postgres job queue -- never a synchronous
-- request (AGENTS.md, ADR-0005). Claimed with `FOR UPDATE SKIP LOCKED`. `request` and `result`
-- are validated against docs/architecture/solver-contract.md on both sides
-- (docs/architecture/data-model.md).

create table solve_run (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references practice(id),
  roster_id       uuid not null references roster(id),
  status          text not null default 'queued'
                    check (status in ('queued', 'running', 'succeeded', 'timed_out', 'failed')),
  request         jsonb not null,
  best_objective  numeric,
  result          jsonb,
  claimed_at      timestamptz,
  finished_at     timestamptz,
  created_at      timestamptz not null default now()
);

create index solve_run_status_idx on solve_run (tenant_id, status);

-- ---------------------------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------------------------

alter table solve_run enable row level security;
alter table solve_run force row level security;
create policy solve_run_isolation on solve_run
  using (tenant_id = app_current_tenant_id())
  with check (tenant_id = app_current_tenant_id());
grant select, insert, update, delete on solve_run to app_user;
