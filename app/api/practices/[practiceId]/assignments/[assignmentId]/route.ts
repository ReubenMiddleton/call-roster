import {
  conflict,
  jsonResponse,
  notFound,
  toErrorResponse,
} from '../../../../../../lib/server/api-error.ts';
import { withTenant } from '../../../../../../lib/server/db.ts';
import { requireTenantForPractice } from '../../../../../../lib/server/tenant-context.ts';

/** Unassigns a doctor from a slot. Deleting the row rather than a soft "unassigned" state is
 * correct here specifically because it isn't the audit boundary -- `command_journal`
 * (append-only, never this table) is what has to answer "who was on duty then"; this table is
 * just the current, editable assignment.
 *
 * Refuses once the slot's roster has left `DRAFT`, for the same reason `assignments/route.ts`'s
 * POST does. */
export async function DELETE(
  request: Request,
  context: { params: Promise<{ practiceId: string; assignmentId: string }> },
): Promise<Response> {
  try {
    const { practiceId, assignmentId } = await context.params;
    const tenantId = requireTenantForPractice(request, practiceId);

    const deleted = await withTenant(tenantId, async (client) => {
      const statusResult = await client.query<{ status: string }>(
        `select r.status
         from shift_assignment sa
         join shift_slot ss on ss.id = sa.shift_slot_id
         join roster r on r.id = ss.roster_id
         where sa.id = $1 and sa.tenant_id = $2`,
        [assignmentId, tenantId],
      );
      const statusRow = statusResult.rows[0];
      if (statusRow === undefined) {
        return undefined;
      }
      if (statusRow.status !== 'draft') {
        throw conflict(
          `Cannot unassign on a roster with status '${statusRow.status}'; only a draft roster can be edited directly.`,
        );
      }

      const result = await client.query<{ id: string }>(
        'delete from shift_assignment where id = $1 and tenant_id = $2 returning id',
        [assignmentId, tenantId],
      );
      return result.rows[0];
    });

    if (deleted === undefined) {
      throw notFound(`No assignment ${assignmentId}.`);
    }

    return jsonResponse({ id: assignmentId, deleted: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
