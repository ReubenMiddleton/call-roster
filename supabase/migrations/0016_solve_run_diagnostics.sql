-- 0016_solve_run_diagnostics.sql
--
-- L3, solve-run diagnostics (docs/ops/diagnostics.md): "a failed or surprising solve must be
-- reproducible from its row alone." `solve_run` (0008_solve_run.sql) already carried `request`
-- and `result`, but neither the request's hash, the pre-flight arithmetic, a model snapshot, nor
-- the CP-SAT version/worker count that make a reproduction actually reproducible. All five are
-- computed by the solver today (`solver/src/call_roster_solver/__init__.py`'s `--json` output)
-- and were simply never given anywhere durable to land.
--
-- ⚠️ Nothing writes to `solve_run` yet, from this migration or any before it -- there is no
-- `GenerateDraft` route and no worker claiming rows with `FOR UPDATE SKIP LOCKED`
-- (0008_solve_run.sql's own comment). "The solver ships last" (AGENTS.md) is deliberate; this
-- migration prepares the diagnostic surface for when it does, and is exercised today only by
-- `scripts/check-solver-e2e.ts` persisting one real row from one real solve, proving the shape
-- holds genuine data rather than being speculative scaffolding. See docs/DECISIONS.md.

alter table solve_run
  add column request_hash    text,   -- sha256 of the request payload as received, hex-encoded
  add column preflight_result jsonb, -- { feasible, totalDemand, totalSupply, failures }
  add column model_snapshot  text,   -- BuiltModel.canonical_text() -- never the solved roster,
                                      -- which is not deterministic across CP-SAT versions or
                                      -- num_workers (see the two columns below)
  add column cp_sat_version  text,
  add column num_workers     integer;
