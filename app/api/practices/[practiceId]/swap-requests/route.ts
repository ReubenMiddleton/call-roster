import { z } from 'zod';
import {
  badRequest,
  conflict,
  jsonResponse,
  notFound,
  toErrorResponse,
} from '../../../../../lib/server/api-error.ts';
import { journalRefusal, writeCommandJournal } from '../../../../../lib/server/command-journal.ts';
import { withTenant } from '../../../../../lib/server/db.ts';
import { requireTenantForPractice } from '../../../../../lib/server/tenant-context.ts';

const createSwapRequestSchema = z
  .object({
    shiftAssignmentId: z.string().min(1),
    requestedDoctorId: z.string().min(1),
    requestedBy: z.string().min(1).optional(),
    reason: z.string().trim().max(500).optional(),
    // Same enum, same default as `AssignDoctorToSlot` (`POST /assignments`) -- "the scheduler
    // assigned it" is the ordinary case for a swap too. Captured here rather than at approval
    // time because the requester is the one who knows *why* -- the same reasoning `reason`
    // already follows. `ApproveSwap` reads this back rather than hard-coding `directed`
    // (docs/domain/fairness.md's provenance table; see docs/DECISIONS.md for the gap this closes).
    provenance: z.enum(['directed', 'requested', 'absorbed', 'unknown']).default('directed'),
  })
  .strict();

interface AssignmentLinkRow {
  current_doctor_id: string;
  roster_status: string;
  roster_id: string;
}

interface SwapRequestRow {
  id: string;
  shift_assignment_id: string;
  requested_doctor_id: string;
  status: string;
  reason: string | null;
  rejection_reason: string | null;
  provenance: string;
  created_at: Date;
  decided_at: Date | null;
}

function toResponseShape(row: SwapRequestRow) {
  return {
    id: row.id,
    shiftAssignmentId: row.shift_assignment_id,
    requestedDoctorId: row.requested_doctor_id,
    status: row.status,
    reason: row.reason,
    rejectionReason: row.rejection_reason,
    provenance: row.provenance,
    createdAt: row.created_at.toISOString(),
    decidedAt: row.decided_at?.toISOString() ?? null,
  };
}

/**
 * `RequestSwap`. Only meaningful once a roster has left `DRAFT` -- while it's still a draft,
 * `POST /assignments` already reassigns freely with no ceremony (docs/domain/commands-events.md).
 * Creates a `swap_request` row; nothing about the assignment itself changes until
 * `[swapRequestId]/approve` runs -- "every change request is evaluated, never auto-applied"
 * (docs/product/lifecycle.md).
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ practiceId: string }> },
): Promise<Response> {
  // Hoisted so the catch block below can journal a refusal -- a `const` inside `try` isn't
  // visible there, and each is only as complete as the code got before throwing.
  let journalContext: { tenantId?: string; rosterId?: string; actorId: string | null } = {
    actorId: null,
  };
  try {
    const { practiceId } = await context.params;
    const tenantId = requireTenantForPractice(request, practiceId);
    journalContext = { ...journalContext, tenantId };
    const body: unknown = await request.json();
    const { shiftAssignmentId, requestedDoctorId, requestedBy, reason, provenance } =
      createSwapRequestSchema.parse(body);
    journalContext = { ...journalContext, actorId: requestedBy ?? null };

    const created = await withTenant(tenantId, async (client) => {
      const linkResult = await client.query<AssignmentLinkRow>(
        `select sa.doctor_id as current_doctor_id, r.status as roster_status, r.id as roster_id
         from shift_assignment sa
         join shift_slot ss on ss.id = sa.shift_slot_id
         join roster r on r.id = ss.roster_id
         where sa.id = $1 and sa.tenant_id = $2`,
        [shiftAssignmentId, tenantId],
      );
      const link = linkResult.rows[0];
      if (link === undefined) {
        return undefined;
      }
      journalContext = { ...journalContext, rosterId: link.roster_id };
      if (link.roster_status !== 'published' && link.roster_status !== 'locked') {
        throw conflict(
          `Cannot request a swap on a roster with status '${link.roster_status}'; a draft roster is edited directly, and an archived one is read-only.`,
        );
      }
      if (link.current_doctor_id === requestedDoctorId) {
        throw badRequest('That doctor already holds this assignment.');
      }

      const pendingResult = await client.query<{ id: string }>(
        "select id from swap_request where shift_assignment_id = $1 and status = 'pending'",
        [shiftAssignmentId],
      );
      if (pendingResult.rows[0] !== undefined) {
        throw conflict('There is already a pending swap request for this assignment.');
      }

      const result = await client.query<SwapRequestRow>(
        `insert into swap_request (tenant_id, shift_assignment_id, requested_doctor_id, requested_by, reason, provenance)
         values ($1, $2, $3, $4, $5, $6)
         returning id, shift_assignment_id, requested_doctor_id, status, reason, rejection_reason, provenance, created_at, decided_at`,
        [
          tenantId,
          shiftAssignmentId,
          requestedDoctorId,
          requestedBy ?? null,
          reason ?? null,
          provenance,
        ],
      );
      const row = result.rows[0];
      if (row === undefined) {
        throw new Error('insert into swap_request returned no row');
      }

      await writeCommandJournal(client, {
        tenantId,
        actorId: requestedBy ?? null,
        commandType: 'RequestSwap',
        rosterId: link.roster_id,
        before: null,
        after: {
          swapRequestId: row.id,
          shiftAssignmentId,
          currentDoctorId: link.current_doctor_id,
          requestedDoctorId,
          provenance,
        },
        reason: reason ?? null,
      });

      return row;
    });

    if (created === undefined) {
      throw notFound(`No shift assignment ${shiftAssignmentId}.`);
    }

    return jsonResponse(toResponseShape(created), { status: 201 });
  } catch (error) {
    await journalRefusal(
      journalContext.tenantId,
      'RequestSwap',
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

const STATUS_FILTER_VALUES = ['pending', 'approved', 'rejected'] as const;

export async function GET(
  request: Request,
  context: { params: Promise<{ practiceId: string }> },
): Promise<Response> {
  try {
    const { practiceId } = await context.params;
    const tenantId = requireTenantForPractice(request, practiceId);

    const statusFilter = new URL(request.url).searchParams.get('status');
    if (
      statusFilter !== null &&
      !STATUS_FILTER_VALUES.includes(statusFilter as (typeof STATUS_FILTER_VALUES)[number])
    ) {
      throw badRequest("status must be one of 'pending', 'approved', 'rejected'.");
    }

    const rows = await withTenant(tenantId, async (client) => {
      const result = await client.query<SwapRequestRow>(
        statusFilter === null
          ? 'select id, shift_assignment_id, requested_doctor_id, status, reason, rejection_reason, provenance, created_at, decided_at from swap_request where tenant_id = $1 order by created_at desc'
          : 'select id, shift_assignment_id, requested_doctor_id, status, reason, rejection_reason, provenance, created_at, decided_at from swap_request where tenant_id = $1 and status = $2 order by created_at desc',
        statusFilter === null ? [tenantId] : [tenantId, statusFilter],
      );
      return result.rows;
    });

    return jsonResponse({ swapRequests: rows.map(toResponseShape) });
  } catch (error) {
    return toErrorResponse(error);
  }
}
