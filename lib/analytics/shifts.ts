/**
 * The shift catalogue, and the calendar classification the burden model depends on.
 *
 * The catalogue is **data**. This practice's three patterns are exported as
 * `PILOT_PATTERNS_V1` for seeding and tests, but every function here takes the catalogue as a
 * parameter — a second tenant supplies its own. See ADR-0010.
 *
 * Times and durations here are the ones verified against fifteen months of transcribed rosters
 * by `scripts/validate-seed-data.mjs`, which fails if a pattern's hours do not sum to 24.
 */

import type {
  DayClass,
  IsoDate,
  RosterDay,
  ShiftDefinition,
  ShiftId,
  ShiftPattern,
} from './types.ts';

/**
 * The pilot practice's patterns, as read off the roster sheets.
 *
 * Named `PILOT_` rather than after the practice: nothing committed names the practice, per the
 * resolved decision in `docs/NEEDS_YOUR_INPUT.md`. Naming it later is easy; un-publishing is not.
 *
 * - **A** — the ordinary day: three eight-hour shifts.
 * - **B** — Friday: four shifts, splitting the day at 12:00 and 17:00.
 * - **C** — the reduced day used at year end and on some public holidays: a 07:00–17:00 long
 *   day, then evening and night.
 *
 * `[CONFIRMED]` — verified across all fifteen transcribed months.
 */
export const PILOT_PATTERNS_V1: readonly ShiftPattern[] = [
  {
    id: 'A',
    shifts: [
      { id: 'std-morning', patternId: 'A', startHour: 7, hours: 8, kind: 'morning' },
      { id: 'std-afternoon', patternId: 'A', startHour: 15, hours: 8, kind: 'afternoon' },
      { id: 'std-night', patternId: 'A', startHour: 23, hours: 8, kind: 'night' },
    ],
  },
  {
    id: 'B',
    shifts: [
      { id: 'fri-early', patternId: 'B', startHour: 7, hours: 5, kind: 'morning' },
      { id: 'fri-midday', patternId: 'B', startHour: 12, hours: 5, kind: 'afternoon' },
      { id: 'fri-evening', patternId: 'B', startHour: 17, hours: 6, kind: 'evening' },
      { id: 'fri-night', patternId: 'B', startHour: 23, hours: 8, kind: 'night' },
    ],
  },
  {
    id: 'C',
    shifts: [
      { id: 'red-longday', patternId: 'C', startHour: 7, hours: 10, kind: 'long-day' },
      { id: 'red-evening', patternId: 'C', startHour: 17, hours: 6, kind: 'evening' },
      { id: 'red-night', patternId: 'C', startHour: 23, hours: 8, kind: 'night' },
    ],
  },
];

/** Flattens a pattern catalogue into a lookup from shift id to its definition. */
export function indexShifts(
  patterns: readonly ShiftPattern[],
): ReadonlyMap<ShiftId, ShiftDefinition> {
  const index = new Map<ShiftId, ShiftDefinition>();
  for (const pattern of patterns) {
    for (const shift of pattern.shifts) {
      const existing = index.get(shift.id);
      if (existing !== undefined && existing.patternId !== shift.patternId) {
        // A shift id shared across patterns would make `red-night` and `std-night`
        // indistinguishable in the ledger. Fail loudly rather than silently merge them.
        throw new Error(
          `shift id "${shift.id}" is defined in both pattern ${existing.patternId} and ${shift.patternId}`,
        );
      }
      index.set(shift.id, shift);
    }
  }
  return index;
}

/** Total hours a pattern covers. 24 for every valid pattern. */
export function patternHours(pattern: ShiftPattern): number {
  return pattern.shifts.reduce((total, shift) => total + shift.hours, 0);
}

/**
 * Day of week for an ISO date, 0 = Sunday … 6 = Saturday.
 *
 * Parsed explicitly in UTC. `new Date('2025-12-25')` is UTC midnight but
 * `new Date('2025-12-25T00:00')` is local, and mixing the two silently shifts dates by one in
 * any timezone behind UTC. Africa/Johannesburg is UTC+2, so the bug would be invisible here and
 * appear only for a tenant west of Greenwich.
 */
export function dayOfWeek(date: IsoDate): number {
  const parts = date.split('-');
  const [year, month, day] = parts;
  if (parts.length !== 3 || year === undefined || month === undefined || day === undefined) {
    throw new Error(`not an ISO date: "${date}"`);
  }
  const timestamp = Date.UTC(Number(year), Number(month) - 1, Number(day));
  if (Number.isNaN(timestamp)) {
    throw new Error(`not an ISO date: "${date}"`);
  }
  return new Date(timestamp).getUTCDay();
}

/**
 * Classifies a date for burden purposes.
 *
 * Public holidays are supplied by the caller rather than derived here: holiday rules are their
 * own problem (computus, the Sunday-to-Monday rule, ad hoc presidential declarations) and live
 * in `docs/domain/holidays.md`, implemented in `lib/calendar/holidays.ts`. The transcribed seed data
 * carries the flag per day, and `npm run seed:holidays` reconciles the two.
 *
 * **Saturday and Sunday outrank a public holiday**, which is the reverse of what this function did
 * before 31 August 2026. The principal was asked whether a holiday falling on a Saturday counts once
 * or twice and answered: *"it counts once as a Saturday, not a Saturday and a holiday."*
 *
 * That is operationally sensible — a holiday on a Saturday produces a roster that looks like an
 * ordinary Saturday — and it lowers the weight from 5.0 to 3.0 for those dates.
 *
 * **Sunday is `[INFERRED]` by symmetry.** He was asked about Saturday specifically. Applying the
 * rule to Saturday and not Sunday would be incoherent, so both outrank; confirming Sunday is a
 * one-word follow-up rather than a redesign.
 */
export function classifyDay(date: IsoDate, isPublicHoliday: boolean): DayClass {
  const weekday = dayOfWeek(date);
  if (weekday === 6) {
    return 'saturday';
  }
  if (weekday === 0) {
    return 'sunday';
  }
  if (isPublicHoliday) {
    return 'public-holiday';
  }
  return 'weekday';
}

/**
 * The hour at which the practice's weekend begins on a Friday.
 *
 * `[CONFIRMED 2026-08-31]` by the practice principal: *"weekend starts at Friday 17:00"*. This is
 * also exactly where Pattern B's pool-only back half begins, and it is explained by the reason GPs
 * cannot work weekday daytime shifts at all — they are at their own practices until late afternoon.
 */
export const WEEKEND_START_HOUR_ON_FRIDAY = 17;

/**
 * Whether a shift falls inside the practice's weekend: **Friday 17:00 to Monday 07:00**.
 *
 * Now a real function rather than four separate counters, because the definition is confirmed. Note
 * what it is *not* used for: **burden weight**. The principal approved the weight table as it stands,
 * and that table prices Friday as a weekday. Whether a Friday 17:00 shift should instead price at the
 * Saturday rate is a narrower question he was not asked — see question W. Keep the two concepts
 * separate; conflating them would quietly reprice about 120 shifts.
 */
export function isWeekendShift(day: RosterDay, shift: ShiftDefinition): boolean {
  if (day.dayClass === 'saturday' || day.dayClass === 'sunday') {
    return true;
  }
  // A public holiday on a Saturday or Sunday classifies as `saturday`/`sunday`, so the weekend
  // test above already covers it. A holiday on a weekday is not weekend work.
  return dayOfWeek(day.date) === 5 && shift.startHour >= WEEKEND_START_HOUR_ON_FRIDAY;
}

/**
 * Days between two ISO dates, inclusive of both ends.
 *
 * Used for active-membership windows, where a doctor present for eleven days of a month must not
 * be compared against one present for all thirty.
 */
export function inclusiveDayCount(from: IsoDate, to: IsoDate): number {
  const fromParts = from.split('-');
  const toParts = to.split('-');
  const [fy, fm, fd] = fromParts;
  const [ty, tm, td] = toParts;
  if (fy === undefined || fm === undefined || fd === undefined) {
    throw new Error(`not an ISO date: "${from}"`);
  }
  if (ty === undefined || tm === undefined || td === undefined) {
    throw new Error(`not an ISO date: "${to}"`);
  }
  const start = Date.UTC(Number(fy), Number(fm) - 1, Number(fd));
  const end = Date.UTC(Number(ty), Number(tm) - 1, Number(td));
  const millisecondsPerDay = 86_400_000;
  return Math.floor((end - start) / millisecondsPerDay) + 1;
}
