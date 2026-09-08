import { z } from 'zod';
import {
  conflict,
  jsonResponse,
  notFound,
  toErrorResponse,
} from '../../../../../../../lib/server/api-error.ts';
import {
  journalRefusal,
  writeCommandJournal,
} from '../../../../../../../lib/server/command-journal.ts';
import { withTenant } from '../../../../../../../lib/server/db.ts';
import { readJsonBody } from '../../../../../../../lib/server/json-body.ts';
import { fetchRosterDetail } from '../../../../../../../lib/server/roster-detail.ts';
import { diffRosterSlots } from '../../../../../../../lib/server/roster-diff.ts';
import { latestRosterVersion } from '../../../../../../../lib/server/roster-version.ts';
import { requireTenantForPractice } from '../../../../../../../lib/server/tenant-context.ts';

const unpublishSchema = z
  .object({ actorId: z.string().min(1).optional(), reason: z.string().trim().max(500).optional() })
  .strict();

/**
 * `RosterUnpublished`: `PUBLISHED` → `DRAFT`. "Must emit a diff of what changed. Going backwards
 * silently is how people stop trusting the system" (docs/domain/commands-events.md). The diff
 * compares the roster's current state against its last published version's snapshot — see
 * `lib/server/roster-diff.ts` for why it will read empty until an edit-after-publish path exists.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ practiceId: string; rosterId: string }> },
): Promise<Response> {
  // Hoisted so the catch block below can journal a refusal -- a `const` inside `try` isn't
  // visible there, and each is only as complete as the code got before throwing.
  let journalContext: { tenantId?: string; rosterId?: string; actorId: string | null } = {
    actorId: null,
  };
  try {
    const { practiceId, rosterId } = await context.params;
    journalContext = { ...journalContext, rosterId };
    const tenantId = requireTenantForPractice(request, practiceId);
    journalContext = { ...journalContext, tenantId };
    const { actorId, reason } = unpublishSchema.parse(await readJsonBody(request));
    journalContext = { ...journalContext, actorId: actorId ?? null };

    const outcome = await withTenant(tenantId, async (client) => {
      const statusResult = await client.query<{ status: string }>(
        'select status from roster where id = $1 and tenant_id = $2 for update',
        [rosterId, tenantId],
      );
      const statusRow = statusResult.rows[0];
      if (statusRow === undefined) {
        return undefined;
      }
      if (statusRow.status !== 'published') {
        throw conflict(
          `Cannot unpublish a roster with status '${statusRow.status}'; only a published roster can be unpublished.`,
        );
      }

      const version = await latestRosterVersion(client, rosterId);
      const current = await fetchRosterDetail(client, tenantId, rosterId);
      if (current === undefined) {
        throw new Error(`roster ${rosterId} vanished mid-transaction`);
      }
      const diff = version === undefined ? [] : diffRosterSlots(version.snapshot, current);

      await client.query("update roster set status = 'draft' where id = $1", [rosterId]);
      await writeCommandJournal(client, {
        tenantId,
        actorId: actorId ?? null,
        commandType: 'UnpublishRoster',
        rosterId,
        before: { status: 'published' },
        after: { status: 'draft', diff },
        reason: reason ?? null,
      });

      return diff;
    });

    if (outcome === undefined) {
      throw notFound(`No roster ${rosterId}.`);
    }

    return jsonResponse({ status: 'draft', diff: outcome });
  } catch (error) {
    await journalRefusal(
      journalContext.tenantId,
      'UnpublishRoster',
      journalContext.actorId,
      journalContext.rosterId ?? null,
      error,
    );
    return toErrorResponse(error, {
      tenantId: journalContext.tenantId,
      route: new URL(request.url).pathname,
    });
  }
}
