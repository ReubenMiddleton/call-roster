/**
 * Builds a month's `RosterDay[]` from the calendar alone — for a month that has not happened yet.
 *
 * This is the last piece of *"set up next month"*. Until now every path into the solver derived its
 * days from **transcribed history**: `loadSeedPeriod` reads a sheet that already exists. That is the
 * right way to seed a fairness ledger and the wrong way to roster October, because October has no
 * sheet. Here the days come from the calendar, the practice's weekday defaults and the holiday rules
 * instead.
 *
 * What it deliberately does **not** produce is assignments. A future month has none — that is what
 * the solver is for.
 *
 * ## Undecided dates come back separately, not silently dropped
 *
 * {@link resolvePattern} refuses to choose a pattern for a public holiday that drops the weekday's
 * structure. Those dates cannot become a `RosterDay`, because a day with no pattern has no shifts and
 * a day with no shifts silently disappears from the roster. So they are returned in their own array,
 * and a caller that ignores it gets a month with a hole in it that it was told about.
 */

import { classifyDay } from '../analytics/shifts.ts';
import type { IsoMonth, RosterDay } from '../analytics/types.ts';
import {
  type PatternResolution,
  type PrecedenceInput,
  resolveMonth,
} from './pattern-precedence.ts';

export interface MonthDays {
  /** Dates whose structure is settled, ready for `buildSolveRequest`. */
  readonly days: readonly RosterDay[];
  /**
   * Dates a human must settle first. **Not in `days`.**
   *
   * Empty in most months — measured at roughly one date every four months for the pilot practice.
   */
  readonly undecided: readonly PatternResolution[];
}

/**
 * Every date of `month`, resolved.
 *
 * `dayClass` comes from {@link classifyDay}, so a holiday falling on a weekend still classifies as
 * the weekend day — the burden ordering the principal confirmed. `isPublicHoliday` carries the
 * calendar fact alongside it, because `dayClass` is lossy about exactly that case.
 */
export function rosterDaysForMonth(month: IsoMonth, input: PrecedenceInput): MonthDays {
  const resolutions = resolveMonth(month, input);
  const days: RosterDay[] = [];
  const undecided: PatternResolution[] = [];

  for (const resolution of resolutions) {
    if (resolution.patternId === undefined) {
      undecided.push(resolution);
      continue;
    }
    days.push({
      date: resolution.date,
      patternId: resolution.patternId,
      dayClass: classifyDay(resolution.date, resolution.isPublicHoliday),
      isPublicHoliday: resolution.isPublicHoliday,
    });
  }

  return { days, undecided };
}
