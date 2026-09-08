import { jsonResponse, notFound, toErrorResponse } from '../../../../lib/server/api-error.ts';
import { withTenant } from '../../../../lib/server/db.ts';
import { requireTenantForPractice } from '../../../../lib/server/tenant-context.ts';

interface PracticeRow {
  id: string;
  name: string;
  created_at: Date;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ practiceId: string }> },
): Promise<Response> {
  try {
    const { practiceId } = await context.params;
    const tenantId = requireTenantForPractice(request, practiceId);

    const practice = await withTenant(tenantId, async (client) => {
      const result = await client.query<PracticeRow>(
        'select id, name, created_at from practice where id = $1',
        [practiceId],
      );
      return result.rows[0];
    });

    if (practice === undefined) {
      throw notFound(`No practice ${practiceId}.`);
    }

    return jsonResponse({
      id: practice.id,
      name: practice.name,
      createdAt: practice.created_at.toISOString(),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
