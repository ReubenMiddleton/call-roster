import { jsonResponse, toErrorResponse } from '../../../../../lib/server/api-error.ts';
import { withTenant } from '../../../../../lib/server/db.ts';
import { requireTenantForPractice } from '../../../../../lib/server/tenant-context.ts';

interface CommandJournalRow {
  id: string;
  command_type: string;
  outcome: string;
  roster_id: string | null;
  roster_version: number | null;
  actor_id: string | null;
  actor_name: string | null;
  before: unknown;
  after: unknown;
  reason: string | null;
  issued_at: Date;
  app_run_id: string | null;
  seq: number | null;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

/**
 * The L1 command journal, read back (`docs/ops/diagnostics.md`). Most-recent-first, because
 * every consumer built so far wants "what just happened" -- the L5 diagnostic bundle's "last N
 * commands", or a developer reconstructing a fault report. A replay tool reading forward from a
 * roster version would want the opposite order; nothing needs that yet, so it isn't built.
 *
 * `actorName` is joined here, at render time, from `person` -- exactly the L0 rule the table
 * itself follows ("a name is never copied into a diagnostic row, so there is no row to scrub
 * later"). The journal row never held it; this response does, briefly, for the one human reading
 * it.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ practiceId: string }> },
): Promise<Response> {
  try {
    const { practiceId } = await context.params;
    const tenantId = requireTenantForPractice(request, practiceId);
    const url = new URL(request.url);
    const rosterId = url.searchParams.get('rosterId');
    const limitParam = url.searchParams.get('limit');
    const limit = limitParam === null ? DEFAULT_LIMIT : Math.min(Number(limitParam), MAX_LIMIT);

    const rows = await withTenant(tenantId, async (client) => {
      const result = await client.query<CommandJournalRow>(
        `select cj.id, cj.command_type, cj.outcome, cj.roster_id, cj.roster_version,
                cj.actor_id, p.full_name as actor_name, cj.before, cj.after, cj.reason,
                cj.issued_at, cj.app_run_id, cj.seq
         from command_journal cj
         left join person p on p.id = cj.actor_id
         where cj.tenant_id = $1 and ($2::uuid is null or cj.roster_id = $2)
         order by cj.issued_at desc
         limit $3`,
        [tenantId, rosterId, limit],
      );
      return result.rows;
    });

    return jsonResponse({
      commands: rows.map((row) => ({
        id: row.id,
        commandType: row.command_type,
        outcome: row.outcome,
        rosterId: row.roster_id,
        rosterVersion: row.roster_version,
        actorId: row.actor_id,
        actorName: row.actor_name,
        before: row.before,
        after: row.after,
        reason: row.reason,
        issuedAt: row.issued_at.toISOString(),
        appRunId: row.app_run_id,
        seq: row.seq,
      })),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
