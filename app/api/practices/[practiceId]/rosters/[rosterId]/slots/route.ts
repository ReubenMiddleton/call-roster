import type { PoolClient } from 'pg';
import {
  conflict,
  jsonResponse,
  notFound,
  toErrorResponse,
} from '../../../../../../../lib/server/api-error.ts';
import { withTenant } from '../../../../../../../lib/server/db.ts';
import { requireTenantForPractice } from '../../../../../../../lib/server/tenant-context.ts';
import { WEEKDAYS } from '../../../../../../../lib/server/weekdays.ts';
import { holidayLookup } from '../../../../../../../lib/calendar/holidays.ts';
import { resolveMonth } from '../../../../../../../lib/calendar/pattern-precedence.ts';
import type { PatternId } from '../../../../../../../lib/analytics/types.ts';

interface RosterRow {
  id: string;
  month: string;
  status: string;
}

interface WeekdayDefaultRow {
  weekday: string;
  pattern_id: string;
}

interface DatePatternRow {
  on_date: string;
  pattern_id: string;
}

interface PatternShiftRow {
  id: string;
  pattern_id: string;
}

function monthRange(month: string): { start: string; end: string } {
  const [year, monthNumber] = month.split('-');
  // Validated as `YYYY-MM` by the roster's own creation schema, so this never actually throws.
  if (year === undefined || monthNumber === undefined) {
    throw new Error(`not an ISO month: "${month}"`);
  }
  const lastDay = new Date(Date.UTC(Number(year), Number(monthNumber), 0)).getUTCDate();
  return { start: `${month}-01`, end: `${month}-${String(lastDay).padStart(2, '0')}` };
}

/**
 * "Set up next month" — the direct implementation of the precedence order in
 * docs/domain/shift-patterns.md, reusing the already-tested resolver in
 * lib/calendar/pattern-precedence.ts rather than re-deriving it in SQL.
 *
 * Idempotent: `shift_slot`'s own unique constraint means calling this twice, or after fixing a
 * weekday default or adding a date override, only inserts the slots that don't already exist —
 * matching how the admin actually works (fix one thing, regenerate, reassess).
 *
 * **Two of the resolver's four precedence levels aren't wired up yet, deliberately**: a per-date
 * custom shift set (level 1) has zero occurrences in 33 months of real data, and holiday-driven
 * pattern suspension (level 3) is practice-specific configuration (`PILOT_HOLIDAY_SUSPENDS_V1`)
 * that has no tenant-scoped home in the schema yet — hard-coding the pilot's answer into this
 * route would be exactly the tenant-specific-data-in-code mistake ADR-0010 exists to prevent. A
 * new tenant with no configured suspension correctly gets "holidays don't change the structure",
 * which the resolver itself documents as a legitimate configuration. Real public holidays are
 * still looked up and reported (`isPublicHoliday`), they just don't suspend anything yet.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ practiceId: string; rosterId: string }> },
): Promise<Response> {
  try {
    const { practiceId, rosterId } = await context.params;
    const tenantId = requireTenantForPractice(request, practiceId);

    const outcome = await withTenant(tenantId, async (client: PoolClient) => {
      const rosterResult = await client.query<RosterRow>(
        'select id, month, status from roster where id = $1 and tenant_id = $2',
        [rosterId, tenantId],
      );
      const roster = rosterResult.rows[0];
      if (roster === undefined) {
        return undefined;
      }
      if (roster.status !== 'draft') {
        // "DRAFT: Anything, the generator runs freely" -- every other status is read-only or
        // routed through a lifecycle command instead (docs/domain/commands-events.md).
        throw conflict(
          `Cannot generate slots for a roster with status '${roster.status}'; only a draft roster can be regenerated.`,
        );
      }

      const weekdayResult = await client.query<WeekdayDefaultRow>(
        'select weekday, pattern_id from weekday_default_pattern where tenant_id = $1',
        [tenantId],
      );
      const byWeekday = new Map(weekdayResult.rows.map((row) => [row.weekday, row.pattern_id]));
      const weekdayDefaults: (PatternId | undefined)[] = WEEKDAYS.map((day) => byWeekday.get(day));

      const { start, end } = monthRange(roster.month);
      const dateOverrideResult = await client.query<DatePatternRow>(
        'select on_date, pattern_id from date_pattern where tenant_id = $1 and on_date between $2 and $3',
        [tenantId, start, end],
      );
      const dateOverrides = new Map(
        dateOverrideResult.rows.map((row) => [row.on_date, row.pattern_id]),
      );

      const holidays = holidayLookup(start, end);

      const resolutions = resolveMonth(roster.month, {
        weekdayDefaults: weekdayDefaults as readonly PatternId[],
        holidays,
        dateOverrides,
      });

      const patternIds = [
        ...new Set(resolutions.map((r) => r.patternId).filter((id) => id !== undefined)),
      ];
      const shiftsByPattern = new Map<string, PatternShiftRow[]>();
      if (patternIds.length > 0) {
        const shiftResult = await client.query<PatternShiftRow>(
          'select id, pattern_id from pattern_shift where tenant_id = $1 and pattern_id = any($2::uuid[])',
          [tenantId, patternIds],
        );
        for (const row of shiftResult.rows) {
          const forPattern = shiftsByPattern.get(row.pattern_id) ?? [];
          forPattern.push(row);
          shiftsByPattern.set(row.pattern_id, forPattern);
        }
      }

      let slotsCreated = 0;
      const datesNeedingDecision: { date: string; reason: string }[] = [];
      for (const resolution of resolutions) {
        if (resolution.needsDecision || resolution.patternId === undefined) {
          if (resolution.needsDecision) {
            datesNeedingDecision.push({ date: resolution.date, reason: resolution.reason });
          }
          continue;
        }
        const shifts = shiftsByPattern.get(resolution.patternId) ?? [];
        for (const shift of shifts) {
          const result = await client.query(
            `insert into shift_slot (tenant_id, roster_id, on_date, pattern_shift_id)
             values ($1, $2, $3, $4)
             on conflict (tenant_id, roster_id, on_date, pattern_shift_id) do nothing`,
            [tenantId, rosterId, resolution.date, shift.id],
          );
          slotsCreated += result.rowCount ?? 0;
        }
      }

      return { slotsCreated, datesNeedingDecision };
    });

    if (outcome === undefined) {
      throw notFound(`No roster ${rosterId}.`);
    }

    return jsonResponse(outcome, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
