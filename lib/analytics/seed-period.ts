/**
 * Loads transcribed roster history into a `RosterPeriod`.
 *
 * The transcription format is the one produced during the August 2026 seeding pass and validated
 * by `scripts/validate-seed-data.mjs`. The files themselves live in `private/seed-data/` and are
 * never committed — fifteen months of day-by-day movements for thirteen identifiable people is
 * exactly what the data boundary exists for. A synthetic fixture with the same shape lives in
 * `fixtures/seed-data/` for tests.
 *
 * This module exists so the analytics engine has one entry point for historical data and the
 * shape decisions below are made once, visibly.
 */

import { classifyDay } from './shifts.ts';
import type { Assignment, IsoDate, RosterDay, RosterPeriod } from './types.ts';

/** One date in a transcribed sheet. */
export interface SeedDay {
  readonly date: IsoDate;
  readonly patternId: string;
  readonly isPublicHoliday?: boolean;
  readonly holidayName?: string;
  /** Shift id to doctor code. A slot the sheet left blank is absent, not null. */
  readonly assignments: Readonly<Record<string, string>>;
}

/** One transcribed monthly sheet. */
export interface SeedMonthDocument {
  readonly month: string;
  readonly source?: string;
  readonly verified?: boolean;
  readonly notes?: string;
  readonly days: readonly SeedDay[];
  /**
   * Dates printed on this sheet that belong to an adjacent month — the leading and trailing cells
   * a calendar grid needs to fill its first and last week.
   */
  readonly spillDays?: readonly SeedDay[];
  readonly anomalies?: readonly {
    readonly date: string;
    readonly kind: string;
    readonly detail: string;
  }[];
}

/**
 * Dates whose burden is not explained by the calendar alone.
 *
 * Keyed by `MM-DD`, so they recur without being restated per year. Deliberately short: a list of
 * "hard dates" is a place where someone else's assumptions accumulate, and the burden schedule is
 * where the practice's actual view belongs.
 *
 * Exported: `lib/server/ledger.ts` builds `RosterDay`s from live database rows the same way this
 * module builds them from transcribed seed JSON, and `specialDate` has to be computed identically
 * in both places or `AGREED_BURDEN_V2`'s Christmas/New Year's Eve rules silently stop firing for
 * one of the two.
 */
export const NAMED_SPECIAL_DATES: Readonly<Record<string, string>> = {
  '12-25': 'christmas',
  '12-31': 'new-years-eve',
};

export interface LoadOptions {
  /**
   * Include the adjacent-month cells printed on each sheet.
   *
   * **Default false, and it should stay false.** Spill days are duplicates: the sheet that owns
   * the date carries it too, and the owning sheet is authoritative where the two disagree — a rule
   * adopted after December 2025 and January 2026 were found to name different doctors for the
   * night of 1 January. Including them double-counts burden and silently inflates the ledger.
   */
  readonly includeSpillDays?: boolean;
}

/**
 * Flattens transcribed months into one period.
 *
 * Every assignment gets provenance `unknown`: the sheets record *who worked*, never *why*. That is
 * a fact about the source material, not a default to be quietly upgraded — see
 * `EQUALISABLE_PROVENANCES` in `ledger.ts`.
 */
export function loadSeedPeriod(
  documents: readonly SeedMonthDocument[],
  label: string,
  options: LoadOptions = {},
): RosterPeriod {
  const includeSpill = options.includeSpillDays ?? false;
  const days: RosterDay[] = [];
  const assignments: Assignment[] = [];
  const seenDates = new Set<IsoDate>();

  const sorted = [...documents].sort((a, b) => a.month.localeCompare(b.month));

  for (const document of sorted) {
    const sheetDays = includeSpill
      ? [...document.days, ...(document.spillDays ?? [])]
      : document.days;

    for (const seedDay of sheetDays) {
      if (seenDates.has(seedDay.date)) {
        // Two sheets claiming the same date. With spill days excluded this means duplicate
        // months in the input, which would double every figure in the report.
        throw new Error(
          `date ${seedDay.date} appears twice while loading "${label}"; check for duplicate month files`,
        );
      }
      seenDates.add(seedDay.date);

      const monthDay = seedDay.date.slice(5);
      const specialDate = NAMED_SPECIAL_DATES[monthDay];

      days.push({
        date: seedDay.date,
        patternId: seedDay.patternId,
        dayClass: classifyDay(seedDay.date, seedDay.isPublicHoliday === true),
        // Carried through as well as folded into dayClass. classifyDay lets Saturday and Sunday
        // outrank public-holiday, so for a weekend holiday dayClass alone loses the fact.
        isPublicHoliday: seedDay.isPublicHoliday === true,
        ...(specialDate === undefined ? {} : { specialDate }),
      });

      for (const [shiftId, doctor] of Object.entries(seedDay.assignments)) {
        assignments.push({ date: seedDay.date, shiftId, doctor, provenance: 'unknown' });
      }
    }
  }

  days.sort((a, b) => a.date.localeCompare(b.date));
  assignments.sort((a, b) => a.date.localeCompare(b.date) || a.shiftId.localeCompare(b.shiftId));

  return { label, days, assignments };
}

/**
 * Splits a period into calendar months, preserving each day's classification.
 *
 * Used for the month-over-month views: burden per doctor per month, and the year-end spike the
 * practice absorbs every December.
 */
export function splitByMonth(period: RosterPeriod): readonly RosterPeriod[] {
  const months = new Map<string, { days: RosterDay[]; assignments: Assignment[] }>();

  const bucket = (month: string) => {
    let existing = months.get(month);
    if (existing === undefined) {
      existing = { days: [], assignments: [] };
      months.set(month, existing);
    }
    return existing;
  };

  for (const day of period.days) {
    bucket(day.date.slice(0, 7)).days.push(day);
  }
  for (const assignment of period.assignments) {
    bucket(assignment.date.slice(0, 7)).assignments.push(assignment);
  }

  return [...months.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, contents]) => ({
      label: month,
      days: contents.days,
      assignments: contents.assignments,
    }));
}
