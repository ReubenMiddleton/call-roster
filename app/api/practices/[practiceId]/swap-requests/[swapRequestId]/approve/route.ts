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
import { tryRecalculateLedger } from '../../../../../../../lib/server/ledger-refresh.ts';
import { enqueueNotification } from '../../../../../../../lib/server/notifications.ts';
import { fetchRosterDetail } from '../../../../../../../lib/server/roster-detail.ts';
import { createRosterVersion } from '../../../../../../../lib/server/roster-version.ts';
import { requireTenantForPractice } from '../../../../../../../lib/server/tenant-context.ts';

const approveSchema = z.object({ actorId: z.string().min(1).optional() }).strict();

interface SwapRequestRow {
  id: string;
  status: string;
  shift_assignment_id: string;
  requested_doctor_id: string;
  reason: string | null;
  provenance: string;
}

interface AssignmentLinkRow {
  current_doctor_id: string;
  roster_id: string;
}

/**
 * `ApproveSwap`. "Create version N+1, never mutate N" (docs/domain/commands-events.md) -- applies
 * the doctor change to `shift_assignment`, which is exactly where the exclusion constraint
 * (`23P01`) and H-03 (`23514`) get their chance to refuse it, then snapshots the *new* state as
 * the next `roster_version`. The roster's own `status` is untouched: a swap changes what a
 * `PUBLISHED` or `LOCKED` roster contains, never which of those two states it's in.
 *
 * The new assignment's `provenance` comes from the swap request, not a hard-coded `'directed'` --
 * `RequestSwap` (`swap-requests/route.ts`) accepts it for the same reason it accepts `reason`: the
 * requester is the one who knows why. Without this the ledger silently mis-prices every swap as
 * scheduler-directed, even one a doctor requested for themselves (docs/domain/fairness.md).
 *
 * Also notifies both doctors (`lib/server/notifications.ts` — recorded, not delivered) and bumps
 * the `SEQUENCE` of any active ICS feed either of them holds, exactly as the policy specifies:
 * "bump the ICS feed's SEQUENCE" (docs/domain/commands-events.md). Then triggers a best-effort
 * ledger recalculation (`lib/server/ledger-refresh.ts`), matching the same policy's next line —
 * "recalculate the ledger" — without letting a recalculation problem block an already-approved
 * swap; see `docs/architecture/api.md`.
 */
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
    const { actorId } = approveSchema.parse(await readJsonBody(request));
    journalContext = { ...journalContext, actorId: actorId ?? null };

    const outcome = await withTenant(tenantId, async (client) => {
      const swapResult = await client.query<SwapRequestRow>(
        `select id, status, shift_assignment_id, requested_doctor_id, reason, provenance
         from swap_request where id = $1 and tenant_id = $2 for update`,
        [swapRequestId, tenantId],
      );
      const swap = swapResult.rows[0];
      if (swap === undefined) {
        return undefined;
      }
      if (swap.status !== 'pending') {
        throw conflict(
          `Cannot approve a swap request with status '${swap.status}'; only a pending request can be approved.`,
        );
      }

      const linkResult = await client.query<AssignmentLinkRow>(
        `select sa.doctor_id as current_doctor_id, r.id as roster_id
         from shift_assignment sa
         join shift_slot ss on ss.id = sa.shift_slot_id
         join roster r on r.id = ss.roster_id
         where sa.id = $1`,
        [swap.shift_assignment_id],
      );
      const link = linkResult.rows[0];
      if (link === undefined) {
        throw new Error(`swap_request ${swapRequestId} references a vanished assignment`);
      }
      journalContext = { ...journalContext, rosterId: link.roster_id };

      // Locks the roster row for the rest of this transaction, same as the lifecycle endpoints
      // -- so an unpublish or archive can't interleave with a swap being approved.
      const rosterResult = await client.query<{ status: string }>(
        'select status from roster where id = $1 for update',
        [link.roster_id],
      );
      const rosterRow = rosterResult.rows[0];
      if (rosterRow === undefined) {
        throw new Error(`roster ${link.roster_id} vanished mid-transaction`);
      }
      if (rosterRow.status !== 'published' && rosterRow.status !== 'locked') {
        throw conflict(`Cannot approve a swap on a roster with status '${rosterRow.status}'.`);
      }

      // The GiST exclusion constraint and the H-03 containment trigger both fire on UPDATE, not
      // only INSERT -- this is where an invalid swap gets refused, atomically, exactly as a new
      // assignment would be. `provenance` comes from the request, not a hard-coded 'directed' --
      // the requester is the one who knows why the swap is happening (docs/domain/fairness.md).
      await client.query(
        'update shift_assignment set doctor_id = $1, provenance = $2 where id = $3',
        [swap.requested_doctor_id, swap.provenance, swap.shift_assignment_id],
      );

      await client.query(
        "update swap_request set status = 'approved', decided_at = now(), decided_by = $1 where id = $2",
        [actorId ?? null, swapRequestId],
      );

      const snapshot = await fetchRosterDetail(client, tenantId, link.roster_id);
      if (snapshot === undefined) {
        throw new Error(`roster ${link.roster_id} vanished mid-transaction`);
      }
      const version = await createRosterVersion(
        client,
        tenantId,
        link.roster_id,
        snapshot,
        actorId ?? null,
      );

      await writeCommandJournal(client, {
        tenantId,
        actorId: actorId ?? null,
        commandType: 'ApproveSwap',
        rosterId: link.roster_id,
        rosterVersion: version.versionNumber,
        before: { doctorId: link.current_doctor_id },
        after: {
          doctorId: swap.requested_doctor_id,
          versionNumber: version.versionNumber,
          provenance: swap.provenance,
        },
        reason: swap.reason,
      });

      for (const doctorId of [link.current_doctor_id, swap.requested_doctor_id]) {
        await enqueueNotification(client, {
          tenantId,
          doctorId,
          eventType: 'SwapApproved',
          payload: {
            shiftAssignmentId: swap.shift_assignment_id,
            previousDoctorId: link.current_doctor_id,
            newDoctorId: swap.requested_doctor_id,
          },
        });
      }
      await client.query(
        `update ics_feed set sequence = sequence + 1
         where tenant_id = $1 and doctor_id = any($2::uuid[]) and revoked_at is null`,
        [tenantId, [link.current_doctor_id, swap.requested_doctor_id]],
      );

      return { rosterId: link.roster_id, version };
    });

    if (outcome === undefined) {
      throw notFound(`No swap request ${swapRequestId}.`);
    }

    const ledger = await tryRecalculateLedger(tenantId);

    return jsonResponse({
      status: 'approved',
      rosterId: outcome.rosterId,
      version: outcome.version,
      ledger,
    });
  } catch (error) {
    await journalRefusal(
      journalContext.tenantId,
      'ApproveSwap',
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
