import { z } from 'zod';
import { jsonResponse, toErrorResponse } from '../../../../../lib/server/api-error.ts';
import { withTenant } from '../../../../../lib/server/db.ts';
import { requireTenantForPractice } from '../../../../../lib/server/tenant-context.ts';

const ISO_MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

const createRosterSchema = z
  .object({
    month: z.string().regex(ISO_MONTH_RE, 'month must be an ISO year-month (YYYY-MM)'),
  })
  .strict();

interface RosterRow {
  id: string;
  month: string;
  status: string;
  created_at: Date;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ practiceId: string }> },
): Promise<Response> {
  try {
    const { practiceId } = await context.params;
    const tenantId = requireTenantForPractice(request, practiceId);

    const rosters = await withTenant(tenantId, async (client) => {
      const result = await client.query<RosterRow>(
        'select id, month, status, created_at from roster where tenant_id = $1 order by month',
        [tenantId],
      );
      return result.rows;
    });

    return jsonResponse({
      rosters: rosters.map((roster) => ({
        id: roster.id,
        month: roster.month,
        status: roster.status,
        createdAt: roster.created_at.toISOString(),
      })),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** `roster` carries `unique (tenant_id, month)` -- a second POST for the same month surfaces as
 * a 409 via `toErrorResponse`'s unique-violation handling, not a generic 500. */
export async function POST(
  request: Request,
  context: { params: Promise<{ practiceId: string }> },
): Promise<Response> {
  try {
    const { practiceId } = await context.params;
    const tenantId = requireTenantForPractice(request, practiceId);
    const body: unknown = await request.json();
    const { month } = createRosterSchema.parse(body);

    const roster = await withTenant(tenantId, async (client) => {
      const result = await client.query<RosterRow>(
        `insert into roster (tenant_id, month) values ($1, $2)
         returning id, month, status, created_at`,
        [tenantId, month],
      );
      const row = result.rows[0];
      if (row === undefined) {
        throw new Error('insert into roster returned no row');
      }
      return row;
    });

    return jsonResponse(
      {
        id: roster.id,
        month: roster.month,
        status: roster.status,
        createdAt: roster.created_at.toISOString(),
      },
      { status: 201 },
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
