/**
 * Wires the database to the already-tested burden ledger in `lib/analytics/`. Nothing about
 * fairness arithmetic is reimplemented here -- `buildLedger`, `entitlementWeights` and
 * `computeLoadRatios` are the same functions the solver and the seed-data reports use. This
 * module's own job is turning live rows into the `RosterPeriod`/`ShiftPattern[]` shape those
 * functions expect, resolving which of the tenant's own burden schedule versions applies
 * (`lib/server/burden-schedule.ts`), and persisting the result.
 */

import type { PoolClient } from 'pg';
import { resolveBurden } from '../analytics/burden.ts';
import type { BurdenSchedule } from '../analytics/burden-types.ts';
import { computeLoadRatios } from '../analytics/equity.ts';
import { buildLedger, entitlementWeights } from '../analytics/ledger.ts';
import { NAMED_SPECIAL_DATES } from '../analytics/seed-period.ts';
import { classifyDay } from '../analytics/shifts.ts';
import type {
  Assignment,
  Provenance,
  RosterDay,
  RosterPeriod,
  ShiftDefinition,
  ShiftKind,
  ShiftPattern,
} from '../analytics/types.ts';
import { holidayLookup } from '../calendar/holidays.ts';
import { badRequest, conflict } from './api-error.ts';
import { loadBurdenSchedules, scheduleForDate } from './burden-schedule.ts';

interface AssignmentRow {
  assignment_id: string;
  doctor_id: string;
  on_date: string;
  pattern_shift_id: string;
  provenance: string;
  roster_id: string;
}

interface PatternShiftRow {
  id: string;
  start_hour: number;
  hours: string;
  kind: string;
  pattern_id: string;
}

export interface LedgerEntry {
  readonly doctorId: string;
  readonly shifts: number;
  readonly burden: number;
  readonly equalisableBurden: number;
  readonly loadRatio: number | null;
}

export interface RecalculateLedgerResult {
  readonly assignmentsProcessed: number;
  readonly totalBurden: number;
  readonly scheduleVersion: string | null;
  readonly entries: readonly LedgerEntry[];
}

/**
 * Picks the single schedule version covering every assignment being recalculated. Non-overlapping
 * versions are enforced at the database level (`burden_schedule`'s exclusion constraint), so if
 * the earliest and latest assignment dates both resolve to the same version, every date between
 * them does too -- checking the two extremes is sufficient, not a shortcut.
 *
 * ⚠️ **A real, named limitation, not a silent one**: if the assignments being recalculated span a
 * schedule change, this throws rather than guessing which version applies to what. Merging
 * `buildLedger`/`entitlementWeights` output across schedule versions correctly would need changes
 * to those shared, widely-used functions (they take one schedule, not a per-date resolver), which
 * is real, separate work -- not something to get subtly wrong under time pressure in a session
 * about fixing exactly this class of bug. See `docs/architecture/api.md`.
 */
function resolveSingleSchedule(
  schedules: readonly BurdenSchedule[],
  firstDate: string,
  lastDate: string,
): BurdenSchedule {
  const firstSchedule = scheduleForDate(schedules, firstDate);
  if (firstSchedule === undefined) {
    throw badRequest(
      `No burden schedule covers ${firstDate}. Create one whose validFrom is on or before that date.`,
    );
  }
  const lastSchedule = scheduleForDate(schedules, lastDate);
  if (lastSchedule === undefined) {
    throw badRequest(
      `No burden schedule covers ${lastDate}. Create a newer schedule version covering it.`,
    );
  }
  if (firstSchedule.version !== lastSchedule.version) {
    throw conflict(
      `Assignments span more than one burden schedule version (${firstDate} under '${firstSchedule.version}', ${lastDate} under '${lastSchedule.version}'). Recalculating across a schedule change isn't supported yet.`,
    );
  }
  return firstSchedule;
}

/**
 * Rebuilds `burden_credit` from every assignment on a non-`draft` roster and returns the fairness
 * picture computed along the way -- raw burden and load ratios (`revealed-opportunity` basis, "the
 * default", docs/domain/fairness.md), not just totals. `DRAFT` rosters are excluded: nothing
 * speculative should be credited to anyone's ledger.
 *
 * Prices using the tenant's own burden schedule (`lib/server/burden-schedule.ts`) — a 400 if none
 * is configured yet, or if the assignment history spans more than one version (see
 * `resolveSingleSchedule`). Nothing here guesses at a tenant's weights the way this module once
 * hard-coded the pilot practice's own numbers for everyone.
 *
 * Idempotent ("RecalculateLedger: Idempotent", docs/domain/commands-events.md) by deleting and
 * rebuilding the tenant's `burden_credit` rows in one transaction, rather than upserting against a
 * natural key that would have to be invented for a table with no obvious one.
 */
export async function recalculateLedger(
  client: PoolClient,
  tenantId: string,
): Promise<RecalculateLedgerResult> {
  const assignmentResult = await client.query<AssignmentRow>(
    `select sa.id as assignment_id, sa.doctor_id, ss.on_date, ss.pattern_shift_id, sa.provenance, ss.roster_id
     from shift_assignment sa
     join shift_slot ss on ss.id = sa.shift_slot_id
     join roster r on r.id = ss.roster_id
     where sa.tenant_id = $1 and r.status in ('published', 'locked', 'archived')`,
    [tenantId],
  );

  if (assignmentResult.rows.length === 0) {
    await client.query('delete from burden_credit where tenant_id = $1', [tenantId]);
    return { assignmentsProcessed: 0, totalBurden: 0, scheduleVersion: null, entries: [] };
  }

  const dates = [...new Set(assignmentResult.rows.map((row) => row.on_date))].sort();
  const firstDate = dates[0];
  const lastDate = dates[dates.length - 1];
  if (firstDate === undefined || lastDate === undefined) {
    throw new Error('unreachable: dates derived from a non-empty assignment list');
  }

  const schedules = await loadBurdenSchedules(client, tenantId);
  if (schedules.length === 0) {
    throw badRequest(
      'No burden schedule is configured for this tenant. Create one with POST .../burden-schedules before recalculating the ledger.',
    );
  }
  const schedule = resolveSingleSchedule(schedules, firstDate, lastDate);

  const patternShiftResult = await client.query<PatternShiftRow>(
    'select id, start_hour, hours, kind, pattern_id from pattern_shift where tenant_id = $1',
    [tenantId],
  );
  const shiftDefinitions: ShiftDefinition[] = patternShiftResult.rows.map((row) => ({
    id: row.id,
    patternId: row.pattern_id,
    startHour: row.start_hour,
    hours: Number(row.hours),
    kind: row.kind as ShiftKind,
  }));
  // buildLedger/resolveBurden index shift definitions by id regardless of which pattern they
  // belong to, so one synthetic "pattern" holding every shift definition for the tenant is
  // exactly the shape they need -- there is no requirement that `patterns` mirror the real
  // per-tenant pattern boundaries.
  const patterns: ShiftPattern[] = [{ id: 'all-shifts', shifts: shiftDefinitions }];

  const holidays = holidayLookup(firstDate, lastDate);

  const days: RosterDay[] = dates.map((date) => {
    const isPublicHoliday = holidays.has(date);
    const specialDate = NAMED_SPECIAL_DATES[date.slice(5)];
    return {
      date,
      patternId: 'all-shifts',
      dayClass: classifyDay(date, isPublicHoliday),
      isPublicHoliday,
      ...(specialDate === undefined ? {} : { specialDate }),
    };
  });

  const assignments: Assignment[] = assignmentResult.rows.map((row) => ({
    date: row.on_date,
    shiftId: row.pattern_shift_id,
    doctor: row.doctor_id,
    provenance: row.provenance as Provenance,
  }));

  const period: RosterPeriod = { label: `tenant-${tenantId}`, days, assignments };
  const ledger = buildLedger(period, patterns, schedule);
  const weights = entitlementWeights(period, patterns, schedule, ledger, {
    basis: 'revealed-opportunity',
  });
  const carried = new Map(ledger.entries.map((entry) => [entry.doctor, entry.equalisableBurden]));
  const loadRatios = new Map(computeLoadRatios(carried, weights).map((r) => [r.doctor, r.ratio]));

  // Rebuild burden_credit from scratch -- see the idempotency note above.
  await client.query('delete from burden_credit where tenant_id = $1', [tenantId]);

  const shiftIndex = new Map(shiftDefinitions.map((shift) => [shift.id, shift]));
  const dayIndex = new Map(days.map((day) => [day.date, day]));
  for (const row of assignmentResult.rows) {
    const day = dayIndex.get(row.on_date);
    const shift = shiftIndex.get(row.pattern_shift_id);
    if (day === undefined || shift === undefined) {
      throw new Error(`unreachable: day/shift missing for assignment ${row.assignment_id}`);
    }
    const { weight } = resolveBurden(day, shift, schedule);
    await client.query(
      `insert into burden_credit (tenant_id, doctor_id, roster_id, shift_kind, weight_used, provenance)
       values ($1, $2, $3, $4, $5, $6)`,
      [tenantId, row.doctor_id, row.roster_id, shift.kind, weight, row.provenance],
    );
  }

  const entries: LedgerEntry[] = ledger.entries.map((entry) => ({
    doctorId: entry.doctor,
    shifts: entry.shifts,
    burden: entry.burden,
    equalisableBurden: entry.equalisableBurden,
    loadRatio: loadRatios.get(entry.doctor) ?? null,
  }));

  return {
    assignmentsProcessed: assignmentResult.rows.length,
    totalBurden: ledger.totalBurden,
    scheduleVersion: schedule.version,
    entries,
  };
}
