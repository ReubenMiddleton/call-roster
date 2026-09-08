import { jsonResponse, toErrorResponse } from '../../../../../../lib/server/api-error.ts';
import { withTenant } from '../../../../../../lib/server/db.ts';
import { recalculateLedger } from '../../../../../../lib/server/ledger.ts';
import { requireTenantForPractice } from '../../../../../../lib/server/tenant-context.ts';

/**
 * `RecalculateLedger`. "Idempotent. Triggered by policy, also runnable by hand"
 * (docs/domain/commands-events.md) — this is the "by hand" path; nothing in the API triggers it
 * automatically yet (not on `PublicHolidayDeclared` or `BurdenWeightsChanged`, since neither
 * command exists, and deliberately not on every `PublishRoster`/`ApproveSwap` either — whether a
 * full tenant-wide rebuild belongs on every write is a real design question, not obvious enough to
 * decide silently while building three other features in the same session).
 *
 * See `lib/server/ledger.ts` for what this actually computes and the one significant gap: it
 * prices every tenant with the pilot practice's own agreed weights, not a tenant-scoped schedule.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ practiceId: string }> },
): Promise<Response> {
  try {
    const { practiceId } = await context.params;
    const tenantId = requireTenantForPractice(request, practiceId);

    const result = await withTenant(tenantId, (client) => recalculateLedger(client, tenantId));

    return jsonResponse(result);
  } catch (error) {
    return toErrorResponse(error);
  }
}
