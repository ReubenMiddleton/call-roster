import { withAppUser, withTenant } from '../../../../lib/server/db.ts';
import { buildIcsCalendar } from '../../../../lib/server/ics.ts';

interface TokenRow {
  tenant_id: string;
  doctor_id: string;
  sequence: number;
}

interface AssignmentRow {
  assignment_id: string;
  period_start: Date;
  period_end: Date;
  shift_kind: string;
}

/**
 * The public feed. No `x-tenant-id` -- the token in the path is the only credential, resolved via
 * `resolve_ics_token` (supabase/migrations/0012_notification_and_ics_feed.sql), and a wrong or
 * revoked token is indistinguishable from a nonexistent path: both a plain 404, matching the same
 * "don't confirm what the caller doesn't already know" reasoning as
 * `requireTenantForPractice` elsewhere in this API.
 *
 * Draft rosters never appear here -- only `published`, `locked` and `archived` assignments are a
 * doctor's business to see on their own calendar.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ token: string }> },
): Promise<Response> {
  try {
    const { token } = await context.params;

    const resolved = await withAppUser(async (client) => {
      const result = await client.query<TokenRow>(
        'select tenant_id, doctor_id, sequence from resolve_ics_token($1)',
        [token],
      );
      return result.rows[0];
    });

    if (resolved === undefined) {
      return new Response('Not found', { status: 404 });
    }

    const events = await withTenant(resolved.tenant_id, async (client) => {
      const result = await client.query<AssignmentRow>(
        `select sa.id as assignment_id, lower(sa.period) as period_start, upper(sa.period) as period_end,
           ps.kind as shift_kind
         from shift_assignment sa
         join shift_slot ss on ss.id = sa.shift_slot_id
         join roster r on r.id = ss.roster_id
         join pattern_shift ps on ps.id = ss.pattern_shift_id
         where sa.tenant_id = $1 and sa.doctor_id = $2 and r.status in ('published', 'locked', 'archived')
         order by sa.period`,
        [resolved.tenant_id, resolved.doctor_id],
      );
      return result.rows;
    });

    const calendar = buildIcsCalendar(
      events.map((row) => ({
        uid: `${row.assignment_id}@call-roster`,
        startUtc: row.period_start,
        endUtc: row.period_end,
        summary: `On duty (${row.shift_kind})`,
      })),
      resolved.sequence,
    );

    return new Response(calendar, {
      status: 200,
      headers: { 'content-type': 'text/calendar; charset=utf-8' },
    });
  } catch (error) {
    console.error(error);
    return new Response('Something went wrong.', { status: 500 });
  }
}
