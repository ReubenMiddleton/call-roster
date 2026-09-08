# Runbook

**Status: forward-looking.** Nothing is deployed, so none of these procedures has been exercised
against a real incident. They are written now because writing them later, during the first
incident, is how the wrong thing gets done — and because several of them constrain the design.

Anything below marked **untested** stays marked until it has actually been run.

---

## The one that matters most: a published roster is wrong

**Symptom.** The roster is published, thirteen people have seen it, and an assignment is wrong —
a doctor who cannot work that shift, or a slot nobody is covering.

**The wrong instinct is to fix it quietly.** An unannounced change to a live call roster is a
patient-safety event: someone will arrive believing they are off, or nobody will arrive at all.

**Procedure:**

1. **Do not edit the published version.** Publishing creates an immutable snapshot; editing creates
   version N+1. If you find yourself able to mutate N, that is a bug and it is more urgent than the
   roster error.
2. Establish the correct assignment with the practice principal. **He decides**, not the system and
   not the developer — he is the one who knows who can actually be called.
3. Apply the change as a swap transaction so it carries an audit trail.
4. Confirm the change notified: WhatsApp to both affected doctors, a bumped calendar sequence
   number, and the "what changed since you last looked" diff visible to anyone holding a share link.
5. Verify the fairness ledger reflects the final state, not the erroneous one.

**If coverage is genuinely unfilled and imminent**, that is a phone call, not a software problem.
The system's job afterwards is to have an unrebuttable record of who was asked and what was agreed.

---

## A solve returns nothing useful

The solver is **elasticised throughout** — almost every constraint carries a named slack variable
and an order-of-magnitude penalty — so `INFEASIBLE` is not a status it can return. See
[`../architecture/solver-contract.md`](../architecture/solver-contract.md).

| Symptom | Likely cause | Action |
|---|---|---|
| `status: TIMED_OUT` with a usable roster | Normal. The time budget expired and the incumbent best was returned | Nothing. Report the objective alongside it so the quality is visible |
| `status: TIMED_OUT` with a poor roster | Time budget too tight, or the model is over-constrained | Raise `timeBudgetSeconds`. Then check whether an `[INFERRED]` constraint has been switched from OFF to BLOCK — that is the usual culprit |
| Huge coverage penalty | Genuinely not enough available doctors | This should have been caught by the pre-flight check. If it was not, **that is the bug** — fix the pre-flight, do not tune the solver |
| `status: ERROR` | Malformed request, contract version mismatch, or a crash | Check `contractVersion` on both sides first. A worker that does not recognise a major version fails deliberately rather than guessing |
| Every doctor unavailable on a date | Unavailability inflation | Check whether the unavailability **budget** is being enforced. Without it, the model is expected to jam |

**Never respond to a bad solve by weakening a hard constraint to make it pass.** Report the
violation and let the principal decide. That is the whole design.

### Pre-flight should catch most of this

Before the solver is invoked: is total demand ≤ total available doctor-shifts, and is per-day demand
≤ the number of doctors available that day? These catch most real infeasibilities instantly and let
the product say *"you need one more doctor available on 23 November"* rather than producing a roster
full of unexplained gaps.

If a solve fails for a reason pre-flight could have named, **the fix belongs in pre-flight.**

---

## A solve never starts

The queue is a Postgres table claimed with `FOR UPDATE SKIP LOCKED`.

1. Is there a `solve_run` row at all? If not, the API never enqueued it.
2. Is `status` still `queued` with a null `claimed_at`? The worker is not running — scale-to-zero
   means a cold start, so allow for it before assuming failure.
3. Is `status` `running` with a stale `claimed_at`? The worker died mid-solve. Rows claimed longer
   than the maximum time budget plus a margin should be reclaimable — **untested**, and worth
   writing a real reaper for before launch rather than after.

## Rollback

- **Application** — redeploy the previous build. Stateless.
- **A published roster** — never rolled back by mutation. Publish a corrected version, or
  `UnpublishRoster`, which **must** emit a diff. Going backwards silently is how people stop
  trusting the system.
- **Database** — forward migrations only. A temporal schema makes destructive rollbacks
  particularly dangerous, because history is data rather than an audit side-effect.
- **Burden weights** — changes apply forward only. Historical credits keep the weight in force when
  they were earned; recalculating history under new weights rewrites who owed what.

## Data-boundary incident

If a real doctor name reaches the public repository:

1. `npm run names:check` should have caught it pre-commit. **If it did not, that is the first bug
   to fix** — the check exists precisely so this cannot depend on anyone remembering.
2. If it was committed but not pushed, amend or reset locally.
3. **If it was pushed, the name is public.** History rewriting reduces exposure but does not undo
   it: forks, caches and mirrors persist. Rewrite history, force-push, and **tell the owner
   immediately** — the practice principal may need to tell the affected doctor. This is a POPIA
   matter, not a tidiness matter.
4. Add the specific pattern that slipped through to
   [`../../scripts/check-no-real-names.mjs`](../../scripts/check-no-real-names.mjs)'s coverage, or
   to the mapping file's surname list if it was a spelling variant nobody had recorded.

**Prevention beats this procedure by a wide margin.** GitHub secret scanning and push protection
are enabled as a non-bypassable backstop to the local hook.

## Escalation

One developer, one design-partner practice. There is no rota and no on-call.

The practical implication: **the system must degrade to paper.** Every screen has an export, and the
principal can abandon the app mid-month with zero loss. That is not a nice-to-have — it is the
reason he can afford to trust it at all, and it is also this runbook's ultimate fallback.
