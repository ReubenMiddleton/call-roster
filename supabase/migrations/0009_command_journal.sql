-- 0009_command_journal.sql
--
-- ⚠️ Originally `audit_log` -- rewritten in place rather than superseded by a later migration,
-- the same call made for `burden_weight` in 0005_fairness.sql and for the same reason: nothing
-- has ever applied this migration against a real Supabase project, so there is no live data for
-- the distinction between "edit" and "a new ALTER" to protect. This table now IS the L1 command
-- journal `docs/ops/diagnostics.md` designs -- "This journal IS the append-only audit trail
-- compliance.md requires ... Do not build a second one." See docs/DECISIONS.md for the full
-- account of the redesign.
--
-- Under ECTA s15(4)/s15(3) (docs/ops/compliance.md), business records in data-message form are
-- rebuttable proof of the facts they contain, with evidential weight a function of demonstrable
-- integrity -- append-only, immutable: every mutation records actor, timestamp, before, after,
-- reason, and override records are preserved, never cleaned up.

create table command_journal (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references practice(id),
  -- One browser lifetime, client-generated -- "Not 'session'": docs/product/glossary.md reserves
  -- that word for a shift synonym. Nullable: every caller today is a server-issued API call with
  -- no real browser client yet (`app/` is still a scaffold) -- real once a client sends one, not
  -- simulated here.
  app_run_id      uuid,
  -- Monotonic per (tenant_id, app_run_id). Gaps are visible, which matters once L4's client
  -- buffer (not built) can drop something. Null alongside a null app_run_id.
  seq             integer,
  roster_id       uuid references roster(id),
  roster_version  integer,
  -- ⚠️ Pre-auth placeholder, like `x-tenant-id` and every other `actorId` in this API -- there is
  -- no session to attribute a mutation to yet.
  actor_id        uuid references person(id),
  -- Enumerated at the application layer (`lib/server/command-journal.ts`'s `CommandType` union),
  -- matching docs/domain/commands-events.md's vocabulary -- left as `text` here rather than a
  -- `check` constraint because the command vocabulary is still growing as more of it gets a route
  -- handler, unlike the closed domain enums (`day_class`, `shift_kind`) elsewhere in this schema.
  command_type    text not null,
  -- "Entity references only -- codes, dates, shift ids" (docs/ops/diagnostics.md's `payload`
  -- field). Every existing call site already expresses its payload as a before/after state
  -- transition, so keeping that proven shape from the original `audit_log` IS the concrete
  -- instantiation of the design doc's single `payload` column here, rather than a third,
  -- redundant JSON column holding the same kind of thing.
  before          jsonb,
  after           jsonb,
  outcome         text not null default 'applied' check (outcome in ('applied', 'refused', 'failed')),
  -- The one sanctioned free-text column, in two uses, neither a POPIA risk. On an `applied` row:
  -- ECTA s15(4) requires a reason survive on the audit trail, and it is product-supplied
  -- administrative text about the scheduler's own decision (`RequestSwap`, `RejectSwap`,
  -- `UnpublishRoster`), stored nowhere else durably. On a `refused`/`failed` row
  -- (`lib/server/command-journal.ts`'s `journalRefusal`): the system's own deterministic,
  -- template-generated explanation of why -- never user-typed, so still no free-text risk. L0's
  -- "no free text in a diagnostic record" targets uncontrolled input; this column is the one
  -- explicit, documented exception either way, allowlisted by name in
  -- `scripts/check-diagnostics-safety.ts` rather than the rule being loosened generally.
  reason          text,
  issued_at       timestamptz not null default now(), -- server time, never a client clock
  client_at       timestamptz,
  app_version     text,
  schema_version  text
);

create index command_journal_tenant_time_idx on command_journal (tenant_id, issued_at);
create index command_journal_roster_idx on command_journal (tenant_id, roster_id)
  where roster_id is not null;
-- Enforces "monotonic per appRunId" at the one layer that can actually guarantee it under
-- concurrent writers, rather than trusting every future call site to compute it correctly.
create unique index command_journal_seq_idx on command_journal (app_run_id, seq)
  where app_run_id is not null and seq is not null;

-- Append-only, enforced rather than merely conventional -- unchanged from the original
-- `audit_log`. Even a role granted UPDATE/DELETE cannot make it through this trigger; app_user is
-- in any case never granted those privileges below. A superuser could still
-- `ALTER TABLE ... DISABLE TRIGGER` first, but that is a deliberate, auditable, two-step action --
-- not an accidental UPDATE.
create or replace function forbid_command_journal_mutation() returns trigger
  language plpgsql
as $$
begin
  raise exception 'command_journal is append-only: % is not permitted on it', TG_OP;
end;
$$;

create trigger command_journal_no_update
  before update on command_journal
  for each row execute function forbid_command_journal_mutation();

create trigger command_journal_no_delete
  before delete on command_journal
  for each row execute function forbid_command_journal_mutation();

-- ---------------------------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------------------------

alter table command_journal enable row level security;
alter table command_journal force row level security;
create policy command_journal_isolation on command_journal
  using (tenant_id = app_current_tenant_id())
  with check (tenant_id = app_current_tenant_id());
grant select, insert on command_journal to app_user; -- no update, no delete -- see the trigger above
