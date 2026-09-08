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

const closeReviewWindowSchema = z.object({ actorId: z.string().min(1).optional() }).strict();

/**
 * `ReviewWindowClosed`: `PUBLISHED` → `LOCKED`. "Transition to LOCKED; disable direct editing;
 * route all further change through swaps" (docs/domain/commands-events.md). No new
 * `roster_version` here — the version already exists from publish, and swaps (not built yet)
 * are what create the next one.
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
    const { actorId } = closeReviewWindowSchema.parse(await readJsonBody(request));
    journalContext = { ...journalContext, actorId: actorId ?? null };

    const closed = await withTenant(tenantId, async (client) => {
      const statusResult = await client.query<{ status: string }>(
        'select status from roster where id = $1 and tenant_id = $2 for update',
        [rosterId, tenantId],
      );
      const statusRow = statusResult.rows[0];
      if (statusRow === undefined) {
        return false;
      }
      if (statusRow.status !== 'published') {
        throw conflict(
          `Cannot close the review window on a roster with status '${statusRow.status}'; it must be published.`,
        );
      }

      await client.query("update roster set status = 'locked' where id = $1", [rosterId]);
      await writeCommandJournal(client, {
        tenantId,
        actorId: actorId ?? null,
        commandType: 'CloseReviewWindow',
        rosterId,
        before: { status: 'published' },
        after: { status: 'locked' },
      });
      return true;
    });

    if (!closed) {
      throw notFound(`No roster ${rosterId}.`);
    }

    return jsonResponse({ status: 'locked' });
  } catch (error) {
    await journalRefusal(
      journalContext.tenantId,
      'CloseReviewWindow',
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
