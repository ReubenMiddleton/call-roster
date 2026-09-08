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
import { requireTenantForPractice } from '../../../../../../../lib/server/tenant-context.ts';

const archiveSchema = z.object({ actorId: z.string().min(1).optional() }).strict();

/** `ArchiveRoster`: `LOCKED` → `ARCHIVED`. Terminal — "Nothing [can change]. Feeds the ledger"
 * (docs/domain/commands-events.md). Nothing under this roster is reachable for mutation from any
 * other endpoint once here; only reads remain. */
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
    const { actorId } = archiveSchema.parse(await readJsonBody(request));
    journalContext = { ...journalContext, actorId: actorId ?? null };

    const archived = await withTenant(tenantId, async (client) => {
      const statusResult = await client.query<{ status: string }>(
        'select status from roster where id = $1 and tenant_id = $2 for update',
        [rosterId, tenantId],
      );
      const statusRow = statusResult.rows[0];
      if (statusRow === undefined) {
        return false;
      }
      if (statusRow.status !== 'locked') {
        throw conflict(
          `Cannot archive a roster with status '${statusRow.status}'; it must be locked first.`,
        );
      }

      await client.query("update roster set status = 'archived' where id = $1", [rosterId]);
      await writeCommandJournal(client, {
        tenantId,
        actorId: actorId ?? null,
        commandType: 'ArchiveRoster',
        rosterId,
        before: { status: 'locked' },
        after: { status: 'archived' },
      });
      return true;
    });

    if (!archived) {
      throw notFound(`No roster ${rosterId}.`);
    }

    return jsonResponse({ status: 'archived' });
  } catch (error) {
    await journalRefusal(
      journalContext.tenantId,
      'ArchiveRoster',
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
