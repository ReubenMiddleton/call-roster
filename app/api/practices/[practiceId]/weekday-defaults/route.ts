import { z } from 'zod';
import { jsonResponse, notFound, toErrorResponse } from '../../../../../lib/server/api-error.ts';
import { withTenant } from '../../../../../lib/server/db.ts';
import { requireTenantForPractice } from '../../../../../lib/server/tenant-context.ts';
import { WEEKDAYS } from '../../../../../lib/server/weekdays.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// All seven required in one call, deliberately: a partial set is exactly the state that makes
// `resolvePattern` (lib/calendar/pattern-precedence.ts) return `needsDecision` for a weekday
// nobody configured, which is a confusing thing to discover only when generating slots later.
const setWeekdayDefaultsSchema = z
  .object(
    Object.fromEntries(
      WEEKDAYS.map((day) => [day, z.string().regex(UUID_RE, 'must be a pattern id')]),
    ) as Record<(typeof WEEKDAYS)[number], z.ZodString>,
  )
  .strict();

interface WeekdayDefaultRow {
  weekday: string;
  pattern_id: string;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ practiceId: string }> },
): Promise<Response> {
  try {
    const { practiceId } = await context.params;
    const tenantId = requireTenantForPractice(request, practiceId);

    const defaults = await withTenant(tenantId, async (client) => {
      const result = await client.query<WeekdayDefaultRow>(
        'select weekday, pattern_id from weekday_default_pattern where tenant_id = $1',
        [tenantId],
      );
      return result.rows;
    });

    const byWeekday = new Map(defaults.map((row) => [row.weekday, row.pattern_id]));
    return jsonResponse({
      weekdayDefaults: Object.fromEntries(WEEKDAYS.map((day) => [day, byWeekday.get(day) ?? null])),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** Upserts all seven at once. `weekday_default_pattern`'s primary key is `(tenant_id, weekday)`,
 * so re-running this to change one day is the normal way to use it, not an edge case. */
export async function PUT(
  request: Request,
  context: { params: Promise<{ practiceId: string }> },
): Promise<Response> {
  try {
    const { practiceId } = await context.params;
    const tenantId = requireTenantForPractice(request, practiceId);
    const body: unknown = await request.json();
    const parsed = setWeekdayDefaultsSchema.parse(body);

    await withTenant(tenantId, async (client) => {
      for (const day of WEEKDAYS) {
        const result = await client.query(
          `insert into weekday_default_pattern (tenant_id, weekday, pattern_id)
           values ($1, $2, $3)
           on conflict (tenant_id, weekday) do update set pattern_id = excluded.pattern_id`,
          [tenantId, day, parsed[day]],
        );
        if (result.rowCount === 0) {
          // Only reachable if the pattern_id's foreign key silently failed to raise, which it
          // won't -- kept as a named failure rather than a swallowed no-op if that ever changes.
          throw notFound(`No shift pattern ${parsed[day]}.`);
        }
      }
    });

    return jsonResponse({ weekdayDefaults: parsed });
  } catch (error) {
    return toErrorResponse(error);
  }
}
