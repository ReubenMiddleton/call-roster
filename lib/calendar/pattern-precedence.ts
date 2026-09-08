/**
 * Which shift pattern applies to a date, and when the calendar refuses to say.
 *
 * The executable form of the *Precedence* section of
 * [`docs/domain/shift-patterns.md`](../../docs/domain/shift-patterns.md), whose four levels are
 * `[CONFIRMED]`:
 *
 * 1. An explicit **per-date custom shift set** — admin-defined, fully arbitrary.
 * 2. An explicit **per-date named pattern** override.
 * 3. **Public-holiday behaviour** — which *removes* a pattern but does not choose a replacement.
 * 4. The **weekday default**.
 *
 * ## Why this module exists
 *
 * Everything upstream of it derives a month's days from *transcribed history*, so the project can
 * solve a month that has already happened and cannot yet describe one that has not. Rostering next
 * month starts here: given a month and the practice's defaults, what is each date's shift structure?
 *
 * ## The one thing it deliberately will not do
 *
 * **A public holiday falling on a Friday drops Pattern B, and the calendar does not choose what
 * replaces it.** `[CONFIRMED]` So {@link resolvePattern} returns `needsDecision: true` with no
 * `patternId`, and the product must ask.
 *
 * It **suggests** instead, via {@link PrecedenceInput.suggestWhenUndetermined}. The distinction is
 * the point: a suggestion the admin confirms with one click is nearly as cheap as a guess and cannot
 * be silently wrong, while a substitution prints and looks plausible.
 *
 * Holding the line here is a judgement, and worth stating because the evidence has moved. This
 * module was written believing `holidays.md`'s claim that holiday Fridays split three-to-one between
 * two patterns. **Running it over all 33 transcribed months falsified that**: eight holiday Fridays,
 * all eight Pattern A, and across 144 Fridays a Pattern A day *only ever* occurs on a holiday. The
 * old claim rested on a date the project brief mislabelled — 4 April 2025 was an ordinary Friday.
 *
 * Eight for eight is still not a rule. **`[CONFIRMED]` H-05, H-06 and H-07 were each written from
 * "zero counterexamples in sixteen months" and each was later falsified by the primary source.** The
 * practice's own documentation says what replaces the dropped pattern is *"a judgement call made on
 * the day"*, and a resolver that overrides a stated judgement call on eight observations would be
 * repeating the project's most expensive recurring mistake. So: suggest, and let him confirm.
 *
 * ## Written against patterns, never against weekdays
 *
 * {@link PrecedenceInput.holidaySuspends} is a set of **pattern ids**, not the string `'Friday'`.
 * This repository has been bitten twice by weekday-scoped rules that were really pattern-scoped —
 * H-06 and H-07, both falsified by a Friday running a different pattern. The rule is *"a holiday
 * drops the four-shift split"*, and the four-shift split is Pattern B wherever it lands.
 *
 * ## Weekday integers are safe here, and only here
 *
 * Indices are `dayOfWeek`'s: **0 = Sunday … 6 = Saturday**. That is the opposite of Python's, where
 * Monday is 0 — see `lib/contract/weekday.ts`. Nothing in this module crosses the solver boundary,
 * so an integer is fine; the moment one does, it becomes a name.
 */

import { dayOfWeek } from '../analytics/shifts.ts';
import type { IsoDate, IsoMonth, PatternId } from '../analytics/types.ts';
import type { PublicHoliday } from './holidays.ts';

/** Which precedence level decided the pattern. */
export type PatternSource =
  /** Level 1: the admin defined an arbitrary shift set for this date. */
  | 'custom-shifts'
  /** Level 2: the admin named a pattern for this date. */
  | 'date-override'
  /** Level 4: the weekday's default applied. */
  | 'weekday-default'
  /** Level 3 removed the default and nothing replaced it. A human has to choose. */
  | 'undetermined';

/** What applies to one date. */
export interface PatternResolution {
  readonly date: IsoDate;
  /** Absent only when `source` is `'undetermined'` or `'custom-shifts'`. */
  readonly patternId: PatternId | undefined;
  readonly source: PatternSource;
  readonly isPublicHoliday: boolean;
  readonly holidayName: string | undefined;
  /**
   * The admin must choose before this date can be rostered.
   *
   * Distinct from `source === 'custom-shifts'`, where they already have.
   */
  readonly needsDecision: boolean;
  /**
   * What to pre-select in the prompt. **Never applied**, and only ever set when `needsDecision`.
   *
   * A suggestion is not a resolution: `patternId` stays `undefined`, so anything that consumes the
   * resolution without asking a human still gets nothing, which is the correct outcome.
   */
  readonly suggestion: PatternId | undefined;
  /** Plain language, addressed to a non-technical admin rather than a developer. */
  readonly reason: string;
}

export interface PrecedenceInput {
  /**
   * The default pattern per weekday, indexed **0 = Sunday … 6 = Saturday**.
   *
   * Per-tenant data, never hard-coded into the resolver — see ADR-0010.
   * {@link PILOT_WEEKDAY_DEFAULTS_V1} is the pilot practice's.
   */
  readonly weekdayDefaults: readonly PatternId[];
  /** Public holidays covering the dates being resolved. From `holidayLookup`. */
  readonly holidays?: ReadonlyMap<IsoDate, PublicHoliday>;
  /** Level 2. A pattern the admin named for a specific date. */
  readonly dateOverrides?: ReadonlyMap<IsoDate, PatternId>;
  /** Level 1. Dates whose shift set the admin defined outright. */
  readonly customShiftDates?: ReadonlySet<IsoDate>;
  /**
   * Level 3. Patterns a public holiday removes.
   *
   * `{'B'}` for the pilot practice: a holiday drops Friday's four-shift split. Empty means holidays
   * change no structure, which is a legitimate configuration for a practice that works them
   * normally.
   */
  readonly holidaySuspends?: ReadonlySet<PatternId>;
  /**
   * What to offer when a holiday drops the weekday's pattern. Pre-selected, never applied.
   *
   * Per-tenant, like everything else here. {@link PILOT_HOLIDAY_FRIDAY_SUGGESTION_V1} is the pilot
   * practice's, and carries the evidence behind it.
   */
  readonly suggestWhenUndetermined?: PatternId;
}

/**
 * The pilot practice's weekday defaults. `[CONFIRMED]`
 *
 * Monday to Thursday and the weekend run Pattern A; Friday runs Pattern B's four-shift split. From
 * the weekday-default table in `docs/domain/shift-patterns.md`, verified across sixteen months.
 *
 * Named `PILOT_` rather than after the practice, like `PILOT_PATTERNS_V1`: nothing committed names
 * the practice.
 */
export const PILOT_WEEKDAY_DEFAULTS_V1: readonly PatternId[] = [
  'A', // Sunday
  'A', // Monday
  'A', // Tuesday
  'A', // Wednesday
  'A', // Thursday
  'B', // Friday — the four-shift split
  'A', // Saturday
];

/** Patterns a public holiday removes at the pilot practice. `[CONFIRMED]` */
export const PILOT_HOLIDAY_SUSPENDS_V1: ReadonlySet<PatternId> = new Set(['B']);

/**
 * What to pre-select when a holiday drops the pilot practice's Friday pattern. `[INFERRED]`
 *
 * Measured by `npm run seed:patterns` over all 33 transcribed months, not assumed:
 *
 * - **Eight** holiday Fridays in the source. **All eight ran Pattern A.**
 * - Of 144 Fridays, 132 ran the Pattern B default and 4 ran Pattern C on ordinary Fridays. A
 *   **Pattern A Friday occurs eight times and every one is a public holiday** — the structure is
 *   diagnostic, not incidental.
 *
 * **`[INFERRED]`, deliberately, and it must stay that way until a human says otherwise.** Eight
 * observations with no counterexample is exactly the evidence H-05, H-06 and H-07 were each written
 * from, and the primary source later falsified all three. So this is pre-selected in a prompt and
 * never applied — see the module docblock.
 */
export const PILOT_HOLIDAY_FRIDAY_SUGGESTION_V1: PatternId = 'A';

const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

/**
 * Resolves one date, applying the four precedence levels in order.
 *
 * Never throws on a date it cannot resolve. An unresolvable date is a normal, expected outcome that
 * the admin settles, not an error.
 */
export function resolvePattern(date: IsoDate, input: PrecedenceInput): PatternResolution {
  const holiday = input.holidays?.get(date);
  const isPublicHoliday = holiday !== undefined;
  const holidayName = holiday?.name;

  // ── Level 1: a custom shift set ────────────────────────────────────────────────────
  if (input.customShiftDates?.has(date) === true) {
    return {
      date,
      patternId: undefined,
      source: 'custom-shifts',
      isPublicHoliday,
      holidayName,
      needsDecision: false,
      suggestion: undefined,
      reason: 'This date has its own shift times, set by hand.',
    };
  }

  // ── Level 2: a named pattern for this date ─────────────────────────────────────────
  const override = input.dateOverrides?.get(date);
  if (override !== undefined) {
    return {
      date,
      patternId: override,
      source: 'date-override',
      isPublicHoliday,
      holidayName,
      needsDecision: false,
      suggestion: undefined,
      reason: `Pattern ${override} was chosen for this date.`,
    };
  }

  const weekday = dayOfWeek(date);
  const fallback = input.weekdayDefaults[weekday];
  const weekdayName = WEEKDAY_NAMES[weekday];
  if (fallback === undefined || weekdayName === undefined) {
    // Reached only when a caller supplies fewer than seven defaults. Saying so beats resolving
    // every date of one weekday to `undefined` and letting it look like a holiday rule.
    return {
      date,
      patternId: undefined,
      source: 'undetermined',
      isPublicHoliday,
      holidayName,
      needsDecision: true,
      suggestion: undefined,
      reason: `No default pattern is configured for weekday ${String(weekday)}.`,
    };
  }

  // ── Level 3: a public holiday removes the weekday's structure ──────────────────────
  if (isPublicHoliday && input.holidaySuspends?.has(fallback) === true) {
    const suggestion = input.suggestWhenUndetermined;
    return {
      date,
      patternId: undefined,
      source: 'undetermined',
      isPublicHoliday,
      holidayName,
      needsDecision: true,
      suggestion,
      reason:
        `${holidayName ?? 'A public holiday'} falls on a ${weekdayName}, which normally runs ` +
        `pattern ${fallback}. A public holiday drops that, and what replaces it is a decision ` +
        'made on the day. Choose the shift times.' +
        (suggestion === undefined ? '' : ` Pattern ${suggestion} is suggested, not applied.`),
    };
  }

  // ── Level 4: the weekday default ───────────────────────────────────────────────────
  return {
    date,
    patternId: fallback,
    source: 'weekday-default',
    isPublicHoliday,
    holidayName,
    needsDecision: false,
    suggestion: undefined,
    reason: `${weekdayName}s normally run pattern ${fallback}.`,
  };
}

/** Days in a calendar month. Day 0 of the next month is the last day of this one. */
function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

/**
 * Resolves every date of a month, in order.
 *
 * The entry point for *"set up next month"*: hand it a month and the practice's defaults and it
 * returns every date with its structure, or an explicit request for a decision.
 */
export function resolveMonth(
  month: IsoMonth,
  input: PrecedenceInput,
): readonly PatternResolution[] {
  const parts = month.split('-');
  const [year, monthNumber] = parts;
  if (parts.length !== 2 || year === undefined || monthNumber === undefined) {
    throw new Error(`not an ISO month: "${month}"`);
  }
  const yearNumber = Number(year);
  const monthIndex = Number(monthNumber) - 1;
  if (!Number.isInteger(yearNumber) || !Number.isInteger(monthIndex)) {
    throw new Error(`not an ISO month: "${month}"`);
  }
  if (monthIndex < 0 || monthIndex > 11) {
    throw new Error(`not an ISO month: "${month}"`);
  }

  const total = daysInMonth(yearNumber, monthIndex);
  const resolutions: PatternResolution[] = [];
  for (let day = 1; day <= total; day += 1) {
    resolutions.push(resolvePattern(`${month}-${String(day).padStart(2, '0')}`, input));
  }
  return resolutions;
}

/** The dates of a resolved month that a human still has to settle. */
export function datesNeedingDecision(
  resolutions: readonly PatternResolution[],
): readonly PatternResolution[] {
  return resolutions.filter((resolution) => resolution.needsDecision);
}
