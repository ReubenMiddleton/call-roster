/**
 * Best-effort ledger recalculation, called after `PublishRoster` and `ApproveSwap` commit --
 * the two events `docs/domain/commands-events.md`'s policy table calls for ("When `SwapApproved`
 * -> ... recalculate the ledger"; publishing is the moment assignments move out of `draft` and
 * become eligible for `burden_credit` in the first place).
 *
 * "Warn and scar, never block" (AGENTS.md) applies here as much as to any constraint: by the time
 * this runs, the roster or swap change has already committed, so nothing recalculation does can
 * be allowed to turn that success into a client-visible failure. `recalculateLedger` itself still
 * throws on a real problem -- no burden schedule configured yet, or an assignment history that
 * spans more than one schedule version -- so this wraps that call in its own transaction and turns
 * any failure into a reported outcome instead, the same shape every other soft result in this
 * product takes. A tenant with no schedule configured yet can still publish rosters; it just gets
 * told, every time, that nothing was priced.
 */

import { ApiError } from './api-error.ts';
import { withTenant } from './db.ts';
import { recalculateLedger } from './ledger.ts';

export type LedgerRefreshOutcome =
  | { readonly recalculated: true; readonly scheduleVersion: string | null }
  | { readonly recalculated: false; readonly reason: string };

export async function tryRecalculateLedger(tenantId: string): Promise<LedgerRefreshOutcome> {
  try {
    const result = await withTenant(tenantId, (client) => recalculateLedger(client, tenantId));
    return { recalculated: true, scheduleVersion: result.scheduleVersion };
  } catch (error) {
    if (error instanceof ApiError) {
      return { recalculated: false, reason: error.message };
    }
    // A genuinely unexpected failure here must not turn an already-committed publish or swap
    // approval into a client-visible error -- log it server-side and report the same soft outcome
    // shape, same as toErrorResponse does for its own unclassified 500 case.
    console.error('Ledger recalculation failed after a committed roster change:', error);
    return { recalculated: false, reason: 'An unexpected error occurred; see server logs.' };
  }
}
