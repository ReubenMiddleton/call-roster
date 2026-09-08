-- 0011_swap_request.sql
--
-- "Swap: a transaction moving an assignment between doctors after lock. Not a silent edit -- an
-- unannounced change to a live call roster is a patient-safety event." (docs/product/glossary.md)
--
-- Three named commands in docs/domain/commands-events.md -- RequestSwap, ApproveSwap,
-- RejectSwap -- rather than one direct edit: "the principal remains the sole scheduler," and a
-- request/decide shape is what makes every post-publish change explicit and auditable instead of
-- an admin quietly overwriting a cell. Scoped to changing WHO holds an existing assignment, per
-- the glossary definition above -- not moving it to a different slot, and not the initial
-- assignment of an empty slot, which `POST /assignments` already covers for DRAFT rosters.
create table swap_request (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references practice(id),
  shift_assignment_id  uuid not null references shift_assignment(id),
  requested_doctor_id  uuid not null references person(id),
  status               text not null default 'pending'
                         check (status in ('pending', 'approved', 'rejected')),
  requested_by         uuid references person(id),
  reason               text,
  rejection_reason     text,
  created_at           timestamptz not null default now(),
  decided_at           timestamptz,
  decided_by           uuid references person(id)
);

create index swap_request_assignment_idx on swap_request (tenant_id, shift_assignment_id);

-- At most one open request per assignment at a time -- two pending requests for the same cell
-- would leave it ambiguous which one "the" decision applies to.
create unique index swap_request_one_pending_per_assignment
  on swap_request (shift_assignment_id)
  where status = 'pending';

alter table swap_request enable row level security;
alter table swap_request force row level security;
create policy swap_request_isolation on swap_request
  using (tenant_id = app_current_tenant_id())
  with check (tenant_id = app_current_tenant_id());
grant select, insert, update on swap_request to app_user; -- no delete -- a decided request stays, like an override
