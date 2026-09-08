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

const rejectSchema = z
  .object({
    actorId: z.string().min(1).optional(),
    rejectionReason: z.string().trim().max(500).optional(),
  })
  .strict();

interface SwapRequestRow {
  status: string;
  roster_id: string;
}

/** `RejectSwap`. No data changes beyond the request's own status -- the assignment is
 * untouched, and there is nothing to version. */
export async function POST(
  request: Request,
  context: { params: Promise<{ practiceId: string; swapRequestId: string }> },
): Promise<Response> {
  // Hoisted so the catch block below can journal a refusal -- a `const` inside `try` isn't
  // visible there, and each is only as complete as the code got before throwing.
  let journalContext: { tenantId?: string; rosterId?: string; actorId: string | null } = {
    actorId: null,
  };
  try {
    const { practiceId, swapRequestId } = await context.params;
    const tenantId = requireTenantForPractice(request, practiceId);
    journalContext = { ...journalContext, tenantId };
    const { actorId, rejectionReason } = rejectSchema.parse(await readJsonBody(request));
    journalContext = { ...journalContext, actorId: actorId ?? null };

    const rejected = await withTenant(tenantId, async (client) => {
      const swapResult = await client.query<SwapRequestRow>(
        `select sr.status, ss.roster_id
         from swap_request sr
         join shift_assignment sa on sa.id = sr.shift_assignment_id
         join shift_slot ss on ss.id = sa.shift_slot_id
         where sr.id = $1 and sr.tenant_id = $2
         for update of sr`,
        [swapRequestId, tenantId],
      );
      const swap = swapResult.rows[0];
      if (swap === undefined) {
        return false;
      }
      journalContext = { ...journalContext, rosterId: swap.roster_id };
      if (swap.status !== 'pending') {
        throw conflict(
          `Cannot reject a swap request with status '${swap.status}'; only a pending request can be rejected.`,
        );
      }

      await client.query(
        "update swap_request set status = 'rejected', decided_at = now(), decided_by = $1, rejection_reason = $2 where id = $3",
        [actorId ?? null, rejectionReason ?? null, swapRequestId],
      );

      await writeCommandJournal(client, {
        tenantId,
        actorId: actorId ?? null,
        commandType: 'RejectSwap',
        rosterId: swap.roster_id,
        before: { status: 'pending' },
        after: { status: 'rejected' },
        reason: rejectionReason ?? null,
      });

      return true;
    });

    if (!rejected) {
      throw notFound(`No swap request ${swapRequestId}.`);
    }

    return jsonResponse({ status: 'rejected' });
  } catch (error) {
    await journalRefusal(
      journalContext.tenantId,
      'RejectSwap',
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
