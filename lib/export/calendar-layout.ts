/**
 * The month-grid layout: the geometry of the printable roster.
 *
 * **This is the most important module in the product.** The printed monthly grid is the artifact of
 * record, and the failure mode is precise: the principal builds a roster in the app, exports it,
 * decides it does not look right, rebuilds it in Word, does the work twice, and stops using the app.
 * See `docs/product/vision.md`.
 *
 * Derived from nineteen photographed exports covering December 2023 to June 2025, plus the fifteen
 * already held. Every rule below is something those sheets do, not something that seemed sensible.
 *
 * ## The layout, as the practice actually produces it
 *
 * Seven columns, **Sunday through Saturday**. Never more than five week-rows. A date's cell carries
 * the day number in the top-right and then one line per shift, name left and time right, with the
 * night shift separated by a gap.
 *
 * ## The five-row rule, which is the interesting part
 *
 * A Sunday-start calendar needs six rows for about a fifth of all months — ten of the forty-eight
 * between 2023 and 2026. **The practice never prints a sixth row.** Instead the trailing days wrap
 * into the *leading* empty cells of the first row:
 *
 * - **March 2025** (starts Saturday, 31 days) prints 30 and 31 in row one's Sunday and Monday cells.
 * - **June 2024** (starts Saturday, 30 days) prints 30 in row one's Sunday cell.
 * - **December 2023** (starts Friday, 31 days) prints 31 December in Sunday *and* 1 January in
 *   Monday — a wrapped own-day and a spill day side by side.
 *
 * So wrapping is deterministic and spill days are optional decoration that fills whatever leading or
 * trailing empties remain. Both land in the same cells, which is why they are computed together.
 *
 * **Getting this wrong is not cosmetic.** A sixth row changes the row height, which changes whether
 * the grid fits one page, which is the difference between a usable export and Word.
 */

import { dayOfWeek } from '../analytics/shifts.ts';
import type { IsoDate } from '../analytics/types.ts';

/** Columns, in print order. Sunday first — that is what the practice's sheets do. */
export const COLUMN_ORDER = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

export const COLUMNS = COLUMN_ORDER.length;

/** The practice never prints more than this many week-rows. */
export const MAX_WEEK_ROWS = 5;

/** One rendered shift line inside a cell. */
export interface CellLine {
  /** Doctor code. Resolved to a display name at the render edge, never here. */
  readonly doctor: string;
  /** As printed on the sheet: `7-15`, `23-7`, `17-23`. */
  readonly time: string;
  /**
   * Whether a visual gap precedes this line.
   *
   * The sheets put a blank line before the night shift, every time, on every sheet. It reads as
   * separating "the day" from "the night" and it is load-bearing for legibility at print size.
   */
  readonly gapBefore: boolean;
}

/** How a cell relates to the month being printed. */
export type CellKind =
  /** A date belonging to this month, in its natural calendar position. */
  | 'own'
  /** A date belonging to this month, moved into row one because the month needs six rows. */
  | 'wrapped'
  /** A date from the previous or next month, shown to fill an empty cell. */
  | 'spill';

export interface GridCell {
  readonly date: IsoDate;
  readonly kind: CellKind;
  /**
   * What the sheet prints as the day number.
   *
   * A plain number for an own-month date; day plus month name for a spill date, which is how the
   * sheets disambiguate — `1 Jan`, `1 April`, `1 Sept`. Wrapped dates print a plain number, because
   * they are still this month.
   */
  readonly label: string;
  readonly lines: readonly CellLine[];
  /** Set when the date is a public holiday, so the renderer can mark it. */
  readonly holidayName?: string;
}

export interface MonthGrid {
  /** `YYYY-MM`. */
  readonly month: string;
  /** Rows of exactly `COLUMNS` entries. `null` is an empty cell. */
  readonly weeks: readonly (readonly (GridCell | null)[])[];
  /** True when trailing days had to be wrapped into row one. */
  readonly wrapped: boolean;
}

/** One date's worth of input. Shift order is the caller's; it is preserved. */
export interface LayoutDay {
  readonly date: IsoDate;
  readonly holidayName?: string;
  readonly lines: readonly { readonly doctor: string; readonly time: string }[];
}

export interface LayoutInput {
  /** `YYYY-MM`. */
  readonly month: string;
  /** Dates belonging to this month. Order does not matter; they are sorted. */
  readonly days: readonly LayoutDay[];
  /** Dates from the adjacent months to show in empty cells, if any fit. */
  readonly spillDays?: readonly LayoutDay[];
}

const MONTH_LABELS = [
  'Jan',
  'Feb',
  'March',
  'April',
  'May',
  'June',
  'July',
  'Aug',
  'Sept',
  'Oct',
  'Nov',
  'Dec',
] as const;

function parseMonth(month: string): { year: number; monthIndex: number } {
  const parts = month.split('-');
  const [year, monthNumber] = parts;
  if (parts.length !== 2 || year === undefined || monthNumber === undefined) {
    throw new Error(`not an ISO month: "${month}"`);
  }
  const parsedYear = Number(year);
  const parsedMonth = Number(monthNumber);
  if (!Number.isInteger(parsedYear) || parsedMonth < 1 || parsedMonth > 12) {
    throw new Error(`not an ISO month: "${month}"`);
  }
  return { year: parsedYear, monthIndex: parsedMonth - 1 };
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

/**
 * A night shift is the one that starts at 23:00. Detected from the printed time rather than a shift
 * id, because the gap is a property of *what the sheet shows*, not of the data model.
 */
function isNightTime(time: string): boolean {
  return time.startsWith('23-');
}

function toLines(day: LayoutDay): CellLine[] {
  return day.lines.map((line) => ({
    doctor: line.doctor,
    time: line.time,
    gapBefore: isNightTime(line.time),
  }));
}

/** Spill labels carry the month, because that is how the sheets disambiguate them. */
function spillLabel(date: IsoDate): string {
  const parts = date.split('-');
  const [, monthNumber, dayNumber] = parts;
  if (monthNumber === undefined || dayNumber === undefined) {
    throw new Error(`not an ISO date: "${date}"`);
  }
  const name = MONTH_LABELS[Number(monthNumber) - 1];
  if (name === undefined) {
    throw new Error(`not an ISO date: "${date}"`);
  }
  return `${String(Number(dayNumber))} ${name}`;
}

function ownLabel(date: IsoDate): string {
  const dayNumber = date.split('-')[2];
  if (dayNumber === undefined) {
    throw new Error(`not an ISO date: "${date}"`);
  }
  return String(Number(dayNumber));
}

/**
 * Lays out one month into at most five week-rows.
 *
 * Throws rather than silently truncating if a month cannot be made to fit. That cannot happen for a
 * real Gregorian month — the worst case is six rows and one wrap always resolves it — so the throw
 * is a guard against a bad `month` string rather than a condition to handle.
 */
export function layoutMonth(input: LayoutInput): MonthGrid {
  const { year, monthIndex } = parseMonth(input.month);
  const total = daysInMonth(year, monthIndex);
  const firstDate = `${input.month}-01`;
  const leadingEmpties = dayOfWeek(firstDate);

  const byDate = new Map<IsoDate, LayoutDay>();
  for (const day of input.days) {
    byDate.set(day.date, day);
  }

  // How many trailing days will not fit in five rows.
  const naturalCells = leadingEmpties + total;
  const capacity = MAX_WEEK_ROWS * COLUMNS;
  const overflow = Math.max(0, naturalCells - capacity);
  if (overflow > leadingEmpties) {
    throw new Error(
      `month ${input.month} needs ${String(overflow)} wrapped cells but has only ${String(leadingEmpties)} leading empties`,
    );
  }

  const cells: (GridCell | null)[] = Array.from({ length: capacity }, () => null);

  // 1. Wrapped days first: the last `overflow` dates of the month, into row one from the left.
  for (let index = 0; index < overflow; index += 1) {
    const dayNumber = total - overflow + index + 1;
    const date = `${input.month}-${String(dayNumber).padStart(2, '0')}`;
    const day = byDate.get(date);
    cells[index] = {
      date,
      kind: 'wrapped',
      label: ownLabel(date),
      lines: day === undefined ? [] : toLines(day),
      ...(day?.holidayName === undefined ? {} : { holidayName: day.holidayName }),
    };
  }

  // 2. The month's own days, in their natural positions, excluding any that were wrapped.
  for (let dayNumber = 1; dayNumber <= total - overflow; dayNumber += 1) {
    const date = `${input.month}-${String(dayNumber).padStart(2, '0')}`;
    const day = byDate.get(date);
    cells[leadingEmpties + dayNumber - 1] = {
      date,
      kind: 'own',
      label: ownLabel(date),
      lines: day === undefined ? [] : toLines(day),
      ...(day?.holidayName === undefined ? {} : { holidayName: day.holidayName }),
    };
  }

  // 3. Spill days fill whatever empties remain, matched by their real weekday so a Sunday spill
  //    lands in the Sunday column. A spill with no free cell in its own column is dropped rather
  //    than moved: putting 1 April in a Tuesday column would misprint the calendar.
  for (const spill of input.spillDays ?? []) {
    const column = dayOfWeek(spill.date);
    for (let row = 0; row < MAX_WEEK_ROWS; row += 1) {
      const position = row * COLUMNS + column;
      if (cells[position] === null) {
        cells[position] = {
          date: spill.date,
          kind: 'spill',
          label: spillLabel(spill.date),
          lines: toLines(spill),
          ...(spill.holidayName === undefined ? {} : { holidayName: spill.holidayName }),
        };
        break;
      }
    }
  }

  const weeks: (GridCell | null)[][] = [];
  for (let row = 0; row < MAX_WEEK_ROWS; row += 1) {
    weeks.push(cells.slice(row * COLUMNS, (row + 1) * COLUMNS));
  }

  // Trim trailing rows that are entirely empty. A month starting on a Sunday with 28 days fills
  // four rows exactly, and printing a blank fifth changes the row height on the page.
  while (weeks.length > 1) {
    const last = weeks[weeks.length - 1];
    if (last?.every((cell) => cell === null) === true) {
      weeks.pop();
    } else {
      break;
    }
  }

  return { month: input.month, weeks, wrapped: overflow > 0 };
}
