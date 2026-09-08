-- 0012_notification_and_ics_feed.sql
--
-- Two Distribution-context pieces (docs/domain/commands-events.md) built as real, working
-- infrastructure even though the channel behind one of them doesn't exist yet -- see the comments
-- on each table for exactly what that means.

-- The outbox pattern: every notification a policy calls for gets recorded here, whether or not
-- anything can actually deliver it yet. "When RosterPublished -> notify every doctor" and "When
-- SwapApproved -> notify both doctors" (docs/domain/commands-events.md) both write rows here.
--
-- ⚠️ Nothing sends these. WhatsApp business verification is deferred until after the pilot
-- (Track B6, docs/NEEDS_YOUR_INPUT.md), so `status` sits at 'pending' forever until a real sender
-- exists to flip it to 'sent' or 'failed'. Recording the outbox now, honestly empty of delivery,
-- is the seam ADR-0010 asks for -- the alternative is building it retroactively once WhatsApp
-- exists, which means guessing at this shape twice.
create table notification (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references practice(id),
  doctor_id    uuid not null references person(id),
  channel      text not null default 'whatsapp' check (channel in ('whatsapp')),
  event_type   text not null, -- 'RosterPublished' | 'SwapApproved' -- the command that caused it
  payload      jsonb not null,
  status       text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  created_at   timestamptz not null default now()
);

create index notification_doctor_idx on notification (tenant_id, doctor_id);
create index notification_status_idx on notification (tenant_id, status);

-- A doctor's personal calendar subscription. "An ICS URL is a bearer credential. Treat it as
-- one." (docs/domain/commands-events.md) -- `token` alone identifies both the tenant and the
-- doctor, so the public feed endpoint (app/api/ics/[token]/route.ts) never sees a tenant header.
--
-- `sequence` is a feed-level generation counter, not a per-VEVENT one: every VEVENT in a fetch of
-- this feed carries the same SEQUENCE, bumped on `ApproveSwap` for whichever doctors' assignments
-- it touched (the policy's literal words: "bump the ICS feed's SEQUENCE"). A stale-cache client
-- that respects SEQUENCE re-treats the whole feed as current; this is simpler than tracking one
-- SEQUENCE per assignment and correct for a feed that is fully regenerated on every fetch anyway.
create table ics_feed (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references practice(id),
  doctor_id   uuid not null references person(id),
  token       text not null unique,
  sequence    integer not null default 0,
  created_at  timestamptz not null default now(),
  revoked_at  timestamptz
);

create index ics_feed_doctor_idx on ics_feed (tenant_id, doctor_id);

-- At most one *active* feed per doctor -- minting again revokes the old one first
-- (`RegenerateIcsToken`'s actual meaning: the old URL must stop working, not grow a sibling).
create unique index ics_feed_one_active_per_doctor
  on ics_feed (tenant_id, doctor_id)
  where revoked_at is null;

-- The public feed endpoint (app/api/ics/[token]/route.ts) has to resolve a token to a tenant
-- BEFORE it has a tenant context to query with -- a chicken-and-egg problem plain RLS cannot
-- solve, since `ics_feed_isolation` below requires the context this lookup exists to produce. A
-- bare superuser connection isn't a real answer either: local dev's "connect as postgres" shortcut
-- is explicitly not how production will authenticate (lib/server/db.ts), so anything relying on
-- superuser bypass would silently stop working the day a real Supabase project exists.
--
-- The portable fix -- and Supabase's own documented pattern for exactly this shape of problem --
-- is a narrow `SECURITY DEFINER` function: it runs with the privileges of whichever role owns it
-- (the migration-applying role), not the caller's, so it can see through RLS for this one,
-- deliberately narrow query while every other access to the table stays fully isolated.
create function resolve_ics_token(p_token text)
returns table (tenant_id uuid, doctor_id uuid, sequence integer)
language sql
security definer
set search_path = public
as $$
  select ics_feed.tenant_id, ics_feed.doctor_id, ics_feed.sequence
  from ics_feed
  where token = p_token and revoked_at is null
$$;

grant execute on function resolve_ics_token(text) to app_user;

-- ---------------------------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------------------------

alter table notification enable row level security;
alter table notification force row level security;
create policy notification_isolation on notification
  using (tenant_id = app_current_tenant_id())
  with check (tenant_id = app_current_tenant_id());
grant select, insert on notification to app_user; -- an outbox entry is never edited, only added

alter table ics_feed enable row level security;
alter table ics_feed force row level security;
create policy ics_feed_isolation on ics_feed
  using (tenant_id = app_current_tenant_id())
  with check (tenant_id = app_current_tenant_id());
grant select, insert, update on ics_feed to app_user; -- update: revoke and bump sequence
