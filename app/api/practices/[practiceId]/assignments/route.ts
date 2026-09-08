import { z } from 'zod';
import {
  conflict,
  jsonResponse,
  notFound,
  toErrorResponse,
} from '../../../../../lib/server/api-error.ts';
import { withTenant } from '../../../../../lib/server/db.ts';
import { requireTenantForPractice } from '../../../../../lib/server/tenant-context.ts';

const createAssignmentSchema = z
  .object({
    shiftSlotId: z.string().min(1),
    doctorId: z.string().min(1),
    // 'directed' by default: an admin calling this endpoint by hand is the ordinary case in the
    // provenance vocabulary (docs/product/glossary.md), not the 'unknown' every historical,
    // never-recorded assignment carries. The column's own DB default stays 'unknown' for bulk
    // imports that go around this API.
    provenance: z.enum(['directed', 'requested', 'absorbed', 'unknown']).default('directed'),
  })
  .strict();

interface AssignmentRow {
  id: string;
  doctor_id: string;
  shift_slot_id: string;
  period_start: Date;
  period_end: Date;
  provenance: string;
  locked: boolean;
}

/**
 * Assigns a doctor to a slot. The client never sends a period -- it is derived, server-side,
 * from the slot's date and its shift definition's `start_hour`/`hours`, in the practice's own
 * timezone, exactly as the H-03 containment trigger computes its own start date
 * (`supabase/migrations/0004_roster_and_assignment.sql`). That is what makes a mismatched
 * period/slot structurally impossible rather than merely validated.
 *
 * Two invariants get exercised here for the first time through the API rather than raw SQL: the
 * GiST exclusion constraint (a doctor already working an overlapping shift is `23P01`, mapped to
 * 409) and H-03 (a doctor outside their membership interval is `23514`, mapped to 400) — see
 * `lib/server/api-error.ts`.
 *
 * Refuses to run at all once the slot's roster has left `DRAFT` — "DRAFT: anything, the generator
 * runs freely" is the only status that is (docs/domain/commands-events.md); `PUBLISHED` edits are
 * meant to flow through a versioned-edit path and `LOCKED` ones through a swap, neither of which
 * is built yet, so refusing outright is the honest interim behaviour rather than an edit that
 * silently skips version-bumping and the audit trail.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ practiceId: string }> },
): Promise<Response> {
  try {
    const { practiceId } = await context.params;
    const tenantId = requireTenantForPractice(request, practiceId);
    const body: unknown = await request.json();
    const { shiftSlotId, doctorId, provenance } = createAssignmentSchema.parse(body);

    const assignment = await withTenant(tenantId, async (client) => {
      const statusResult = await client.query<{ status: string }>(
        `select r.status
         from shift_slot ss
         join roster r on r.id = ss.roster_id
         where ss.id = $1 and ss.tenant_id = $2`,
        [shiftSlotId, tenantId],
      );
      const statusRow = statusResult.rows[0];
      if (statusRow === undefined) {
        return undefined;
      }
      if (statusRow.status !== 'draft') {
        throw conflict(
          `Cannot assign a doctor on a roster with status '${statusRow.status}'; only a draft roster can be edited directly.`,
        );
      }

      const result = await client.query<AssignmentRow>(
        `insert into shift_assignment (tenant_id, doctor_id, shift_slot_id, period, provenance)
         select $1, $2, ss.id,
           tstzrange(
             (ss.on_date + (ps.start_hour || ' hours')::interval) at time zone 'Africa/Johannesburg',
             (ss.on_date + (ps.start_hour || ' hours')::interval + (ps.hours || ' hours')::interval)
               at time zone 'Africa/Johannesburg'
           ),
           $3
         from shift_slot ss
         join pattern_shift ps on ps.id = ss.pattern_shift_id
         where ss.id = $4 and ss.tenant_id = $1
         returning id, doctor_id, shift_slot_id, lower(period) as period_start, upper(period) as period_end,
           provenance, locked`,
        [tenantId, doctorId, provenance, shiftSlotId],
      );
      const row = result.rows[0];
      if (row === undefined) {
        throw new Error(
          'insert into shift_assignment returned no row despite passing the status check',
        );
      }
      return row;
    });

    if (assignment === undefined) {
      throw notFound(`No shift slot ${shiftSlotId}.`);
    }

    return jsonResponse(
      {
        id: assignment.id,
        doctorId: assignment.doctor_id,
        shiftSlotId: assignment.shift_slot_id,
        periodStart: assignment.period_start.toISOString(),
        periodEnd: assignment.period_end.toISOString(),
        provenance: assignment.provenance,
        locked: assignment.locked,
      },
      { status: 201 },
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
