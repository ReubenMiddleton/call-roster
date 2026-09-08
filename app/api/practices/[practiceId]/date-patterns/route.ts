import { z } from 'zod';
import { jsonResponse, toErrorResponse } from '../../../../../lib/server/api-error.ts';
import { withTenant } from '../../../../../lib/server/db.ts';
import { requireTenantForPractice } from '../../../../../lib/server/tenant-context.ts';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const setDatePatternSchema = z
  .object({
    onDate: z.string().regex(ISO_DATE_RE, 'onDate must be an ISO date (YYYY-MM-DD)'),
    patternId: z.string().min(1),
    reason: z.string().trim().max(500).optional(),
  })
  .strict();

interface DatePatternRow {
  on_date: string;
  pattern_id: string;
  reason: string | null;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ practiceId: string }> },
): Promise<Response> {
  try {
    const { practiceId } = await context.params;
    const tenantId = requireTenantForPractice(request, practiceId);

    const overrides = await withTenant(tenantId, async (client) => {
      const result = await client.query<DatePatternRow>(
        'select on_date, pattern_id, reason from date_pattern where tenant_id = $1 order by on_date',
        [tenantId],
      );
      return result.rows;
    });

    return jsonResponse({
      datePatterns: overrides.map((row) => ({
        onDate: row.on_date,
        patternId: row.pattern_id,
        reason: row.reason,
      })),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/**
 * Sets, or changes, the pattern override for one date -- level 2 of
 * docs/domain/shift-patterns.md's precedence order. An upsert, not a create: "the admin can
 * override at any level" is a stated requirement, and he moves one thing and reassesses
 * (docs/NEEDS_YOUR_INPUT.md, "edit shape"), which includes changing his mind about a date he
 * already overrode.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ practiceId: string }> },
): Promise<Response> {
  try {
    const { practiceId } = await context.params;
    const tenantId = requireTenantForPractice(request, practiceId);
    const body: unknown = await request.json();
    const { onDate, patternId, reason } = setDatePatternSchema.parse(body);

    const datePattern = await withTenant(tenantId, async (client) => {
      const result = await client.query<DatePatternRow>(
        `insert into date_pattern (tenant_id, on_date, pattern_id, reason)
         values ($1, $2, $3, $4)
         on conflict (tenant_id, on_date) do update set pattern_id = excluded.pattern_id, reason = excluded.reason
         returning on_date, pattern_id, reason`,
        [tenantId, onDate, patternId, reason ?? null],
      );
      const row = result.rows[0];
      if (row === undefined) {
        throw new Error('upsert into date_pattern returned no row');
      }
      return row;
    });

    return jsonResponse(
      {
        onDate: datePattern.on_date,
        patternId: datePattern.pattern_id,
        reason: datePattern.reason,
      },
      { status: 201 },
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
