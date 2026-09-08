import {
  jsonResponse,
  notFound,
  toErrorResponse,
} from '../../../../../../../lib/server/api-error.ts';
import { getAppVersion, getSchemaVersion } from '../../../../../../../lib/server/build-info.ts';
import { withTenant } from '../../../../../../../lib/server/db.ts';
import { latestRosterVersion } from '../../../../../../../lib/server/roster-version.ts';
import { requireTenantForPractice } from '../../../../../../../lib/server/tenant-context.ts';

interface RosterRow {
  id: string;
  month: string;
  status: string;
}

interface CommandRow {
  id: string;
  command_type: string;
  outcome: string;
  roster_version: number | null;
  before: unknown;
  after: unknown;
  reason: string | null;
  issued_at: Date;
}

const RECENT_COMMAND_LIMIT = 50;

/**
 * L5, the diagnostic bundle (`docs/ops/diagnostics.md`) — *"the single most important layer for
 * the pilot, and the cheapest."* One file, produced by one tap, that a non-technical user sends
 * over WhatsApp when *"the roster went funny"* — no console, no reproduction steps.
 *
 * ⚠️ **This is the assembly endpoint, not the whole layer.** The design calls for four things:
 * current view state, the last N commands, recent errors, and app/schema version plus the active
 * roster version. Two of those don't exist yet to include, and this bundle says so rather than
 * silently omitting them:
 *
 * - **Current view state** is inherently client-side, and there is no real client yet (`app/` is
 *   still a scaffold) — nothing to capture until one exists.
 * - **Recent errors** is L2, not built in this pass — `docs/architecture/api.md` tracks it as the
 *   next diagnostics layer.
 *
 * What this endpoint *can* give today — the last N journalled commands for this roster, and the
 * build that produced them — is already enough to answer "what commands ran against this roster,
 * in what order, with what outcome" offline, which is most of what a replay needs.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ practiceId: string; rosterId: string }> },
): Promise<Response> {
  try {
    const { practiceId, rosterId } = await context.params;
    const tenantId = requireTenantForPractice(request, practiceId);

    const bundle = await withTenant(tenantId, async (client) => {
      const rosterResult = await client.query<RosterRow>(
        'select id, month, status from roster where id = $1 and tenant_id = $2',
        [rosterId, tenantId],
      );
      const roster = rosterResult.rows[0];
      if (roster === undefined) {
        return undefined;
      }

      const version = await latestRosterVersion(client, rosterId);

      const commandsResult = await client.query<CommandRow>(
        `select id, command_type, outcome, roster_version, before, after, reason, issued_at
         from command_journal
         where tenant_id = $1 and roster_id = $2
         order by issued_at desc
         limit $3`,
        [tenantId, rosterId, RECENT_COMMAND_LIMIT],
      );

      return { roster, version, commands: commandsResult.rows };
    });

    if (bundle === undefined) {
      throw notFound(`No roster ${rosterId}.`);
    }

    return jsonResponse({
      generatedAt: new Date().toISOString(),
      appVersion: getAppVersion(),
      schemaVersion: getSchemaVersion(),
      roster: {
        id: bundle.roster.id,
        month: bundle.roster.month,
        status: bundle.roster.status,
        activeRosterVersion: bundle.version?.versionNumber ?? null,
      },
      recentCommands: bundle.commands.map((row) => ({
        id: row.id,
        commandType: row.command_type,
        outcome: row.outcome,
        rosterVersion: row.roster_version,
        before: row.before,
        after: row.after,
        reason: row.reason,
        issuedAt: row.issued_at.toISOString(),
      })),
      // Named explicitly rather than omitted silently -- see the docblock above.
      notIncluded: {
        viewState: 'no client exists yet to capture it',
        recentErrors: 'L2 error capture is not built yet',
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
