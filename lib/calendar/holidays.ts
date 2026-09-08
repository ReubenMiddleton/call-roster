/**
 * South African public holidays, **computed rather than tabulated**.
 *
 * The executable form of [`docs/domain/holidays.md`](../../docs/domain/holidays.md). That document
 * gives the reasoning; this module gives the dates, and the two must not disagree.
 *
 * Three requirements from the document drive the whole design:
 *
 * 1. **Easter is computed, never tabulated.** A hand-maintained table of Good Fridays is a silent
 *    time bomb that fails in whichever year nobody remembered to extend it, and the failure mode is
 *    a roster built against the wrong dates.
 * 2. **The Sunday-to-Monday rule is statutory.** Public Holidays Act 36 of 1994, s2(1). It is law,
 *    not policy, and it is not configurable.
 * 3. **Ad hoc declarations are data, not code.** A fixed calendar of twelve statutory holidays is
 *    wrong roughly every other year. {@link SOURCED_DECLARATIONS} is a historical record, not the
 *    authority — at run time declarations come from the tenant's own database.
 *
 * ## The 27 December declarations are not ad hoc at all
 *
 * `holidays.md` lists 27 December as having been declared a public holiday in 2011, 2016 and 2022,
 * filed under *"presidential declarations happen and are not predictable."* Running the statutory
 * rules over those years shows something better: **all three are the years Christmas Day fell on a
 * Sunday.** s2(1) moves it to the following Monday — which is already Day of Goodwill — so the
 * automatic rule silently produces no extra day off, and a proclamation has to.
 *
 * That class of declaration *is* predictable, and {@link suppressedObservances} names it. Over
 * 1995–2080 it is the **only** collision the statutory rules can produce, and the next occurrences
 * are 2033, 2039 and 2044. Election days and the 2023 Rugby World Cup declaration remain genuinely
 * unpredictable; this narrows the unpredictable set, it does not empty it.
 *
 * ## Two statutory holidays can land on one date
 *
 * 21 March 2008 was both Human Rights Day and Good Friday — the only such coincidence between 1995
 * and 2080. It produces **one** holiday carrying both names, not two entries: the export prints one
 * cell, and a doctor works one day. The Act substitutes only for a Sunday (s2(1)), so a coincidence
 * grants nothing extra and none is invented here.
 *
 * ## What this module deliberately does not do
 *
 * **Per-person substitution under s2(2)** — a doctor exchanging Christmas for another day — is not
 * here. It is burden attribution, not a calendar fact: the substituted day carries the holiday's
 * weight *for that individual* and the calendar is unchanged for everyone else. It belongs with the
 * fairness ledger. Mixing the two would make this module return different dates per doctor, which is
 * the wrong shape for every other caller.
 *
 * **Burden weights** are not here either. A holiday's weight is a practice decision that has to be
 * agreed with the group visibly — see [`docs/domain/fairness.md`](../../docs/domain/fairness.md).
 * Note in particular that {@link classifyDay} lets Saturday and Sunday outrank `public-holiday`, so
 * a holiday on a weekend is *not* priced as a holiday. This module reports the calendar fact; what
 * it is worth is somebody else's problem.
 */

import { dayOfWeek } from '../analytics/shifts.ts';
import type { IsoDate } from '../analytics/types.ts';

/** Why a date is a public holiday. The three concepts `holidays.md` insists are kept distinct. */
export type HolidayOrigin =
  /** Named in Schedule 1 of the Act, or computed from Easter. */
  | 'statutory'
  /** Created by s2(1) because the statutory date fell on a Sunday. */
  | 'observed'
  /** Added by proclamation or by an admin. Not derivable from the Act. */
  | 'declared';

/** One public holiday on one date. */
export interface PublicHoliday {
  readonly date: IsoDate;
  /**
   * The holiday's name as the practice would print it. Observed days carry `(observed)`, matching
   * the convention already used in the transcribed history.
   */
  readonly name: string;
  readonly origin: HolidayOrigin;
  /** For `origin: 'observed'`, the Sunday it moved from. Absent otherwise. */
  readonly observedFor?: IsoDate;
}

/** A date declared a public holiday by proclamation or by an admin. */
export interface DeclaredHoliday {
  readonly date: IsoDate;
  readonly name: string;
  /** Where this came from, so a reader can check it. Free text, never shown to a doctor. */
  readonly source?: string;
}

/**
 * A statutory holiday whose s2(1) observance had nowhere to go.
 *
 * Reported rather than swallowed, because historically this is the exact situation that produces a
 * proclamation — see the module docblock.
 */
export interface SuppressedObservance {
  /** The statutory date that fell on a Sunday. */
  readonly date: IsoDate;
  readonly name: string;
  /** The Monday s2(1) points at. */
  readonly wouldObserveOn: IsoDate;
  /** The holiday already sitting on that Monday. */
  readonly blockedBy: string;
}

/**
 * The ten fixed-date public holidays of Schedule 1, Public Holidays Act 36 of 1994. `[CONFIRMED]`
 *
 * Good Friday and Family Day are the other two and are computed — see {@link easterSunday}.
 *
 * Kept as `MM-DD` because these do not move. The two that look as though they might — Freedom Day
 * and National Women's Day — are fixed dates that get *observed* elsewhere when they fall on a
 * Sunday, which is a different thing and handled by {@link statutoryHolidays}.
 */
const FIXED_HOLIDAYS: readonly { readonly monthDay: string; readonly name: string }[] = [
  { monthDay: '01-01', name: "New Year's Day" },
  { monthDay: '03-21', name: 'Human Rights Day' },
  { monthDay: '04-27', name: 'Freedom Day' },
  { monthDay: '05-01', name: "Workers' Day" },
  { monthDay: '06-16', name: 'Youth Day' },
  { monthDay: '08-09', name: "National Women's Day" },
  { monthDay: '09-24', name: 'Heritage Day' },
  { monthDay: '12-16', name: 'Day of Reconciliation' },
  { monthDay: '12-25', name: 'Christmas Day' },
  { monthDay: '12-26', name: 'Day of Goodwill' },
];

/**
 * Ad hoc declarations this repository can actually cite. **Not a complete record of South African
 * proclamations, and not the run-time source.**
 *
 * Every entry is sourced from something already in the repository, because a date invented from
 * memory here would quietly reprice a historical shift and nobody would ever check it. A tenant's
 * real declarations live in their database, are auditable, and are passed in as `declared`.
 *
 * The 2011, 2016 and 2022 entries are the Christmas-on-Sunday collisions described in the module
 * docblock. The model predicts 2005 belongs to the same family; the repository does not record it,
 * so it is not listed.
 */
export const SOURCED_DECLARATIONS: readonly DeclaredHoliday[] = [
  { date: '2011-12-27', name: 'Public holiday by proclamation', source: 'docs/domain/holidays.md' },
  { date: '2016-12-27', name: 'Public holiday by proclamation', source: 'docs/domain/holidays.md' },
  { date: '2022-12-27', name: 'Public holiday by proclamation', source: 'docs/domain/holidays.md' },
  {
    date: '2023-12-15',
    name: 'Rugby World Cup victory',
    source: 'docs/domain/holidays.md',
  },
  {
    date: '2024-05-29',
    name: 'General election day',
    source: 'private/seed-data/2024-05.json',
  },
];

/** `YYYY-MM-DD` from numeric parts, zero-padded. */
function toIso(year: number, month: number, day: number): IsoDate {
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${String(year)}-${mm}-${dd}`;
}

/**
 * Splits an ISO date into numeric parts, in UTC.
 *
 * `noUncheckedIndexedAccess` is on, so the destructured parts are `string | undefined` and are
 * narrowed rather than asserted. A malformed date here would become a wrong holiday date, which
 * prints and looks plausible.
 */
function parts(date: IsoDate): { year: number; month: number; day: number } {
  const split = date.split('-');
  const [year, month, day] = split;
  if (split.length !== 3 || year === undefined || month === undefined || day === undefined) {
    throw new Error(`not an ISO date: "${date}"`);
  }
  const parsed = { year: Number(year), month: Number(month), day: Number(day) };
  if (Number.isNaN(Date.UTC(parsed.year, parsed.month - 1, parsed.day))) {
    throw new Error(`not an ISO date: "${date}"`);
  }
  return parsed;
}

/** `date` shifted by `days`, in UTC. Used only for the one- and two-day Easter and s2(1) offsets. */
function addDays(date: IsoDate, days: number): IsoDate {
  const { year, month, day } = parts(date);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return toIso(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
}

/**
 * Gregorian Easter Sunday, by the Anonymous Gregorian computus.
 *
 * The algorithm is arithmetic on the year alone — no table, no lookup, valid for any Gregorian year.
 * Good Friday is two days before and Family Day is the day after, which is why this is the only
 * moving part the South African calendar has.
 *
 * Verified against the observed dates in sixteen months of the practice's own rosters: Good Friday
 * 18 April 2025 and 3 April 2026 both fall out of this function.
 */
export function easterSunday(year: number): IsoDate {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return toIso(year, month, day);
}

/** Good Friday: the Friday before Easter Sunday. */
export function goodFriday(year: number): IsoDate {
  return addDays(easterSunday(year), -2);
}

/**
 * Family Day: the Monday after Easter Sunday.
 *
 * Named *Family Day* in South Africa, not *Easter Monday*. The practice's own sheets use Family Day
 * and so does the glossary, so the name is not a detail — it is what gets printed.
 */
export function familyDay(year: number): IsoDate {
  return addDays(easterSunday(year), 1);
}

/**
 * Every statutory holiday of a year, before the s2(1) Sunday rule is applied.
 *
 * Coincident holidays are merged into one dated entry carrying both names — see the module
 * docblock. Names are joined in calendar-list order (Schedule 1's fixed dates first, then the Easter
 * pair) so the result is stable rather than depending on which happened to be constructed first.
 */
function scheduleOne(year: number): readonly PublicHoliday[] {
  const all: readonly { readonly date: IsoDate; readonly name: string }[] = [
    ...FIXED_HOLIDAYS.map((entry) => ({
      date: `${String(year)}-${entry.monthDay}`,
      name: entry.name,
    })),
    { date: goodFriday(year), name: 'Good Friday' },
    { date: familyDay(year), name: 'Family Day' },
  ];

  const byDate = new Map<IsoDate, string[]>();
  for (const entry of all) {
    const names = byDate.get(entry.date);
    if (names === undefined) {
      byDate.set(entry.date, [entry.name]);
    } else {
      names.push(entry.name);
    }
  }

  return [...byDate].map(([date, names]) => ({
    date,
    name: names.join(' / '),
    origin: 'statutory' as const,
  }));
}

/**
 * Every public holiday of a calendar year under the Act, including s2(1) observances.
 *
 * A statutory holiday falling on a Sunday produces **two** entries: the Sunday itself, which the Act
 * never stops being a public holiday, and the following Monday, which s2(1) creates. The transcribed
 * history flags both for Youth Day 2024 and the reasoning is written into that month's notes.
 *
 * Where the Monday is already a holiday the observance is **suppressed rather than pushed to the
 * Tuesday** — the Act creates no such cascade, and history shows a proclamation filling the gap
 * instead. {@link suppressedObservances} reports those.
 */
export function statutoryHolidays(year: number): readonly PublicHoliday[] {
  const base = scheduleOne(year);
  const taken = new Set(base.map((holiday) => holiday.date));
  const observed: PublicHoliday[] = [];

  for (const holiday of base) {
    if (dayOfWeek(holiday.date) !== 0) {
      continue;
    }
    const monday = addDays(holiday.date, 1);
    if (taken.has(monday)) {
      continue;
    }
    taken.add(monday);
    observed.push({
      date: monday,
      name: `${holiday.name} (observed)`,
      origin: 'observed',
      observedFor: holiday.date,
    });
  }

  return [...base, ...observed].sort((left, right) => left.date.localeCompare(right.date));
}

/**
 * Statutory holidays whose s2(1) observance collided with another holiday and was dropped.
 *
 * Worth surfacing to an admin *before* they build that month's roster: it is the one case where the
 * statutory calendar produces fewer days off than people expect, and the historical remedy has been
 * a proclamation on the next working day.
 */
export function suppressedObservances(year: number): readonly SuppressedObservance[] {
  const base = scheduleOne(year);
  const byDate = new Map(base.map((holiday) => [holiday.date, holiday]));
  const found: SuppressedObservance[] = [];

  for (const holiday of base) {
    if (dayOfWeek(holiday.date) !== 0) {
      continue;
    }
    const monday = addDays(holiday.date, 1);
    const blocker = byDate.get(monday);
    if (blocker === undefined) {
      continue;
    }
    found.push({
      date: holiday.date,
      name: holiday.name,
      wouldObserveOn: monday,
      blockedBy: blocker.name,
    });
  }

  return found;
}

/**
 * Every public holiday from `start` to `end` inclusive, statutory and declared.
 *
 * A declaration on a date that is already statutorily a holiday is ignored rather than duplicated —
 * an admin marking Christmas as a holiday should be a no-op, not two entries in the export.
 */
export function holidaysInRange(
  start: IsoDate,
  end: IsoDate,
  declared: readonly DeclaredHoliday[] = [],
): readonly PublicHoliday[] {
  // Both dates are parsed BEFORE they are compared. String comparison on an unvalidated date
  // silently decides the argument order — `'not-a-date' > '2025-12-25'` — and the caller then gets
  // told their range is inverted when the real fault is a malformed date.
  const firstYear = parts(start).year;
  const lastYear = parts(end).year;
  if (end < start) {
    throw new Error(`range ends before it starts: ${start}..${end}`);
  }

  const collected: PublicHoliday[] = [];
  for (let year = firstYear; year <= lastYear; year += 1) {
    collected.push(...statutoryHolidays(year));
  }

  const statutoryDates = new Set(collected.map((holiday) => holiday.date));
  for (const entry of declared) {
    if (statutoryDates.has(entry.date)) {
      continue;
    }
    statutoryDates.add(entry.date);
    collected.push({ date: entry.date, name: entry.name, origin: 'declared' });
  }

  return collected
    .filter((holiday) => holiday.date >= start && holiday.date <= end)
    .sort((left, right) => left.date.localeCompare(right.date));
}

/**
 * A date-keyed lookup over {@link holidaysInRange}.
 *
 * The shape almost every caller actually wants: the export asks *"is this cell red?"* per day, and
 * the solver request builder asks *"is this date a public holiday?"* per day. Building the range
 * once and querying it beats recomputing the computus thirty times a month.
 */
export function holidayLookup(
  start: IsoDate,
  end: IsoDate,
  declared: readonly DeclaredHoliday[] = [],
): ReadonlyMap<IsoDate, PublicHoliday> {
  return new Map(holidaysInRange(start, end, declared).map((holiday) => [holiday.date, holiday]));
}
