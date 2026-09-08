-- 0015_swap_request_provenance.sql
--
-- Closes a real gap: `ApproveSwap` has always hard-coded `provenance = 'directed'` on the
-- reassignment it makes, with no way to say otherwise -- even though `AssignDoctorToSlot`
-- (`POST /assignments`) has accepted an explicit `provenance` since the assignment schema
-- landed. A swap approved because a doctor asked a colleague to cover for them is exactly the
-- `requested` case docs/domain/fairness.md exists to separate out; hard-coding `directed` for
-- every swap silently mis-prices it in the ledger. See docs/DECISIONS.md for the full account.
--
-- Captured on the *request*, not the approval: `RequestSwap` already carries a free-text `reason`
-- for "why", and whoever is requesting the swap is the one who knows why it's happening --
-- `ApproveSwap` reads it back, the same way it already reads back `reason`.

alter table swap_request
  add column provenance text not null default 'directed'
    check (provenance in ('directed', 'requested', 'absorbed', 'unknown'));
