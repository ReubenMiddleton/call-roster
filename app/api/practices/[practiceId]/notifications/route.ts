import { badRequest, jsonResponse, toErrorResponse } from '../../../../../lib/server/api-error.ts';
import { withTenant } from '../../../../../lib/server/db.ts';
import { requireTenantForPractice } from '../../../../../lib/server/tenant-context.ts';

interface NotificationRow {
  id: string;
  doctor_id: string;
  channel: string;
  event_type: string;
  payload: unknown;
  status: string;
  created_at: Date;
}

const STATUS_FILTER_VALUES = ['pending', 'sent', 'failed'] as const;

/** The outbox, read-only -- see `lib/server/notifications.ts` for why every row here sits at
 * `pending` until a real delivery channel exists. No POST: nobody authors a notification
 * directly, they're always a side effect of `PublishRoster`/`ApproveSwap`. */
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
      throw badRequest("status must be one of 'pending', 'sent', 'failed'.");
    }

    const rows = await withTenant(tenantId, async (client) => {
      const result = await client.query<NotificationRow>(
        statusFilter === null
          ? 'select id, doctor_id, channel, event_type, payload, status, created_at from notification where tenant_id = $1 order by created_at desc'
          : 'select id, doctor_id, channel, event_type, payload, status, created_at from notification where tenant_id = $1 and status = $2 order by created_at desc',
        statusFilter === null ? [tenantId] : [tenantId, statusFilter],
      );
      return result.rows;
    });

    return jsonResponse({
      notifications: rows.map((row) => ({
        id: row.id,
        doctorId: row.doctor_id,
        channel: row.channel,
        eventType: row.event_type,
        payload: row.payload,
        status: row.status,
        createdAt: row.created_at.toISOString(),
      })),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
