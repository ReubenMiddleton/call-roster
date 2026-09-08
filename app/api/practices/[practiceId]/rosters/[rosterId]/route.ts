import { jsonResponse, notFound, toErrorResponse } from '../../../../../../lib/server/api-error.ts';
import { withTenant } from '../../../../../../lib/server/db.ts';
import { fetchRosterDetail } from '../../../../../../lib/server/roster-detail.ts';
import { requireTenantForPractice } from '../../../../../../lib/server/tenant-context.ts';

/** The whole month's grid data in one call -- what the eventual editor UI, and this endpoint's
 * own tests, both need to render or verify a roster. See `lib/server/roster-detail.ts`, also
 * used by `PublishRoster` to snapshot exactly this shape into `roster_version`. */
export async function GET(
  request: Request,
  context: { params: Promise<{ practiceId: string; rosterId: string }> },
): Promise<Response> {
  try {
    const { practiceId, rosterId } = await context.params;
    const tenantId = requireTenantForPractice(request, practiceId);

    const roster = await withTenant(tenantId, (client) =>
      fetchRosterDetail(client, tenantId, rosterId),
    );

    if (roster === undefined) {
      throw notFound(`No roster ${rosterId}.`);
    }

    return jsonResponse(roster);
  } catch (error) {
    return toErrorResponse(error);
  }
}
